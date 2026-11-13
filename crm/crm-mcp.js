"use strict";

// MCP (Model Context Protocol) — Protokollseite des headless CRM.
//
// Spricht JSON-RPC 2.0 mit den MCP-Methoden initialize, ping, tools/list,
// tools/call, resources/list und resources/read. Der Dispatcher ist
// transportlos: crm-server.js laedt ihn hinter POST /mcp (Streamable HTTP),
// starteMcpStdio() bedient einen lokalen Agenten ueber stdin/stdout.

const { CRM_VERSION, CRM_AGENT_NAME } = require("./crm-core");

const PROTOKOLLVERSION = "2025-06-18";
const UNTERSTUETZTE_VERSIONEN = ["2025-06-18", "2025-03-26", "2024-11-05"];

const FEHLER_PARSE = -32700;
const FEHLER_UNGUELTIG = -32600;
const FEHLER_METHODE = -32601;
const FEHLER_PARAMETER = -32602;
const FEHLER_INTERN = -32603;

function rpcFehler(id, code, meldung) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message: meldung } };
}

function erstelleMcpVerbindung(kontext) {
  async function verarbeite(nachricht) {
    if (!nachricht || typeof nachricht !== "object" || Array.isArray(nachricht)) {
      return rpcFehler(null, FEHLER_UNGUELTIG, "Die Nachricht muss ein JSON-RPC-2.0-Objekt sein.");
    }
    const { jsonrpc, id, method, params } = nachricht;
    const ohneAntwort = id === undefined || id === null;
    if (jsonrpc !== "2.0") {
      return rpcFehler(id ?? null, FEHLER_UNGUELTIG, 'jsonrpc muss "2.0" sein.');
    }
    if (typeof method !== "string") {
      return ohneAntwort ? null : rpcFehler(id, FEHLER_METHODE, "Die Nachricht nennt keine Methode.");
    }
    try {
      switch (method) {
        case "initialize": {
          if (ohneAntwort) return rpcFehler(null, FEHLER_UNGUELTIG, "initialize braucht eine id.");
          const gewuenscht = params?.protocolVersion;
          const version = UNTERSTUETZTE_VERSIONEN.includes(gewuenscht) ? gewuenscht : PROTOKOLLVERSION;
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: version,
              capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
              serverInfo: { name: CRM_AGENT_NAME, version: CRM_VERSION, title: "UnitedShare Headless-CRM" },
              instructions:
                "Headless Parquet-Vault-CRM: CRM-Fragen aus Parquet-Dateien im Tresor, nur lesend. " +
                "Werkzeuge: crm_dateien, crm_schema, crm_uebersicht, crm_fuellstand, crm_suchen, " +
                "crm_geburtsmonat, crm_faelligkeiten(+zusammenfassung), crm_dubletten, crm_werbequellen, " +
                "crm_regionen, crm_altersgruppen, crm_sql, crm_abfragen, crm_abfrage_datei. " +
                "Ergebnisse sind JSON mit daten, zeilen, ingesamt und abgeschnitten — nichts wird still gekuerzt.",
            },
          };
        }
        case "notifications/initialized":
        case "notifications/cancelled":
          return null;
        case "ping":
          return ohneAntwort ? null : { jsonrpc: "2.0", id, result: {} };
        case "tools/list": {
          const werkzeuge = await kontext.werkzeuge();
          return ohneAntwort
            ? null
            : {
                jsonrpc: "2.0",
                id,
                result: {
                  tools: werkzeuge.map((w) => ({
                    name: w.name,
                    title: w.titel,
                    description: w.beschreibung,
                    inputSchema: w.eingabeSchema,
                  })),
                },
              };
        }
        case "tools/call": {
          if (ohneAntwort) return rpcFehler(null, FEHLER_PARAMETER, "tools/call braucht eine id.");
          const werkzeuge = await kontext.werkzeuge();
          const werkzeug = werkzeuge.find((w) => w.name === params?.name);
          if (!werkzeug) {
            const namen = werkzeuge.map((w) => w.name).join(", ");
            return rpcFehler(id, FEHLER_PARAMETER, `Unbekanntes Werkzeug ${JSON.stringify(params?.name)}. Verfuegbar: ${namen}`);
          }
          try {
            const ergebnis = await werkzeug.ausfuehren(params?.arguments ?? {}, kontext);
            return {
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: JSON.stringify(ergebnis, null, 2) }], isError: false },
            };
          } catch (fehler) {
            return {
              jsonrpc: "2.0",
              id,
              result: { content: [{ type: "text", text: String(fehler?.message ?? fehler) }], isError: true },
            };
          }
        }
        case "resources/list": {
          const ressourcen = await kontext.ressourcen();
          return ohneAntwort ? null : { jsonrpc: "2.0", id, result: { resources: ressourcen } };
        }
        case "resources/read": {
          if (ohneAntwort) return rpcFehler(null, FEHLER_PARAMETER, "resources/read braucht eine id.");
          try {
            const inhalt = await kontext.ressourceLesen(params?.uri);
            return { jsonrpc: "2.0", id, result: { contents: [inhalt] } };
          } catch (fehler) {
            return rpcFehler(id, FEHLER_PARAMETER, String(fehler?.message ?? fehler));
          }
        }
        default:
          return ohneAntwort ? null : rpcFehler(id, FEHLER_METHODE, `Methode nicht bekannt: ${method}`);
      }
    } catch (fehler) {
      return ohneAntwort ? null : rpcFehler(id, FEHLER_INTERN, `Interner Fehler: ${fehler?.message ?? fehler}`);
    }
  }
  return { verarbeite };
}

// MCP ueber stdio: eine JSON-RPC-Nachricht je Zeile, Antworten auf stdout,
// Begleittext nur auf stderr. Fuer lokale Agenten — kein Token noetig.
function starteMcpStdio(kontext) {
  const verbindung = erstelleMcpVerbindung(kontext);
  const sende = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
  async function zeile(zeilenText) {
    let nachricht;
    try { nachricht = JSON.parse(zeilenText); }
    catch {
      sende(rpcFehler(null, FEHLER_PARSE, "Nachricht war kein gueltiges JSON."));
      return;
    }
    try {
      const antwort = await verbindung.verarbeite(nachricht);
      if (antwort) sende(antwort);
    } catch (fehler) {
      sende(rpcFehler(nachricht?.id ?? null, FEHLER_INTERN, `Interner Fehler: ${fehler?.message ?? fehler}`));
    }
  }
  let puffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (stueck) => {
    puffer += stueck;
    let index;
    while ((index = puffer.indexOf("\n")) >= 0) {
      const zeilenText = puffer.slice(0, index).trim();
      puffer = puffer.slice(index + 1);
      if (zeilenText) zeile(zeilenText);
    }
  });
  process.stdin.on("end", () => process.exit(0));
  process.stderr.write(
    `UnitedShare CRM über stdio: JSON-RPC 2.0, eine Nachricht je Zeile. Tresor: ${kontext.cfg.vault || "(kein Tresor gefunden)"}\n`,
  );
  return { verarbeite: zeile };
}

module.exports = {
  PROTOKOLLVERSION,
  UNTERSTUETZTE_VERSIONEN,
  FEHLER_PARSE,
  FEHLER_UNGUELTIG,
  FEHLER_METHODE,
  FEHLER_PARAMETER,
  FEHLER_INTERN,
  rpcFehler,
  erstelleMcpVerbindung,
  starteMcpStdio,
};
