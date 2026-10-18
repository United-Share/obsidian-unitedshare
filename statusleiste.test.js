"use strict";

// Verträge für die kompakte Verbrauchsanzeige in Obsidians Statusleiste.
//
// ANLASS (2026-10-18): Die bestehende Kontextfenster-Zeile unter dem
// Eingabefeld (verbrauchZeile) zeigt volle Zahlen mit Tausenderpunkten und
// ist nur sichtbar, wenn die Seitenleiste offen ist. Die Statusleiste ist
// immer sichtbar, aber sehr schmal -- dafür braucht es eine eigene, kurze
// Schreibweise (12,3M statt 12.345.678).

const test = require("node:test");
const assert = require("node:assert/strict");

const { kompakteZahl, verbrauchKompakt, verbrauchProzent } = require("./unitedshare-core");

test("kompakteZahl rundet auf eine Nachkommastelle und hängt K/M/Mrd an", () => {
  assert.equal(kompakteZahl(0), "0");
  assert.equal(kompakteZahl(950), "950");
  assert.equal(kompakteZahl(12345), "12,3K");
  assert.equal(kompakteZahl(100000000), "100M");
  assert.equal(kompakteZahl(12345678), "12,3M");
  assert.equal(kompakteZahl(2500000000), "2,5Mrd");
});

test("verbrauchKompakt zeigt Verbrauch/Limit nur, wenn beide bekannt sind", () => {
  assert.equal(verbrauchKompakt({ verbraucht_tag: 25000000, limit_tag: 100000000 }), "25M/100M");
  assert.equal(verbrauchKompakt({ rest_tag: 5 }), "");
  assert.equal(verbrauchKompakt(null), "");
});

test("verbrauchProzent liefert den Anteil, gekappt auf 0 bis 100", () => {
  assert.equal(verbrauchProzent({ verbraucht_tag: 25000000, limit_tag: 100000000 }), 25);
  assert.equal(verbrauchProzent({ verbraucht_tag: 150, limit_tag: 100 }), 100, "nie über 100%");
  assert.equal(verbrauchProzent({ rest_tag: 5 }), null);
  assert.equal(verbrauchProzent(null), null);
});
