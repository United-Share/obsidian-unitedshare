"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  baueSyncManifest,
  planeSyncAbgleich,
  konfliktDateiname,
} = require("./unitedshare-core");

// -- baueSyncManifest --------------------------------------------------------

test("baut ein Manifest mit Hash aus injiziertem Inhalt", () => {
  const dateien = [
    { pfad: "Notiz.md", mtime: 100, groesse: 5 },
    { pfad: "Ordner/Zweite.md", mtime: 200, groesse: 9 },
  ];
  const inhalte = { "Notiz.md": "hallo", "Ordner/Zweite.md": "welt" };
  const manifest = baueSyncManifest(dateien, (pfad) => inhalte[pfad]);

  assert.equal(manifest["Notiz.md"].mtime, 100);
  assert.equal(manifest["Notiz.md"].groesse, 5);
  assert.equal(typeof manifest["Notiz.md"].hash, "string");
  assert.ok(manifest["Notiz.md"].hash.length > 0);
  assert.notEqual(manifest["Notiz.md"].hash, manifest["Ordner/Zweite.md"].hash);
});

test("gleicher Inhalt ergibt denselben Hash, anderer Inhalt einen anderen", () => {
  const m1 = baueSyncManifest([{ pfad: "a.md" }], () => "gleicher text");
  const m2 = baueSyncManifest([{ pfad: "b.md" }], () => "gleicher text");
  const m3 = baueSyncManifest([{ pfad: "c.md" }], () => "anderer text");
  assert.equal(m1["a.md"].hash, m2["b.md"].hash);
  assert.notEqual(m1["a.md"].hash, m3["c.md"].hash);
});

test("leere Dateiliste ergibt ein leeres Manifest", () => {
  assert.deepEqual(baueSyncManifest([], () => "x"), {});
  assert.deepEqual(baueSyncManifest(undefined, () => "x"), {});
});

test("fehlender inhaltLesen-Callback faellt auf leeren Inhalt zurueck, bricht nicht ab", () => {
  const manifest = baueSyncManifest([{ pfad: "ohne-callback.md" }]);
  assert.equal(typeof manifest["ohne-callback.md"].hash, "string");
});

test("Pfad ohne Dateiendung wird wie jeder andere Schluessel behandelt", () => {
  const manifest = baueSyncManifest([{ pfad: "README" }], () => "inhalt");
  assert.ok(manifest.README);
  assert.equal(typeof manifest.README.hash, "string");
});

// -- planeSyncAbgleich --------------------------------------------------------

function manifestAus(eintraege) {
  // Testhilfe: {pfad: hash} -> Manifestform {pfad: {hash}}
  const out = {};
  for (const [pfad, hash] of Object.entries(eintraege)) out[pfad] = { hash };
  return out;
}

test("leere Manifeste ergeben einen leeren Plan", () => {
  const plan = planeSyncAbgleich({}, {}, {});
  assert.deepEqual(plan, { push: [], pull: [], konflikt: [] });
});

test("nur lokal geaendert, fern unveraendert -> push", () => {
  const basis = manifestAus({ "a.md": "h0" });
  const lokal = manifestAus({ "a.md": "h1" });
  const fern = manifestAus({ "a.md": "h0" });
  const plan = planeSyncAbgleich(lokal, fern, basis);
  assert.deepEqual(plan, { push: ["a.md"], pull: [], konflikt: [] });
});

test("nur fern geaendert, lokal unveraendert -> pull", () => {
  const basis = manifestAus({ "a.md": "h0" });
  const lokal = manifestAus({ "a.md": "h0" });
  const fern = manifestAus({ "a.md": "h1" });
  const plan = planeSyncAbgleich(lokal, fern, basis);
  assert.deepEqual(plan, { push: [], pull: ["a.md"], konflikt: [] });
});

test("beide geaendert, aber identisch -> nichts tun", () => {
  const basis = manifestAus({ "a.md": "h0" });
  const lokal = manifestAus({ "a.md": "h1" });
  const fern = manifestAus({ "a.md": "h1" });
  const plan = planeSyncAbgleich(lokal, fern, basis);
  assert.deepEqual(plan, { push: [], pull: [], konflikt: [] });
});

test("beide geaendert, unterschiedlich -> konflikt", () => {
  const basis = manifestAus({ "a.md": "h0" });
  const lokal = manifestAus({ "a.md": "h1" });
  const fern = manifestAus({ "a.md": "h2" });
  const plan = planeSyncAbgleich(lokal, fern, basis);
  assert.deepEqual(plan, { push: [], pull: [], konflikt: ["a.md"] });
});

test("neu auf lokal, fern fehlt komplett, kein Eintrag im letzten Stand -> push, kein Konflikt", () => {
  const lokal = manifestAus({ "neu.md": "h1" });
  const fern = {};
  const plan = planeSyncAbgleich(lokal, fern, {});
  assert.deepEqual(plan, { push: ["neu.md"], pull: [], konflikt: [] });
});

test("neu auf fern, lokal fehlt komplett, kein Eintrag im letzten Stand -> pull, kein Konflikt", () => {
  const lokal = {};
  const fern = manifestAus({ "neu.md": "h1" });
  const plan = planeSyncAbgleich(lokal, fern, {});
  assert.deepEqual(plan, { push: [], pull: ["neu.md"], konflikt: [] });
});

test("Datei war im letzten Stand, lokal unveraendert, fern fehlt komplett -> push (keine Loeschung)", () => {
  const basis = manifestAus({ "alt.md": "h0" });
  const lokal = manifestAus({ "alt.md": "h0" });
  const fern = {};
  const plan = planeSyncAbgleich(lokal, fern, basis);
  assert.deepEqual(plan, { push: ["alt.md"], pull: [], konflikt: [] });
});

test("Datei war im letzten Stand, fern unveraendert, lokal fehlt komplett -> pull (keine Loeschung)", () => {
  const basis = manifestAus({ "alt.md": "h0" });
  const lokal = {};
  const fern = manifestAus({ "alt.md": "h0" });
  const plan = planeSyncAbgleich(lokal, fern, basis);
  assert.deepEqual(plan, { push: [], pull: ["alt.md"], konflikt: [] });
});

test("Datei fehlt komplett auf beiden Seiten -> kein Eintrag im Plan, obwohl im letzten Stand bekannt", () => {
  const basis = manifestAus({ "weg.md": "h0" });
  const plan = planeSyncAbgleich({}, {}, basis);
  assert.deepEqual(plan, { push: [], pull: [], konflikt: [] });
});

test("mehrere Dateien gemischt werden korrekt auf push/pull/konflikt verteilt", () => {
  const basis = manifestAus({ "p.md": "h0", "q.md": "h0", "r.md": "h0" });
  const lokal = manifestAus({ "p.md": "h1", "q.md": "h0", "r.md": "hr1" });
  const fern = manifestAus({ "p.md": "h0", "q.md": "h1", "r.md": "hr2" });
  const plan = planeSyncAbgleich(lokal, fern, basis);
  assert.deepEqual(plan.push, ["p.md"]);
  assert.deepEqual(plan.pull, ["q.md"]);
  assert.deepEqual(plan.konflikt, ["r.md"]);
});

// -- konfliktDateiname --------------------------------------------------------

test("erzeugt den ersten Konflikt-Namen, wenn noch keiner existiert", () => {
  assert.equal(konfliktDateiname("Notiz.md", new Set()), "Notiz (Konflikt).md");
});

test("zaehlt hoch, wenn der erste Konflikt-Name schon existiert", () => {
  const vorhanden = new Set(["Notiz (Konflikt).md"]);
  assert.equal(konfliktDateiname("Notiz.md", vorhanden), "Notiz (Konflikt 2).md");
});

test("zaehlt weiter hoch, wenn schon zwei Konfliktkopien existieren", () => {
  const vorhanden = new Set(["Notiz (Konflikt).md", "Notiz (Konflikt 2).md"]);
  assert.equal(konfliktDateiname("Notiz.md", vorhanden), "Notiz (Konflikt 3).md");
});

test("funktioniert auch mit einer Existenzpruef-Funktion statt einem Set", () => {
  const vorhanden = new Set(["Notiz (Konflikt).md"]);
  const existiert = (kandidat) => vorhanden.has(kandidat);
  assert.equal(konfliktDateiname("Notiz.md", existiert), "Notiz (Konflikt 2).md");
});

test("Pfad ohne Dateiendung bekommt keinen Punkt angehaengt", () => {
  assert.equal(konfliktDateiname("README", new Set()), "README (Konflikt)");
});

test("Pfad mit Ordner haelt den Konflikt-Zusatz im Dateinamen, nicht im Ordner", () => {
  assert.equal(
    konfliktDateiname("Ordner/Unterordner/Notiz.md", new Set()),
    "Ordner/Unterordner/Notiz (Konflikt).md",
  );
});

test("leeres Set bedeutet, dass nichts existiert", () => {
  assert.equal(konfliktDateiname("x.md"), "x (Konflikt).md");
});
