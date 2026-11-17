"use strict";

// Vertraege fuer den Second-Brain-Ordner-Sync in den Vault-Workspace.
//
// ANLASS: Ein gewaehlter Ordner (Setting secondBrainOrdner) soll auf allen
// Geraeten derselben Identitaet verfuegbar sein. Backend sind die vier
// Workspace-Endpunkte des Gateways, Keys unter obsidian/notes/<relpfad>.
//
// WARUM EIN HASH-INDEX: Blind-Uploads wuerden bei jedem Lauf den ganzen
// Ordner uebertragen. Der Index merkt sich den zuletzt gespiegelten Stand
// pro Datei; nur Abweichungen werden hochgeladen.
//
// WARUM KONFLIKTKOPIEN STATT UEBERSCHREIBEN: Stiller Datenverlust ist das
// einzige unverzeihliche Verhalten eines Sync. Ist die lokale Datei anders
// als die eingehende, bleibt die lokale stehen und die eingehende landet als
// Konfliktkopie daneben (konfliktDateiname aus unitedshare-core).
//
// WARUM KEINE LOESCH-PROPAGATION IM MVP: Ohne Tombstones ist nicht
// unterscheidbar, ob eine Datei geloescht oder nur noch nie gesehen wurde.
// Der Plan behandelt entfernte Keys ohne lokale Datei deshalb ausdruecklich
// als "ignoriert", nie als Loeschauftrag.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  NOTES_PRAEFIX,
  MAX_OBJEKT_BYTES,
  keyAusRelpfad,
  relpfadAusKey,
  planeOrdnerSync,
  eingehendeNotiz,
  indexNachSync,
} = require("./ordner-sync");

test("keyAusRelpfad und relpfadAusKey sind verlustfrei, auch mit Umlauten und Leerzeichen", () => {
  const rel = "Ideen/Café Plan (2026).md";
  const key = keyAusRelpfad(rel);
  assert.equal(key, "obsidian/notes/Ideen/Café Plan (2026).md");
  assert.equal(relpfadAusKey(key), rel);
  assert.ok(key.startsWith(NOTES_PRAEFIX));
});

test("keyAusRelpfad lehnt gefaehrliche Pfade ab", () => {
  assert.equal(keyAusRelpfad(""), null);
  assert.equal(keyAusRelpfad("/absolut.md"), null);
  assert.equal(keyAusRelpfad("a/../b.md"), null);
  assert.equal(relpfadAusKey("anderes/praefix.md"), null);
});

// Haertung nach Security-Finding 1: Parser-Differentiale zwischen Obsidian,
// Gateway und Vault duerfen keinen Weg aus dem Notes-Praefix heraus bieten.
// Backslash-Separatoren, Laufwerks-Praefixe, leere Segmente sowie Segmente,
// die "."/".." sind oder mit Punkt/Leerzeichen enden (Windows-Normalisierung),
// werden je Segment abgelehnt.
test("keyAusRelpfad lehnt Angriffs- und Grenzpfade je Segment ab", () => {
  const boese = [
    "a\\..\\b.md",
    "C:evil.md",
    "/abs.md",
    "\\abs.md",
    "a//b.md",
    "a/./b.md",
    "a/../b.md",
    "falle. /x.md",
    "ordner./n.md",
    "endet-mit-slash/",
    "punkt-am-ende.md ",
  ];
  for (const pfad of boese) {
    assert.equal(keyAusRelpfad(pfad), null, `muss abgelehnt werden: ${JSON.stringify(pfad)}`);
  }
  assert.ok(keyAusRelpfad("Ideen/Café Plan (2026).md"));
  assert.ok(keyAusRelpfad("a.b/c-d_e.md"));
});

// Haertung nach Security-Finding (Dotfiles und Codeausfuehrung): Ein
// eingehender Pfad wie .obsidian/plugins/x/main.js wuerde in das
// Konfigurationsverzeichnis schreiben. Dot-Segmente sind deshalb tabu, und
// nur die Second-Brain-Formate .md und .canvas sind als Endung erlaubt.
test("keyAusRelpfad lehnt Dot-Segmente und fremde Endungen ab", () => {
  const boese = [
    ".obsidian/plugins/evil/main.js",
    ".hidden/n.md",
    "notes/.versteckt.md",
    "notes/script.js",
    "notes/bild.png",
    "notes/ohne-endung",
  ];
  for (const pfad of boese) {
    assert.equal(keyAusRelpfad(pfad), null, `muss abgelehnt werden: ${pfad}`);
  }
  assert.ok(keyAusRelpfad("notes/idee.md"));
  assert.ok(keyAusRelpfad("boards/plan.canvas"));
  assert.ok(keyAusRelpfad("GROSS.MD"));
});

// Haertungsrunde 2, Finding 2: Windows-Geraetenamen sind auf NTFS in jedem
// Ordner reserviert und loesen beim Sync auf ein Windows-Geraet Fehler oder
// Umleitungen aus. Und ohne Unicode-Normalisierung sehen Validator und
// Dateisystem verschiedene Pfade (NFD vom Mac, NFC im Key).
test("keyAusRelpfad lehnt Windows-Geraetenamen case-insensitiv ab", () => {
  for (const pfad of ["CON.md", "com1.md", "ordner/NUL.canvas", "prn.md", "LPT9.md", "aux.canvas"]) {
    assert.equal(keyAusRelpfad(pfad), null, `muss abgelehnt werden: ${pfad}`);
  }
  assert.ok(keyAusRelpfad("console.md"));
  assert.ok(keyAusRelpfad("compendium1.md"));
});

// Haertungsrunde 2, Finding 3: Doppelpunkte sind auf NTFS Alternate Data
// Streams und machen Pfade laufwerksrelativ; das Laufwerks-Praefix allein
// deckt "a:b" mitten im Pfad nicht ab.
test("keyAusRelpfad lehnt Doppelpunkte in jedem Segment ab", () => {
  for (const pfad of ["notes/datei.md:stream", "a:b/n.md", "x/y:z.md"]) {
    assert.equal(keyAusRelpfad(pfad), null, `muss abgelehnt werden: ${pfad}`);
  }
});

test("keyAusRelpfad normalisiert NFD und NFC auf denselben Key", () => {
  const nfc = "id\u00e9e.md";
  const nfd = "ide\u0301e.md";
  assert.notEqual(nfc, nfd);
  const keyNfc = keyAusRelpfad(nfc);
  const keyNfd = keyAusRelpfad(nfd);
  assert.ok(keyNfc);
  assert.equal(keyNfc, keyNfd);
});

test("planeOrdnerSync laedt nur Neues und Geaendertes hoch", () => {
  const plan = planeOrdnerSync({
    dateien: [
      { pfad: "a.md", hash: "h1", groesse: 10 },
      { pfad: "b.md", hash: "h2-neu", groesse: 10 },
      { pfad: "c.md", hash: "h3", groesse: 10 },
    ],
    index: { "a.md": "h1", "b.md": "h2-alt" },
    entfernt: [],
  });
  assert.deepEqual(plan.hochladen.map((d) => d.pfad).sort(), ["b.md", "c.md"]);
  assert.deepEqual(plan.uebersprungen, []);
});

test("planeOrdnerSync ueberspringt Dateien ueber dem Gateway-Limit mit Grund", () => {
  const plan = planeOrdnerSync({
    dateien: [
      { pfad: "klein.md", hash: "h1", groesse: 10 },
      { pfad: "riesig.md", hash: "h2", groesse: MAX_OBJEKT_BYTES + 1 },
    ],
    index: {},
    entfernt: [],
  });
  assert.deepEqual(plan.hochladen.map((d) => d.pfad), ["klein.md"]);
  assert.equal(plan.uebersprungen.length, 1);
  assert.equal(plan.uebersprungen[0].pfad, "riesig.md");
  assert.equal(plan.uebersprungen[0].grund, "zu-gross");
});

// Haertung nach Security-Finding 3: fehlende oder unsinnige Groessenangaben
// duerfen das Limit nicht umgehen. Ohne gueltige Zahl wird nicht hochgeladen.
test("planeOrdnerSync ueberspringt Dateien ohne gueltige Groesse", () => {
  const plan = planeOrdnerSync({
    dateien: [
      { pfad: "ohne.md", hash: "h1" },
      { pfad: "nan.md", hash: "h2", groesse: Number.NaN },
      { pfad: "negativ.md", hash: "h3", groesse: -1 },
      { pfad: "unendlich.md", hash: "h4", groesse: Infinity },
      { pfad: "ok.md", hash: "h5", groesse: 5 },
    ],
    index: {},
    entfernt: [],
  });
  assert.deepEqual(plan.hochladen.map((d) => d.pfad), ["ok.md"]);
  assert.equal(plan.uebersprungen.length, 4);
  for (const u of plan.uebersprungen) assert.equal(u.grund, "ungueltige-groesse", u.pfad);
});

test("planeOrdnerSync propagiert Loeschungen nicht, sondern weist sie nur aus", () => {
  const plan = planeOrdnerSync({
    dateien: [{ pfad: "bleibt.md", hash: "h1", groesse: 5 }],
    index: { "bleibt.md": "h1", "lokal-geloescht.md": "h9" },
    entfernt: [
      { key: "obsidian/notes/bleibt.md", size: 5 },
      { key: "obsidian/notes/nur-remote.md", size: 7 },
    ],
  });
  assert.deepEqual(plan.hochladen, []);
  assert.deepEqual(plan.geloeschtIgnoriert.sort(), ["obsidian/notes/nur-remote.md"]);
  assert.ok(!("loeschen" in plan));
});

test("eingehendeNotiz legt Neues direkt an und macht bei Abweichung eine Konfliktkopie", () => {
  const neu = eingehendeNotiz({
    relpfad: "Ideen/neu.md",
    remoteText: "Inhalt",
    lokalText: null,
    existiert: () => false,
  });
  assert.equal(neu.aktion, "anlegen");
  assert.equal(neu.zielPfad, "Ideen/neu.md");

  const gleich = eingehendeNotiz({
    relpfad: "Ideen/gleich.md",
    remoteText: "Inhalt",
    lokalText: "Inhalt",
    existiert: () => true,
  });
  assert.equal(gleich.aktion, "unveraendert");

  const belegt = new Set(["Ideen/anders.md"]);
  const konflikt = eingehendeNotiz({
    relpfad: "Ideen/anders.md",
    remoteText: "Remote-Fassung",
    lokalText: "Lokale Fassung",
    existiert: (p) => belegt.has(p),
  });
  assert.equal(konflikt.aktion, "konflikt");
  assert.notEqual(konflikt.zielPfad, "Ideen/anders.md");
  assert.ok(konflikt.zielPfad.includes("Konflikt"));
});

// Haertung nach Security-Finding 2: "anlegen" darf nur zurueckkommen, wenn
// die Datei nachweislich NICHT existiert. lokalText null bedeutet auch
// "Lesen fehlgeschlagen"; eine existierende, aber unlesbare Datei still zu
// ueberschreiben waere Datenverlust. existiert ist deshalb Pflicht und
// entscheidet; unlesbar bei existierender Datei ergibt eine Konfliktkopie.
test("eingehendeNotiz ist fail-closed: existierend plus unlesbar ergibt Konflikt", () => {
  const e = eingehendeNotiz({
    relpfad: "Ideen/unlesbar.md",
    remoteText: "Remote-Fassung",
    lokalText: null,
    existiert: (p) => p === "Ideen/unlesbar.md",
  });
  assert.equal(e.aktion, "konflikt");
  assert.notEqual(e.zielPfad, "Ideen/unlesbar.md");
  assert.ok(e.zielPfad.includes("Konflikt"));
});

test("eingehendeNotiz verlangt existiert als Funktion", () => {
  assert.throws(() => eingehendeNotiz({ relpfad: "a.md", remoteText: "x", lokalText: null }), TypeError);
});

test("indexNachSync uebernimmt die hochgeladenen Staende und vergisst nichts anderes", () => {
  const neu = indexNachSync({ "a.md": "h1" }, [{ pfad: "b.md", hash: "h2" }]);
  assert.deepEqual(neu, { "a.md": "h1", "b.md": "h2" });
});
