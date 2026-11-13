"use strict";

// Headless Parquet-Vault-CRM — Kern.
//
// Liest Parquet-Dateien direkt aus dem Tresor-Ordner mit der installierten
// duckdb-CLI („headless": kein Obsidian, kein Browser, keine Cloud). Alle
// Absicherungen sind bewusst streng: nur lesende Abfragen, nur Dateien im
// Tresor, nie stilles Abschneiden (Ergebnisse tragen ingesamt und
// abgeschnitten). Die Agent-Anbindung liegt daneben:
//   crm-werkzeuge.js     die CRM-Werkzeuge (Abfragen) + Ressourcen
//   crm-mcp.js           MCP-Protokoll (stdio + Streamable HTTP)
//   crm-acp.js           ACP-REST (Agent Communication Protocol, Subset 0.2.0)
//   crm-server.js        Loopback-HTTP-Server mit Token (MCP + ACP + health)
//   crm-agent-client.js  ausgehende Aufrufe an api.unitedshare.ai (abgeschaltet)

const { spawn } = require("node:child_process");
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");

const CRM_VERSION = "1.0.0";
const CRM_AGENT_NAME = "unitedshare-crm";
const STANDARD_AGENT_URL = "https://api.unitedshare.ai";
const STANDARD_DATEI = "adressen.parquet";
const LIMIT_STANDARD = 100;
const LIMIT_MAXIMAL = 1000;
const ABFRAGE_TIMEOUT_MS = 30000;

// ------------------------------------------------------------- Konfiguration

function zahlAusUmgebung(name) {
  const roh = process.env[name];
  if (roh === undefined || roh === "") return undefined;
  const zahl = Number(roh);
  return Number.isFinite(zahl) ? zahl : undefined;
}

function inGrenzen(zahl, min, max, ersatz) {
  if (!Number.isFinite(zahl)) return ersatz;
  return Math.min(max, Math.max(min, Math.floor(zahl)));
}

function standardKonfig(overrides = {}) {
  return {
    vault: overrides.vault ?? process.env.CRM_VAULT ?? "",
    duckdbBin: overrides.duckdbBin ?? process.env.CRM_DUCKDB_BIN ?? "duckdb",
    limit: inGrenzen(
      overrides.limit ?? zahlAusUmgebung("CRM_LIMIT") ?? LIMIT_STANDARD,
      1, LIMIT_MAXIMAL, LIMIT_STANDARD,
    ),
  };
}

// ------------------------------------------------------ SQL-Absicherungen
//
// Trickquelle: Werte. Ein Semikolon in 'x;y' oder ein Spaltenname "alter"
// darf eine Pruefung nicht ausloesen. Deshalb liest sqlAnsichten() die
// Abfrage Zeichen fuer Zeichen und liefert zwei Ansichten: `roh` (echter
// Text) und `entkernt` (Zeichenketten und geklammerte Bezeichner ersetzt).
// Alle Pruefungen laufen auf `entkernt`, ausgefuehrt wird `roh`.

function sqlAnsichten(sql) {
  let roh = "";
  let entkernt = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const zeichen = sql[i];
    if (zeichen === "'" || zeichen === '"') {
      const klafter = zeichen;
      let wort = zeichen;
      i += 1;
      while (i < n) {
        if (sql[i] === klafter) {
          if (sql[i + 1] === klafter) { wort += klafter + klafter; i += 2; continue; }
          wort += klafter;
          i += 1;
          break;
        }
        wort += sql[i];
        i += 1;
      }
      roh += wort;
      entkernt += klafter === "'" ? "''" : '""';
      continue;
    }
    if (zeichen === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i += 1;
      roh += " ";
      entkernt += " ";
      continue;
    }
    if (zeichen === "/" && sql[i + 1] === "*") {
      let tiefe = 0;
      while (i < n) {
        if (sql[i] === "/" && sql[i + 1] === "*") { tiefe += 1; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") {
          tiefe -= 1;
          i += 2;
          if (tiefe <= 0) break;
          continue;
        }
        i += 1;
      }
      roh += " ";
      entkernt += " ";
      continue;
    }
    roh += zeichen;
    entkernt += zeichen;
    i += 1;
  }
  return { roh, entkernt };
}

const VERBOTENE_WORTE = /\b(create|insert|update|delete|drop|alter|copy|attach|detach|export|import|install|load|call|pragma|set|begin|commit|rollback|vacuum|checkpoint|grant|revoke)\b/i;

// Erlaubt sind nur einzelne lesende Anweisungen, die mit SELECT oder WITH
// beginnen. Jede Ablehnung nennt den Grund (fail-closed, keine stillen
// Abweichungen).
function istLesendeAbfrage(sql) {
  if (typeof sql !== "string" || !sql.trim()) {
    return { ok: false, meldung: "Die Abfrage fehlt oder ist leer." };
  }
  const { roh, entkernt } = sqlAnsichten(sql);
  const text = entkernt.trim().replace(/;+\s*$/, "");
  const abfrage = roh.trim().replace(/;+\s*$/, "");
  if (!text) {
    return { ok: false, meldung: "Nach Entfernen von Kommentaren bleibt keine Abfrage uebrig." };
  }
  if (text.includes(";")) {
    return { ok: false, meldung: "Nur eine einzige Anweisung je Abfrage — Semikolons in der Abfrage sind nicht erlaubt." };
  }
  if (!/^(select|with)\b/i.test(text)) {
    return { ok: false, meldung: "Nur lesende Abfragen: die Abfrage muss mit SELECT oder WITH beginnen." };
  }
  const verboten = VERBOTENE_WORTE.exec(text);
  if (verboten) {
    return {
      ok: false,
      meldung: `Schreib- oder Verwaltungsausdruck "${verboten[0]}" ist nicht erlaubt — der CRM-Kern liest nur.`,
    };
  }
  return { ok: true, abfrage };
}

// Dateien sind nur tresor-relativ erreichbar, ohne Pfade und ohne(..).
function sichererParquetName(name) {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, meldung: "Der Dateiname fehlt." };
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return { ok: false, meldung: "Dateien sind nur tresor-relativ erreichbar — Pfade mit /, \\ oder .. sind nicht erlaubt." };
  }
  if (!/\.parquet$/i.test(name)) {
    return { ok: false, meldung: "Nur .parquet-Dateien sind Tabellen des CRM." };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.parquet$/i.test(name)) {
    return { ok: false, meldung: "Dateinamen bestehen aus Buchstaben, Zahlen, Leerzeichen, Punkt, Unterstrich oder Bindestrich." };
  }
  return { ok: true, name };
}

function sichererAbfrageName(name) {
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, meldung: "Der Dateiname fehlt." };
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return { ok: false, meldung: "Abfragedateien sind nur tresor-relativ erreichbar — Pfade mit /, \\ oder .. sind nicht erlaubt." };
  }
  if (!/\.sql$/i.test(name)) {
    return { ok: false, meldung: "Nur .sql-Dateien sind CRM-Abfragedateien." };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.sql$/i.test(name)) {
    return { ok: false, meldung: "Dateinamen bestehen aus Buchstaben, Zahlen, Leerzeichen, Punkt, Unterstrich oder Bindestrich." };
  }
  return { ok: true, name };
}

// SQL-String-Literal mit verdoppelten Apostrophen (einzige Injektionsduese,
// die wir brauchen — alles andere sind gepruefte Namen und Zahlen).
function sqlText(wert) {
  return "'" + String(wert).replace(/'/g, "''") + "'";
}

// ------------------------------------------------------- DuckDB-CLI-Laufzeit

function sqlKurz(sql) {
  const s = String(sql).replace(/\s+/g, " ").trim();
  return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

function duckdbJsonAusfuehren(cfg, sql, timeoutMs = ABFRAGE_TIMEOUT_MS) {
  return new Promise((loesen, verwerfen) => {
    const kind = spawn(cfg.duckdbBin, ["-json", "-batch", "-c", sql], {
      cwd: cfg.vault || undefined,
      windowsHide: true,
    });
    let raus = "";
    let fehlerText = "";
    const uhr = setTimeout(() => {
      kind.kill("SIGKILL");
      verwerfen(new Error(`DuckDB-Abfrage brach nach ${timeoutMs} ms ab: ${sqlKurz(sql)}`));
    }, timeoutMs);
    kind.stdout.on("data", (stueck) => { raus += stueck; });
    kind.stderr.on("data", (stueck) => { fehlerText += stueck; });
    kind.on("error", (fehler) => {
      clearTimeout(uhr);
      verwerfen(new Error(`DuckDB-Laufzeit "${cfg.duckdbBin}" liess sich nicht starten: ${fehler.message}`));
    });
    kind.on("close", (code) => {
      clearTimeout(uhr);
      if (code !== 0) {
        verwerfen(new Error(`DuckDB-Abfrage fehlgeschlagen (Exit ${code}): ${fehlerText.trim().slice(-2000) || sqlKurz(sql)}`));
        return;
      }
      const text = raus.trim();
      if (!text) { loesen([]); return; }
      try { loesen(JSON.parse(text)); }
      catch {
        verwerfen(new Error(`DuckDB gab kein gueltiges JSON zurueck: ${text.slice(0, 200)}`));
      }
    });
  });
}

function abfrageBegrenzen(abfrage, limit) {
  return `SELECT * FROM (${abfrage}) AS crm_begrenzt LIMIT ${Math.max(0, Math.floor(limit))}`;
}

function abfrageZaehlen(abfrage) {
  return `SELECT COUNT(*) AS ingesamt FROM (${abfrage}) AS crm_zaehlung`;
}

// Fuehrt eine lesende Abfrage zweistufig aus: einmal begrenzt, einmal als
// Zaehlung. Kein Ergebnis wird je still gekuerzt — der Antwortblock traegt
// zeilen, ingesamt und abgeschnitten.
async function ausfuehrenBegrenzt(cfg, abfrage, limit) {
  const [zeilen, zaehlung] = await Promise.all([
    duckdbJsonAusfuehren(cfg, abfrageBegrenzen(abfrage, limit)),
    duckdbJsonAusfuehren(cfg, abfrageZaehlen(abfrage)),
  ]);
  const ingesamt = Number(zaehlung[0]?.ingesamt ?? zeilen.length);
  return {
    daten: zeilen,
    zeilen: zeilen.length,
    ingesamt,
    abgeschnitten: ingesamt > zeilen.length,
    limit,
  };
}

// ------------------------------------------------------------- Tresor-Lesen

async function parquetDateienImVault(cfg) {
  const eintraege = await readdir(cfg.vault || ".", { withFileTypes: true });
  return eintraege
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".parquet"))
    .map((e) => e.name)
    .sort();
}

async function abfrageDateienImVault(cfg) {
  try {
    const eintraege = await readdir(path.join(cfg.vault || ".", "crm"), { withFileTypes: true });
    return eintraege
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".sql"))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function leseAbfrageDatei(cfg, name) {
  const pruefung = sichererAbfrageName(name);
  if (!pruefung.ok) throw new Error(pruefung.meldung);
  return String(await readFile(path.join(cfg.vault || ".", "crm", name), "utf8"));
}

module.exports = {
  CRM_VERSION,
  CRM_AGENT_NAME,
  STANDARD_AGENT_URL,
  STANDARD_DATEI,
  LIMIT_STANDARD,
  LIMIT_MAXIMAL,
  ABFRAGE_TIMEOUT_MS,
  standardKonfig,
  sqlAnsichten,
  istLesendeAbfrage,
  sichererParquetName,
  sichererAbfrageName,
  sqlText,
  duckdbJsonAusfuehren,
  abfrageBegrenzen,
  abfrageZaehlen,
  ausfuehrenBegrenzt,
  parquetDateienImVault,
  abfrageDateienImVault,
  leseAbfrageDatei,
  inGrenzen,
};
