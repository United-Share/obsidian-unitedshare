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

const { konfliktDateiname } = require("./unitedshare-core");
const { MAX_OBJEKT_BYTES } = require("./workspace-sync");

const NOTES_PRAEFIX = "obsidian/notes/";

// Haertung (Security-Finding 1): je Segment pruefen, damit kein
// Parser-Differential (Backslash, Laufwerks-Praefix, leere Segmente,
// Windows-Normalisierung von Punkt/Leerzeichen am Ende) aus dem
// Notes-Praefix herausfuehrt.
// Reservierte NTFS-Basisnamen, in jedem Ordner und case-insensitiv.
const GERAETENAMEN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function keyAusRelpfad(relpfad) {
  // NFC vor Validierung und Key-Bau: Validator und Dateisystem muessen
  // dieselbe Sicht haben (macOS liefert NFD, der Key traegt NFC).
  const rel = String(relpfad ?? "").normalize("NFC");
  if (rel.length === 0 || rel.length > 400) return null;
  if (/[\u0000-\u001f\u007f]/.test(rel)) return null;
  if (rel.includes("\\")) return null;
  if (/^[A-Za-z]:/.test(rel)) return null;
  if (rel.startsWith("/")) return null;
  const segmente = rel.split("/");
  for (const segment of segmente) {
    if (segment.length === 0) return null;
    // Dot-Segmente sind tabu: .obsidian/plugins waere Codeausfuehrung.
    if (segment.startsWith(".")) return null;
    if (segment.endsWith(".") || segment.endsWith(" ")) return null;
    if (GERAETENAMEN.test(segment)) return null;
    // NTFS Alternate Data Streams und laufwerksrelative Pfade.
    if (segment.includes(":")) return null;
  }
  // Second-Brain-Zuschnitt: nur Markdown und Canvas werden gesynct.
  if (!/\.(md|canvas)$/i.test(segmente[segmente.length - 1])) return null;
  return NOTES_PRAEFIX + rel;
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
  // Fuer die NAMENSsuche der Konfliktkopie darf eine werfende Probe die
  // Schleife in konfliktDateiname nicht endlos machen: Wurf heisst dort
  // "Kandidat gilt als frei", der Schreibpfad bestaetigt ohnehin.
  const probeFuerNamen = (kandidat) => {
    try {
      return Boolean(existiert(kandidat));
    } catch (_fehler) {
      return false;
    }
  };
  let vorhanden;
  try {
    vorhanden = Boolean(existiert(pfad));
  } catch (_fehler) {
    return { aktion: "konflikt", zielPfad: konfliktDateiname(pfad, probeFuerNamen) };
  }
  const lesbar = lokalText !== null && lokalText !== undefined;
  if (!vorhanden && !lesbar) {
    return { aktion: "anlegen", zielPfad: pfad };
  }
  if (vorhanden && lesbar && lokalText === remoteText) {
    return { aktion: "unveraendert", zielPfad: pfad };
  }
  return { aktion: "konflikt", zielPfad: konfliktDateiname(pfad, probeFuerNamen) };
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
