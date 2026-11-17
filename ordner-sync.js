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

const NOTES_PRAEFIX = "obsidian/notes/";
const MAX_OBJEKT_BYTES = 16 * 1024 * 1024;

// Haertung (Security-Finding 1): je Segment pruefen, damit kein
// Parser-Differential (Backslash, Laufwerks-Praefix, leere Segmente,
// Windows-Normalisierung von Punkt/Leerzeichen am Ende) aus dem
// Notes-Praefix herausfuehrt.
function keyAusRelpfad(relpfad) {
  const rel = String(relpfad ?? "");
  if (rel.length === 0 || rel.length > 400) return null;
  if (/[\u0000-\u001f\u007f]/.test(rel)) return null;
  if (rel.includes("\\")) return null;
  if (/^[A-Za-z]:/.test(rel)) return null;
  if (rel.startsWith("/")) return null;
  for (const segment of rel.split("/")) {
    if (segment.length === 0) return null;
    if (segment === "." || segment === "..") return null;
    if (segment.endsWith(".") || segment.endsWith(" ")) return null;
  }
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
    if (datei.groesse > MAX_OBJEKT_BYTES) {
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

// Entscheidung fuer eine eingehende Notiz. Niemals stilles Ueberschreiben:
// weicht die lokale Fassung ab, bekommt die eingehende eine Konfliktkopie.
function eingehendeNotiz({ relpfad, remoteText, lokalText, existiert }) {
  if (lokalText === null || lokalText === undefined) {
    return { aktion: "anlegen", zielPfad: relpfad };
  }
  if (lokalText === remoteText) {
    return { aktion: "unveraendert", zielPfad: relpfad };
  }
  return { aktion: "konflikt", zielPfad: konfliktDateiname(relpfad, existiert) };
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
