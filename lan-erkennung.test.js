"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { lanAdresseAusInterfaces } = require("./unitedshare-core");

function eintrag(address, { family = "IPv4", internal = false } = {}) {
  return { address, family, internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24` };
}

test("eine einzelne private 192.168.x-Adresse wird erkannt", () => {
  const interfaces = { en0: [eintrag("192.168.1.5")] };
  assert.equal(lanAdresseAusInterfaces(interfaces), "192.168.1.5");
});

test("eine private 10.x-Adresse wird erkannt", () => {
  const interfaces = { en0: [eintrag("10.1.101.102")] };
  assert.equal(lanAdresseAusInterfaces(interfaces), "10.1.101.102");
});

test("172.16.0.0/12 wird erkannt, 172.15.x und 172.32.x nicht (ausserhalb des Bereichs)", () => {
  assert.equal(lanAdresseAusInterfaces({ en0: [eintrag("172.16.0.1")] }), "172.16.0.1");
  assert.equal(lanAdresseAusInterfaces({ en0: [eintrag("172.31.255.255")] }), "172.31.255.255");
  assert.equal(lanAdresseAusInterfaces({ en0: [eintrag("172.15.0.1")] }), null);
  assert.equal(lanAdresseAusInterfaces({ en0: [eintrag("172.32.0.1")] }), null);
});

test("Loopback (127.0.0.1, internal=true) wird nie zurueckgegeben", () => {
  const interfaces = { lo0: [eintrag("127.0.0.1", { internal: true })] };
  assert.equal(lanAdresseAusInterfaces(interfaces), null);
});

test("Tailscales eigener Bereich 100.64.0.0/10 zaehlt ausdruecklich NICHT als LAN", () => {
  const interfaces = { utun0: [eintrag("100.64.0.6")] };
  assert.equal(lanAdresseAusInterfaces(interfaces), null);
  // Grenzen des /10-Bereichs: 100.64.x bis 100.127.x gehoeren Tailscale,
  // 100.63.x und 100.128.x nicht (und sind ohnehin keine privaten Bereiche).
  assert.equal(lanAdresseAusInterfaces({ en0: [eintrag("100.127.255.255")] }), null);
});

test("IPv6-Eintraege werden ignoriert, auch wenn sie zuerst in der Liste stehen", () => {
  const interfaces = {
    en0: [eintrag("fe80::1", { family: "IPv6" }), eintrag("192.168.1.5")],
  };
  assert.equal(lanAdresseAusInterfaces(interfaces), "192.168.1.5");
});

test("kein privater Treffer ueberhaupt liefert null", () => {
  const interfaces = { en0: [eintrag("8.8.8.8")] };
  assert.equal(lanAdresseAusInterfaces(interfaces), null);
});

test("ohne Interfaces (undefined/null/leeres Objekt) liefert null, wirft nicht", () => {
  assert.equal(lanAdresseAusInterfaces(undefined), null);
  assert.equal(lanAdresseAusInterfaces(null), null);
  assert.equal(lanAdresseAusInterfaces({}), null);
});

test("ein virtuelles Interface (utun) wird gegenueber einem echten (en0) zurueckgestellt, unabhaengig von der Reihenfolge im Objekt", () => {
  const interfaces = {
    utun0: [eintrag("192.168.1.9")],
    en0: [eintrag("192.168.1.5")],
  };
  assert.equal(lanAdresseAusInterfaces(interfaces), "192.168.1.5");
});

test("nur ein virtuelles Interface mit privater Adresse zaehlt trotzdem, wenn es keine Alternative gibt", () => {
  const interfaces = { awdl0: [eintrag("192.168.1.9")] };
  assert.equal(lanAdresseAusInterfaces(interfaces), "192.168.1.9");
});

test("mehrere echte Interfaces: die erste in Objekt-Reihenfolge gewinnt", () => {
  const interfaces = {
    en0: [eintrag("192.168.1.5")],
    en1: [eintrag("10.0.0.9")],
  };
  assert.equal(lanAdresseAusInterfaces(interfaces), "192.168.1.5");
});
