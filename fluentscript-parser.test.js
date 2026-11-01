"use strict";

// Verträge für den JS-Port der FluentScript-Grammatik.
//
// Referenz (NUR LESEN): BA10_BDH/tools/fluentscript.py — "Der Parser ist
// die Messlatte". Die Fälle hier sind sinngemäß aus dessen selftest()
// übertragen (Zeile ~180-243), damit der JS-Port dieselbe Grammatik
// durchsetzt wie das Original, nicht nur eine ähnlich aussehende.

const test = require("node:test");
const assert = require("node:assert/strict");
const { fluentScriptAlsZeilen, fluentScriptParsen, fluentScriptKarten, UnitedShareError } = require("./unitedshare-core");

test("eine Quelle mit mehreren Ketten bleibt gleichbedeutend, Leerzeilen trennen nicht", () => {
  assert.deepEqual(fluentScriptAlsZeilen(fluentScriptParsen('result("a").ok().value("x"); result("b").ok().value("y"); result("c").ok().value("z")')).map((z) => z.id), ["a", "b", "c"]);
});

test("hinter dem letzten Aufruf ist ein Semikolon ein benannter Fehler", () => {
  assert.throws(
    () => fluentScriptParsen('result("a").ok().value("x");\n\n'),
    (error) => {
      assert.match(error.message, /Semikolon/);
      assert.doesNotMatch(error.message, /Kopfverb/);
      return true;
    },
  );
  // Recht häufig: Semikolon nur am Zeilenende des letzten Aufrufs.
  assert.throws(() => fluentScriptParsen('result("a").ok().value("x") ;'), /Semikolon/);
  assert.throws(() => fluentScriptParsen(";"), /Semikolon/);
  // Ein Semikolon in Anführungszeichen ist Daten, kein Trenner.
  assert.equal(fluentScriptParsen('result("r").ok().value("a;")')[0].kopf, "result");
});

test("fluentScriptParsen: Kette mit ID, benannten und positionalen Argumenten", () => {
  const ketten = fluentScriptParsen('task("t1").goal("x").give(a: "b", n: 3).to(cortex)');
  assert.equal(ketten.length, 1);
  const [k] = ketten;
  assert.equal(k.kopf, "task");
  assert.equal(k.id, "t1");
  assert.equal(k.aufrufe.length, 3);
  assert.deepEqual(k.aufrufe[0], { aufruf: "goal", args: ["x"], benannt: {} });
  assert.deepEqual(k.aufrufe[1], { aufruf: "give", args: [], benannt: { a: "b", n: 3 } });
  assert.deepEqual(k.aufrufe[2], { aufruf: "to", args: [{ ident: "cortex" }], benannt: {} });
});

test("fluentScriptParsen: alle fünf Kopfverben werden akzeptiert", () => {
  for (const kopf of ["task", "result", "query", "error", "ack"]) {
    const text =
      kopf === "result" ? `${kopf}("x").ok()` : `${kopf}("x").irgendwas()`;
    const ketten = fluentScriptParsen(text);
    assert.equal(ketten[0].kopf, kopf);
  }
});

test("fluentScriptParsen: mehrere Ketten getrennt durch ';'", () => {
  const ketten = fluentScriptParsen(
    'task("m2").goal("zerlege in teilaufgaben").give(auftrag: "monatsabschluss").to(cerebri);' +
      'task("m2a").goal("belege pruefen").to(buchhaltung)',
  );
  assert.equal(ketten.length, 2);
  assert.equal(ketten[0].id, "m2");
  assert.equal(ketten[1].id, "m2a");
});

test("fluentScriptParsen: result().ok() ist gültig", () => {
  const ketten = fluentScriptParsen('result("r").ok().value(1)');
  assert.equal(ketten[0].aufrufe[0].aufruf, "ok");
});

test("fluentScriptParsen: result() mit zwei Statusaufrufen ist ungültig", () => {
  assert.throws(() => fluentScriptParsen('result("r").ok().unknown()'), UnitedShareError);
});

test("fluentScriptParsen: result().unknown() ohne missing() ist ungültig", () => {
  assert.throws(() => fluentScriptParsen('result("r").unknown()'), (err) => {
    assert.ok(err instanceof UnitedShareError);
    assert.match(err.message, /unknown.*missing|missing.*unknown/i);
    return true;
  });
});

test("fluentScriptParsen: result().unknown().missing(...) ist gültig", () => {
  const ketten = fluentScriptParsen('result("r").unknown().missing("x")');
  assert.deepEqual(
    ketten[0].aufrufe.map((a) => a.aufruf),
    ["unknown", "missing"],
  );
});

test("fluentScriptParsen: result().failed() allein ist gültig (am Original geprüft, siehe GRAMMATIK.md Beispiel result(\"m2\").failed().reason(...) -- die Semantik verlangt nur GENAU EINEN Status, keine weiteren Pflichtfelder für failed)", () => {
  const ketten = fluentScriptParsen('result("r").failed()');
  assert.deepEqual(
    ketten[0].aufrufe.map((a) => a.aufruf),
    ["failed"],
  );
});

test("fluentScriptParsen: ungültiges Kopfverb wird abgelehnt", () => {
  assert.throws(() => fluentScriptParsen('machwas("x").gib()'), UnitedShareError);
});

test("fluentScriptParsen: gebrochene Klammern werden abgelehnt", () => {
  assert.throws(() => fluentScriptParsen('task("t1".goal("x")'), UnitedShareError);
});

test("fluentScriptParsen: doppelter Punkt (Kettenbruch) wird abgelehnt", () => {
  assert.throws(() => fluentScriptParsen('task("t")..goal("x")'), UnitedShareError);
});

test("fluentScriptParsen: leerer Text wird abgelehnt", () => {
  assert.throws(() => fluentScriptParsen(""), UnitedShareError);
});

test("fluentScriptParsen: deutsche Umlaute in Werten werden akzeptiert", () => {
  const ketten = fluentScriptParsen('task("t1").goal("prüfe Überweisung").to(übergabe)');
  assert.equal(ketten[0].aufrufe[0].args[0], "prüfe Überweisung");
  assert.deepEqual(ketten[0].aufrufe[1].args[0], { ident: "übergabe" });
});

test("fluentScriptParsen: kanonische Beispiele aus GRAMMATIK.md parsen alle", () => {
  const beispiele = [
    'task("n1").goal("einschlaegige normen").give(sachverhalt: "Die Klaegerin erhielt einen Bescheid").to(cortex_legal)',
    'task("l1").goal("pruefe folgerung").give(fakten: "A ist rot. Rote sind jung.", behauptung: "A ist jung").to(logik)',
    'result("l1").ok().value("True").proof("fakt1 -> regel1")',
    'result("n1").ok().value("§ 113 VwGO").score(0.68)',
    'result("b7").unknown().missing("beleg fuer 2026-03")',
    'query("n1").about("verwaltungs oder finanzgerichtsbarkeit")',
    'error("l1").reason("eingabe kein fakten regeln format").retry(true)',
    'ack("n1")',
    'task("k9").goal("belege zaehlen").give(lieferant: "Hetzner", zeitraum: "2025-03").to(buchhaltung)',
    'result("k9").ok().value(2).unit("belege")',
    'result("m2").failed().reason("zyklus in teilaufgaben")',
  ];
  for (const b of beispiele) {
    assert.doesNotThrow(() => fluentScriptParsen(b), `sollte parsen: ${b}`);
  }
});

test("fluentScriptKarten: baut Kopfverb+ID und lesbare Aufruf-Felder", () => {
  const ketten = fluentScriptParsen('task("t1").goal("x").give(a: "b", n: 3).to(cortex)');
  const karten = fluentScriptKarten(ketten);
  assert.equal(karten.length, 1);
  assert.deepEqual(karten[0], {
    kopfverb: "task",
    id: "t1",
    felder: [
      { name: "goal", wert: "x" },
      { name: "give", wert: "a=b, n=3" },
      { name: "to", wert: "cortex" },
    ],
  });
});

test("fluentScriptKarten: nimmt auch eine einzelne Kette statt einer Liste an", () => {
  const [kette] = fluentScriptParsen('ack("n1")');
  const karten = fluentScriptKarten(kette);
  assert.deepEqual(karten, [{ kopfverb: "ack", id: "n1", felder: [] }]);
});

// -- fluentScriptAlsZeilen: Ketten -> Tabellenzeilen (Hello/World-Fall) -----

test("fluentScriptAlsZeilen: gleichförmige Ketten (gleicher Kopf, gleiche Aufrufnamen) werden zu Zeilen", () => {
  const ketten = fluentScriptParsen('result("z1").ok().value("Hello"); result("z2").ok().value("World")');
  const zeilen = fluentScriptAlsZeilen(ketten);
  assert.deepEqual(zeilen, [
    { id: "z1", ok: "", value: "Hello" },
    { id: "z2", ok: "", value: "World" },
  ]);
});

test("fluentScriptAlsZeilen: unterschiedliche Kopfverben ergeben null (keine Tabelle möglich)", () => {
  const ketten = fluentScriptParsen('ack("a1"); query("q1").about("x")');
  assert.equal(fluentScriptAlsZeilen(ketten), null);
});

test("fluentScriptAlsZeilen: unterschiedliche Aufrufnamen ergeben null", () => {
  const ketten = fluentScriptParsen('result("z1").ok().value("Hello"); result("z2").failed()');
  assert.equal(fluentScriptAlsZeilen(ketten), null);
});

test("fluentScriptAlsZeilen: eine einzelne Kette ergibt eine einzeilige Tabelle", () => {
  const ketten = fluentScriptParsen('result("z1").ok().value("Hello")');
  assert.deepEqual(fluentScriptAlsZeilen(ketten), [{ id: "z1", ok: "", value: "Hello" }]);
});

test("fluentScriptAlsZeilen: leere Liste ergibt null", () => {
  assert.equal(fluentScriptAlsZeilen([]), null);
});
