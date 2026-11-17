"use strict";

// Gemeinsame Pfad- und Key-Pruefung fuer den Workspace-Sync (Zuschnitte A
// und B). Eine einzige Segmentpruefung fuer beide Richtungen: lokale
// Relpfade, die zu Keys werden (ordner-sync.keyAusRelpfad), und Keys aus
// dem Netz, die gelistet werden (workspace-sync.wiederherstellbareChats).
// Zwei Implementierungen derselben Regeln wuerden frueher oder spaeter
// auseinanderlaufen, und genau in der Luecke saesse der Angriff.
//
// Vertraege: ordner-sync.test.js und workspace-sync.test.js.

// Reservierte NTFS-Basisnamen, in jedem Ordner und case-insensitiv.
const GERAETENAMEN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function segmentGueltig(segment) {
  if (segment.length === 0) return false;
  // Dot-Segmente sind tabu: .obsidian/plugins waere Codeausfuehrung.
  if (segment.startsWith(".")) return false;
  if (segment.endsWith(".") || segment.endsWith(" ")) return false;
  if (GERAETENAMEN.test(segment)) return false;
  // NTFS Alternate Data Streams und laufwerksrelative Pfade.
  if (segment.includes(":")) return false;
  return true;
}

/// Prueft einen praefixlosen Relpfad (Segmente durch "/") samt
/// Endungs-Allowlist fuer das letzte Segment.
function relpfadGueltig(rel, endungen) {
  if (typeof rel !== "string") return false;
  if (rel.length === 0 || rel.length > 400) return false;
  if (/[\u0000-\u001f\u007f]/.test(rel)) return false;
  if (rel.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(rel)) return false;
  if (rel.startsWith("/")) return false;
  const segmente = rel.split("/");
  for (const segment of segmente) {
    if (!segmentGueltig(segment)) return false;
  }
  const letzter = segmente[segmente.length - 1];
  const endungOk = (Array.isArray(endungen) ? endungen : []).some((e) =>
    new RegExp(`\\.${e}$`, "i").test(letzter)
  );
  return endungOk;
}

/// Prueft einen vollen Key aus fremder Quelle gegen Praefix und Regeln.
function keyPruefen(praefix, key, endungen) {
  if (typeof key !== "string" || !key.startsWith(praefix)) return false;
  return relpfadGueltig(key.slice(praefix.length), endungen);
}

module.exports = {
  GERAETENAMEN,
  segmentGueltig,
  relpfadGueltig,
  keyPruefen,
};
