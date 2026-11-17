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

// Hausmuster aus unitedshare-core: Buffer nur mit Guard, der
// Bundler-Buffer-Stub hat kein byteLength.
function utf8ByteLength(text) {
  if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
    return Buffer.byteLength(text, "utf8");
  }
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

// S6: Zeichenklassen, mit denen ein Key am Validator vorbei auf dem
// Dateisystem anders aussieht: unsichtbare Formatzeichen (Cf), einsame
// Surrogate (Cs), Private Use (Co), Zeilen- und Absatztrenner (Zl, Zp),
// Leerraum am Segmentrand (Zs, auch U+3000), getarnte Punkt- und
// Slash-Varianten, Windows-Sonderzeichen, Prozent (Encoding-Differential)
// und ueberlange Segmente (Dateisystem-Grenze 255 Bytes).
const UNSICHTBAR = /[\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const RAND_LEERRAUM = /^\p{Zs}|\p{Zs}$/u;
const SLASH_VARIANTEN = /[\uff0f\u2215]/;
const WINDOWS_ZEICHEN = /[*?"<>|]/;
const PUNKT_VARIANTEN = /[\u2024\uff0e]/g;
const MAX_SEGMENT_BYTES = 255;

function segmentGueltig(segment) {
  if (segment.length === 0) return false;
  if (UNSICHTBAR.test(segment)) return false;
  if (RAND_LEERRAUM.test(segment)) return false;
  if (SLASH_VARIANTEN.test(segment)) return false;
  if (WINDOWS_ZEICHEN.test(segment)) return false;
  if (segment.includes("%")) return false;
  if (utf8ByteLength(segment) > MAX_SEGMENT_BYTES) return false;
  // Punkt-Varianten zaehlen in allen Punkt-Regeln als Punkt.
  const punktNorm = segment.replace(PUNKT_VARIANTEN, ".");
  // Dot-Segmente sind tabu: .obsidian/plugins waere Codeausfuehrung.
  if (punktNorm.startsWith(".")) return false;
  if (punktNorm.endsWith(".") || punktNorm.endsWith(" ")) return false;
  // Konservativ: ".." auch mitten im Segment ablehnen. Eine spaetere
  // Normalisierungsschicht koennte daraus echte Traversal-Punkte machen.
  if (punktNorm.includes("..")) return false;
  if (GERAETENAMEN.test(punktNorm)) return false;
  // NTFS Alternate Data Streams und laufwerksrelative Pfade.
  if (punktNorm.includes(":")) return false;
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
  MAX_SEGMENT_BYTES,
  utf8ByteLength,
  GERAETENAMEN,
  segmentGueltig,
  relpfadGueltig,
  keyPruefen,
};
