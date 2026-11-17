"use strict";

// Vertraege fuer die gemeinsame Pfad- und Key-Pruefung.
//
// ANLASS (S6-Nachtrag): der utf8ByteLength-Fallback zaehlte text.length
// und damit Mehrbyte-Zeichen zu klein; auf Plattformen ohne Buffer und
// TextEncoder waere die 255-Byte-Grenze damit umgehbar gewesen.

const test = require("node:test");
const assert = require("node:assert/strict");

const { utf8ByteLength } = require("./key-pruefung");

test("utf8ByteLength zaehlt auch ohne Buffer und TextEncoder korrekt", () => {
  const emoji = "\u{1F600}".repeat(100);
  const erwartet = 400;
  assert.equal(utf8ByteLength(emoji), erwartet);

  const bufferAlt = globalThis.Buffer;
  const encoderAlt = globalThis.TextEncoder;
  try {
    globalThis.Buffer = undefined;
    globalThis.TextEncoder = undefined;
    assert.equal(utf8ByteLength(emoji), erwartet, "Fallback muss Codepoints zaehlen");
    assert.equal(utf8ByteLength("a\u00e4\u20ac"), 1 + 2 + 3);
  } finally {
    globalThis.Buffer = bufferAlt;
    globalThis.TextEncoder = encoderAlt;
  }
});
