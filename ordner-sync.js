"use strict";

// Second-Brain-Ordner-Sync in den Vault-Workspace (Zuschnitt B).
//
// Reine Planungs- und Entscheidungslogik: was hochgeladen wird (Hash-Index
// statt Blind-Upload), wie eingehende Notizen behandelt werden (Konfliktkopie
// statt Ueberschreiben, konfliktDateiname aus unitedshare-core) und dass
// Loeschungen im MVP ausdruecklich nicht propagiert werden. Transport laeuft
// ueber workspace-sync (objektSchreiben, objektLesen, objekteListen).
//
// Vertraege und Begruendungen: ordner-sync.test.js.

const { MAX_OBJEKT_BYTES } = require("./workspace-sync");
const { relpfadGueltig } = require("./key-pruefung");

const NOTES_PRAEFIX = "obsidian/notes/";

// Haertung (Security-Finding 1): je Segment pruefen, damit kein
// Parser-Differential (Backslash, Laufwerks-Praefix, leere Segmente,
// Windows-Normalisierung von Punkt/Leerzeichen am Ende) aus dem
// Notes-Praefix herausfuehrt.
const ENDUNGEN = ["md", "canvas"];

// Delegiert an die gemeinsame Segmentpruefung in key-pruefung.js; NFC vor
// Validierung und Key-Bau, damit Validator und Dateisystem dieselbe Sicht
// haben (macOS liefert NFD, der Key traegt NFC).
function keyAusRelpfad(relpfad) {
  const rel = String(relpfad ?? "").normalize("NFC");
  return relpfadGueltig(rel, ENDUNGEN) ? NOTES_PRAEFIX + rel : null;
}

function relpfadAusKey(key) {
  const k = String(key ?? "");
  if (!k.startsWith(NOTES_PRAEFIX)) return null;
  const rel = k.slice(NOTES_PRAEFIX.length);
  return keyAusRelpfad(rel) ? rel : null;
}

// Plant einen Sync-Lauf. dateien = lokaler Ist-Stand des gewaehlten Ordners
// ({pfad, hash, groesse} mit Pfaden relativ zum Ordner), index = zuletzt
// gespiegelter Stand (pfad -> hash), entfernt = Listing des Workspace.
function planeOrdnerSync({ dateien = [], index = {}, entfernt = [] } = {}) {
  const hochladen = [];
  const uebersprungen = [];
  const lokalePfade = new Set();

  for (const datei of dateien) {
    lokalePfade.add(datei.pfad);
    if (keyAusRelpfad(datei.pfad) === null) {
      uebersprungen.push({ pfad: datei.pfad, grund: "ungueltiger-pfad" });
      continue;
    }
    // Security-Finding 3: ohne gueltige Groesse kein Upload, sonst waere
    // das Limit mit fehlenden oder unsinnigen Metadaten umgehbar.
    const groesse = Number(datei.groesse);
    if (!Number.isFinite(groesse) || groesse < 0) {
      uebersprungen.push({ pfad: datei.pfad, grund: "ungueltige-groesse" });
      continue;
    }
    if (groesse > MAX_OBJEKT_BYTES) {
      uebersprungen.push({ pfad: datei.pfad, grund: "zu-gross" });
      continue;
    }
    if (index[datei.pfad] !== datei.hash) hochladen.push(datei);
  }

  // Keys ohne lokale Datei sind KEIN Loeschauftrag: ohne Tombstones ist
  // "geloescht" von "hier nie gesehen" nicht unterscheidbar.
  const geloeschtIgnoriert = [];
  for (const objekt of entfernt) {
    const rel = relpfadAusKey(objekt && objekt.key);
    if (rel !== null && !lokalePfade.has(rel)) geloeschtIgnoriert.push(objekt.key);
  }

  return { hochladen, uebersprungen, geloeschtIgnoriert };
}

// Entscheidung fuer eine eingehende Notiz. Niemals stilles Ueberschreiben,
// fail-closed: existiert und lokalText sind ADDITIVE Signale. "anlegen"
// gibt es nur, wenn beide sagen "da ist nichts". Widersprechen sie sich
// (Race, kaputter Adapter) oder wirft existiert, wird die Konfliktkopie
// gewaehlt. Der Relpfad wird wie in keyAusRelpfad auf NFC normalisiert.
function eingehendeNotiz({ relpfad, remoteText, lokalText, existiert }) {
  if (typeof existiert !== "function") {
    throw new TypeError("eingehendeNotiz braucht existiert als Funktion");
  }
  const pfad = String(relpfad ?? "").normalize("NFC");
  // S1: eigene Pruefung statt Vertrauen in den Aufrufer. Dieselben Regeln
  // wie beim Key-Bau; ein Pfad, der dort nie zum Key wuerde, darf hier
  // auch nie zu einer Schreibaktion werden.
  if (!relpfadGueltig(pfad, ENDUNGEN)) {
    return { aktion: "abgelehnt", grund: "ungueltiger-pfad" };
  }
  let vorhanden;
  try {
    vorhanden = Boolean(existiert(pfad));
  } catch (_fehler) {
    return konfliktErgebnis(pfad, existiert);
  }
  const lesbar = lokalText !== null && lokalText !== undefined;
  if (!vorhanden && !lesbar) {
    return { aktion: "anlegen", zielPfad: pfad };
  }
  if (vorhanden && lesbar && lokalText === remoteText) {
    return { aktion: "unveraendert", zielPfad: pfad };
  }
  return konfliktErgebnis(pfad, existiert);
}

// Begrenzte, fail-closed Namenssuche fuer die Konfliktkopie, Namensschema
// kompatibel zu konfliktDateiname aus unitedshare-core. Eine werfende Probe
// heisst BELEGT (weiter suchen), nie frei: sonst koennte die Kopie einen
// vergebenen Namen treffen. Bleibt die Lage unbestaetigt oder ist die
// Grenze erschoepft, traegt das Ergebnis bestaetigungErforderlich; der
// Schreibpfad muss Konfliktkopien ohnehin IMMER exklusiv anlegen.
const KONFLIKT_SUCHGRENZE = 100;

function konfliktErgebnis(pfad, existiert) {
  const slash = pfad.lastIndexOf("/");
  const ordner = slash === -1 ? "" : pfad.slice(0, slash + 1);
  const basisName = slash === -1 ? pfad : pfad.slice(slash + 1);
  const punkt = basisName.lastIndexOf(".");
  const stamm = punkt > 0 ? basisName.slice(0, punkt) : basisName;
  const endung = punkt > 0 ? basisName.slice(punkt) : "";

  const kandidatFuer = (zaehler) => {
    const zusatz = zaehler === 1 ? "(Konflikt)" : `(Konflikt ${zaehler})`;
    return `${ordner}${stamm} ${zusatz}${endung}`;
  };

  let unbestaetigt = false;
  for (let zaehler = 1; zaehler <= KONFLIKT_SUCHGRENZE; zaehler += 1) {
    const kandidat = kandidatFuer(zaehler);
    let belegt;
    try {
      belegt = Boolean(existiert(kandidat));
    } catch (_fehler) {
      unbestaetigt = true;
      belegt = true;
    }
    if (!belegt) {
      // S1: auch der erzeugte Zielpfad muss die Pruefung bestehen.
      if (!relpfadGueltig(kandidat, ENDUNGEN)) {
        return { aktion: "abgelehnt", grund: "ungueltiger-pfad" };
      }
      return { aktion: "konflikt", zielPfad: kandidat, bestaetigungErforderlich: unbestaetigt };
    }
  }
  // Grenze erschoepft: unerprobter Kandidat jenseits der Grenze, nur mit
  // exklusivem Anlegen zu schreiben.
  return { aktion: "konflikt", zielPfad: kandidatFuer(KONFLIKT_SUCHGRENZE + 1), bestaetigungErforderlich: true };
}

function indexNachSync(index, hochgeladen) {
  const neu = Object.assign({}, index);
  for (const datei of Array.isArray(hochgeladen) ? hochgeladen : []) {
    neu[datei.pfad] = datei.hash;
  }
  return neu;
}

module.exports = {
  NOTES_PRAEFIX,
  MAX_OBJEKT_BYTES,
  keyAusRelpfad,
  relpfadAusKey,
  planeOrdnerSync,
  eingehendeNotiz,
  indexNachSync,
};
