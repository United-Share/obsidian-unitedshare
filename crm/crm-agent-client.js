"use strict";

// Ausgehende Agent-Aufrufe an die UnitedShare-API — bewusst fail-closed.
// Jede Funktion verlangt erlaubt:true (CLI: --erlaubt); ohne Freigabe wird
// NICHTS gesendet, die Meldung nennt den Grund. Ziel ist standardmaessig
// https://api.unitedshare.ai — dort existieren /mcp und /acp (geprueft am
// 13.11.2026 als Platzhalter: HTTP 200, leerer Koerper). Der Client ist
// deshalb so gebaut, dass er gegen einen echten MCP-/ACP-Endpunkt funktioniert
// und gegen den heutigen Platzhalter eine ehrliche, benannte Meldung liefert.

const { STANDARD_AGENT_URL, CRM_AGENT_NAME } = require("./crm-core");

const STANDARD_MCP_PFAD = "/mcp";
const CLIENT_VERSION = "1.0.0";

function verweigereOhneErlaubnis(optionen, ziel) {
  if (optionen?.erlaubt !== true) {
    throw new Error(
      `Cloud-Anfrage verweigert: Der Aufruf an ${ziel} braucht ausdrueckliche Freigabe ` +
      "(Option --erlaubt bzw. {erlaubt: true}). Nichts gesendet.",
    );
  }
}

function basisUrl(optionen) {
  const roh = String(optionen?.url ?? STANDARD_AGENT_URL).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(roh)) throw new Error(`Die Agent-Adresse muss mit http(s) beginnen: ${roh}`);
  return roh;
}

async function mcpPost(url, nachricht, optionen) {
  const kopf = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (optionen.token) kopf.Authorization = `Bearer ${optionen.token}`;
  if (optionen.sitzung) kopf["Mcp-Session-Id"] = optionen.sitzung;
  const antwort = await fetch(url, {
    method: "POST",
    headers: kopf,
    body: JSON.stringify(nachricht),
    signal: AbortSignal.timeout(optionen.timeoutMs ?? 30000),
  });
  const sitzung = antwort.headers.get("mcp-session-id") ?? undefined;
  const typ = antwort.headers.get("content-type") ?? "";
  const text = await antwort.text();
  let koerper = null;
  if (typ.includes("text/event-stream")) {
    for (const zeile of text.split("\n")) {
      if (!zeile.startsWith("data:")) continue;
      const daten = zeile.slice(5).trim();
      if (!daten) continue;
      try { koerper = JSON.parse(daten); } catch { koerper = null; }
    }
  } else if (text.trim()) {
    try { koerper = JSON.parse(text); } catch { koerper = null; }
  }
  return { status: antwort.status, typ, sitzung, koerper, text };
}

async function agentMcpHandschlag(optionen) {
  const url = basisUrl(optionen) + (optionen.pfad ?? STANDARD_MCP_PFAD);
  verweigereOhneErlaubnis(optionen, url);
  const init = await mcpPost(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: CRM_AGENT_NAME, version: CLIENT_VERSION },
    },
  }, optionen);
  if (!init.koerper?.result?.serverInfo) {
    const grund = init.koerper?.error?.message ?? (init.text.trim() ? init.text.slice(0, 120) : "leerer Koerper");
    throw new Error(
      `Die Gegenstelle an ${url} antwortet nicht wie ein MCP-Server (HTTP ${init.status}: ${grund}). ` +
      "Hinweis: api.unitedshare.ai/mcp ist am 13.11.2026 ein Platzhalter (HTTP 200, leerer Koerper); " +
      "sobald dort ein echter MCP-Endpunkt steht, funktioniert dieser Aufruf unverändert.",
    );
  }
  if (init.sitzung) {
    await mcpPost(url, { jsonrpc: "2.0", method: "notifications/initialized" }, { ...optionen, sitzung: init.sitzung });
  }
  return {
    url,
    sitzung: init.sitzung ?? null,
    serverInfo: init.koerper.result.serverInfo,
    protokollVersion: init.koerper.result.protocolVersion ?? null,
  };
}

async function agentWerkzeuge(optionen) {
  const handschlag = await agentMcpHandschlag(optionen);
  const antwort = await mcpPost(handschlag.url, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { ...optionen, sitzung: handschlag.sitzung });
  if (!antwort.koerper?.result) {
    throw new Error(`tools/list lief keine Liste (HTTP ${antwort.status}).`);
  }
  return antwort.koerper.result.tools ?? [];
}

async function agentWerkzeugAufrufen(optionen, name, argumente = {}) {
  const handschlag = await agentMcpHandschlag(optionen);
  const antwort = await mcpPost(handschlag.url, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name, arguments: argumente },
  }, { ...optionen, sitzung: handschlag.sitzung });
  if (antwort.koerper?.error) {
    throw new Error(`Der Agent-Endpunkt meldete: ${antwort.koerper.error.message}`);
  }
  return antwort.koerper?.result ?? null;
}

// ACP-Lauf gegen die Gegenstelle: POST {basis}/acp/runs im Spec-Format
// (agent_name, input, mode). mode "sync" liefert den fertigen Lauf.
async function agentAcpLauf(optionen, eingabeText, modus = "sync") {
  const url = `${basisUrl(optionen)}/acp/runs`;
  verweigereOhneErlaubnis(optionen, url);
  const kopf = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (optionen.token) kopf.Authorization = `Bearer ${optionen.token}`;
  const antwort = await fetch(url, {
    method: "POST",
    headers: kopf,
    body: JSON.stringify({
      agent_name: CRM_AGENT_NAME,
      input: [{ role: "user", parts: [{ content_type: "text/plain", content: String(eingabeText ?? "") }] }],
      mode: modus,
    }),
    signal: AbortSignal.timeout(optionen.timeoutMs ?? 30000),
  });
  const text = await antwort.text();
  try { return { status: antwort.status, lauf: JSON.parse(text) }; }
  catch {
    throw new Error(`Die ACP-Gegenstelle an ${url} antwortete ohne Run-JSON (HTTP ${antwort.status}): ${text.trim().slice(0, 120) || "leerer Koerper"}`);
  }
}

module.exports = {
  STANDARD_MCP_PFAD,
  CLIENT_VERSION,
  basisUrl,
  verweigereOhneErlaubnis,
  agentMcpHandschlag,
  agentWerkzeuge,
  agentWerkzeugAufrufen,
  agentAcpLauf,
};
