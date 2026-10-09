"use strict";

// Verträge für den Fall, dass das Modell das Aktionsformat verfehlt.
//
// ANLASS (aus dem Vault, 2026-10-09): Auf die Bitte, eine Notiz anzulegen,
// antwortete rmxos-mega mit
//
//   Da, da. Entschuldige die Verzögerung. Hier die Notiz:
//   {"action":"write","path":"DIDNS.md","content":"---\ntitle: DIDNS ..."}
//
// Der Nutzer sah rohes JSON, und angelegt wurde nichts. Zwei Gründe:
//   1. parseVaultActions erkennt Aktionen nur in einem Codeblock mit der
//      Sprache unitedshare. Hier fehlte der Block.
//   2. actionsFromReply, der Auffangweg, deckt nur ausführbare Dateien
//      (.py, .js, .mjs, .sh) und nur Pfade, die in der FRAGE stehen. Eine
//      .md-Notiz, deren Namen das Modell selbst wählt, fällt durch beides.
//
// WARUM NICHT DEN PARSER LOCKERN: Dann würde auch ein JSON ausgeführt, das
// das Format bloß erklärt ("du kannst {"action":"write",...} schreiben").
// Vor Vault-Aktionen wird nicht nachgefragt -- runVaultInstruction führt sie
// unmittelbar aus. Ein zu weiter Parser schriebe also Dateien auf Verdacht.
//
// STATTDESSEN: Nichts ausführen, sondern dem Modell in der vorhandenen
// Mehrschritt-Schleife zurückmelden, dass der Block fehlt. Es antwortet neu.
// Ausgeführt wird weiterhin ausschließlich korrekt Formatiertes; der Preis
// ist im Fehlerfall ein zusätzlicher Modellaufruf.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runVaultInstruction } = require("./unitedshare-core");

function block(daten) {
  return ["```unitedshare", JSON.stringify(daten), "```"].join("\n");
}

function tresor() {
  const geschrieben = [];
  const gestartet = [];
  return {
    geschrieben,
    gestartet,
    async read() {
      return "Inhalt";
    },
    async list() {
      return [];
    },
    async write(pfad, inhalt) {
      geschrieben.push({ pfad, inhalt });
    },
    async run(pfad) {
      gestartet.push(pfad);
      return "gelaufen";
    },
  };
}

const NACKT = 'Hier die Notiz:\n{"action":"write","path":"DIDNS.md","content":"# DIDNS\\n"}';

test("nacktes Aktions-JSON legt keine Datei an", async () => {
  const host = tresor();
  await runVaultInstruction({
    turns: [{ role: "user", content: "Leg mir eine Notiz zu DIDNS an." }],
    host,
    complete: async () => NACKT,
  });
  assert.equal(host.geschrieben.length, 0,
    "ohne den Block darf nichts geschrieben werden -- auch nicht auf Verdacht");
});

test("stattdessen bekommt das Modell den fehlenden Block gemeldet", async () => {
  const host = tresor();
  const gesehen = [];
  const antwort = await runVaultInstruction({
    turns: [{ role: "user", content: "Leg mir eine Notiz zu DIDNS an." }],
    host,
    complete: async (thread) => {
      gesehen.push(thread.map((t) => t.content).join("\n"));
      if (gesehen.length === 1) return NACKT;
      if (gesehen.length === 2) {
        return `Jetzt richtig.\n${block({ action: "write", path: "DIDNS.md", content: "# DIDNS\n" })}`;
      }
      // Nach dem Ergebnis hört ein Modell auf. Gäbe der Mock den Block
      // endlos zurück, schriebe die Schleife die Datei sechsmal -- das wäre
      // ein Fehler des Mocks, nicht des Codes.
      return "Die Notiz liegt im Tresor.";
    },
  });
  assert.equal(gesehen.length >= 2, true, "es muss ein zweiter Versuch folgen");
  assert.match(gesehen[1], /unitedshare/,
    "der Hinweis muss sagen, wie das Format heißt");
  assert.equal(host.geschrieben.length, 1, "der zweite, korrekte Versuch läuft");
  assert.equal(host.geschrieben[0].pfad, "DIDNS.md");
  assert.equal(antwort.includes('"action"'), false,
    "der Nutzer darf kein rohes JSON mehr sehen");
});

test("eine gewöhnliche Antwort löst keinen zweiten Aufruf aus", async () => {
  // Der teuerste Fehler wäre, jede Antwort zweimal zu holen.
  let aufrufe = 0;
  const antwort = await runVaultInstruction({
    turns: [{ role: "user", content: "Was ist eine DID?" }],
    host: tresor(),
    complete: async () => {
      aufrufe += 1;
      return "Eine DID ist eine URI nach Schema did:method:kennung.";
    },
  });
  assert.equal(aufrufe, 1);
  assert.equal(antwort, "Eine DID ist eine URI nach Schema did:method:kennung.");
});

test("auch das Wort action allein löst nichts aus", async () => {
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Was kannst du?" }],
    host: tresor(),
    complete: async () => {
      aufrufe += 1;
      return "Ich kann Dateien lesen, schreiben und starten. Die action dafür heißt write.";
    },
  });
  assert.equal(aufrufe, 1, "nur ein JSON-Objekt mit action zählt, nicht das Wort");
});

test("es wird höchstens einmal nachgefasst", async () => {
  // Beharrt das Modell auf dem falschen Format, darf daraus keine Schleife
  // über alle sechs Schritte werden -- jeder kostet einen Modellaufruf.
  let aufrufe = 0;
  const host = tresor();
  await runVaultInstruction({
    turns: [{ role: "user", content: "Leg eine Notiz an." }],
    host,
    complete: async () => {
      aufrufe += 1;
      return NACKT;
    },
  });
  assert.equal(aufrufe, 2);
  assert.equal(host.geschrieben.length, 0);
});

test("ein korrekter Block läuft weiterhin beim ersten Versuch", async () => {
  const host = tresor();
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Leg eine Notiz an." }],
    host,
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "write", path: "a.md", content: "x" });
      return "Fertig.";
    },
  });
  assert.equal(host.geschrieben.length, 1);
  assert.equal(aufrufe, 2, "ein Aufruf für die Aktion, einer für die Zusammenfassung");
});

test("auch andere Aktionsarten werden erkannt", async () => {
  for (const art of ["read", "list", "run", "sync", "mesh-join"]) {
    let aufrufe = 0;
    await runVaultInstruction({
      turns: [{ role: "user", content: "Mach was." }],
      host: tresor(),
      complete: async () => {
        aufrufe += 1;
        return `Bitte:\n{"action":"${art}","path":"x.md"}`;
      },
    });
    assert.equal(aufrufe, 2, `${art} muss als verfehltes Format gelten`);
  }
});
