"use strict";

// Verträge für die Schrittanzeige.
//
// ANLASS: Die Mehrschritt-Schleife macht bis zu sechs Durchgänge -- lesen,
// schreiben, starten -- und der Nutzer sieht davon nichts außer "Antwort
// kommt." Bei mega mit Denken sind das zwanzig Sekunden ohne Rückmeldung.
//
// Gezeigt wird nur, was wirklich passiert. Eine Anzeige, die Schritte
// erfindet, damit es belebter aussieht, wäre schlimmer als gar keine: sie
// belügt den Nutzer über den Stand seiner Arbeit.

const test = require("node:test");
const assert = require("node:assert/strict");

const { runVaultInstruction, schrittText } = require("./unitedshare-core");

function block(daten) {
  return ["```unitedshare", JSON.stringify(daten), "```"].join("\n");
}

function tresor() {
  return {
    async read() { return "Inhalt"; },
    async list() { return ["a.md"]; },
    async write() {},
    async run() { return "gelaufen"; },
  };
}

// ------------------------------------------------------------- Beschriftung

test("jede Aktionsart hat eine lesbare Beschriftung", () => {
  assert.equal(schrittText({ action: "read", path: "DID Chats.md" }), 'Liest „DID Chats.md“');
  assert.equal(schrittText({ action: "write", path: "Notiz.md" }), 'Schreibt „Notiz.md“');
  assert.equal(schrittText({ action: "run", path: "hallo.py" }), 'Startet „hallo.py“');
  assert.equal(schrittText({ action: "list", path: "Ordner" }), 'Sieht in „Ordner“ nach');
  assert.equal(schrittText({ action: "list", path: "" }), "Sieht im Tresor nach");
  assert.equal(schrittText({ action: "mesh-join", path: "e.json" }), 'Tritt bei mit „e.json“');
  assert.equal(schrittText({ action: "sync", peer: "mini", direction: "push" }),
    "Gleicht ab mit „mini“");
});

test("eine unbekannte Art bekommt keine erfundene Beschriftung", () => {
  assert.equal(schrittText({ action: "flugzeug", path: "x" }), "Arbeitet im Tresor");
  assert.equal(schrittText(null), "Arbeitet im Tresor");
});

test("ein langer Pfad wird gekürzt, nicht die Anzeige gesprengt", () => {
  const lang = `${"tief/".repeat(30)}datei.md`;
  const text = schrittText({ action: "read", path: lang });
  assert.ok(text.length <= 60, `${text.length} Zeichen: ${text}`);
  assert.ok(text.includes("datei.md"), "das Ende ist das Interessante");
});

// ----------------------------------------------------------------- Meldung

test("die Schleife meldet jede Aktion vor und nach dem Lauf", async () => {
  const gemeldet = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md" }],
    host: tresor(),
    onSchritt: (schritt) => gemeldet.push(`${schritt.zustand}:${schritt.text}`),
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Da steht: Inhalt.";
    },
  });
  assert.deepEqual(gemeldet, ['laeuft:Liest „a.md“', 'fertig:Liest „a.md“']);
});

test("mehrere Aktionen werden einzeln gemeldet", async () => {
  const gemeldet = [];
  let aufrufe = 0;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Mach beides" }],
    host: tresor(),
    onSchritt: (schritt) => {
      if (schritt.zustand === "fertig") gemeldet.push(schritt.text);
    },
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) {
        return `${block({ action: "read", path: "a.md" })}\n${block({ action: "write", path: "b.md", content: "x" })}`;
      }
      return "Fertig.";
    },
  });
  assert.deepEqual(gemeldet, ['Liest „a.md“', 'Schreibt „b.md“']);
});

test("ohne Aktionen wird nichts gemeldet", async () => {
  const gemeldet = [];
  await runVaultInstruction({
    turns: [{ role: "user", content: "Was ist eine DID?" }],
    host: tresor(),
    onSchritt: (schritt) => gemeldet.push(schritt),
    complete: async () => "Eine DID ist eine URI.",
  });
  assert.deepEqual(gemeldet, [], "eine Anzeige darf keine Schritte erfinden");
});

test("ohne onSchritt läuft alles unverändert", async () => {
  // Der Rückruf ist freiwillig. Fehlt er, darf nichts brechen.
  let aufrufe = 0;
  const antwort = await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md" }],
    host: tresor(),
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Da steht: Inhalt.";
    },
  });
  assert.equal(antwort, "Da steht: Inhalt.");
});

test("ein Fehler im Rückruf bringt die Antwort nicht zu Fall", async () => {
  // Die Anzeige ist Beiwerk. Stürzt sie ab, soll die Arbeit weiterlaufen.
  let aufrufe = 0;
  const antwort = await runVaultInstruction({
    turns: [{ role: "user", content: "Lies a.md" }],
    host: tresor(),
    onSchritt: () => {
      throw new Error("Anzeige kaputt");
    },
    complete: async () => {
      aufrufe += 1;
      if (aufrufe === 1) return block({ action: "read", path: "a.md" });
      return "Da steht: Inhalt.";
    },
  });
  assert.equal(antwort, "Da steht: Inhalt.");
});
