"use strict";

// Nur ausdrücklich benannte, einfache Properties werden lokal aufgelöst.
function privateVorlageVorbereiten(frontmatter, vorlage) {
  if (!frontmatter || frontmatter.unitedshare_privacy !== "template") {
    throw new Error("Diese Notiz muss unitedshare_privacy: template setzen.");
  }
  const felder = frontmatter.unitedshare_private_felder;
  if (!Array.isArray(felder) || !felder.length || felder.length > 100) {
    throw new Error("unitedshare_private_felder muss eine nichtleere Liste sein.");
  }
  const werte = new Map();
  const namen = new Set();
  for (const [index, feld] of felder.entries()) {
    if (typeof feld !== "string" || !feld || namen.has(feld) || feld.startsWith("unitedshare_") || !Object.hasOwn(frontmatter, feld)) {
      throw new Error("Die Liste privater Eigenschaften ist ungültig.");
    }
    namen.add(feld);
    const wert = frontmatter[feld];
    if (!(typeof wert === "string" || typeof wert === "boolean" || (typeof wert === "number" && Number.isFinite(wert)))) {
      throw new Error("Private Eigenschaften müssen Text, Zahlen oder Wahrheitswerte sein.");
    }
    if (String(wert).includes("{{") || String(wert).includes("}}")) {
      throw new Error("Private Werte dürfen keine Platzhalter-Klammern enthalten.");
    }
    werte.set(`VAR_${index + 1}`, String(wert));
  }
  const rohtext = String(vorlage || "").trim();
  if (!rohtext) throw new Error("Bitte eine Cloud-Vorlage eingeben.");
  const text = eigenschaftsPlatzhalterNormalisieren(rohtext, felder);
  pruefePlatzhalter(text, werte);
  // Dies ist nur eine Zusatzprüfung, keine automatische Anonymisierung.
  for (const wert of werte.values()) {
    if (wert.length >= 3 && text.includes(wert)) throw new Error("Die Vorlage enthält einen privaten Wert. Bitte durch einen Platzhalter ersetzen.");
  }
  return { text, werte };
}

function pruefePlatzhalter(text, werte) {
  const rest = String(text).replace(/\{\{([^{}]+)\}\}/g, (_ganz, name) => {
    if (!werte.has(name)) throw new Error("Unbekannter Platzhalter: " + name);
    return "";
  });
  if (rest.includes("{{") || rest.includes("}}")) throw new Error("Ungültiger Platzhalter.");
}

// {{$kunde}} wird nur lokal zu {{VAR_n}} umgezeichnet: Der Name der
// Eigenschaft verlässt den Rechner nie, gesendet wird allein die Nummer.
// Form wie in rmxos-Codeblöcken; Lesefehlern (unbekannter Eigenschaft) wird
// hier nicht mit Schweigen begegnet, sondern abgelehnt.
function eigenschaftsPlatzhalterNormalisieren(text, felder) {
  return String(text).replace(/\{\{\$\s*([^{}]+?)\s*\}\}/gu, (original, roh) => {
    const name = roh.trim();
    const stelle = felder.indexOf(name);
    if (stelle === -1) {
      throw new Error(
        "Unbekannter Eigenschafts-Platzhalter: {{$" + name +
        "}}. Erlaubt sind die Namen aus unitedshare_private_felder.",
      );
    }
    return `{{VAR_${stelle + 1}}}`;
  });
}

function privateAntwortAufloesen(antwort, werte) {
  const text = String(antwort || "");
  pruefePlatzhalter(text, werte);
  return text.replace(/\{\{([^{}]+)\}\}/g, (_ganz, name) => werte.get(name));
}

module.exports = { privateVorlageVorbereiten, privateAntwortAufloesen };
