"use strict";

// Verträge für Denken, Zeichen und Ergebnisse in der Schrittkette.
//
// Die Kette zeigt heute nur die Vault-Aktionen. Bei einer Frage ohne
// Werkzeug bleibt sie leer -- und genau dann wartet der Nutzer am längsten,
// weil das Modell denkt.
//
// GEMESSEN (2026-10-09): Der INHALT des Denkens lässt sich nicht zeigen.
// Die Delta-Felder im Strom sind ausschließlich content und role -- kein
// reasoning_content, bei keinem der drei Modelle. Was bleibt, ist der
// Zustand: solange kein Text fließt, denkt das Modell. Das ist belegt und
// darf gezeigt werden; der Denkinhalt wäre erfunden.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runVaultInstruction, schrittZeichen } = require("./unitedshare-core");

function block(daten) {
  return ["```unitedshare", JSON.stringify(daten), "```"].join("\n");
}

function tresor() {
  return {
    async read() { return "Zeile eins\nZeile zwei\nZeile drei"; },
    async list() { return ["a.md", "b.md"]; },
    async write() {},
    async run() { return "fertig gelaufen"; },
  };
}

// ------------------------------------------------------------------ Zeichen

test("jede Aktionsart hat ein eigenes Zeichen", () => {
  const arten = ["read", "write", "run", "list", "mesh-join", "sync"];
  const zeichen = arten.map(schrittZeichen);
  assert.equal(new Set(zeichen).size, arten.length,
    `Zeichen doppelt vergeben: ${zeichen.join(" ")}`);
  for (const z of zeichen) assert.ok(z && typeof z === "string");
});

test("Denken und Antwort haben eigene Zeichen", () => {
  assert.ok(schrittZeichen("denken"));
  assert.ok(schrittZeichen("antwort"));
  assert.notEqual(schrittZeichen("denken"), schrittZeichen("antwort"));
});

test("eine unbekannte Art bekommt ein neutrales Zeichen", () => {
  assert.ok(schrittZeichen("flugzeug"));
  assert.ok(schrittZeichen(null));
});

// ----------------------------------------------------------------- Ergebnis

test("die Fertig-Meldung trägt das Ergebnis", async () => {
  const gemeldet = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md" }],
    host: tresor(),
    onSchritt: (s) => gemeldet.push(s),
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Fertig.";
    },
  });
  const fertig = gemeldet.find((s) => s.zustand === "fertig");
  assert.ok(fertig, "es muss eine Fertig-Meldung geben");
  assert.ok(fertig.ergebnis, "ohne Ergebnis bleibt der Schritt stumm");
  assert.match(fertig.ergebnis, /Zeile eins/);
});

test("die Laeuft-Meldung hat noch kein Ergebnis", async () => {
  const gemeldet = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md" }],
    host: tresor(),
    onSchritt: (s) => gemeldet.push(s),
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Fertig.";
    },
  });
  const laeuft = gemeldet.find((s) => s.zustand === "laeuft");
  assert.equal(laeuft.ergebnis, undefined, "vor dem Lauf gibt es nichts zu melden");
});

test("das Ergebnis ist kurz genug für eine Zeile", async () => {
  // Der volle Dateiinhalt gehoert nicht in die Schrittliste -- sie soll
  // zeigen, DASS etwas geschah, nicht den Inhalt wiederholen.
  const lang = "x".repeat(5000);
  const gemeldet = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md" }],
    host: { ...tresor(), async read() { return lang; } },
    onSchritt: (s) => gemeldet.push(s),
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Fertig.";
    },
  });
  const fertig = gemeldet.find((s) => s.zustand === "fertig");
  assert.ok(fertig.ergebnis.length <= 120, `${fertig.ergebnis.length} Zeichen`);
});

test("ein gescheiterter Schritt meldet den Grund", async () => {
  const gemeldet = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Lies weg.md" }],
    host: { ...tresor(), async read() { return null; } },
    onSchritt: (s) => gemeldet.push(s),
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "weg.md" });
      return "Fertig.";
    },
  });
  const fertig = gemeldet.find((s) => s.zustand === "fertig");
  assert.match(fertig.ergebnis, /nicht im Tresor/);
});
