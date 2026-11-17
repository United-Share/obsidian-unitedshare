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
const { relpfadGueltig, utf8ByteLength, MAX_SEGMENT_BYTES } = require("./key-pruefung");

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
function planeOrdnerSync({ dateien = [], index = {}, entfernt = [], remoteStand = {} } = {}) {
  const hochladen = [];
  const uebersprungen = [];
  // K6: Push-Schutz gegen Last-Writer-Wins. Weicht die Remote-Fassung vom
  // zuletzt gesehenen Stand ab (oder wurde sie nie gesehen), wird nicht
  // hochgeladen, sondern der Konfliktpfad gewaehlt. Erst Pull, dann Push.
  const remoteAbweichung = [];
  const remoteNachPfad = new Map();
  for (const objekt of entfernt) {
    const rel = relpfadAusKey(objekt && objekt.key);
    if (rel !== null) remoteNachPfad.set(rel, objekt);
  }
  const lokalePfade = new Set();

  for (const datei of dateien) {
    // K2: macOS liefert NFD; Index, Keys und Vergleiche laufen auf NFC.
    const pfad = String(datei.pfad ?? "").normalize("NFC");
    lokalePfade.add(pfad);
    if (keyAusRelpfad(pfad) === null) {
      uebersprungen.push({ pfad, grund: "ungueltiger-pfad" });
      continue;
    }
    // K5: ohne gueltigen Hash ist Aenderungserkennung Raten.
    if (typeof datei.hash !== "string" || datei.hash.length === 0) {
      uebersprungen.push({ pfad, grund: "ungueltiger-hash" });
      continue;
    }
    // Security-Finding 3: ohne gueltige Groesse kein Upload, sonst waere
    // das Limit mit fehlenden oder unsinnigen Metadaten umgehbar.
    const groesse = Number(datei.groesse);
    if (!Number.isFinite(groesse) || groesse < 0) {
      uebersprungen.push({ pfad, grund: "ungueltige-groesse" });
      continue;
    }
    if (groesse > MAX_OBJEKT_BYTES) {
      uebersprungen.push({ pfad, grund: "zu-gross" });
      continue;
    }
    if (index[pfad] === datei.hash) continue;
    const remoteObjekt = remoteNachPfad.get(pfad);
    if (remoteObjekt) {
      const erinnert = Object.hasOwn(remoteStand ?? {}, pfad) ? remoteStand[pfad] : null;
      const unveraendertGesehen = erinnert && Number(erinnert.size) === Number(remoteObjekt.size);
      if (!unveraendertGesehen) {
        remoteAbweichung.push({ pfad, remoteSize: remoteObjekt.size });
        continue;
      }
    }
    hochladen.push({ pfad, hash: datei.hash, groesse });
  }

  // Keys ohne lokale Datei sind KEIN Loeschauftrag: ohne Tombstones ist
  // "geloescht" von "hier nie gesehen" nicht unterscheidbar.
  const geloeschtIgnoriert = [];
  for (const objekt of entfernt) {
    const rel = relpfadAusKey(objekt && objekt.key);
    if (rel !== null && !lokalePfade.has(rel)) geloeschtIgnoriert.push(objekt.key);
  }

  return { hochladen, uebersprungen, geloeschtIgnoriert, remoteAbweichung };
}

// K7: ein laufend-Flag im Zustand verhindert ueberlappende Sync-Laeufe;
// beide Kommandos (manuell und Datei-Speichern) kehren dann frueh zurueck.
function laufStarten(zustand) {
  if (!zustand || typeof zustand !== "object") return false;
  if (zustand.laufend === true) return false;
  zustand.laufend = true;
  return true;
}

function laufBeenden(zustand) {
  if (zustand && typeof zustand === "object") zustand.laufend = false;
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
  // K7: case-insensitiv befragen. Auf APFS und NTFS belegt readme.md den
  // Namen README.md; wer nur exakt fragt, legt an und ueberschreibt.
  const befrage = (p) => {
    if (existiert(p)) return true;
    const klein = p.toLowerCase();
    return klein !== p ? Boolean(existiert(klein)) : false;
  };
  let vorhanden;
  try {
    vorhanden = befrage(pfad);
  } catch (_fehler) {
    return konfliktErgebnis(pfad, befrage);
  }
  const lesbar = lokalText !== null && lokalText !== undefined;
  if (!vorhanden && !lesbar) {
    return { aktion: "anlegen", zielPfad: pfad };
  }
  if (vorhanden && lesbar && lokalText === remoteText) {
    return { aktion: "unveraendert", zielPfad: pfad };
  }
  return konfliktErgebnis(pfad, befrage);
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

  // S6: der Stamm wird so gekuerzt, dass Stamm plus Konflikt-Zusatz plus
  // Endung unter der Segmentgrenze bleiben; ein beim Kuerzen entstandenes
  // einsames Surrogat wird mit abgeschnitten.
  const kandidatFuer = (zaehler) => {
    const zusatz = zaehler === 1 ? "(Konflikt)" : `(Konflikt ${zaehler})`;
    let stammKurz = stamm;
    while (stammKurz.length > 0 && utf8ByteLength(`${stammKurz} ${zusatz}${endung}`) > MAX_SEGMENT_BYTES) {
      stammKurz = stammKurz.slice(0, -1);
      const letzter = stammKurz.charCodeAt(stammKurz.length - 1);
      if (letzter >= 0xd800 && letzter <= 0xdbff) stammKurz = stammKurz.slice(0, -1);
    }
    return `${ordner}${stammKurz} ${zusatz}${endung}`;
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

// S7: der Index kommt deserialisiert aus den Plugin-Daten und ist damit
// Fremdeingabe. Null-Prototyp als Ziel, Uebernahme nur eigener
// Eigenschaften, Prototype-Schluessel fliegen raus.
const VERBOTENE_SCHLUESSEL = new Set(["__proto__", "constructor", "prototype"]);

function indexNachSync(index, hochgeladen) {
  const neu = Object.create(null);
  const quelle = index && typeof index === "object" ? index : {};
  for (const schluessel of Object.keys(quelle)) {
    if (VERBOTENE_SCHLUESSEL.has(schluessel)) continue;
    if (!Object.hasOwn(quelle, schluessel)) continue;
    neu[schluessel] = quelle[schluessel];
  }
  for (const datei of Array.isArray(hochgeladen) ? hochgeladen : []) {
    if (!datei || typeof datei.pfad !== "string") continue;
    if (VERBOTENE_SCHLUESSEL.has(datei.pfad)) continue;
    // K5: nur bestaetigte Staende mit echtem Hash in den Index.
    if (typeof datei.hash !== "string" || datei.hash.length === 0) continue;
    neu[datei.pfad] = datei.hash;
  }
  return neu;
}

module.exports = {
  NOTES_PRAEFIX,
  laufStarten,
  laufBeenden,
  MAX_OBJEKT_BYTES,
  keyAusRelpfad,
  relpfadAusKey,
  planeOrdnerSync,
  eingehendeNotiz,
  indexNachSync,
};
