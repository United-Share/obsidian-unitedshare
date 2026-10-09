"use strict";

// Verträge dafür, was der Nutzer während einer Antwort zu sehen bekommt.
//
// ANLASS (aus dem Vault, 2026-10-09, mit 1.2.1): Im Chat stand
//
//   ```unitedshare
//   {"action":"read","path":"@DID Chats.md"}
//   ```
//
// Diesmal war das Format richtig -- die Aktion lief also. Sichtbar wurde der
// Block trotzdem, und zwar auf zwei Wegen, die beide in main.src.js liegen:
//
//   draft.content = text   in der Strom-Rückmeldung: der Rohtext geht
//                          unverändert in die Blase, Block inbegriffen.
//   draft.streaming = false im Fehlerzweig: schlägt ein späterer Schritt
//                          fehl, bleibt genau dieser Rohtext stehen.
//
// stripVaultActions greift erst bei einem GESCHLOSSENEN Block und erst am
// Ende der Schleife. Während des Stroms ist der Block offen, und im
// Fehlerfall kommt das Ende nie.
//
// Der Block ist Maschinenkommunikation. Er gehört nie in die Blase, auch
// nicht für einen Moment.

const test = require("node:test");
const assert = require("node:assert/strict");

const { visibleStreamText } = require("./unitedshare-core");

test("gewöhnlicher Text bleibt unverändert", () => {
  assert.equal(visibleStreamText("Es ist 14:23 Uhr."), "Es ist 14:23 Uhr.");
  assert.equal(visibleStreamText(""), "");
  assert.equal(visibleStreamText(null), "");
});

test("ein geschlossener Block verschwindet", () => {
  const text = 'Ich sehe nach.\n```unitedshare\n{"action":"read","path":"a.md"}\n```\nSo.';
  assert.equal(visibleStreamText(text), "Ich sehe nach.\n\nSo.");
});

test("ein angefangener Block verschwindet ebenfalls", () => {
  // Der gemessene Fall: waehrend des Stroms ist der Block noch offen.
  const text = 'Ich sehe nach.\n```unitedshare\n{"action":"read","path":"@DID Chat';
  assert.equal(visibleStreamText(text), "Ich sehe nach.");
});

test("auch wenn die Antwort mit dem Block beginnt", () => {
  assert.equal(visibleStreamText('```unitedshare\n{"action":"read"'), "");
  assert.equal(visibleStreamText("```unitedshare"), "");
});

test("ein gewöhnlicher Codeblock bleibt stehen", () => {
  // Nur unitedshare-Bloecke sind Protokoll. Python, Shell und der Rest sind
  // Inhalt, den der Nutzer sehen will.
  const text = "So geht das:\n```python\nprint(1)\n```";
  assert.equal(visibleStreamText(text), text);
  const offen = "So geht das:\n```python\nprint(1)";
  assert.equal(visibleStreamText(offen), offen);
});

test("ein noch unvollständiger Zaun bleibt stehen", () => {
  // Bei "```un" ist nicht zu erkennen, ob unitedshare folgt oder etwa
  // "unix". Abschneiden erst ab dem vollstaendigen Wort -- der Zaun allein
  // ist fuer einen Augenblick sichtbar, und das ist richtig so: lieber kurz
  // ein ``` als ein verschlucktes Codebeispiel.
  assert.equal(visibleStreamText("Text\n```un"), "Text\n```un");
  assert.equal(visibleStreamText("Text\n``"), "Text\n``");
});

test("mehrere Blöcke verschwinden alle", () => {
  const text = 'Erst\n```unitedshare\n{"action":"read","path":"a"}\n```\n'
    + 'dann\n```unitedshare\n{"action":"read","path":"b"}\n```\nfertig';
  assert.equal(visibleStreamText(text), "Erst\n\ndann\n\nfertig");
});

test("geschlossener und danach angefangener Block", () => {
  const text = 'Erst\n```unitedshare\n{"action":"read","path":"a"}\n```\n'
    + 'dann\n```unitedshare\n{"action":"wr';
  assert.equal(visibleStreamText(text), "Erst\n\ndann");
});

test("die Zaunsprache darf Zusätze tragen", () => {
  // parseVaultActions erlaubt ```unitedshare mit Anhaengseln. Was dort als
  // Protokoll gilt, muss hier auch verschwinden -- sonst zeigt die Blase,
  // was gleich ausgefuehrt wird.
  const text = 'Gleich:\n```unitedshare json\n{"action":"read","path":"a"}\n```';
  assert.equal(visibleStreamText(text), "Gleich:");
});
