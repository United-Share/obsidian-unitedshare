"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bedieneSyncAnfrage,
  assertTailscaleAdresse,
  pairingVerschluesseln,
  pairingEntschluesseln,
  PEER_SYNC_TOKEN_HEADER,
} = require("./unitedshare-core");

// -- Testhilfen ---------------------------------------------------------------

// Fester 32-Byte-Schluessel fuers Verschluesseln/Entschluesseln in den Tests
// -- entspricht dem beim Pairing abgeleiteten AES-256-GCM-Sitzungsschluessel
// (siehe pairing-protokoll.test.js), hier nur deterministisch statt per ECDH.
const SCHLUESSEL = Buffer.alloc(32, 7);
const ANDERER_SCHLUESSEL = Buffer.alloc(32, 9);

// kontext.schluesselFuerToken() liefert standardmaessig SCHLUESSEL fuers
// Token "richtig" -- Spiegelbild der echten Host-Seite (peerSyncGeraete mit
// gespeichertem symmetricKey). kein Eintrag/kein Schluessel => null, damit
// "altes Geraet ohne Schluessel"-Faelle gezielt simuliert werden koennen.
function spyKontext(overrides) {
  const aufrufe = { listeDateien: 0, liesInhalt: 0, schreibeInhalt: 0, existiertDatei: 0 };
  const basis = {
    pruefeToken: (token) => token === "richtig",
    schluesselFuerToken: (token) => (token === "richtig" ? SCHLUESSEL : null),
    listeDateien: () => {
      aufrufe.listeDateien += 1;
      return [{ pfad: "a.md", mtime: 1, groesse: 5 }];
    },
    liesInhalt: (pfad) => {
      aufrufe.liesInhalt += 1;
      return pfad === "a.md" ? "hallo" : null;
    },
    schreibeInhalt: (_pfad, _inhalt) => {
      aufrufe.schreibeInhalt += 1;
    },
    existiertDatei: (pfad) => {
      aufrufe.existiertDatei += 1;
      return pfad === "a.md";
    },
  };
  return { kontext: Object.assign(basis, overrides), aufrufe };
}

function anfrage(overrides) {
  return Object.assign(
    { methode: "GET", pfad: "/manifest", suche: {}, kopfzeilen: { [PEER_SYNC_TOKEN_HEADER]: "richtig" }, textkoerper: "" },
    overrides,
  );
}

// Entschluesselt eine Antwort mit dem erwarteten Format {nonce, ciphertext,
// tag} und liefert das geparste JSON-Objekt.
async function entschluesselteAntwort(antwort, schluessel = SCHLUESSEL) {
  const verschluesselt = JSON.parse(antwort.textkoerper);
  const klartext = await pairingEntschluesseln(verschluesselt, schluessel);
  return JSON.parse(klartext.toString("utf8"));
}

// Baut den verschluesselten Request-Body fuer "Datei schreiben", wie ihn ein
// echter Mobile-Client (mobilSyncHost() in main.src.js) schicken wuerde.
async function verschluesselterKoerper(daten, schluessel = SCHLUESSEL) {
  return JSON.stringify(await pairingVerschluesseln(JSON.stringify(daten), schluessel));
}

// -- Token-Pruefung -----------------------------------------------------------

test("fehlendes Token wird mit 401 abgelehnt, kein Dateizugriff erfolgt", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(anfrage({ kopfzeilen: {} }), kontext);
  assert.equal(antwort.status, 401);
  assert.equal(aufrufe.listeDateien, 0);
  assert.equal(aufrufe.liesInhalt, 0);
  assert.equal(aufrufe.schreibeInhalt, 0);
  assert.equal(aufrufe.existiertDatei, 0);
});

test("falsches Token wird mit 401 abgelehnt, kein Dateizugriff erfolgt", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({ kopfzeilen: { [PEER_SYNC_TOKEN_HEADER]: "falsch" } }),
    kontext,
  );
  assert.equal(antwort.status, 401);
  assert.equal(aufrufe.listeDateien, 0);
});

// -- fehlender Sitzungsschluessel (Geraet vor der Verschluesselung gepaart) --

test("gueltiges Token, aber kein gespeicherter Schluessel: 401, kein Dateizugriff, keine Klartextdaten", async () => {
  const { kontext, aufrufe } = spyKontext({ schluesselFuerToken: () => null });
  const antwort = await bedieneSyncAnfrage(anfrage(), kontext);
  assert.equal(antwort.status, 401);
  assert.equal(aufrufe.listeDateien, 0);
  // Fehlerantwort bleibt Klartext-JSON (kein Notizinhalt), aber garantiert
  // kein {hash,...}-Manifest und keine Notiz:
  const body = JSON.parse(antwort.textkoerper);
  assert.ok(body.fehler);
});

test("gueltiges Token, kein Schluessel: auch Datei lesen und Datei schreiben werden abgelehnt", async () => {
  const { kontext: kontextLesen, aufrufe: aufrufeLesen } = spyKontext({ schluesselFuerToken: () => null });
  const antwortLesen = await bedieneSyncAnfrage(
    anfrage({ methode: "GET", pfad: "/datei", suche: { pfad: "a.md" } }),
    kontextLesen,
  );
  assert.equal(antwortLesen.status, 401);
  assert.equal(aufrufeLesen.liesInhalt, 0);
  assert.equal(aufrufeLesen.existiertDatei, 0);

  const { kontext: kontextSchreiben, aufrufe: aufrufeSchreiben } = spyKontext({ schluesselFuerToken: () => null });
  const antwortSchreiben = await bedieneSyncAnfrage(
    anfrage({
      methode: "POST",
      pfad: "/datei",
      textkoerper: await verschluesselterKoerper({ pfad: "neu.md", inhalt: "welt" }),
    }),
    kontextSchreiben,
  );
  assert.equal(antwortSchreiben.status, 401);
  assert.equal(aufrufeSchreiben.schreibeInhalt, 0);
});

// -- Manifest -------------------------------------------------------------------

test("Manifest-Abruf liefert ein verschluesseltes Manifest, das mit dem richtigen Schluessel entschluesselt werden kann", async () => {
  const { kontext } = spyKontext();
  const antwort = await bedieneSyncAnfrage(anfrage(), kontext);
  assert.equal(antwort.status, 200);
  // Der rohe HTTP-Response-Body ist {nonce, ciphertext, tag}, kein Manifest:
  const roh = JSON.parse(antwort.textkoerper);
  assert.ok(roh.nonce);
  assert.ok(roh.ciphertext);
  assert.ok(roh.tag);

  const body = await entschluesselteAntwort(antwort);
  assert.equal(body["a.md"].mtime, 1);
  assert.equal(body["a.md"].groesse, 5);
  assert.equal(typeof body["a.md"].hash, "string");
});

test("Manifest-Abruf mit falschem Schluessel laesst sich nicht entschluesseln", async () => {
  const { kontext } = spyKontext();
  const antwort = await bedieneSyncAnfrage(anfrage(), kontext);
  assert.equal(antwort.status, 200);
  await assert.rejects(() => entschluesselteAntwort(antwort, ANDERER_SCHLUESSEL));
});

// -- Datei lesen ------------------------------------------------------------

test("Datei lesen: vorhandene Datei kommt verschluesselt mit 200 zurueck, der rohe Body enthaelt keinen Klartext-Notizinhalt", async () => {
  const { kontext } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({ methode: "GET", pfad: "/datei", suche: { pfad: "a.md" } }),
    kontext,
  );
  assert.equal(antwort.status, 200);
  // (b): der tatsaechliche HTTP-Response-Body enthaelt NICHT den Klartext:
  assert.equal(antwort.textkoerper.includes("hallo"), false);
  const body = await entschluesselteAntwort(antwort);
  assert.equal(body.inhalt, "hallo");
});

test("Datei lesen: fehlende Datei kommt mit 404 zurueck", async () => {
  const { kontext } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({ methode: "GET", pfad: "/datei", suche: { pfad: "fehlt.md" } }),
    kontext,
  );
  assert.equal(antwort.status, 404);
});

test("Datei lesen: Pfad-Traversal wird mit 400 abgelehnt, kein Dateizugriff erfolgt", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({ methode: "GET", pfad: "/datei", suche: { pfad: "../../etc/passwd" } }),
    kontext,
  );
  assert.equal(antwort.status, 400);
  assert.equal(aufrufe.existiertDatei, 0);
  assert.equal(aufrufe.liesInhalt, 0);
});

// -- Datei schreiben ----------------------------------------------------------

test("Datei schreiben: neue Datei wird uebernommen (verschluesselter Request-Body)", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({
      methode: "POST",
      pfad: "/datei",
      textkoerper: await verschluesselterKoerper({ pfad: "neu.md", inhalt: "welt" }),
    }),
    kontext,
  );
  assert.equal(antwort.status, 200);
  assert.equal(aufrufe.schreibeInhalt, 1);
  // Response ist ebenfalls verschluesselt, kein Klartext im rohen Body:
  assert.equal(antwort.textkoerper.includes("neu.md"), false);
  const body = await entschluesselteAntwort(antwort);
  assert.equal(body.pfad, "neu.md");
  assert.equal(body.geschrieben, true);
});

test("Datei schreiben: verschachtelter Ordner geht ohne Fehler durch (Ordner anlegen ist Sache des Kontexts)", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({
      methode: "POST",
      pfad: "/datei",
      textkoerper: await verschluesselterKoerper({ pfad: "Ordner/Unterordner/neu.md", inhalt: "welt" }),
    }),
    kontext,
  );
  assert.equal(antwort.status, 200);
  assert.equal(aufrufe.schreibeInhalt, 1);
});

test("Datei schreiben: Ueberschreiben einer vorhandenen Datei geht durch", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({
      methode: "POST",
      pfad: "/datei",
      textkoerper: await verschluesselterKoerper({ pfad: "a.md", inhalt: "neu" }),
    }),
    kontext,
  );
  assert.equal(antwort.status, 200);
  assert.equal(aufrufe.schreibeInhalt, 1);
});

test("Datei schreiben: Pfad-Traversal wird mit 400 abgelehnt, kein Dateizugriff erfolgt", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({
      methode: "POST",
      pfad: "/datei",
      textkoerper: await verschluesselterKoerper({ pfad: "../../etc/passwd", inhalt: "böse" }),
    }),
    kontext,
  );
  assert.equal(antwort.status, 400);
  assert.equal(aufrufe.schreibeInhalt, 0);
});

test("Datei schreiben: kaputter Textkoerper (kein JSON) wird mit 400 abgelehnt, kein Dateizugriff erfolgt", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({ methode: "POST", pfad: "/datei", textkoerper: "{kein json" }),
    kontext,
  );
  assert.equal(antwort.status, 400);
  assert.equal(aufrufe.schreibeInhalt, 0);
});

test("Datei schreiben: mit dem falschen Schluessel verschluesselter Body wird abgelehnt, kein Dateizugriff erfolgt", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({
      methode: "POST",
      pfad: "/datei",
      textkoerper: await verschluesselterKoerper({ pfad: "neu.md", inhalt: "welt" }, ANDERER_SCHLUESSEL),
    }),
    kontext,
  );
  assert.equal(antwort.status, 400);
  assert.equal(aufrufe.schreibeInhalt, 0);
});

test("Datei schreiben: unverschluesselter Klartext-Body (altes Protokoll) wird abgelehnt, kein Dateizugriff erfolgt", async () => {
  const { kontext, aufrufe } = spyKontext();
  const antwort = await bedieneSyncAnfrage(
    anfrage({
      methode: "POST",
      pfad: "/datei",
      textkoerper: JSON.stringify({ pfad: "neu.md", inhalt: "welt" }),
    }),
    kontext,
  );
  assert.equal(antwort.status, 400);
  assert.equal(aufrufe.schreibeInhalt, 0);
});

// -- unbekannte Routen --------------------------------------------------------

test("unbekannte Route ergibt 404", async () => {
  const { kontext } = spyKontext();
  const antwort = await bedieneSyncAnfrage(anfrage({ pfad: "/nirgendwo" }), kontext);
  assert.equal(antwort.status, 404);
});

test("bekannte Route mit falscher Methode ergibt 404", async () => {
  const { kontext } = spyKontext();
  const antwort = await bedieneSyncAnfrage(anfrage({ methode: "DELETE", pfad: "/manifest" }), kontext);
  assert.equal(antwort.status, 404);
});

test("unbekannte Route bricht nicht ab, auch ohne Token", async () => {
  const { kontext } = spyKontext();
  const antwort = await bedieneSyncAnfrage(anfrage({ pfad: "/nirgendwo", kopfzeilen: {} }), kontext);
  assert.equal(antwort.status, 404);
});

// -- assertTailscaleAdresse ----------------------------------------------------

test("eine Adresse im Bereich 100.64.0.0/10 wird akzeptiert", () => {
  assert.equal(assertTailscaleAdresse("100.64.0.1"), "100.64.0.1");
  assert.equal(assertTailscaleAdresse("100.127.255.254"), "100.127.255.254");
  assert.equal(assertTailscaleAdresse("  100.100.50.4  "), "100.100.50.4");
});

test("eine Adresse ausserhalb von 100.64.0.0/10 wird abgelehnt", () => {
  assert.throws(() => assertTailscaleAdresse("100.63.255.255"));
  assert.throws(() => assertTailscaleAdresse("100.128.0.0"));
  assert.throws(() => assertTailscaleAdresse("192.168.1.1"));
  assert.throws(() => assertTailscaleAdresse("127.0.0.1"));
});

test("keine Adresse oder Unsinn wird abgelehnt", () => {
  assert.throws(() => assertTailscaleAdresse(""));
  assert.throws(() => assertTailscaleAdresse(undefined));
  assert.throws(() => assertTailscaleAdresse("0.0.0.0"));
  assert.throws(() => assertTailscaleAdresse("nicht-eine-adresse"));
});
