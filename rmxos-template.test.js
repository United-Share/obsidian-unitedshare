"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fluentScriptParsen, fluentScriptAlsZeilen } = require("./unitedshare-core");
const { rmxosEigenschaftenErsetzen } = require("./rmxos-template");

test("Frontmatter-Eigenschaft wird in einer Tabellenzelle ersetzt", () => {
  const original = fluentScriptParsen('result("r").ok().value("Pipeline {{$date}}"); result("s").ok().value("unverändert")');
  const resolved = rmxosEigenschaftenErsetzen(original, { date: "31.10.2026" });
  assert.equal(fluentScriptAlsZeilen(resolved)[0].value, "Pipeline 31.10.2026");
  assert.equal(fluentScriptAlsZeilen(original)[0].value, "Pipeline {{$date}}");
});

test("Text, Zahlen und Wahrheitswerte ersetzen; unbekannte und komplexe Werte bleiben sichtbar", () => {
  const source = fluentScriptParsen('result("{{$name}}").ok().value("{{$nullwert}} {{$fehlt}} {{$zahl}} {{$aktiv}} {{$liste}} {{$name}}")');
  const [result] = rmxosEigenschaftenErsetzen(source, { name: "Beispiel", nullwert: null, zahl: 0, aktiv: false, liste: ["a"] });
  assert.equal(result.id, "Beispiel");
  assert.equal(result.aufrufe[1].args[0], "{{$nullwert}} {{$fehlt}} 0 false {{$liste}} Beispiel");
});

test("Property-Inhalt kann keine FluentScript-Aktionen einschleusen", () => {
  const source = fluentScriptParsen('result("r").ok().value("{{$feld}}")');
  const result = rmxosEigenschaftenErsetzen(source, { feld: '"); task("fremd").run("x")' });
  assert.equal(result.length, 1);
  assert.equal(result[0].aufrufe[1].args[0], '"); task("fremd").run("x")');
});

test("Properties werden rekursiv aufgelöst, Prototypen aber nicht gelesen", () => {
  const source = fluentScriptParsen('result("r").ok().value("{{$a}} {{$constructor}}")');
  const result = rmxosEigenschaftenErsetzen(source, { a: "{{$b}}", b: "geheim" });
  assert.equal(result[0].aufrufe[1].args[0], "geheim {{$constructor}}");
});

test("eine zusammengesetzte Eigenschaft (owner aus name und surname) wird aufgelöst", () => {
  const source = fluentScriptParsen('result("r").ok().value("Auftraggeber: {{$owner}}")');
  const result = rmxosEigenschaftenErsetzen(source, {
    name: "Mike",
    surname: "Baumgart",
    owner: "{{$name}} {{$surname}}",
  });
  assert.equal(result[0].aufrufe[1].args[0], "Auftraggeber: Mike Baumgart");
});

test("ein Zyklus fällt sichtbar auf den Platzhalter zurück statt endlos zu laufen", () => {
  const source = fluentScriptParsen('result("r").ok().value("{{$a}}")');
  const result = rmxosEigenschaftenErsetzen(source, { a: "{{$b}}", b: "{{$a}}" });
  // a -> b -> a: die innere Wiederholung bleibt als Platzhalter stehen,
  // es gibt keinen Absturz und keine Endlosschleife.
  assert.equal(result[0].aufrufe[1].args[0], "{{$a}}");
});

test("eine zu tiefe Kette wird begrenzt und bleibt teilweise sichtbar", () => {
  const kette = {};
  const namen = [];
  for (let i = 0; i < 30; i += 1) {
    kette[`e${i}`] = `{{$e${i + 1}}}`;
    namen.push(`e${i}`);
  }
  kette.e30 = "ende";
  const source = fluentScriptParsen('result("r").ok().value("{{$e0}}")');
  const result = rmxosEigenschaftenErsetzen(source, kette);
  const wert = result[0].aufrufe[1].args[0];
  assert.ok(wert.includes("ende") === false, "die Kette darf nicht bis zum Ende aufgelöst werden");
  assert.ok(/\{\{\$e\d+\}\}/u.test(wert), "die Tiefenbegrenzung bleibt sichtbar");
});
