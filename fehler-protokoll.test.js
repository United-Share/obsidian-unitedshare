"use strict";

// Verträge für das Fehlerprotokoll in <Tresor>/.vault/debug.log.
//
// ANLASS (2026-10-18): Ein 400 oder eine leere Antwort von api.unitedshare.ai
// tritt "ab und zu" auf und ist beim nächsten Blick in die Konsole meist
// schon verschwunden. Eine Zeile pro Fehlschlag im Tresor macht das Muster
// über Zeit sichtbar, auch ohne offene Entwicklerwerkzeuge -- genau das, was
// main.src.js bei jedem gescheiterten Modellaufruf schreiben soll.

const test = require("node:test");
const assert = require("node:assert/strict");

const { DEBUG_LOG_PATH, DEBUG_LOG_LIMIT, debugLogZeile, debugLogSchreiben } = require("./unitedshare-core");

function fakeAdapter(dateien = {}) {
  const inhalt = new Map(Object.entries(dateien));
  const angelegt = [];
  return {
    inhalt,
    angelegt,
    async exists(pfad) {
      if (inhalt.has(pfad)) return true;
      for (const schluessel of inhalt.keys()) {
        if (schluessel.startsWith(`${pfad}/`)) return true;
      }
      return angelegt.includes(pfad);
    },
    async mkdir(pfad) {
      angelegt.push(pfad);
    },
    async write(pfad, daten) {
      inhalt.set(pfad, daten);
    },
    async read(pfad) {
      if (!inhalt.has(pfad)) throw new Error(`nicht da: ${pfad}`);
      return inhalt.get(pfad);
    },
  };
}

test("debugLogZeile fasst Zeitpunkt, Status und Meldung in eine Zeile", () => {
  const zeile = debugLogZeile({
    zeit: "2026-10-18T19:00:00.000Z",
    status: 400,
    meldung: "Modellaufruf fehlgeschlagen (Status 400): kaputt",
    body: "roh",
  });
  assert.match(zeile, /^2026-10-18T19:00:00\.000Z status=400 /);
  assert.match(zeile, /kaputt/);
  assert.match(zeile, /body=roh/);
  assert.equal(zeile.includes("\n"), false, "eine Zeile bleibt eine Zeile");
});

test("debugLogZeile kommt auch ohne Rohtext aus", () => {
  const zeile = debugLogZeile({ zeit: "t", status: 0, meldung: "leer" });
  assert.equal(zeile, "t status=0 leer");
});

test("debugLogSchreiben legt die Datei neu an", async () => {
  const adapter = fakeAdapter();
  await debugLogSchreiben(adapter, { zeit: "2026-10-18T19:00:00.000Z", status: 400, meldung: "kaputt" });
  const inhalt = adapter.inhalt.get(DEBUG_LOG_PATH);
  assert.ok(inhalt && inhalt.includes("kaputt"), `nicht geschrieben: ${inhalt}`);
});

test("debugLogSchreiben hängt an, statt zu überschreiben", async () => {
  const adapter = fakeAdapter();
  await debugLogSchreiben(adapter, { zeit: "t1", status: 400, meldung: "erst" });
  await debugLogSchreiben(adapter, { zeit: "t2", status: 0, meldung: "zweit" });
  const zeilen = adapter.inhalt.get(DEBUG_LOG_PATH).trim().split("\n");
  assert.equal(zeilen.length, 2);
  assert.match(zeilen[0], /erst/);
  assert.match(zeilen[1], /zweit/);
});

test("debugLogSchreiben kappt auf die letzten Zeilen, damit die Datei nicht wächst", async () => {
  const adapter = fakeAdapter();
  const gesamt = DEBUG_LOG_LIMIT + 5;
  for (let i = 0; i < gesamt; i += 1) {
    await debugLogSchreiben(adapter, { zeit: `t${i}`, status: 0, meldung: `eintrag-${i}` });
  }
  const zeilen = adapter.inhalt.get(DEBUG_LOG_PATH).trim().split("\n");
  assert.equal(zeilen.length, DEBUG_LOG_LIMIT);
  assert.match(zeilen[0], /eintrag-5\b/, "die ältesten 5 müssen weg sein");
  assert.match(zeilen[zeilen.length - 1], new RegExp(`eintrag-${gesamt - 1}\\b`));
});

test("ein fehlender Adapter wird stillschweigend übersprungen", async () => {
  await assert.doesNotReject(() => debugLogSchreiben(null, { zeit: "t", status: 0, meldung: "x" }));
});
