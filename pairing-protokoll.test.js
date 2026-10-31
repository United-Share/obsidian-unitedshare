"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  akzeptierePairing,
  erzeugePairingAnfrage,
  erzeugePairingAngebot,
  erzeugePairingCode,
  leiteSessionSchluesselAb,
  PAIRING_MAX_VERSUCHE,
  pairingEntschluesseln,
  pairingVerschluesseln,
  pairingVersuchErlaubt,
  pairingVersuchVermerken,
  UnitedShareError,
} = require("./unitedshare-core");

// -- erzeugePairingCode -------------------------------------------------------
// erzeugePairingCode() nutzt jetzt globalThis.crypto.getRandomValues()
// (Web-Crypto-API, synchron) statt Nodes crypto.randomInt() -- der Mock
// greift darum auf getRandomValues() statt auf das node:crypto-Modul.

test("erzeugePairingCode liefert immer genau 6 Ziffern, auch mit fuehrenden Nullen", () => {
  const original = globalThis.crypto.getRandomValues;
  globalThis.crypto.getRandomValues = (typedArray) => {
    typedArray[0] = 42; // erzwingt einen kleinen Wert, deutlich unter dem Rejection-Limit
    return typedArray;
  };
  try {
    const code = erzeugePairingCode();
    assert.equal(code, "000042");
    assert.equal(code.length, 6);
    assert.match(code, /^\d{6}$/);
  } finally {
    globalThis.crypto.getRandomValues = original;
  }
});

test("erzeugePairingCode liefert ueber viele Durchlaeufe immer ein gueltiges 6-Ziffern-Format", () => {
  for (let i = 0; i < 50; i++) {
    const code = erzeugePairingCode();
    assert.match(code, /^\d{6}$/);
  }
});

// -- Rundlauf: Angebot -> Anfrage -> akzeptieren -> Client leitet ab ---------

test("Rundlauf mit korrektem Code: Host- und Client-Session-Key sind identisch", async () => {
  const { angebot, privaterSchluessel: hostKey, code } = await erzeugePairingAngebot({
    host: "100.64.0.6",
    port: 19845,
    geraetename: "Mac",
  });

  const { anfrage, privaterSchluessel: clientKey } = await erzeugePairingAnfrage({
    angebot,
    code,
    geraetename: "iPhone",
  });

  const session = await akzeptierePairing({
    anfrage,
    privaterSchluessel: hostKey,
    erwarteterCode: code,
    angebot,
  });

  const clientSessionKey = await leiteSessionSchluesselAb({
    privaterSchluessel: clientKey,
    hostOeffentlicherSchluessel: angebot.publicKey,
  });

  assert.equal(session.symmetricKey.toString("hex"), clientSessionKey.toString("hex"));
  assert.equal(session.symmetricKey.length, 32);
  assert.equal(session.peerDeviceName, "iPhone");
  assert.ok(session.sessionId);
  assert.ok(session.erstelltAm > 0);
});

test("falscher Code: Host lehnt ab, wirft Fehler, keine Session entsteht", async () => {
  const { angebot, privaterSchluessel: hostKey, code } = await erzeugePairingAngebot({
    host: "100.64.0.6",
    port: 19845,
    geraetename: "Mac",
  });

  const falscherCode = code === "000000" ? "111111" : "000000";
  const { anfrage } = await erzeugePairingAnfrage({ angebot, code: falscherCode, geraetename: "iPhone" });

  await assert.rejects(
    () => akzeptierePairing({ anfrage, privaterSchluessel: hostKey, erwarteterCode: code, angebot }),
    UnitedShareError,
  );
});

test("abgelaufenes Angebot wird nicht mehr akzeptiert, selbst mit korrektem Code", async () => {
  const { angebot, privaterSchluessel: hostKey, code } = await erzeugePairingAngebot({
    host: "100.64.0.6",
    port: 19845,
    geraetename: "Mac",
  });
  const abgelaufenesAngebot = { ...angebot, expiresAt: Date.now() - 1000 };

  const { anfrage } = await erzeugePairingAnfrage({ angebot: abgelaufenesAngebot, code, geraetename: "iPhone" });

  await assert.rejects(
    () =>
      akzeptierePairing({
        anfrage,
        privaterSchluessel: hostKey,
        erwarteterCode: code,
        angebot: abgelaufenesAngebot,
      }),
    UnitedShareError,
  );
});

test("Angebot enthaelt Ablaufzeit rund 5 Minuten in der Zukunft", async () => {
  const vor = Date.now();
  const { angebot } = await erzeugePairingAngebot({ host: "100.64.0.6", port: 19845, geraetename: "Mac" });
  const nach = Date.now();
  assert.ok(angebot.expiresAt >= vor + 5 * 60 * 1000);
  assert.ok(angebot.expiresAt <= nach + 5 * 60 * 1000 + 1000);
});

// -- Versuchszaehler/Ablauf-Logik --------------------------------------------
// Reine Entscheidungsfunktionen, keine Krypto -- bleiben unveraendert und
// synchron (siehe Kommentar im Kernmodul).

test("ein frischer Zustand (noch keine Versuche) erlaubt einen Versuch", () => {
  const zustand = { versuche: 0, erfolgreich: false, laeuftAbAm: Date.now() + 5 * 60 * 1000 };
  assert.equal(pairingVersuchErlaubt(zustand), true);
});

test("ohne jeden Zustand (erster Versuch ueberhaupt) ist ein Versuch erlaubt", () => {
  assert.equal(pairingVersuchErlaubt(undefined), true);
});

test("nach PAIRING_MAX_VERSUCHE Fehlversuchen wird auch ein korrekter Code nicht mehr akzeptiert", () => {
  let zustand = { versuche: 0, erfolgreich: false, laeuftAbAm: Date.now() + 5 * 60 * 1000 };
  for (let i = 0; i < PAIRING_MAX_VERSUCHE; i++) {
    assert.equal(pairingVersuchErlaubt(zustand), true, `Versuch ${i + 1} sollte noch erlaubt sein`);
    zustand = pairingVersuchVermerken(zustand, false);
  }
  // Der Code ist jetzt verbraucht -- auch wenn der naechste Versuch korrekt waere.
  assert.equal(pairingVersuchErlaubt(zustand), false);
});

test("nach einem erfolgreichen Versuch ist der Zustand verbraucht (einmal nutzbar)", () => {
  const zustand = { versuche: 0, erfolgreich: false, laeuftAbAm: Date.now() + 5 * 60 * 1000 };
  const neuerZustand = pairingVersuchVermerken(zustand, true);
  assert.equal(neuerZustand.erfolgreich, true);
  assert.equal(pairingVersuchErlaubt(neuerZustand), false);
});

test("nach Ablauf der Gueltigkeit (laeuftAbAm in der Vergangenheit) ist kein Versuch mehr erlaubt", () => {
  const zustand = { versuche: 0, erfolgreich: false, laeuftAbAm: Date.now() - 1000 };
  assert.equal(pairingVersuchErlaubt(zustand), false);
});

// -- AES-256-GCM verschluesseln/entschluesseln -------------------------------

test("Rundlauf verschluesseln/entschluesseln liefert den Klartext zurueck", async () => {
  const { angebot, privaterSchluessel: hostKey, code } = await erzeugePairingAngebot({
    host: "100.64.0.6",
    port: 19845,
    geraetename: "Mac",
  });
  const { anfrage, privaterSchluessel: clientKey } = await erzeugePairingAnfrage({
    angebot,
    code,
    geraetename: "iPhone",
  });
  const session = await akzeptierePairing({ anfrage, privaterSchluessel: hostKey, erwarteterCode: code, angebot });
  const clientSessionKey = await leiteSessionSchluesselAb({
    privaterSchluessel: clientKey,
    hostOeffentlicherSchluessel: angebot.publicKey,
  });

  const payload = await pairingVerschluesseln("ein geheimer Token-Text", session.symmetricKey);
  assert.ok(payload.nonce);
  assert.ok(payload.ciphertext);
  assert.ok(payload.tag);

  const klartext = await pairingEntschluesseln(payload, clientSessionKey);
  assert.equal(klartext.toString("utf8"), "ein geheimer Token-Text");
});

test("ein manipuliertes Tag fuehrt zu einem Fehler beim Entschluesseln", async () => {
  const schluessel = Buffer.alloc(32, 7);
  const payload = await pairingVerschluesseln("Daten", schluessel);
  const manipuliert = { ...payload, tag: Buffer.alloc(16, 9).toString("base64") };
  await assert.rejects(() => pairingEntschluesseln(manipuliert, schluessel), UnitedShareError);
});

test("eine manipulierte Ciphertext fuehrt zu einem Fehler beim Entschluesseln", async () => {
  const schluessel = Buffer.alloc(32, 7);
  const payload = await pairingVerschluesseln("Daten", schluessel);
  const manipuliertesCiphertext = Buffer.from(payload.ciphertext, "base64");
  manipuliertesCiphertext[0] ^= 0xff;
  const manipuliert = { ...payload, ciphertext: manipuliertesCiphertext.toString("base64") };
  await assert.rejects(() => pairingEntschluesseln(manipuliert, schluessel), UnitedShareError);
});

// -- Beweis: keine Node-spezifische Krypto mehr im Pairing-Protokoll --------
// Der naechstbeste Beweis fuer "funktioniert auch in Obsidians mobiler
// WebView" ohne echtes iPhone: ein Text-Scan, der sicherstellt, dass der
// Pairing-Abschnitt kein require("crypto")/require("node:crypto") mehr
// enthaelt -- genau das crashte den Knopf-Handler auf dem echten Geraet.
test("der Pairing-Protokoll-Abschnitt in unitedshare-core.js nutzt kein require(\"crypto\") mehr", () => {
  const fs = require("node:fs");
  const quelle = fs.readFileSync(require.resolve("./unitedshare-core.js"), "utf8");
  const start = quelle.indexOf("-- Pairing-Protokoll --");
  const ende = quelle.indexOf("-- LAN-Adresserkennung --");
  assert.ok(start > 0, "Abschnittsmarkierung 'Pairing-Protokoll' nicht gefunden");
  assert.ok(ende > start, "Abschnittsmarkierung 'LAN-Adresserkennung' nicht gefunden");
  const abschnitt = quelle.slice(start, ende);
  assert.equal(abschnitt.includes('require("crypto")'), false);
  assert.equal(abschnitt.includes('require("node:crypto")'), false);
});
