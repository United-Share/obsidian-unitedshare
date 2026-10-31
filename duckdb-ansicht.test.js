"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DUCKDB_ANSICHT_ENDUNGEN,
  duckdbDateiverweiseAusSql,
  duckdbSqlAusDatei,
  duckdbTabelleAusZeilen,
  duckdbVorschauAbfrage,
  istDuckdbAnsichtEndung,
  UnitedShareError,
} = require("./unitedshare-core");

test("DUCKDB_ANSICHT_ENDUNGEN listet genau die drei zustaendigen Endungen", () => {
  assert.deepEqual([...DUCKDB_ANSICHT_ENDUNGEN].sort(), ["duckdb", "parquet", "sql"]);
});

test("istDuckdbAnsichtEndung erkennt die drei zustaendigen Endungen", () => {
  assert.equal(istDuckdbAnsichtEndung("parquet"), true);
  assert.equal(istDuckdbAnsichtEndung("sql"), true);
  assert.equal(istDuckdbAnsichtEndung("duckdb"), true);
});

test("istDuckdbAnsichtEndung lehnt andere Endungen ab", () => {
  assert.equal(istDuckdbAnsichtEndung("md"), false);
  assert.equal(istDuckdbAnsichtEndung(""), false);
  assert.equal(istDuckdbAnsichtEndung(null), false);
  assert.equal(istDuckdbAnsichtEndung(undefined), false);
});

test("istDuckdbAnsichtEndung ist robust gegen Punkt-Praefix und Gross-/Kleinschreibung", () => {
  assert.equal(istDuckdbAnsichtEndung(".parquet"), true);
  assert.equal(istDuckdbAnsichtEndung("SQL"), true);
  assert.equal(istDuckdbAnsichtEndung(".DuckDB"), true);
});

test("duckdbVorschauAbfrage baut SELECT * FROM '<pfad>' LIMIT <n>", () => {
  assert.equal(
    duckdbVorschauAbfrage("notizen/a.parquet", 50),
    "SELECT * FROM 'notizen/a.parquet' LIMIT 50",
  );
});

test("duckdbVorschauAbfrage escaped ein Apostroph im Dateinamen SQL-konform", () => {
  const abfrage = duckdbVorschauAbfrage("notizen/O'Brien's Notiz.parquet", 100);
  assert.equal(abfrage, "SELECT * FROM 'notizen/O''Brien''s Notiz.parquet' LIMIT 100");
  // Syntaktisch korrekt heisst: eine ausgewogene, gerade Zahl von '-Zeichen
  // im String-Literal-Teil -- kein vorzeitig geschlossenes Literal.
  const literal = abfrage.slice(abfrage.indexOf("'"), abfrage.lastIndexOf("'") + 1);
  assert.equal((literal.match(/'/g) || []).length % 2, 0);
});

test("duckdbVorschauAbfrage faellt bei ungueltigem n auf den Standard zurueck", () => {
  assert.match(duckdbVorschauAbfrage("a.parquet", 0), /LIMIT 100$/);
  assert.match(duckdbVorschauAbfrage("a.parquet", -5), /LIMIT 100$/);
  assert.match(duckdbVorschauAbfrage("a.parquet", 1.5), /LIMIT 100$/);
  assert.match(duckdbVorschauAbfrage("a.parquet", "viele"), /LIMIT 100$/);
  assert.match(duckdbVorschauAbfrage("a.parquet", undefined), /LIMIT 100$/);
});

test("duckdbVorschauAbfrage verlangt einen Pfad", () => {
  assert.throws(() => duckdbVorschauAbfrage("", 10), UnitedShareError);
  assert.throws(() => duckdbVorschauAbfrage(null, 10), UnitedShareError);
});

test("duckdbTabelleAusZeilen liefert bei leerem Ergebnis leere Spalten/Zeilen", () => {
  assert.deepEqual(duckdbTabelleAusZeilen([]), { spalten: [], zeilen: [] });
  assert.deepEqual(duckdbTabelleAusZeilen(null), { spalten: [], zeilen: [] });
  assert.deepEqual(duckdbTabelleAusZeilen(undefined), { spalten: [], zeilen: [] });
});

test("duckdbTabelleAusZeilen bildet Spalten der ersten Zeile als Referenz ab", () => {
  const ergebnis = duckdbTabelleAusZeilen([
    { a: 1, b: 2 },
    { b: 3, a: 4 },
  ]);
  assert.deepEqual(ergebnis.spalten, ["a", "b"]);
  assert.deepEqual(ergebnis.zeilen, [[1, 2], [4, 3]]);
});

test("duckdbTabelleAusZeilen ignoriert Spalten, die nicht in der ersten Zeile stehen", () => {
  const ergebnis = duckdbTabelleAusZeilen([
    { a: 1 },
    { a: 2, b: 99 },
  ]);
  assert.deepEqual(ergebnis.spalten, ["a"]);
  assert.deepEqual(ergebnis.zeilen, [[1], [2]]);
});

test("duckdbTabelleAusZeilen stellt null als ∅ dar, nie als die Zeichenkette 'null'", () => {
  const ergebnis = duckdbTabelleAusZeilen([{ a: null, b: "wert" }]);
  assert.deepEqual(ergebnis.spalten, ["a", "b"]);
  assert.deepEqual(ergebnis.zeilen, [["∅", "wert"]]);
  assert.notEqual(ergebnis.zeilen[0][0], "null");
});

test("duckdbTabelleAusZeilen stellt fehlende Schluessel als leeren String dar", () => {
  const ergebnis = duckdbTabelleAusZeilen([
    { a: 1, b: 2 },
    { a: 3 },
  ]);
  assert.deepEqual(ergebnis.zeilen, [[1, 2], [3, ""]]);
});

test("duckdbSqlAusDatei liefert '' bei leerem Dateiinhalt (keine Abfrage)", () => {
  assert.equal(duckdbSqlAusDatei(""), "");
  assert.equal(duckdbSqlAusDatei("   \n  \t"), "");
  assert.equal(duckdbSqlAusDatei(null), "");
  assert.equal(duckdbSqlAusDatei(undefined), "");
});

test("duckdbSqlAusDatei liefert '' bei reinem Kommentar-Inhalt (keine Abfrage)", () => {
  assert.equal(duckdbSqlAusDatei("-- nur ein Kommentar\n-- noch einer"), "");
  assert.equal(duckdbSqlAusDatei("/* Blockkommentar\nueber mehrere Zeilen */"), "");
  assert.equal(duckdbSqlAusDatei("  /* a */  -- b\n"), "");
});

test("duckdbSqlAusDatei gibt echten Inhalt unveraendert (getrimmt) zurueck", () => {
  assert.equal(duckdbSqlAusDatei("SELECT 1;"), "SELECT 1;");
  assert.equal(duckdbSqlAusDatei("  SELECT 1;  "), "SELECT 1;");
  assert.equal(
    duckdbSqlAusDatei("-- Kommentar\nSELECT 1; SELECT 2;"),
    "-- Kommentar\nSELECT 1; SELECT 2;",
  );
});

// -- SQL-Codeblock: Dateiverweise in einem SQL-Text finden, die vor der
// Abfrage per registerFileBuffer() unter genau diesem String registriert
// werden muessen (sql-codeblock.test.js deckt die DOM-Verkabelung ab) --

test("duckdbDateiverweiseAusSql findet ein einfaches FROM-Dateiliteral", () => {
  assert.deepEqual(
    duckdbDateiverweiseAusSql("SELECT * FROM 'daten.parquet' LIMIT 10"),
    ["daten.parquet"],
  );
});

test("duckdbDateiverweiseAusSql findet mehrere verschiedene Verweise und entdoppelt", () => {
  const sql = "SELECT * FROM 'a/b.parquet' UNION ALL SELECT * FROM 'a/b.parquet' UNION ALL SELECT * FROM read_csv('c.csv')";
  assert.deepEqual(duckdbDateiverweiseAusSql(sql), ["a/b.parquet", "c.csv"]);
});

test("duckdbDateiverweiseAusSql ignoriert URLs, absolute Pfade und Glob-Muster", () => {
  const sql = "SELECT * FROM 'https://beispiel.test/d.parquet', '/etc/d.parquet', 'C:\\d.parquet', '*.parquet'";
  assert.deepEqual(duckdbDateiverweiseAusSql(sql), []);
});

test("duckdbDateiverweiseAusSql ignoriert Literale ohne Dateiendung", () => {
  assert.deepEqual(duckdbDateiverweiseAusSql("SELECT * WHERE name = 'daten'"), []);
});

test("duckdbDateiverweiseAusSql entschlueselt verdoppelte Apostrophe im Literal", () => {
  assert.deepEqual(
    duckdbDateiverweiseAusSql("SELECT * FROM 'O''Brien.parquet'"),
    ["O'Brien.parquet"],
  );
});

test("duckdbDateiverweiseAusSql liefert [] ohne Literale oder bei leerer Eingabe", () => {
  assert.deepEqual(duckdbDateiverweiseAusSql("SELECT 1"), []);
  assert.deepEqual(duckdbDateiverweiseAusSql(""), []);
  assert.deepEqual(duckdbDateiverweiseAusSql(null), []);
  assert.deepEqual(duckdbDateiverweiseAusSql(undefined), []);
});

// -- Strukturpruefung der drei vendorten @duckdb/duckdb-wasm-Dateien --
// Kein echter WASM/Worker-Lauf (siehe CLAUDE.md "Grenzen deiner eigenen
// Verifikation"), aber das hier IST messbar: Magic-Bytes bzw. gueltige
// JS/ESM-Syntax, ohne den Dateiinhalt selbst zu veraendern.
const DUCKDB_DIR = path.join(__dirname, "duckdb");

// "eh" (Exception Handling) statt "mvp": siehe main.src.js initDuckDb() --
// im MVP-Bundle verschluckt sich jede DuckDB-Fehlermeldung selbst
// (github.com/duckdb/duckdb-wasm Issue #2267), "eh" nutzt native WASM-
// Ausnahmebehandlung und ist davon nicht betroffen.
test("duckdb-eh.wasm beginnt mit der WASM-Magic-Number \\0asm", () => {
  const kopf = Buffer.alloc(4);
  const fd = fs.openSync(path.join(DUCKDB_DIR, "duckdb-eh.wasm"), "r");
  try {
    fs.readSync(fd, kopf, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }
  assert.deepEqual([...kopf], [0x00, 0x61, 0x73, 0x6d]);
});

test("duckdb-browser-eh.worker.js ist syntaktisch gueltiges JavaScript", () => {
  execFileSync(process.execPath, ["--check", path.join(DUCKDB_DIR, "duckdb-browser-eh.worker.js")]);
});

test("duckdb-browser-eh.worker.js hat KEIN ungebundenes _setThrew (der MVP-Fehler, Issue #2267)", () => {
  const code = fs.readFileSync(path.join(DUCKDB_DIR, "duckdb-browser-eh.worker.js"), "utf8");
  assert.equal(code.includes("_setThrew"), false);
});

// Eigener, dedizierter Test fuer die vendorte apache-arrow-Abhaengigkeit:
// require("apache-arrow") aus duckdb-browser.cjs kann FEHLSCHLAGEN, ohne
// dass das beim bloßen Laden des Moduls auffaellt (ein falsches/kaputtes
// apache-arrow -- z. B. ein Namenskollisions-Fehler beim Vendoren, der
// tatsaechlich einmal passiert ist, siehe HERKUNFT.md -- wird einfach
// stillschweigend als `u` zugewiesen; der Absturz passiert sonst erst beim
// echten Abfragen, nicht beim Laden). Darum hier EXPLIZIT die Symbole
// pruefen, die duckdb-browser.cjs tatsaechlich benutzt (RecordBatchReader,
// Table, tableToIPC), nicht nur irgendwelche Keys.
test("vendortes apache-arrow löst sich korrekt auf (RecordBatchReader, Table, tableToIPC vorhanden)", () => {
  const arrow = require(path.join(DUCKDB_DIR, "node_modules", "apache-arrow"));
  assert.equal(typeof arrow.RecordBatchReader, "function");
  assert.equal(typeof arrow.Table, "function");
  assert.equal(typeof arrow.tableToIPC, "function");
});

// package.json-Identitaet pruefen -- genau DAS fehlte bei der Kollision:
// die package.json war die von tslib, nicht von apache-arrow.
test("vendortes apache-arrow/package.json ist wirklich apache-arrow, nicht versehentlich eine Abhaengigkeit davon", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(DUCKDB_DIR, "node_modules", "apache-arrow", "package.json"), "utf8"),
  );
  assert.equal(pkg.name, "apache-arrow");
});

// duckdb-browser.cjs statt duckdb-browser.mjs: dynamisches import() einer
// file://-URL scheiterte in Obsidians Electron-Fenster ("Failed to fetch
// dynamically imported module", siehe duckdb/HERKUNFT.md "Nachtrag 2").
// require() der CommonJS-Variante nutzt Nodes eigene Dateisystem-
// Aufloesung statt Chromiums Fetch-Schicht.
//
// In reinem Node (hier im Test) wertet das Modul vollstaendig aus (inkl.
// require("apache-arrow"), das beweist die vendorte Abhaengigkeit ist
// korrekt aufloesbar) und scheitert ERST am globalen `Worker` -- das ist
// die Browser-/Electron-Renderer-API, die es in reinem Node nicht gibt,
// in Obsidians echtem Fenster aber schon. Dieselbe, erwartete Grenze wie
// beim manuellen Test waehrend der Fehlersuche (siehe HERKUNFT.md).
test("duckdb-browser.cjs laedt per require() bis zur erwarteten Worker-Grenze (beweist: apache-arrow korrekt aufloesbar)", () => {
  assert.throws(
    () => require(path.join(DUCKDB_DIR, "duckdb-browser.cjs")),
    (err) => {
      assert.ok(err instanceof ReferenceError);
      assert.match(err.message, /Worker is not defined/);
      return true;
    },
  );
});
