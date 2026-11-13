"use strict";

// ACP (Agent Communication Protocol, Version 0.2.0 von i-am-bee/acp) —
// REST-Seite des headless CRM. Ein Agent stellt Discovery- und Lauf-Fragen:
//   GET  /agents              Agenten entdecken
//   GET  /agents/{name}       Agenten-Manifest
//   POST /runs                einen Lauf starten (mode: sync | async | stream)
//   GET  /runs/{run_id}       Laufzustand lesen
//   POST /runs/{run_id}/cancel
//   GET  /runs/{run_id}/events
//   GET  /ping
// Eingabe an den Agenten ist Text: entweder {"werkzeug","argumente"} als
// JSON oder eine lesende SQL-Abfrage (SELECT/WITH). Fehler folgen der
// Spec-Form {code, message[, data]} mit code aus invalid_input | not_found
// | server_error. Ehrliche Grenzen dieses Baus: Laeufe sind synchron —
// mode:async liefert den fertigen Lauf (202), mode:stream die beiden
// Ereignisse run.created + run.completed|run.failed als SSE-Text.

const { randomUUID } = require("node:crypto");
const { CRM_AGENT_NAME, CRM_VERSION } = require("./crm-core");

const AGENT_MANIFEST = {
  name: CRM_AGENT_NAME,
  description:
    "Headless Parquet-Vault-CRM (lesend): Kennzahlen, Suche, Dubletten, Geburtstage, " +
    'Faelligkeiten und freie SELECT-Abfragen über Parquet im Tresor. Eingabe: Text mit ' +
    '{"werkzeug","argumente"} (JSON) oder eine SQL-Abfrage, die mit SELECT/WITH beginnt.',
  input_content_types: ["text/plain", "application/json"],
  output_content_types: ["application/json"],
  metadata: { version: CRM_VERSION, protokoll: "ACP 0.2.0 (Subset)" },
};

function acpFehler(code, meldung, daten) {
  const fehler = new Error(meldung);
  fehler.acpCode = code;
  if (daten !== undefined) fehler.acpData = daten;
  return fehler;
}

function acpFehlerObjekt(fehler) {
  const objekt = { code: fehler?.acpCode ?? "server_error", message: String(fehler?.message ?? fehler) };
  if (fehler?.acpData !== undefined) objekt.data = fehler.acpData;
  return objekt;
}

function erstelleAcpVerbindung(kontext) {
  const laeufe = new Map();

  // Deutet die Eingabe, BEVOR ein Lauf entsteht: unklare Eingaben sind
  // HTTP-Fehler (400/404, Spec Error-Form), keine failed-Laeufe. Erst echte
  // Ausfuehrungsfehler werden zu einem Run mit status "failed".
  async function deutEingangAus(input) {
    if (!Array.isArray(input) || input.length === 0) {
      throw acpFehler("invalid_input", "input braucht mindestens eine Nachricht (role + parts).");
    }
    const letzte = input[input.length - 1];
    if (!letzte || !Array.isArray(letzte.parts)) {
      throw acpFehler("invalid_input", "Die letzte Eingabenachricht braucht ein parts-Feld.");
    }
    const roh = letzte.parts
      .filter((teil) => typeof teil?.content === "string")
      .map((teil) => teil.content)
      .join("\n")
      .trim();
    if (!roh) {
      throw acpFehler("invalid_input", "Die Eingabe braucht einen Text: entweder {\"werkzeug\",\"argumente\"} als JSON oder eine lesende SQL-Abfrage (SELECT/WITH).");
    }
    const werkzeuge = await kontext.werkzeuge();
    let werkzeugName;
    let argumente;
    if (roh.startsWith("{")) {
      let objekt;
      try { objekt = JSON.parse(roh); }
      catch {
        throw acpFehler("invalid_input", 'Der JSON-Eingang war nicht lesbar: erwartet {"werkzeug": "...", "argumente": {...}}.');
      }
      werkzeugName = objekt?.werkzeug;
      argumente = objekt?.argumente ?? {};
    } else if (/^(select|with)\b/i.test(roh)) {
      werkzeugName = "crm_sql";
      argumente = { sql: roh };
    } else {
      throw acpFehler("invalid_input", "Unklare Eingabe: entweder {\"werkzeug\",\"argumente\"} als JSON oder eine Abfrage, die mit SELECT/WITH beginnt.");
    }
    const werkzeug = werkzeuge.find((w) => w.name === werkzeugName);
    if (!werkzeug) {
      throw acpFehler("invalid_input", `Unbekanntes Werkzeug ${JSON.stringify(werkzeugName)}. Verfuegbar: ${werkzeuge.map((w) => w.name).join(", ")}`);
    }
    return { werkzeug, argumente };
  }

  async function erzeugeLauf(koerper) {
    const agentName = koerper?.agent_name;
    if (typeof agentName !== "string" || !agentName) {
      throw acpFehler("invalid_input", "agent_name fehlt.");
    }
    if (agentName !== AGENT_MANIFEST.name) {
      throw acpFehler("not_found", `Agent "${agentName}" ist nicht registriert. Verfuegbar: ${AGENT_MANIFEST.name}`);
    }
    const modus = koerper.mode ?? "sync";
    if (!["sync", "async", "stream"].includes(modus)) {
      throw acpFehler("invalid_input", "mode ist sync, async oder stream.");
    }
    const ziel = await deutEingangAus(koerper.input);
    const lauf = {
      agent_name: AGENT_MANIFEST.name,
      session_id: typeof koerper.session_id === "string" ? koerper.session_id : null,
      run_id: randomUUID(),
      status: "in-progress",
      await_request: null,
      output: [],
      error: null,
      created_at: new Date().toISOString(),
      finished_at: null,
    };
    const ereignisse = [{ type: "run.created", run: lauf }];
    try {
      const ergebnis = await ziel.werkzeug.ausfuehren(ziel.argumente, kontext);
      lauf.status = "completed";
      lauf.output = [{
        role: "agent",
        parts: [{ content_type: "application/json", content: JSON.stringify(ergebnis) }],
      }];
      lauf.finished_at = new Date().toISOString();
      ereignisse.push({ type: "run.completed", run: lauf });
    } catch (fehler) {
      lauf.status = "failed";
      lauf.error = acpFehlerObjekt(fehler);
      lauf.finished_at = new Date().toISOString();
      ereignisse.push({ type: "run.failed", run: lauf });
    }
    laeufe.set(lauf.run_id, { lauf, ereignisse });
    if (modus === "stream") {
      const strom = ereignisse.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
      return { status: 200, typ: "text/event-stream", koerper: strom };
    }
    if (modus === "async") return { status: 202, koerper: lauf };
    return { status: 200, koerper: lauf };
  }

  async function bediene(methode, pfad, koerper) {
    const teile = String(pfad).split("/").filter(Boolean);
    if (methode === "GET" && teile.length === 1 && teile[0] === "ping") {
      return { status: 200, koerper: { status: "ok" } };
    }
    if (methode === "GET" && teile[0] === "agents") {
      if (teile.length === 1) {
        return {
          status: 200,
          koerper: {
            agents: [{ name: AGENT_MANIFEST.name, description: AGENT_MANIFEST.description, metadata: AGENT_MANIFEST.metadata }],
          },
        };
      }
      if (teile.length === 2) {
        if (teile[1] === AGENT_MANIFEST.name) return { status: 200, koerper: AGENT_MANIFEST };
        return { status: 404, koerper: { code: "not_found", message: `Agent "${teile[1]}" ist nicht registriert. Verfuegbar: ${AGENT_MANIFEST.name}` } };
      }
    }
    if (methode === "POST" && teile.length === 1 && teile[0] === "runs") {
      try {
        return await erzeugeLauf(koerper);
      } catch (fehler) {
        return { status: fehler?.acpCode === "not_found" ? 404 : 400, koerper: acpFehlerObjekt(fehler) };
      }
    }
    if (teile[0] === "runs" && teile.length === 2 && methode === "GET") {
      const eintrag = laeufe.get(teile[1]);
      if (!eintrag) return { status: 404, koerper: { code: "not_found", message: `Lauf "${teile[1]}" ist unbekannt.` } };
      return { status: 200, koerper: eintrag.lauf };
    }
    if (teile[0] === "runs" && teile.length === 3) {
      const eintrag = laeufe.get(teile[1]);
      if (!eintrag) return { status: 404, koerper: { code: "not_found", message: `Lauf "${teile[1]}" ist unbekannt.` } };
      if (methode === "POST" && teile[2] === "cancel") {
        // Laeufe laufen synchron ab — der Abbruch wirkt nur auf die Buchung,
        // ein fertiger Lauf bleibt fertig (ehrlich dokumentiert, kein Schein-Abbruch).
        return { status: 202, koerper: eintrag.lauf };
      }
      if (methode === "GET" && teile[2] === "events") {
        return { status: 200, koerper: { events: eintrag.ereignisse } };
      }
    }
    return { status: 404, koerper: { code: "not_found", message: `Unbekannter ACP-Pfad: ${methode} ${pfad}` } };
  }

  return { bediene, laeufe, manifest: AGENT_MANIFEST };
}

module.exports = { AGENT_MANIFEST, acpFehler, acpFehlerObjekt, erstelleAcpVerbindung };
