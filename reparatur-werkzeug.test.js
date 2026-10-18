"use strict";

// Verträge für scripts/repariere-chats.js.
//
// ANLASS (2026-10-18): Der Nested-Fence-Bug in stripVaultActions (behoben in
// unitedshare-core.js) hat vor der Reparatur bereits Nachrichten in
// .vault/chats gespeichert -- mit dem Rest eines abgebrochenen JSON-Objekts
// statt des eigentlichen Antworttexts. Der ursprüngliche, vollständige
// Rohtext existiert nirgends mehr: der alte, fehlerhafte stripVaultActions
// hat ihn beim ersten Durchlauf schon überschrieben. "Reparieren" kann also
// nur heißen: den sichtbaren Rest als das benennen, was er ist, nicht ihn
// rekonstruieren.
//
// SIGNATUR: Der Rest endet immer auf das schließende Zitat plus Klammer des
// ursprünglichen JSON-Objekts -- "}". Das kommt in echtem Fließtext
// praktisch nie vor und ist deshalb ein verlässliches, enges Erkennungsmerkmal.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  istVerstuemmelterProtokollRest,
  bereinigeNachricht,
  bereinigeEintrag,
  PLATZHALTER_TEXT,
} = require("./scripts/repariere-chats");

const VERSTUEMMELT = [
  "mermaid",
  "graph TD",
  "A[Notiz] -->|read| B(Aktion)",
  "```",
  "",
  "![[image_description]]",
  "",
  '"}',
].join("\n");

test("istVerstuemmelterProtokollRest erkennt den JSON-Rest an der Endung", () => {
  assert.equal(istVerstuemmelterProtokollRest(VERSTUEMMELT), true);
  assert.equal(istVerstuemmelterProtokollRest("Ein ganz normaler Satz."), false);
  assert.equal(istVerstuemmelterProtokollRest('Ein Satz mit Anführung "Zitat" mittendrin.'), false);
  assert.equal(istVerstuemmelterProtokollRest(""), false);
  assert.equal(istVerstuemmelterProtokollRest(null), false);
});

test("bereinigeNachricht ersetzt nur betroffene Assistant-Nachrichten", () => {
  const sauber = { role: "assistant", content: "Alles in Ordnung." };
  assert.equal(bereinigeNachricht(sauber), sauber, "unveraendert bleibt dieselbe Referenz");

  const nutzerFrage = { role: "user", content: VERSTUEMMELT };
  assert.equal(bereinigeNachricht(nutzerFrage), nutzerFrage, "Nutzerfragen werden nie angefasst");

  const kaputt = { role: "assistant", content: `Einleitung.\n\n${VERSTUEMMELT}` };
  const ergebnis = bereinigeNachricht(kaputt);
  assert.notEqual(ergebnis, kaputt);
  assert.equal(ergebnis.content, PLATZHALTER_TEXT);
  assert.equal(ergebnis.role, "assistant");
});

test("bereinigeEintrag zählt die geänderten Nachrichten und lässt den Rest unberührt", () => {
  const eintrag = {
    id: "x",
    messages: [
      { role: "user", content: "Frage" },
      { role: "assistant", content: `Vorher.\n${VERSTUEMMELT}` },
      { role: "user", content: "Zweite Frage" },
      { role: "assistant", content: "Eine saubere Antwort." },
    ],
  };
  const { eintrag: bereinigt, anzahl } = bereinigeEintrag(eintrag);
  assert.equal(anzahl, 1);
  assert.equal(bereinigt.messages[1].content, PLATZHALTER_TEXT);
  assert.equal(bereinigt.messages[3].content, "Eine saubere Antwort.");
  assert.equal(bereinigt.id, "x");
});

test("ein unveränderter Eintrag liefert anzahl 0 und dieselbe Nachrichtenliste inhaltlich", () => {
  const eintrag = { id: "y", messages: [{ role: "assistant", content: "Ok." }] };
  const { eintrag: bereinigt, anzahl } = bereinigeEintrag(eintrag);
  assert.equal(anzahl, 0);
  assert.deepEqual(bereinigt, eintrag);
});
