"use strict";

// Verträge für Pfade, in denen das Erwähnungszeichen hängengeblieben ist.
//
// ANLASS (aus dem Vault, 2026-10-09): Der Block lautete
//
//   {"action":"read","path":"@DID Chats.md"}
//
// Das @ ist die Erwähnungs-Syntax der Eingabe (@Pfad liest eine Notiz), kein
// Teil des Dateinamens. Das Modell hat es aus der Frage mitgenommen. Die
// Datei heißt "DID Chats.md", also schlug das Lesen fehl -- und weil die
// Schleife danach weiterläuft, versucht das Modell es erneut, bis zu sechs
// Mal.
//
// VORSICHTIG: Eine Datei DARF mit @ beginnen. Deshalb wird nicht blind
// abgeschnitten, sondern erst der Pfad wie angegeben versucht und nur bei
// Misserfolg der ohne @. So geht nichts verloren.

const test = require("node:test");
const assert = require("node:assert/strict");

const { executeVaultAction } = require("./unitedshare-core");

function tresor(dateien) {
  const inhalt = new Map(Object.entries(dateien));
  const gelesen = [];
  return {
    gelesen,
    async read(pfad) {
      gelesen.push(pfad);
      return inhalt.has(pfad) ? inhalt.get(pfad) : null;
    },
    async list() {
      return [...inhalt.keys()];
    },
    async write(pfad, inhaltNeu) {
      inhalt.set(pfad, inhaltNeu);
    },
    async run(pfad) {
      // Wie der echte Host: was nicht da ist, läuft nicht. Ein Mock, der
      // jeden Pfad annimmt, macht den Test grün, ohne etwas zu zeigen.
      if (!inhalt.has(pfad)) throw new Error(`nicht da: ${pfad}`);
      return "gelaufen";
    },
  };
}

test("ein hängengebliebenes @ verhindert das Lesen nicht", async () => {
  const host = tresor({ "DID Chats.md": "Guten Tag." });
  const ergebnis = await executeVaultAction(
    { action: "read", path: "@DID Chats.md", content: "" },
    host,
  );
  assert.match(ergebnis, /Guten Tag\./);
});

test("der Pfad mit @ wird zuerst versucht", async () => {
  // Eine Datei darf mit @ beginnen. Die bekommt den Vorrang.
  const host = tresor({ "@besonders.md": "mit Klammeraffe", "besonders.md": "ohne" });
  const ergebnis = await executeVaultAction(
    { action: "read", path: "@besonders.md", content: "" },
    host,
  );
  assert.match(ergebnis, /mit Klammeraffe/);
  assert.equal(host.gelesen[0], "@besonders.md");
});

test("ohne @ bleibt alles wie bisher", async () => {
  const host = tresor({ "notiz.md": "Inhalt" });
  const ergebnis = await executeVaultAction(
    { action: "read", path: "notiz.md", content: "" },
    host,
  );
  assert.match(ergebnis, /Inhalt/);
  assert.deepEqual(host.gelesen, ["notiz.md"]);
});

test("gibt es beide nicht, bleibt die Meldung bei dem, was gefragt war", async () => {
  const host = tresor({});
  const ergebnis = await executeVaultAction(
    { action: "read", path: "@fehlt.md", content: "" },
    host,
  );
  assert.match(ergebnis, /@fehlt\.md/);
  assert.match(ergebnis, /nicht im Tresor/);
});

test("auch beim Starten greift die Nachsicht", async () => {
  const host = tresor({ "skript.py": "print(1)" });
  const ergebnis = await executeVaultAction(
    { action: "run", path: "@skript.py", content: "" },
    host,
  );
  assert.match(ergebnis, /gelaufen/);
});

test("beim Schreiben wird NICHT nachgebessert", async () => {
  // Lesen ist folgenlos, Schreiben nicht. Legte man bei "@neu.md" die Datei
  // "neu.md" an, entstünde eine Datei, die niemand genannt hat.
  const host = tresor({});
  await executeVaultAction(
    { action: "write", path: "@neu.md", content: "x" },
    host,
  );
  const namen = await host.list();
  assert.deepEqual(namen, ["@neu.md"],
    "geschrieben wird genau der genannte Pfad");
});
