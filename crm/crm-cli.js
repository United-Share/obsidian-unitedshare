"use strict";

// CLI des headless Parquet-Vault-CRM.
//   node crm/crm-cli.js hilfe
// Alle Cloud-Aufrufe (agent ...) brauchen --erlaubt — ohne Freigabe wird
// nichts gesendet.

const { spawn } = require("node:child_process");
const {
  CRM_VERSION, STANDARD_AGENT_URL, standardKonfig,
  parquetDateienImVault, abfrageDateienImVault, duckdbJsonAusfuehren,
} = require("./crm-core");
const { crmWerkzeugeAlle, erstelleKontext } = require("./crm-abfragen-tools");
const { starteMcpStdio } = require("./crm-mcp");
const { starteCrmServer } = require("./crm-server");
const {
  agentMcpHandschlag, agentWerkzeuge, agentWerkzeugAufrufen, agentAcpLauf,
} = require("./crm-agent-client");

const HILFE = `UnitedShare Headless-CRM ${CRM_VERSION} — Parquet im Tresor, DuckDB-CLI, lesend.

Befehle:
  status                        Laufzeit, Tresor, Dateien, Werkzeuge zeigen
  dateien                       .parquet-Dateien mit Zeilenzahl
  abfragen                      .sql-Abfragedateien aus crm/ im Tresor
  abfrage <name.sql>            eine Abfragedatei ausfuehren
  tool <name> [--json '{}']     ein Werkzeug aufrufen (siehe status)
  sql "<SELECT|WITH ...>"       freie lesende Abfrage
  server [--host] [--port]      MCP + ACP + health, Loopback, Token
  stdio                         MCP über stdin/stdout (fuer lokale Agenten)
  agent info|werkzeuge|tool|acp Cloud-Gegenstelle (braucht --erlaubt)
  hilfe | version               diese Hilfe | Version

Optionen:
  --vault <pfad>                Tresor-Ordner (auch CRM_VAULT)
  --limit <n>                   Zeilengrenze je Abfrage (1-1000, Standard 100)
  --duckdb <pfad>               duckdb-Binaerdatei (auch CRM_DUCKDB_BIN)
  --token <t>                   Server-Token (auch CRM_TOKEN; sonst zufaellig)
  --agent-url <url>             sonst https://api.unitedshare.ai
  --erlaubt                     Cloud-Aufrufe ausdruecklich freigeben

Beispiele:
  node crm/crm-cli.js status --vault /Volumes/SecondBrainReemax/UnitedShare/obsidian-test-126
  node crm/crm-cli.js tool crm_uebersicht --vault ...
  node crm/crm-cli.js server --vault ... --port 8787
  node crm/crm-cli.js agent info --erlaubt
`;

function drucke(objekt) {
  process.stdout.write(JSON.stringify(objekt, null, 2) + "\n");
}

class CliFehler extends Error {
  constructor(text, code) {
    super(text);
    this.beendungsCode = code;
  }
}

function leseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--erlaubt") flags.erlaubt = true;
    else if (arg === "--vault") flags.vault = argv[++i];
    else if (arg === "--port") flags.port = Number(argv[++i]);
    else if (arg === "--host") flags.host = argv[++i];
    else if (arg === "--token") flags.token = argv[++i];
    else if (arg === "--limit") flags.limit = Number(argv[++i]);
    else if (arg === "--duckdb") flags.duckdbBin = argv[++i];
    else if (arg === "--agent-url") flags.agentUrl = argv[++i];
    else if (arg === "--json") flags.json = argv[++i];
    else rest.push(arg);
  }
  return { flags, rest };
}

function jsonArgumente(flags, what) {
  if (!flags.json) return {};
  try { return JSON.parse(flags.json); }
  catch (fehler) {
    throw new CliFehler(`--json war kein gueltiges JSON (${fehler.message}) — erwartet ein Objekt fuer ${what}.`, 2);
  }
}

async function duckdbVersion(cfg) {
  return new Promise((loesen) => {
    const kind = spawn(cfg.duckdbBin, ["--version"], { windowsHide: true });
    let raus = "";
    let fehler = "";
    kind.stdout.on("data", (s) => { raus += s; });
    kind.stderr.on("data", (s) => { fehler += s; });
    kind.on("error", (f) => loesen({ bin: cfg.duckdbBin, startFehler: f.message }));
    kind.on("close", (code) => {
      if (code !== 0) loesen({ bin: cfg.duckdbBin, startFehler: fehler.trim() || `Exit ${code}` });
      else loesen({ bin: cfg.duckdbBin, version: raus.trim() });
    });
  });
}

async function status(cfg) {
  let dateien = [];
  let tresorFehler = null;
  try { dateien = await parquetDateienImVault(cfg); }
  catch (fehler) { tresorFehler = fehler.message; }
  let abfragen = [];
  try { abfragen = await abfrageDateienImVault(cfg); } catch { abfragen = []; }
  return {
    version: CRM_VERSION,
    tresor: cfg.vault || "(nicht gesetzt — --vault <pfad> angeben)",
    tresorFehler,
    duckdb: await duckdbVersion(cfg),
    parquetDateien: dateien,
    abfrageDateien: abfragen,
    werkzeuge: crmWerkzeugeAlle().map((w) => w.name),
    agentUrl: STANDARD_AGENT_URL,
    agentHinweis: "agent-Aufrufe brauchen --erlaubt; ohne Freigabe wird nichts gesendet.",
  };
}

function serverBanner(lauf, cfg) {
  return [
    "UnitedShare CRM-Server (headless, lesend)",
    `  Adresse : ${lauf.adresse}`,
    "  MCP     : POST /mcp   (JSON-RPC 2.0; die initialize-Antwort nennt Mcp-Session-Id)",
    "  ACP     : /acp/ping, /acp/agents, /acp/runs   (Agent Communication Protocol 0.2.0-Subset)",
    `  Tresor  : ${cfg.vault}`,
    `  Token   : ${lauf.token}`,
    '  Jeder Aufruf braucht:  -H "Authorization: Bearer <token>"',
    "STRG+C beendet den Server.",
  ].join("\n") + "\n";
}

async function main(argv) {
  const { flags, rest } = leseFlags(argv);
  const befehl = rest[0] ?? "hilfe";
  const cfg = standardKonfig({ vault: flags.vault, limit: flags.limit, duckdbBin: flags.duckdbBin });

  if (befehl === "hilfe" || befehl === "help" || befehl === "--help" || befehl === "-h") {
    process.stdout.write(HILFE);
    return 0;
  }
  if (befehl === "version") { drucke({ version: CRM_VERSION }); return 0; }

  const kontext = erstelleKontext(cfg);

  switch (befehl) {
    case "status": {
      drucke(await status(cfg));
      return 0;
    }
    case "dateien": {
      drucke(await kontext.werkzeuge().find((w) => w.name === "crm_dateien").ausfuehren({}, kontext));
      return 0;
    }
    case "abfragen": {
      drucke(await kontext.werkzeuge().find((w) => w.name === "crm_abfragen").ausfuehren({}, kontext));
      return 0;
    }
    case "abfrage": {
      const name = rest[1];
      if (!name) throw new CliFehler("abfrage braucht einen Namen: abfrage <name.sql> [--vault <pfad>]", 2);
      const werkzeug = kontext.werkzeuge().find((w) => w.name === "crm_abfrage_datei");
      drucke(await werkzeug.ausfuehren({ datei: name }, kontext));
      return 0;
    }
    case "tool": {
      const name = rest[1];
      if (!name) throw new CliFehler("tool braucht einen Namen: tool <name> [--json '{...}']", 2);
      const werkzeug = kontext.werkzeuge().find((w) => w.name === name);
      if (!werkzeug) {
        throw new CliFehler(`Unbekanntes Werkzeug ${JSON.stringify(name)}. Verfuegbar: ${kontext.werkzeuge().map((w) => w.name).join(", ")}`, 2);
      }
      drucke(await werkzeug.ausfuehren(jsonArgumente(flags, name), kontext));
      return 0;
    }
    case "sql": {
      const sql = rest[1];
      if (!sql) throw new CliFehler('sql braucht eine Abfrage: sql "SELECT ..."', 2);
      const werkzeug = kontext.werkzeuge().find((w) => w.name === "crm_sql");
      drucke(await werkzeug.ausfuehren({ sql }, kontext));
      return 0;
    }
    case "server": {
      if (!cfg.vault) throw new CliFehler("server braucht einen Tresor: --vault <pfad> (oder CRM_VAULT).", 2);
      const lauf = await starteCrmServer(kontext, {
        host: flags.host ?? "127.0.0.1",
        port: flags.port,
        token: flags.token,
      });
      process.stderr.write(serverBanner(lauf, cfg));
      await new Promise(() => {});
      return 0;
    }
    case "stdio": {
      starteMcpStdio(kontext);
      await new Promise(() => {});
      return 0;
    }
    case "agent": {
      const agentBefehl = rest[1] ?? "info";
      const optionen = {
        url: flags.agentUrl,
        token: flags.token ?? process.env.CRM_AGENT_TOKEN,
        erlaubt: flags.erlaubt,
      };
      if (agentBefehl === "info") {
        drucke(await agentMcpHandschlag(optionen));
        return 0;
      }
      if (agentBefehl === "werkzeuge") {
        drucke(await agentWerkzeuge(optionen));
        return 0;
      }
      if (agentBefehl === "tool") {
        const name = rest[2];
        if (!name) throw new CliFehler("agent tool braucht einen Namen: agent tool <name> [--json '{...}'] --erlaubt", 2);
        drucke(await agentWerkzeugAufrufen(optionen, name, jsonArgumente(flags, name)));
        return 0;
      }
      if (agentBefehl === "acp") {
        const eingabe = rest[2];
        if (!eingabe) throw new CliFehler('agent acp braucht eine Eingabe: agent acp \'{"werkzeug":"crm_uebersicht","argumente":{}}\' --erlaubt', 2);
        drucke(await agentAcpLauf(optionen, eingabe));
        return 0;
      }
      throw new CliFehler("agent kennt: info | werkzeuge | tool | acp", 2);
    }
    default:
      throw new CliFehler(`Unbekannter Befehl: ${befehl}. "node crm/crm-cli.js hilfe" zeigt alles.`, 2);
  }
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code ?? 0; })
  .catch((fehler) => {
    process.stderr.write(`Fehler: ${fehler?.message ?? fehler}\n`);
    process.exitCode = fehler?.beendungsCode ?? 1;
  });
