"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { privateVorlageVorbereiten, privateAntwortAufloesen } = require("./privacy-template");

const fm = { unitedshare_privacy: "template", unitedshare_private_felder: ["kunde", "wert"], kunde: "Müller GmbH", wert: 80000 };

test("Vorlage enthält keine Property-Werte und Antwort wird lokal aufgelöst", () => {
  const auftrag = privateVorlageVorbereiten(fm, "Plane für {{VAR_1}} mit {{VAR_2}}.");
  assert.equal(auftrag.text, "Plane für {{VAR_1}} mit {{VAR_2}}.");
  assert.equal(privateAntwortAufloesen("Hallo {{VAR_1}}, {{VAR_2}}", auftrag.werte), "Hallo Müller GmbH, 80000");
});

test("fehlende oder ungültige Datenschutzregeln blockieren", () => {
  for (const frontmatter of [{}, { ...fm, unitedshare_privacy: "lokal" }, { ...fm, unitedshare_private_felder: ["fehlt"] }, { ...fm, kunde: ["a"] }, { ...fm, unitedshare_private_felder: ["kunde", "kunde"] }]) {
    assert.throws(() => privateVorlageVorbereiten(frontmatter, "Hallo {{VAR_1}}"));
  }
});

test("unbekannte oder fehlerhafte Platzhalter und offensichtlicher Klartext werden abgelehnt", () => {
  for (const text of ["Hallo {{VAR_3}}", "Hallo {{VAR_1", "Müller GmbH", ""]) {
    assert.throws(() => privateVorlageVorbereiten(fm, text));
  }
  const { werte } = privateVorlageVorbereiten(fm, "Hallo {{VAR_1}}");
  assert.throws(() => privateAntwortAufloesen("{{VAR_99}}", werte));
  assert.throws(() => privateAntwortAufloesen("{{VAR_1", werte));
});

test("Werte werden nicht rekursiv als Platzhalter interpretiert", () => {
  assert.throws(() => privateVorlageVorbereiten({ ...fm, kunde: "{{VAR_2}}" }, "{{VAR_1}}"));
});

test("{{$kunde}} wird nur lokal zu VAR_1 umgezeichnet, der Name wird nie gesendet", () => {
  const auftrag = privateVorlageVorbereiten(fm, "Plane für {{$kunde}} mit {{$wert}}.");
  assert.equal(auftrag.text, "Plane für {{VAR_1}} mit {{VAR_2}}.");
  assert.doesNotMatch(auftrag.text, /kunde|wert/);
  assert.equal(privateAntwortAufloesen("A {{VAR_1}} B {{VAR_2}}", auftrag.werte), "A Müller GmbH B 80000");
});

test("{{VAR_1}} und {{$kunde}} sind gleichwertig und mehrfach verwendbar", () => {
  const mitNummer = privateVorlageVorbereiten(fm, "Hallo {{VAR_1}} und {{VAR_1}}");
  const mitName = privateVorlageVorbereiten(fm, "Hallo {{$kunde}} und {{$kunde}}");
  assert.equal(mitNummer.text, mitName.text);
  assert.deepEqual([...mitNummer.werte.entries()], [...mitName.werte.entries()]);
});

test("Leerzeichen nach $ sind erlaubt, Leerzeichen im Namen zählen", () => {
  const mitAbstand = privateVorlageVorbereiten(fm, "Hallo {{$ kunde}}");
  assert.equal(mitAbstand.text, "Hallo {{VAR_1}}");
});

test("Unbekannte oder geschützte Eigenschaften als {{$...}} werden abgelehnt", () => {
  assert.throws(() => privateVorlageVorbereiten(fm, "Hallo {{$aktion}}"), /Unbekannter Eigenschafts-Platzhalter: \{\{\$aktion\}\}/);
  assert.throws(() => privateVorlageVorbereiten(fm, "Hallo {{$unitedshare_privacy}}"), /Unbekannter Eigenschafts-Platzhalter/);
  const ohne = { unitedshare_privacy: "template", unitedshare_private_felder: ["kunde"], kunde: "Müller GmbH", wert: 80000 };
  assert.throws(() => privateVorlageVorbereiten(ohne, "Hallo {{$wert}}"), /Unbekannter Eigenschafts-Platzhalter/);
});
