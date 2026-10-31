"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  fuehreSyncDurch,
  baueSyncManifest,
  konfliktDateiname,
} = require("./unitedshare-core");

// -- Testhilfen ---------------------------------------------------------------

// Baut einen Satz injizierter Callbacks aus einem einfachen Zustand:
// lokaleDateien = {pfad: inhalt}, ferneDateien = {pfad: inhalt}.
// Zeichnet jeden Aufruf auf, damit Tests Seiteneffekte pruefen koennen.
function szenario({ lokaleDateien = {}, ferneDateien = {}, letzterStand = {} } = {}) {
  const lokal = { ...lokaleDateien };
  const fern = { ...ferneDateien };
  const aufrufe = { fernDateiSchreiben: [], lokalInhaltSchreiben: [], konfliktNameFrei: [] };

  const lokalDateienListe = () =>
    Object.keys(lokal).map((pfad) => ({ pfad, mtime: 1, groesse: lokal[pfad].length }));

  const callbacks = {
    fernManifestHolen: async () => {
      const dateien = Object.keys(fern).map((pfad) => ({ pfad, mtime: 2, groesse: fern[pfad].length }));
      return baueSyncManifest(dateien, (pfad) => fern[pfad]);
    },
    fernDateiHolen: async (pfad) => fern[pfad],
    fernDateiSchreiben: async (pfad, inhalt) => {
      aufrufe.fernDateiSchreiben.push({ pfad, inhalt });
      fern[pfad] = inhalt;
    },
    lokalDateien: lokalDateienListe(),
    lokalInhaltLesen: async (pfad) => lokal[pfad],
    lokalInhaltSchreiben: async (pfad, inhalt) => {
      aufrufe.lokalInhaltSchreiben.push({ pfad, inhalt });
      lokal[pfad] = inhalt;
    },
    letzterStand,
    konfliktNameFrei: async (pfad) => {
      aufrufe.konfliktNameFrei.push(pfad);
      return konfliktDateiname(pfad, new Set());
    },
  };

  return { lokal, fern, aufrufe, callbacks };
}

// -- reiner Push-Fall ---------------------------------------------------------

test("reiner Push: lokale neue Datei wandert zu fern, nichts kommt zurueck", async () => {
  const { lokal, fern, aufrufe, callbacks } = szenario({
    lokaleDateien: { "neu.md": "hallo welt" },
  });
  const ergebnis = await fuehreSyncDurch(callbacks);

  assert.equal(ergebnis.push, 1);
  assert.equal(ergebnis.pull, 0);
  assert.equal(ergebnis.konflikt, 0);
  assert.equal(aufrufe.fernDateiSchreiben.length, 1);
  assert.equal(aufrufe.fernDateiSchreiben[0].pfad, "neu.md");
  assert.equal(aufrufe.fernDateiSchreiben[0].inhalt, "hallo welt");
  assert.equal(fern["neu.md"], "hallo welt");
  assert.equal(aufrufe.lokalInhaltSchreiben.length, 0);
  assert.ok(ergebnis.letzterStand["neu.md"]);
  assert.equal(lokal["neu.md"], "hallo welt");
});

// -- reiner Pull-Fall ---------------------------------------------------------

test("reiner Pull: ferne neue Datei wandert zu lokal, nichts geht raus", async () => {
  const { fern, aufrufe, callbacks } = szenario({
    ferneDateien: { "fern.md": "von drueben" },
  });
  const ergebnis = await fuehreSyncDurch(callbacks);

  assert.equal(ergebnis.push, 0);
  assert.equal(ergebnis.pull, 1);
  assert.equal(ergebnis.konflikt, 0);
  assert.equal(aufrufe.fernDateiSchreiben.length, 0);
  assert.equal(aufrufe.lokalInhaltSchreiben.length, 1);
  assert.equal(aufrufe.lokalInhaltSchreiben[0].pfad, "fern.md");
  assert.equal(aufrufe.lokalInhaltSchreiben[0].inhalt, "von drueben");
  assert.equal(fern["fern.md"], "von drueben");
  assert.ok(ergebnis.letzterStand["fern.md"]);
});

// -- Konflikt-Fall -------------------------------------------------------------

test("Konflikt: Original bleibt unveraendert, Kopie bekommt den fernen Inhalt, fern wird nicht beschrieben", async () => {
  const basis = baueSyncManifest([{ pfad: "geteilt.md" }], () => "gemeinsamer anfang");
  const { lokal, fern, aufrufe, callbacks } = szenario({
    lokaleDateien: { "geteilt.md": "lokale aenderung" },
    ferneDateien: { "geteilt.md": "ferne aenderung" },
    letzterStand: basis,
  });
  const ergebnis = await fuehreSyncDurch(callbacks);

  assert.equal(ergebnis.push, 0);
  assert.equal(ergebnis.pull, 0);
  assert.equal(ergebnis.konflikt, 1);

  // Original lokal unveraendert:
  assert.equal(lokal["geteilt.md"], "lokale aenderung");
  // fern unveraendert, kein Schreibversuch fuer diesen Pfad:
  assert.equal(fern["geteilt.md"], "ferne aenderung");
  assert.equal(aufrufe.fernDateiSchreiben.length, 0);

  // Konfliktkopie mit dem FERNEN Inhalt angelegt, unter freiem Namen:
  assert.equal(aufrufe.konfliktNameFrei.length, 1);
  assert.equal(aufrufe.konfliktNameFrei[0], "geteilt.md");
  assert.equal(aufrufe.lokalInhaltSchreiben.length, 1);
  assert.equal(aufrufe.lokalInhaltSchreiben[0].pfad, "geteilt (Konflikt).md");
  assert.equal(aufrufe.lokalInhaltSchreiben[0].inhalt, "ferne aenderung");
  assert.equal(lokal["geteilt (Konflikt).md"], "ferne aenderung");

  // Sichtbarkeit im Ergebnis:
  assert.equal(ergebnis.konfliktPfade.length, 1);
  assert.equal(ergebnis.konfliktPfade[0].original, "geteilt.md");
  assert.equal(ergebnis.konfliktPfade[0].kopie, "geteilt (Konflikt).md");
});

// -- gemischter Fall ------------------------------------------------------------

test("gemischt: push, pull und konflikt gleichzeitig werden korrekt verteilt", async () => {
  const basis = baueSyncManifest(
    [{ pfad: "p.md" }, { pfad: "q.md" }, { pfad: "r.md" }],
    (pfad) => ({ "p.md": "p0", "q.md": "q0", "r.md": "r0" }[pfad]),
  );
  const { lokal, fern, aufrufe, callbacks } = szenario({
    lokaleDateien: { "p.md": "p1", "q.md": "q0", "r.md": "r-lokal" },
    ferneDateien: { "p.md": "p0", "q.md": "q1", "r.md": "r-fern" },
    letzterStand: basis,
  });
  const ergebnis = await fuehreSyncDurch(callbacks);

  assert.equal(ergebnis.push, 1);
  assert.equal(ergebnis.pull, 1);
  assert.equal(ergebnis.konflikt, 1);

  assert.equal(fern["p.md"], "p1");
  assert.equal(lokal["q.md"], "q1");
  assert.equal(lokal["r.md"], "r-lokal");
  assert.equal(fern["r.md"], "r-fern");
  assert.equal(lokal["r (Konflikt).md"], "r-fern");

  assert.equal(aufrufe.fernDateiSchreiben.length, 1);
  assert.equal(aufrufe.fernDateiSchreiben[0].pfad, "p.md");
  assert.equal(aufrufe.lokalInhaltSchreiben.length, 2);
});

// -- leerer Fall -----------------------------------------------------------------

test("leer: nichts zu tun, keine Seiteneffekte, Zaehler stehen auf 0", async () => {
  const { aufrufe, callbacks } = szenario({});
  const ergebnis = await fuehreSyncDurch(callbacks);

  assert.equal(ergebnis.push, 0);
  assert.equal(ergebnis.pull, 0);
  assert.equal(ergebnis.konflikt, 0);
  assert.deepEqual(ergebnis.konfliktPfade, []);
  assert.deepEqual(ergebnis.letzterStand, {});
  assert.equal(aufrufe.fernDateiSchreiben.length, 0);
  assert.equal(aufrufe.lokalInhaltSchreiben.length, 0);
});

// -- letzterStand als Grundlage fuer den naechsten Lauf --------------------------

test("das zurueckgegebene letzterStand loest denselben unveraenderten Zustand im naechsten Lauf nicht erneut als push/pull aus", async () => {
  const { callbacks } = szenario({
    lokaleDateien: { "gleich.md": "schon abgeglichen" },
    ferneDateien: { "gleich.md": "schon abgeglichen" },
  });
  const ergebnis = await fuehreSyncDurch(callbacks);
  assert.equal(ergebnis.push, 0);
  assert.equal(ergebnis.pull, 0);
  assert.ok(ergebnis.letzterStand["gleich.md"]);
});
