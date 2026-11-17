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
  // Fail-closed-Fallback: text.length wuerde Mehrbyte-Zeichen unterzaehlen
  // und die Byte-Grenzen aufweichen. Manuelle Codepoint-Zaehlung,
  // Surrogatpaare korrekt als 4 Bytes.
  let bytes = 0;
  for (const zeichen of text) {
    const cp = zeichen.codePointAt(0);
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

// S6: Zeichenklassen, mit denen ein Key am Validator vorbei auf dem
// Dateisystem anders aussieht: unsichtbare Formatzeichen (Cf), einsame
// Surrogate (Cs), Private Use (Co), Zeilen- und Absatztrenner (Zl, Zp),
// Leerraum am Segmentrand (Zs, auch U+3000), getarnte Punkt- und
// Slash-Varianten, Windows-Sonderzeichen, Prozent (Encoding-Differential)
// und ueberlange Segmente (Dateisystem-Grenze 255 Bytes).
// METHODIK (Z1): Die Regel ist die NFKC-Faltung gegen pfadbedeutsame
// Zeichen plus Unicode-KATEGORIEN, keine Einzelzeichen-Listen. Aufgezaehlt
// wird nur, was belegt durch beide Raster faellt (NFKC-resistente
// Slash-Doppelgaenger, Variation Selectors als Mn-Sonderfall).
const UNSICHTBAR = /[\p{Cf}\p{Cs}\p{Co}\p{Cc}\p{Cn}\p{Zl}\p{Zp}]/u;
const VARIATION_SELECTORS = /[\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/u;
const MARK_AM_ANFANG = /^\p{M}/u;
const RAND_LEERRAUM = /^\p{Zs}|\p{Zs}$/u;
const WINDOWS_ZEICHEN = /[*?"<>|]/;
// NFKC-resistente Slash-Doppelgaenger: normalize("NFKC") laesst U+2044
// (Fraction Slash) und U+2215 (Division Slash) gemessen unveraendert
// stehen, deshalb bleiben genau diese beiden als Restliste gesperrt.
const NFKC_RESISTENTE_SLASHES = /[\u2044\u2215]/;
const MAX_SEGMENT_BYTES = 255;
// T2: gemeinsame Objektgrenze des Gateways. Lebt hier im Leaf, damit beim
// Inlining in main.js keine doppelte Top-Level-Deklaration entsteht.
const MAX_OBJEKT_BYTES = 16 * 1024 * 1024;
const PFADBEDEUTSAM = [".", "/", "\\", ":"];

function segmentGueltig(segment) {
  if (segment.length === 0) return false;
  if (UNSICHTBAR.test(segment)) return false;
  if (VARIATION_SELECTORS.test(segment)) return false;
  // Eine fuehrende Combining Mark haengt sich an den Pfadtrenner; ein
  // Segment NUR aus Marks faellt damit ebenfalls.
  if (MARK_AM_ANFANG.test(segment)) return false;
  if (RAND_LEERRAUM.test(segment)) return false;
  if (WINDOWS_ZEICHEN.test(segment)) return false;
  if (segment.includes("%")) return false;
  if (utf8ByteLength(segment) > MAX_SEGMENT_BYTES) return false;
  // S6-Nachtrag: die Kompatibilitaets-Form entscheidet. Faltet NFKC ein
  // pfadbedeutsames Zeichen herbei, das die Originalform nicht hatte,
  // wird abgelehnt: eine nachgelagerte Faltung darf nie Pfadbedeutung
  // erzeugen.
  const nfkc = segment.normalize("NFKC");
  for (const zeichen of PFADBEDEUTSAM) {
    if (nfkc.includes(zeichen) && !segment.includes(zeichen)) return false;
  }
  if (NFKC_RESISTENTE_SLASHES.test(nfkc)) return false;
  // Dot-Segmente sind tabu: .obsidian/plugins waere Codeausfuehrung.
  if (nfkc.startsWith(".")) return false;
  if (nfkc.endsWith(".") || nfkc.endsWith(" ")) return false;
  // Konservativ: ".." auch mitten im Segment ablehnen.
  if (nfkc.includes("..")) return false;
  if (GERAETENAMEN.test(nfkc)) return false;
  // NTFS Alternate Data Streams und laufwerksrelative Pfade.
  if (nfkc.includes(":")) return false;
  return true;
}

/// Prueft einen praefixlosen Relpfad (Segmente durch "/") samt
/// Endungs-Allowlist fuer das letzte Segment.
function relpfadGueltig(relRoh, endungen) {
  if (typeof relRoh !== "string") return false;
  // P1: nicht auf Aufrufer verlassen; NFD vom Netz oder vom Dateisystem
  // wird hier zur NFC-Sicht, mit der auch die Keys gebaut werden.
  const rel = relRoh.normalize("NFC");
  if (rel.length === 0 || rel.length > 400) return false;
  if (/[\u0000-\u001f\u007f]/.test(rel)) return false;
  if (rel.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(rel)) return false;
  if (rel.startsWith("/")) return false;
  const segmente = rel.split("/");
  for (const segment of segmente) {
    if (!segmentGueltig(segment)) return false;
  }
  // Z4: endsWith statt unescaptem RegExp-Bau; kein Ausdruck, kein Cache.
  const letzter = segmente[segmente.length - 1].toLowerCase();
  return (Array.isArray(endungen) ? endungen : []).some((e) => letzter.endsWith("." + String(e).toLowerCase()));
}

/// Prueft einen vollen Key aus fremder Quelle gegen Praefix und Regeln.
function keyPruefen(praefix, key, endungen) {
  if (typeof key !== "string" || !key.startsWith(praefix)) return false;
  return relpfadGueltig(key.slice(praefix.length), endungen);
}

module.exports = {
  MAX_SEGMENT_BYTES,
  MAX_OBJEKT_BYTES,
  utf8ByteLength,
  GERAETENAMEN,
  segmentGueltig,
  relpfadGueltig,
  keyPruefen,
};
