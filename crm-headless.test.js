"use strict";

// Tests fuer das headless Parquet-Vault-CRM (crm/).
// Teil 1: Absicherungen, DuckDB-Laufzeit, Werkzeuge, Ressourcen.
// Teil 2 (unten): MCP, ACP, Server, Agent-Client.

const os = require("node:os");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("./crm/crm-core");
const { crmWerkzeugeAlle, erstelleKontext, ressourcenLaden, ressourceLesen } = require("./crm/crm-abfragen-tools");

// ------------------------------------------------------------- Absicherungen

test("istLesendeAbfrage nimmt SELECT und WITH an und schneidet das Endsemikolon ab", () => {
  const select = core.istLesendeAbfrage("  SELECT 1 AS x;  ");
  assert.equal(select.ok, true);
  assert.equal(select.abfrage, "SELECT 1 AS x");
  const with_ = core.istLesendeAbfrage("WITH t AS (SELECT 1 AS a) SELECT * FROM t");
  assert.equal(with_.ok, true);
});

test("istLesendeAbfrage weist Schreiben und Verwalten mit Namensnennung ab", () => {
  for (const sql of [
    "CREATE TABLE x(a INT)",
    "INSERT INTO x VALUES (1)",
    "UPDATE x SET a = 2",
    "DELETE FROM x",
    "DROP TABLE x",
    "COPY (SELECT 1) TO 'y.parquet'",
    "ATTACH 'b.duckdb' AS b",
    "SET memory_limit = '1GB'",
  ]) {
    const pruefung = core.istLesendeAbfrage(sql);
    assert.equal(pruefung.ok, false, sql);
    assert.match(pruefung.meldung, /erlaubt|liest nur|einzige Anweisung|SELECT oder WITH/);
  }
});

test("istLesendeAbfrage weist mehrere Anweisungen und Nicht-SELECT ab", () => {
  assert.equal(core.istLesendeAbfrage("SELECT 1; DROP TABLE x").ok, false);
  assert.equal(core.istLesendeAbfrage("EXPLAIN SELECT 1").ok, false);
  assert.equal(core.istLesendeAbfrage("").ok, false);
  assert.equal(core.istLesendeAbfrage(42).ok, false);
  assert.equal(core.istLesendeAbfrage("-- nur ein Kommentar").ok, false);
});

test("istLesendeAbfrage laesst Werte und Spaltennamen unangetastet", () => {
  const werte = core.istLesendeAbfrage("SELECT ';' AS s, 'DROP TABLE x' AS t");
  assert.equal(werte.ok, true);
  const spalte = core.istLesendeAbfrage('SELECT "alter" FROM adressen.parquet');
  assert.equal(spalte.ok, true);
  const kommentar = core.istLesendeAbfrage("SELECT 1 /* drop table */");
  assert.equal(kommentar.ok, true);
  const kommentarVorne = core.istLesendeAbfrage("/* droppen */ SELECT 1");
  assert.equal(kommentarVorne.ok, true);
  const dropperKommentar = core.istLesendeAbfrage("/*x*/ DROP TABLE x");
  assert.equal(dropperKommentar.ok, false);
});

test("sichererParquetName erlaubt nur tresor-relative Parquet-Namen", () => {
  assert.equal(core.sichererParquetName("adressen.parquet").ok, true);
  assert.equal(core.sichererParquetName("adressen 1.parquet").ok, true);
  for (const name of ["../x.parquet", "crm/y.parquet", "x\\y.parquet", "a/../b.parquet", "x.sql", "", null]) {
    const pruefung = core.sichererParquetName(name);
    assert.equal(pruefung.ok, false, String(name));
    assert.ok(pruefung.meldung.length > 10, String(name));
  }
});

test("standardKonfig begrenzt limit auf 1 bis 1000", () => {
  assert.equal(core.standardKonfig({ limit: 5000 }).limit, 1000);
  assert.equal(core.standardKonfig({ limit: 0 }).limit, 1);
  assert.equal(core.standardKonfig({}).limit, 100);
});

// ---------------------------------------------------------- Tresor finden

test("findeTresor findet den Tresor von innen und bleibt außerhalb ehrlich leer", async () => {
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), "crm-finde-"));
  const tresor = path.join(wurzel, "mein-tresor");
  await fs.mkdir(path.join(tresor, ".obsidian"), { recursive: true });
  await fs.mkdir(path.join(tresor, "crm"), { recursive: true });
  await fs.mkdir(path.join(tresor, "crm", "tiefer"), { recursive: true });
  assert.equal(core.findeTresor(tresor), tresor);
  assert.equal(core.findeTresor(path.join(tresor, "crm")), tresor);
  assert.equal(core.findeTresor(path.join(tresor, "crm", "tiefer")), tresor);
  assert.equal(core.findeTresor(wurzel), null);
  assert.equal(core.findeTresor(wurzel, 0), null);
});

test("findeTresor hoert an der Wurzel auf und ehrt die Tiefe", async () => {
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), "crm-tiefe-"));
  let ordner = wurzel;
  for (let i = 0; i < 8; i += 1) {
    const folge = path.join(ordner, `ebene${i}`);
    await fs.mkdir(folge);
    ordner = folge;
  }
  await fs.mkdir(path.join(wurzel, ".obsidian"), { recursive: true });
  // 8 Ebenen liegen jenseits der Standardtiefe 6 — außerhalb bleibt der Fund leer,
  // mit genug Tiefe wird er gefunden.
  assert.equal(core.findeTresor(ordner), null);
  assert.equal(core.findeTresor(ordner, 10), wurzel);
});

test("tresorBestimmen: Angabe vor Umgebung vor Automatik — jede Quelle benannt", async () => {
  const wurzel = await fs.mkdtemp(path.join(os.tmpdir(), "crm-quelle-"));
  const tresor = path.join(wurzel, "tresor");
  await fs.mkdir(path.join(tresor, ".obsidian"), { recursive: true });
  const vorher = process.env.CRM_VAULT;
  try {
    process.env.CRM_VAULT = "";
    const auto = core.tresorBestimmen({}, tresor);
    assert.equal(auto.vault, tresor);
    assert.equal(auto.tresorQuelle, "auto");
    assert.equal(auto.limit, 100);
    process.env.CRM_VAULT = tresor;
    const umgebung = core.tresorBestimmen({}, wurzel);
    assert.equal(umgebung.vault, tresor);
    assert.equal(umgebung.tresorQuelle, "umgebung");
    const angabe = core.tresorBestimmen({ vault: tresor }, wurzel);
    assert.equal(angabe.vault, tresor);
    assert.equal(angabe.tresorQuelle, "angabe");
    process.env.CRM_VAULT = "";
    const nichts = core.tresorBestimmen({}, wurzel);
    assert.equal(nichts.vault, "");
    assert.equal(nichts.tresorQuelle, "");
  } finally {
    if (vorher === undefined) delete process.env.CRM_VAULT;
    else process.env.CRM_VAULT = vorher;
  }
});

// --------------------------------------------------- DuckDB-Laufzeit + Werkzeuge

let duckdbVorhanden = true;
let duckdbGrund = "";
try {
  execFileSync("duckdb", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
} catch (fehler) {
  duckdbVorhanden = false;
  duckdbGrund = fehler.message;
}

const SKIP_DUCKDB = duckdbVorhanden ? false : `DuckDB-CLI fehlt: ${duckdbGrund}`;

let fixtur = null;

async function crmFixtur() {
  if (fixtur) return fixtur;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crm-headless-"));
  const datei = path.join(dir, "adressen.parquet");
  execFileSync("duckdb", ["-c", [
    "COPY (SELECT * FROM (VALUES",
    "  ('Frau','Anna','Beispiel','Musterweg 1','44135','Dortmund','0231 111111','1990-03-04','KOP-01','ja','01.01.2030',false,true,35,231111111,'anna@beispiel.de'),",
    "  ('Herr','Benno','Beispiel','Musterweg 2','44135','Dortmund','0231 222222','1985-07-07','KOP-01','ja','15.06.2026',false,false,41,NULL,NULL),",
    "  ('Frau','Carla','Beispiel','Musterweg 3','10115','Berlin','0231 111111','1978-11-11','KOP-02',NULL,'20.07.2026',true,false,47,NULL,NULL)",
    ") AS t(Anrede, Vorname, Nachname, Strasse, Plz, Ort, Rufnummer, Geburtsdatum, Werbequelle,",
    "      Userchoice, \"Gueltig bis\", ist_dublette, ist_besteller, \"alter\", Telefon_Rufnummer, email))",
    `TO '${datei}' (FORMAT PARQUET)`,
  ].join("\n")]);
  const crmOrdner = path.join(dir, "crm");
  await fs.mkdir(crmOrdner);
  await fs.writeFile(path.join(crmOrdner, "test-abfrage.sql"),
    "-- Zaehlt alle Zeilen\nSELECT COUNT(*) AS n FROM 'adressen.parquet'\n");
  fixtur = { dir, datei, cfg: core.standardKonfig({ vault: dir }) };
  return fixtur;
}

function werkzeug(kontext, name) {
  const gefunden = kontext.werkzeuge().find((w) => w.name === name);
  assert.ok(gefunden, `Werkzeug ${name} fehlt`);
  return gefunden;
}

test("Werkzeugliste enthaelt die Kernwerkzeuge", () => {
  const namen = crmWerkzeugeAlle().map((w) => w.name);
  for (const erwartet of [
    "crm_dateien", "crm_schema", "crm_uebersicht", "crm_fuellstand", "crm_suchen",
    "crm_geburtsmonat", "crm_faelligkeiten", "crm_faelligkeiten_zusammenfassung",
    "crm_dubletten", "crm_werbequellen", "crm_regionen", "crm_altersgruppen",
    "crm_sql", "crm_abfragen", "crm_abfrage_datei",
  ]) {
    assert.ok(namen.includes(erwartet), erwartet);
  }
});

test("Werkzeugnamen sind MCP- und ACP-tauglich", () => {
  for (const name of crmWerkzeugeAlle().map((w) => w.name)) {
    assert.match(name, /^[a-zA-Z0-9_-]+$/, name);
  }
});

test("duckdbJsonAusfuehren liest Parquet und nennt Fehler benannt", { skip: SKIP_DUCKDB }, async () => {
  const { cfg } = await crmFixtur();
  const zeilen = await core.duckdbJsonAusfuehren(cfg, "SELECT COUNT(*) AS n FROM 'adressen.parquet'");
  assert.equal(zeilen[0].n, 3);
  await assert.rejects(
    () => core.duckdbJsonAusfuehren(cfg, "SELECT * FROM 'fehlt.parquet'"),
    (fehler) => /DuckDB-Abfrage fehlgeschlagen/.test(fehler.message),
  );
});

test("ausfuehrenBegrenzt traegt zeilen, ingesamt und abgeschnitten", { skip: SKIP_DUCKDB }, async () => {
  const { cfg } = await crmFixtur();
  const ergebnis = await core.ausfuehrenBegrenzt(cfg, "SELECT Werbequelle, COUNT(*) AS n FROM 'adressen.parquet' GROUP BY Werbequelle", 1);
  assert.equal(ergebnis.zeilen, 1);
  assert.equal(ergebnis.ingesamt, 2);
  assert.equal(ergebnis.abgeschnitten, true);
});

test("crm_dateien und crm_schema sehen die Fixtur", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const dateien = await werkzeug(kontext, "crm_dateien").ausfuehren({}, kontext);
  assert.deepEqual(dateien.daten, [{ datei: "adressen.parquet", saetze: 3 }]);
  const schema = await werkzeug(kontext, "crm_schema").ausfuehren({}, kontext);
  assert.ok(schema.daten.some((z) => z.column_name === "Gueltig bis"), "Spalte Gueltig bis fehlt");
  assert.ok(schema.daten.some((z) => z.column_name === "alter"), "Spalte alter fehlt");
});

test("crm_uebersicht rechnet die Kennzahlen der Fixtur", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const ergebnis = await werkzeug(kontext, "crm_uebersicht").ausfuehren({}, kontext);
  const zeile = ergebnis.daten[0];
  assert.equal(Number(zeile.datensaetze), 3);
  assert.equal(Number(zeile.verschiedene_rufnummern), 2);
  assert.equal(Number(zeile.rufnummer_als_zahl), 1);
  assert.equal(Number(zeile.mit_email), 1);
  assert.equal(Number(zeile.mit_userchoice), 2);
  assert.equal(Number(zeile.zeilen_als_dublette), 1);
  assert.equal(Number(zeile.zeilen_besteller), 1);
});

test("crm_fuellstand zeigt fehlende Werte in Prozent", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const ergebnis = await werkzeug(kontext, "crm_fuellstand").ausfuehren({}, kontext);
  const zeile = ergebnis.daten[0];
  assert.equal(Number(zeile.datensaetze), 3);
  assert.equal(Number(zeile.ohne_rufnummer_pct), 0);
  assert.equal(Number(zeile.ohne_gueltig_bis_pct), 0);
});

test("crm_suchen findet in mehreren Spalten und ehrt das Limit", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const anna = await werkzeug(kontext, "crm_suchen").ausfuehren({ suchtext: "Anna" }, kontext);
  assert.equal(anna.zeilen, 1);
  assert.equal(anna.daten[0].Vorname, "Anna");
  const telefon = await werkzeug(kontext, "crm_suchen").ausfuehren({ suchtext: "0231", limit: 2 }, kontext);
  assert.equal(telefon.ingesamt, 3);
  assert.equal(telefon.zeilen, 2);
  assert.equal(telefon.abgeschnitten, true);
  await assert.rejects(
    () => werkzeug(kontext, "crm_suchen").ausfuehren({}, kontext),
    (fehler) => /suchtext/.test(fehler.message),
  );
});

test("crm_geburtsmonat nimmt nur Monate 1 bis 12", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const maerz = await werkzeug(kontext, "crm_geburtsmonat").ausfuehren({ monat: 3 }, kontext);
  assert.equal(maerz.zeilen, 1);
  assert.equal(maerz.daten[0].Vorname, "Anna");
  await assert.rejects(
    () => werkzeug(kontext, "crm_geburtsmonat").ausfuehren({ monat: 13 }, kontext),
    (fehler) => /1 bis 12/.test(fehler.message),
  );
});

test("crm_faelligkeiten trennt abgelaufen von spaeter gueltig", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const abgelaufen = await werkzeug(kontext, "crm_faelligkeiten").ausfuehren({}, kontext);
  assert.deepEqual(abgelaufen.daten.map((z) => z.gueltig_bis), ["2026-06-15", "2026-07-20"]);
  const alle = await werkzeug(kontext, "crm_faelligkeiten").ausfuehren({ nurAbgelaufen: false }, kontext);
  assert.equal(alle.zeilen, 3);
  const zusammen = await werkzeug(kontext, "crm_faelligkeiten_zusammenfassung").ausfuehren({}, kontext);
  const zeile = zusammen.daten[0];
  assert.equal(Number(zeile.abgelaufen), 2);
  assert.equal(Number(zeile.laeuft_bald_ab), 0);
  assert.equal(Number(zeile.weitere_gueltig), 1);
  assert.equal(Number(zeile.nicht_lesbar), 0);
});

test("crm_dubletten erkennt die doppelte Rufnummer", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const ergebnis = await werkzeug(kontext, "crm_dubletten").ausfuehren({}, kontext);
  const zeile = ergebnis.daten[0];
  assert.equal(Number(zeile.mehrere_eintraege_rufnummern), 1);
  assert.equal(Number(zeile.zeilen_auf_diesen_rufnummern), 2);
  assert.equal(Number(zeile.schon_markierte_dubletten), 1);
});

test("crm_regionen und crm_altersgruppen gruppieren korrekt", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const regionen = await werkzeug(kontext, "crm_regionen").ausfuehren({}, kontext);
  assert.deepEqual(regionen.daten.map((z) => z.Ort), ["Dortmund", "Berlin"]);
  assert.deepEqual(regionen.daten.map((z) => Number(z.datensaetze)), [2, 1]);
  const altersgruppen = await werkzeug(kontext, "crm_altersgruppen").ausfuehren({}, kontext);
  const reihen = Object.fromEntries(altersgruppen.daten.map((z) => [z.altersreihe, Number(z.datensaetze)]));
  assert.equal(reihen["30-39"], 1);
  assert.equal(reihen["40-49"], 2);
});

test("crm_sql prueft und rechnt, Fehler kommen benannt", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const ok = await werkzeug(kontext, "crm_sql").ausfuehren({ sql: "SELECT 1 AS x" }, kontext);
  assert.deepEqual(ok.daten, [{ x: 1 }]);
  await assert.rejects(
    () => werkzeug(kontext, "crm_sql").ausfuehren({ sql: "CREATE TABLE x(a INT)" }, kontext),
    (fehler) => /SELECT oder WITH/.test(fehler.message),
  );
  await assert.rejects(
    () => werkzeug(kontext, "crm_sql").ausfuehren({ sql: "SELECT 1; DROP TABLE x" }, kontext),
    (fehler) => /einzige Anweisung/.test(fehler.message),
  );
  const mitWert = await werkzeug(kontext, "crm_sql").ausfuehren({ sql: "SELECT ';' AS s" }, kontext);
  assert.deepEqual(mitWert.daten, [{ s: ";" }]);
});

test("crm_abfragen und crm_abfrage_datei nutzen crm/ im Tresor", { skip: SKIP_DUCKDB }, async () => {
  const kontext = erstelleKontext((await crmFixtur()).cfg);
  const liste = await werkzeug(kontext, "crm_abfragen").ausfuehren({}, kontext);
  assert.deepEqual(liste.daten, [{ datei: "test-abfrage.sql", hinweis: "Zaehlt alle Zeilen" }]);
  const lauf = await werkzeug(kontext, "crm_abfrage_datei").ausfuehren({ datei: "test-abfrage.sql" }, kontext);
  assert.deepEqual(lauf.daten, [{ n: 3 }]);
  await assert.rejects(
    () => werkzeug(kontext, "crm_abfrage_datei").ausfuehren({ datei: "../ausserhalb.sql" }, kontext),
    (fehler) => /tresor-relativ/.test(fehler.message),
  );
});

test("Ressourcen listen Parquet und Abfragen, Lesen liefert Inhalt", { skip: SKIP_DUCKDB }, async () => {
  const cfg = (await crmFixtur()).cfg;
  const liste = await ressourcenLaden(cfg);
  const uris = liste.map((r) => r.uri);
  assert.ok(uris.includes("crm://daten/adressen.parquet"), uris.join(", "));
  assert.ok(uris.includes("crm://abfrage/test-abfrage.sql"), uris.join(", "));
  const abfrage = await ressourceLesen(cfg, "crm://abfrage/test-abfrage.sql");
  assert.match(abfrage.text, /SELECT COUNT\(\*\) AS n/);
  const schema = await ressourceLesen(cfg, "crm://daten/adressen.parquet");
  assert.match(schema.text, /column_name/);
  await assert.rejects(() => ressourceLesen(cfg, "crm://daten/../geheim.txt"), /tresor-relativ/);
  await assert.rejects(() => ressourceLesen(cfg, "crm://unbekannt/x"), /Unbekannte Ressourcen-URI/);
});

// ----------------------------------------------------------------- MCP / ACP

const mcp = require("./crm/crm-mcp");
const acpModul = require("./crm/crm-acp");
const serverModul = require("./crm/crm-server");
const agent = require("./crm/crm-agent-client");

function stubKontext() {
  return {
    cfg: core.standardKonfig({ vault: os.tmpdir() }),
    werkzeuge: async () => [{
      name: "stub_werkzeug",
      titel: "Stub",
      beschreibung: "nur fuer Tests",
      eingabeSchema: { type: "object" },
      ausfuehren: async (args) => {
        if (args?.kaputt) throw new Error("absichtlich kaputt");
        return { daten: [{ ok: true, args: args ?? null }], zeilen: 1, ingesamt: 1, abgeschnitten: false };
      },
    }],
    ressourcen: async () => [{ uri: "crm://abfrage/stub.sql", name: "stub.sql", mimeType: "text/x-sql" }],
    ressourceLesen: async (uri) => {
      if (uri === "crm://abfrage/stub.sql") return { uri, mimeType: "text/x-sql", text: "SELECT 1" };
      throw new Error(`Unbekannte Ressourcen-URI: ${uri}`);
    },
  };
}

test("MCP initialize verhandelt die Protokollversion", async () => {
  const verbindung = mcp.erstelleMcpVerbindung(stubKontext());
  const init = await verbindung.verarbeite({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.equal(init.result.serverInfo.name, core.CRM_AGENT_NAME);
  assert.ok(init.result.capabilities.tools);
  assert.match(init.result.instructions, /abgeschnitten/);
  const fremd = await verbindung.verarbeite({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(fremd.result.protocolVersion, mcp.PROTOKOLLVERSION);
  const ohneId = await verbindung.verarbeite({ jsonrpc: "2.0", method: "initialize" });
  assert.equal(ohneId.error.code, mcp.FEHLER_UNGUELTIG);
});

test("MCP kennt Benachrichtigungen, ping und Methodenfehler", async () => {
  const verbindung = mcp.erstelleMcpVerbindung(stubKontext());
  assert.equal(await verbindung.verarbeite({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const ping = await verbindung.verarbeite({ jsonrpc: "2.0", id: 3, method: "ping" });
  assert.deepEqual(ping.result, {});
  assert.equal(await verbindung.verarbeite({ jsonrpc: "2.0", method: "ping" }), null);
  const unbekannt = await verbindung.verarbeite({ jsonrpc: "2.0", id: 4, method: "müll" });
  assert.equal(unbekannt.error.code, mcp.FEHLER_METHODE);
  assert.equal(await verbindung.verarbeite({ jsonrpc: "2.0", method: "müll" }), null);
  const falsch = await verbindung.verarbeite({ jsonrpc: "1.0", id: 5, method: "ping" });
  assert.equal(falsch.error.code, mcp.FEHLER_UNGUELTIG);
  const ohneMethode = await verbindung.verarbeite({ jsonrpc: "2.0", id: 6 });
  assert.equal(ohneMethode.error.code, mcp.FEHLER_METHODE);
});

test("MCP tools/list und tools/call folgen dem Protokoll", async () => {
  const verbindung = mcp.erstelleMcpVerbindung(stubKontext());
  const liste = await verbindung.verarbeite({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(liste.result.tools[0].name, "stub_werkzeug");
  assert.deepEqual(liste.result.tools[0].inputSchema, { type: "object" });
  const ok = await verbindung.verarbeite({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "stub_werkzeug", arguments: { x: 1 } } });
  assert.equal(ok.result.isError, false);
  const inhalt = JSON.parse(ok.result.content[0].text);
  assert.equal(inhalt.daten[0].ok, true);
  assert.equal(inhalt.daten[0].args.x, 1);
  const kaputt = await verbindung.verarbeite({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "stub_werkzeug", arguments: { kaputt: true } } });
  assert.equal(kaputt.result.isError, true);
  assert.equal(kaputt.result.content[0].text, "absichtlich kaputt");
  const unbekannt = await verbindung.verarbeite({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "gibtsnicht" } });
  assert.equal(unbekannt.error.code, mcp.FEHLER_PARAMETER);
});

test("MCP Ressourcen listen und lesen, unbekannte URIs kommen benannt", async () => {
  const verbindung = mcp.erstelleMcpVerbindung(stubKontext());
  const liste = await verbindung.verarbeite({ jsonrpc: "2.0", id: 1, method: "resources/list" });
  assert.equal(liste.result.resources[0].uri, "crm://abfrage/stub.sql");
  const lesen = await verbindung.verarbeite({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "crm://abfrage/stub.sql" } });
  assert.equal(lesen.result.contents[0].text, "SELECT 1");
  const unbekannt = await verbindung.verarbeite({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "crm://abfrage/fremd.sql" } });
  assert.equal(unbekannt.error.code, mcp.FEHLER_PARAMETER);
  assert.match(unbekannt.error.message, /Unbekannte Ressourcen-URI/);
});

test("MCP vor dem echten CRM: initialize, Werkzeugliste, Aufruf", { skip: SKIP_DUCKDB }, async () => {
  const verbindung = mcp.erstelleMcpVerbindung(erstelleKontext((await crmFixtur()).cfg));
  const init = await verbindung.verarbeite({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.result.protocolVersion, mcp.PROTOKOLLVERSION);
  const liste = await verbindung.verarbeite({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.ok(liste.result.tools.some((w) => w.name === "crm_uebersicht"));
  const aufruf = await verbindung.verarbeite({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "crm_uebersicht", arguments: {} } });
  const ergebnis = JSON.parse(aufruf.result.content[0].text);
  assert.equal(Number(ergebnis.daten[0].datensaetze), 3);
});

// ---------------------------------------------------------------------- ACP

test("ACP Discovery liefert Manifest und Ping", async () => {
  const acp = acpModul.erstelleAcpVerbindung(stubKontext());
  const ping = await acp.bediene("GET", "/ping", null);
  assert.equal(ping.status, 200);
  const liste = await acp.bediene("GET", "/agents", null);
  assert.equal(liste.koerper.agents[0].name, core.CRM_AGENT_NAME);
  const manifest = await acp.bediene("GET", `/agents/${core.CRM_AGENT_NAME}`, null);
  assert.deepEqual(manifest.koerper.input_content_types, ["text/plain", "application/json"]);
  const fremd = await acp.bediene("GET", "/agents/fremd", null);
  assert.equal(fremd.status, 404);
  assert.equal(fremd.koerper.code, "not_found");
});

test("ACP Lauf: Werkzeug-Eingabe, SQL-Eingabe, Fehlerformen", async () => {
  const acp = acpModul.erstelleAcpVerbindung(stubKontext());
  const eingabe = [{ role: "user", parts: [{ content_type: "text/plain", content: '{"werkzeug":"stub_werkzeug","argumente":{"x":7}}' }] }];
  const sync = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME, input: eingabe, mode: "sync" });
  assert.equal(sync.status, 200);
  assert.equal(sync.koerper.status, "completed");
  assert.ok(sync.koerper.run_id);
  const inhalt = JSON.parse(sync.koerper.output[0].parts[0].content);
  assert.equal(inhalt.daten[0].args.x, 7);
  const unklar = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME, input: [{ role: "user", parts: [{ content: "hallihallo" }] }] });
  assert.equal(unklar.status, 400);
  assert.equal(unklar.koerper.code, "invalid_input");
  const fremd = await acp.bediene("POST", "/runs", { agent_name: "fremd", input: eingabe });
  assert.equal(fremd.status, 404);
  const leer = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME });
  assert.equal(leer.status, 400);
  const sqlOhneWerkzeug = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME, input: [{ role: "user", parts: [{ content: "SELECT 1" }] }] });
  assert.equal(sqlOhneWerkzeug.status, 400);
  assert.match(sqlOhneWerkzeug.koerper.message, /crm_sql/);
});

test("ACP Laeufe sind lesbar und tragen Ereignisse; stream liefert SSE", async () => {
  const acp = acpModul.erstelleAcpVerbindung(stubKontext());
  const start = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME, input: [{ role: "user", parts: [{ content: '{"werkzeug":"stub_werkzeug","argumente":{}}' }] }] });
  const runId = start.koerper.run_id;
  const lesen = await acp.bediene("GET", `/runs/${runId}`, null);
  assert.equal(lesen.koerper.run_id, runId);
  const fehlt = await acp.bediene("GET", "/runs/00000000-0000-0000-0000-000000000000", null);
  assert.equal(fehlt.status, 404);
  const ereignisse = await acp.bediene("GET", `/runs/${runId}/events`, null);
  assert.deepEqual(ereignisse.koerper.events.map((e) => e.type), ["run.created", "run.completed"]);
  const strom = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME, input: [{ role: "user", parts: [{ content: '{"werkzeug":"stub_werkzeug","argumente":{}}' }] }], mode: "stream" });
  assert.equal(strom.typ, "text/event-stream");
  assert.match(strom.koerper, /event: run\.created/);
  assert.match(strom.koerper, /event: run\.completed/);
  const bruch = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME, input: [{ role: "user", parts: [{ content: '{"werkzeug":"stub_werkzeug","argumente":{"kaputt":true}}' }] }] });
  assert.equal(bruch.koerper.status, "failed");
  assert.equal(bruch.koerper.error.code, "server_error");
  const abbruch = await acp.bediene("POST", `/runs/${runId}/cancel`, null);
  assert.equal(abbruch.status, 202);
  const unbekannt = await acp.bediene("POST", "/runs/x/events", null);
  assert.equal(unbekannt.status, 404);
});

test("ACP vor dem echten CRM: SQL-Eingabe rechnet die Fixtur", { skip: SKIP_DUCKDB }, async () => {
  const acp = acpModul.erstelleAcpVerbindung(erstelleKontext((await crmFixtur()).cfg));
  const start = await acp.bediene("POST", "/runs", { agent_name: core.CRM_AGENT_NAME, input: [{ role: "user", parts: [{ content: "SELECT COUNT(*) AS n FROM 'adressen.parquet'" }] }] });
  assert.equal(start.koerper.status, "completed");
  const inhalt = JSON.parse(start.koerper.output[0].parts[0].content);
  assert.deepEqual(inhalt.daten, [{ n: 3 }]);
});

// ------------------------------------------------------------------- Server

test("tokenStimmt vergleicht fehlsicher", () => {
  assert.equal(serverModul.tokenStimmt({ headers: { authorization: "Bearer abc" } }, "abc"), true);
  assert.equal(serverModul.tokenStimmt({ headers: { "x-unitedshare-token": "abc" } }, "abc"), true);
  assert.equal(serverModul.tokenStimmt({ headers: { authorization: "Bearer xyz" } }, "abc"), false);
  assert.equal(serverModul.tokenStimmt({ headers: {} }, "abc"), false);
  assert.equal(serverModul.tokenStimmt({ headers: { authorization: "Basic abc" } }, "abc"), false);
});

test("Server: Tokenpflicht und health", async () => {
  const lauf = await serverModul.starteCrmServer(stubKontext(), { port: 0, token: "test-token" });
  try {
    const ohne = await fetch(`${lauf.adresse}/health`);
    assert.equal(ohne.status, 401);
    const gesund = await fetch(`${lauf.adresse}/health`, { headers: { Authorization: "Bearer test-token" } });
    assert.equal(gesund.status, 200);
    const health = await gesund.json();
    assert.equal(health.status, "ok");
    assert.ok(health.werkzeuge.includes("stub_werkzeug"));
    assert.equal(health.mcp, "POST /mcp");
  } finally {
    await lauf.schliessen();
  }
});

test("Server: MCP-Sitzung von initialize bis delete", async () => {
  const lauf = await serverModul.starteCrmServer(stubKontext(), { port: 0, token: "test-token" });
  try {
    const kopf = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
    const init = await fetch(`${lauf.adresse}/mcp`, { method: "POST", headers: kopf, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    assert.equal(init.status, 200);
    const sitzung = init.headers.get("mcp-session-id");
    assert.ok(sitzung, "initialize muss eine Sitzung nennen");
    assert.equal((await init.json()).result.protocolVersion, mcp.PROTOKOLLVERSION);
    const ohneSitzung = await fetch(`${lauf.adresse}/mcp`, { method: "POST", headers: kopf, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    assert.equal(ohneSitzung.status, 400);
    const fremdeSitzung = await fetch(`${lauf.adresse}/mcp`, { method: "POST", headers: { ...kopf, "Mcp-Session-Id": "unbekannt" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }) });
    assert.equal(fremdeSitzung.status, 404);
    const liste = await fetch(`${lauf.adresse}/mcp`, { method: "POST", headers: { ...kopf, "Mcp-Session-Id": sitzung }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }) });
    assert.equal(liste.status, 200);
    const tools = (await liste.json()).result.tools;
    assert.ok(tools.some((w) => w.name === "stub_werkzeug"));
    const aufruf = await fetch(`${lauf.adresse}/mcp`, { method: "POST", headers: { ...kopf, "Mcp-Session-Id": sitzung }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "stub_werkzeug", arguments: {} } }) });
    assert.ok((await aufruf.json()).result.content[0].text.includes("ok"));
    const kaputt = await fetch(`${lauf.adresse}/mcp`, { method: "POST", headers: { ...kopf, "Mcp-Session-Id": sitzung }, body: "{nope" });
    assert.equal((await kaputt.json()).error.code, mcp.FEHLER_PARSE);
    const get = await fetch(`${lauf.adresse}/mcp`, { headers: kopf });
    assert.equal(get.status, 405);
    const loeschen = await fetch(`${lauf.adresse}/mcp`, { method: "DELETE", headers: { ...kopf, "Mcp-Session-Id": sitzung } });
    assert.equal(loeschen.status, 204);
    const danach = await fetch(`${lauf.adresse}/mcp`, { method: "POST", headers: { ...kopf, "Mcp-Session-Id": sitzung }, body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list" }) });
    assert.equal(danach.status, 404);
    const fremderPfad = await fetch(`${lauf.adresse}/quatsch`, { headers: kopf });
    assert.equal(fremderPfad.status, 404);
  } finally {
    await lauf.schliessen();
  }
});

test("Server: ACP-Routen hinter dem Token", async () => {
  const lauf = await serverModul.starteCrmServer(stubKontext(), { port: 0, token: "test-token" });
  try {
    const kopf = { Authorization: "Bearer test-token", "Content-Type": "application/json" };
    const agents = await fetch(`${lauf.adresse}/acp/agents`, { headers: kopf });
    const agenten = await agents.json();
    assert.equal(agenten.agents[0].name, core.CRM_AGENT_NAME);
    const start = await fetch(`${lauf.adresse}/acp/runs`, { method: "POST", headers: kopf, body: JSON.stringify({
      agent_name: core.CRM_AGENT_NAME,
      input: [{ role: "user", parts: [{ content_type: "text/plain", content: '{"werkzeug":"stub_werkzeug","argumente":{"y":9}}' }] }],
      mode: "sync",
    }) });
    assert.equal(start.status, 200);
    const laufBody = await start.json();
    assert.equal(laufBody.status, "completed");
    assert.ok(JSON.parse(laufBody.output[0].parts[0].content).daten[0].args.y === 9);
    const lesen = await fetch(`${lauf.adresse}/acp/runs/${laufBody.run_id}`, { headers: kopf });
    assert.equal(lesen.status, 200);
    const ereignisse = await fetch(`${lauf.adresse}/acp/runs/${laufBody.run_id}/events`, { headers: kopf });
    assert.ok((await ereignisse.json()).events.length >= 2);
    const strom = await fetch(`${lauf.adresse}/acp/runs`, { method: "POST", headers: kopf, body: JSON.stringify({
      agent_name: core.CRM_AGENT_NAME,
      input: [{ role: "user", parts: [{ content: '{"werkzeug":"stub_werkzeug","argumente":{}}' }] }],
      mode: "stream",
    }) });
    assert.match(strom.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.match(await strom.text(), /event: run\.created/);
    const ohneKoerper = await fetch(`${lauf.adresse}/acp/runs`, { method: "POST", headers: kopf, body: "{nope" });
    assert.equal(ohneKoerper.status, 400);
  } finally {
    await lauf.schliessen();
  }
});

// ------------------------------------------------------------- Agent-Client

test("Agent-Client verweigert Cloud-Anfragen ohne Freigabe", async () => {
  await assert.rejects(() => agent.agentMcpHandschlag({}), /verweigert/);
  await assert.rejects(() => agent.agentWerkzeuge({}), /verweigert/);
  await assert.rejects(() => agent.agentAcpLauf({}, "SELECT 1"), /verweigert/);
});

test("Agent-Client prueft die Basis-Adresse", () => {
  assert.equal(agent.basisUrl({}), "https://api.unitedshare.ai");
  assert.equal(agent.basisUrl({ url: "http://127.0.0.1:8787/" }), "http://127.0.0.1:8787");
  assert.throws(() => agent.basisUrl({ url: "ftp://x" }), /http\(s\)/);
});

test("Agent-Client spricht mit dem eigenen Server end-to-end", async () => {
  const lauf = await serverModul.starteCrmServer(stubKontext(), { port: 0, token: "test-token" });
  try {
    const optionen = { url: lauf.adresse, token: lauf.token, erlaubt: true };
    const handschlag = await agent.agentMcpHandschlag(optionen);
    assert.equal(handschlag.serverInfo.name, core.CRM_AGENT_NAME);
    const werkzeuge = await agent.agentWerkzeuge(optionen);
    assert.ok(werkzeuge.some((w) => w.name === "stub_werkzeug"));
    const ergebnis = await agent.agentWerkzeugAufrufen(optionen, "stub_werkzeug", { x: 5 });
    assert.ok(JSON.parse(ergebnis.content[0].text).daten[0].args.x === 5);
    const acpLauf = await agent.agentAcpLauf(optionen, '{"werkzeug":"stub_werkzeug","argumente":{"z":2}}');
    assert.equal(acpLauf.status, 200);
    assert.equal(acpLauf.lauf.status, "completed");
  } finally {
    await lauf.schliessen();
  }
});

