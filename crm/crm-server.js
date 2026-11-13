"use strict";

// Loopback-HTTP-Server des headless CRM: MCP (POST /mcp), ACP (/acp/*) und
// /health hinter EINEM Token. Bindet standardmaessig auf 127.0.0.1; ein
// anderer Host (z. B. die Tailscale-Adresse) ist bewusst erst nach
// ausdruecklicher Angabe moeglich. Jeder Aufruf braucht den Token — auch
// /health, weil sie den Tresor nennt.

const http = require("node:http");
const { randomUUID, timingSafeEqual } = require("node:crypto");
const { erstelleMcpVerbindung, rpcFehler } = require("./crm-mcp");
const { erstelleAcpVerbindung } = require("./crm-acp");
const {
  CRM_VERSION, CRM_AGENT_NAME, STANDARD_AGENT_URL,
  parquetDateienImVault, inGrenzen,
} = require("./crm-core");

const KOERPER_OBERGRENZE = 1024 * 1024;

function tokenStimmt(anfrage, token) {
  const kopf = anfrage.headers.authorization;
  const alternativ = anfrage.headers["x-unitedshare-token"];
  const roh = typeof kopf === "string" && kopf.startsWith("Bearer ") ? kopf.slice(7) : (alternativ ?? "");
  const geheimnis = Buffer.from(token);
  const kandidat = Buffer.from(String(roh));
  if (kandidat.length !== geheimnis.length) return false;
  return timingSafeEqual(kandidat, geheimnis);
}

function sendeJson(antwort, status, objekt, extraKopf = {}) {
  const text = JSON.stringify(objekt);
  antwort.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text), ...extraKopf });
  antwort.end(text);
}

function leseKoerper(anfrage) {
  return new Promise((loesen, verwerfen) => {
    let roh = "";
    anfrage.setEncoding("utf8");
    anfrage.on("data", (stueck) => {
      roh += stueck;
      if (roh.length > KOERPER_OBERGRENZE) {
        const fehler = new Error(`Der Koerper ist groesser als ${KOERPER_OBERGRENZE} Bytes.`);
        fehler.statusFuerHttp = 413;
        verwerfen(fehler);
        anfrage.destroy();
      }
    });
    anfrage.on("end", () => loesen(roh));
    anfrage.on("error", verwerfen);
  });
}

async function starteCrmServer(kontext, optionen = {}) {
  const host = optionen.host ?? "127.0.0.1";
  const port = inGrenzen(optionen.port, 0, 65535, 8787);
  const token = optionen.token ?? process.env.CRM_TOKEN ?? randomUUID();

  const mcp = erstelleMcpVerbindung(kontext);
  const acp = erstelleAcpVerbindung(kontext);
  const sitzungen = new Set();

  const server = http.createServer(async (anfrage, antwort) => {
    try {
      const url = new URL(anfrage.url ?? "/", "http://lokal");
      const pfad = url.pathname;
      if (!tokenStimmt(anfrage, token)) {
        sendeJson(antwort, 401, { code: "unauthorized", message: "Token fehlt oder ist falsch. Er steht beim Serverstart in der Konsole (oder kommt aus CRM_TOKEN)." });
        return;
      }
      if (pfad === "/health" && anfrage.method === "GET") {
        let dateien = [];
        try { dateien = await parquetDateienImVault(kontext.cfg); } catch { dateien = []; }
        sendeJson(antwort, 200, {
          status: "ok",
          agent: CRM_AGENT_NAME,
          version: CRM_VERSION,
          tresor: kontext.cfg.vault,
          parquetDateien: dateien,
          werkzeuge: (await kontext.werkzeuge()).map((w) => w.name),
          mcp: "POST /mcp",
          acp: "/acp/ping, /acp/agents, /acp/runs",
          agentUrl: STANDARD_AGENT_URL,
        });
        return;
      }
      if (pfad === "/mcp") {
        if (anfrage.method === "GET") {
          sendeJson(antwort, 405, { code: "method_not_allowed", message: "Kein SSE-Push: MCP-Nachrichten per POST /mcp senden." });
          return;
        }
        if (anfrage.method === "DELETE") {
          const sitzung = anfrage.headers["mcp-session-id"];
          if (sitzung) sitzungen.delete(String(sitzung));
          antwort.writeHead(204);
          antwort.end();
          return;
        }
        if (anfrage.method !== "POST") {
          sendeJson(antwort, 405, { code: "method_not_allowed", message: "MCP nutzt POST /mcp (und DELETE /mcp zum Beenden)." });
          return;
        }
        const roh = await leseKoerper(anfrage);
        let nachrichten;
        try { nachrichten = JSON.parse(roh); }
        catch {
          sendeJson(antwort, 400, rpcFehler(null, -32700, "Der Koerper war kein gueltiges JSON."));
          return;
        }
        const liste = Array.isArray(nachrichten) ? nachrichten : [nachrichten];
        const initialisiert = liste.some((n) => n && n.method === "initialize" && n.id != null);
        const sitzungsKopf = anfrage.headers["mcp-session-id"];
        if (!initialisiert) {
          if (!sitzungsKopf) {
            sendeJson(antwort, 400, { code: "invalid_input", message: "Kopf Mcp-Session-Id fehlt — erst initialize senden, die Antwort nennt die Sitzung." });
            return;
          }
          if (!sitzungen.has(String(sitzungsKopf))) {
            sendeJson(antwort, 404, { code: "not_found", message: "Sitzung unbekannt oder beendet — neu initialisieren." });
            return;
          }
        }
        const antworten = [];
        for (const nachricht of liste) antworten.push(await mcp.verarbeite(nachricht));
        const echte = antworten.filter(Boolean);
        const extraKopf = {};
        if (initialisiert) {
          const sitzung = randomUUID();
          sitzungen.add(sitzung);
          extraKopf["Mcp-Session-Id"] = sitzung;
        }
        if (Array.isArray(nachrichten)) {
          if (echte.length === 0) { antwort.writeHead(202, extraKopf); antwort.end(); return; }
          sendeJson(antwort, 200, echte, extraKopf);
          return;
        }
        sendeJson(antwort, 200, echte[0] ?? null, extraKopf);
        return;
      }
      if (pfad === "/acp" || pfad.startsWith("/acp/")) {
        const unterpfad = pfad.replace(/^\/acp\/?/, "/");
        let koerperObjekt;
        if (anfrage.method === "POST") {
          const roh = await leseKoerper(anfrage);
          try { koerperObjekt = JSON.parse(roh); }
          catch {
            sendeJson(antwort, 400, { code: "invalid_input", message: "Der Koerper war kein gueltiges JSON." });
            return;
          }
        }
        const ergebnis = await acp.bediene(anfrage.method, unterpfad, koerperObjekt);
        if (ergebnis.typ === "text/event-stream") {
          antwort.writeHead(ergebnis.status, { "Content-Type": "text/event-stream" });
          antwort.end(ergebnis.koerper);
          return;
        }
        sendeJson(antwort, ergebnis.status, ergebnis.koerper);
        return;
      }
      sendeJson(antwort, 404, { code: "not_found", message: `Unbekannter Pfad: ${pfad}. Vorhanden: /health, /mcp, /acp/*.` });
    } catch (fehler) {
      sendeJson(antwort, fehler?.statusFuerHttp ?? 500, { code: "server_error", message: String(fehler?.message ?? fehler) });
    }
  });

  await new Promise((loesen, verwerfen) => {
    server.once("error", verwerfen);
    server.listen(port, host, () => loesen());
  });

  const echteAdresse = server.address();
  return {
    server,
    host,
    port: echteAdresse.port,
    token,
    adresse: `http://${host}:${echteAdresse.port}`,
    sitzungen,
    schliessen: () => new Promise((loesen) => server.close(loesen)),
  };
}

module.exports = { starteCrmServer, tokenStimmt };
