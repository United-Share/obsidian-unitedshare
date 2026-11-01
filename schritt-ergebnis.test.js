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
  const fehlgeschlagen = gemeldet.find((s) => s.zustand === "fehlgeschlagen");
  assert.match(fehlgeschlagen.ergebnis, /nicht im Tresor/);
});

test("Freigabe wartet sichtbar und Ablehnung wird nicht als Erfolg gemeldet", async () => {
  const schritte = [];
  let aufrufe = 0;
  let geschrieben = false;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Schreibe" }],
    host: { async read() { return null; }, async write() { geschrieben = true; } },
    requireWriteConfirm: true,
    confirm: async () => { assert.equal(schritte.at(-1).zustand, "wartet"); return false; },
    onSchritt: (s) => schritte.push(s),
    complete: async () => ++aufrufe === 1 ? block({ action: "write", path: "a.md", content: "x" }) : "OK",
  });
  assert.deepEqual(schritte.map((s) => s.zustand), ["geplant", "wartet", "abgelehnt"]);
  assert.equal(new Set(schritte.map((s) => s.id)).size, 1);
  assert.equal(geschrieben, false);
});

test("nach Freigabe läuft die Aktion und meldet Erfolg", async () => {
  const schritte = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Schreibe" }],
    host: { async read() { return null; }, async write() {} },
    requireWriteConfirm: true,
    confirm: async () => true,
    onSchritt: (s) => schritte.push(s),
    complete: async () => ++aufrufe === 1 ? block({ action: "write", path: "a.md", content: "x" }) : "OK",
  });
  assert.deepEqual(schritte.map((s) => s.zustand), ["geplant", "wartet", "laeuft", "fertig"]);
});

// ------------------------------------------------------------------- Runden
//
// ANLASS (2026-11-01): "Der Chat bleibt oft hängen und ich habe keinen Plan
// was los ist, da keine vernünftige Meldung kommt." Ursache: ab der zweiten
// Modellrunde einer mehrstufigen Schleife schwieg die Seitenleiste. Nur die
// allererste Runde meldete etwas ("Die Aufgabe läuft noch."). Jede weitere
// Runde meldet sich jetzt über onRunde mit Nummer und laufender Zeit.

test("jede Modellrunde meldet sich, auch nach ausgeführten Werkzeugschritten", async () => {
  const runden = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md und antworte" }],
    host: tresor(),
    onRunde: (r) => runden.push(r),
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Fertig.";
    },
  });
  assert.equal(runden.length, 2, "eine Meldung je Modellrunde");
  assert.deepEqual(runden.map((r) => r.runde), [1, 2]);
  assert.equal(runden[0].folge, false, "die erste Runde ist noch keine Folgerunde");
  assert.equal(runden[1].folge, true, "die zweite Runde folgt auf einen Werkzeugschritt");
  assert.equal(runden[0].von, 6, "die Obergrenze steht als Zahl bereit");
  assert.equal(runden[1].stand, 1, "ein Werkzeugschritt war erledigt");
});

test("eine Rückmeldung, die selbst wirft, bricht den Auftrag nicht ab", async () => {
  let aufrufe = 0;
  const antwort = await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md" }],
    host: tresor(),
    onRunde: () => { throw new Error("kaputte Anzeige"); },
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Fertig.";
    },
  });
  assert.equal(antwort, "Fertig.");
});
