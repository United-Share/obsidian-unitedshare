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
  laufStarten,
  laufBeenden,
} = require("./ordner-sync");

test("keyAusRelpfad und relpfadAusKey sind verlustfrei, auch mit Umlauten und Leerzeichen", () => {
  const rel = "Ideen/Café Plan (2026).md";
  const key = keyAusRelpfad(rel);
  assert.equal(key, "obsidian/notes/Ideen/Café Plan (2026).md");
  assert.equal(relpfadAusKey(key), rel);
  assert.ok(key.startsWith(NOTES_PRAEFIX));
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
    listingVollstaendig: true,
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
    listingVollstaendig: true,
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
    listingVollstaendig: true,
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

// Nacharbeit K2: macOS liefert NFD, Index und Keys tragen NFC. Ohne
// Normalisierung am Eingang landet dieselbe Notiz als "fremd geloescht"
// im Plan oder wird doppelt hochgeladen.
test("planeOrdnerSync normalisiert lokale Pfade auf NFC", () => {
  const nfdPfad = "ide\u0301e.md";
  const plan = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: nfdPfad, hash: "h1", groesse: 5 }],
    index: { "id\u00e9e.md": "h1" },
    entfernt: [{ key: "obsidian/notes/id\u00e9e.md", size: 5 }],
  });
  assert.deepEqual(plan.hochladen, []);
  assert.deepEqual(plan.geloeschtIgnoriert, []);
});

// Nacharbeit K5: ohne gueltigen Hash ist Aenderungserkennung Raten.
test("planeOrdnerSync ueberspringt Dateien ohne gueltigen hash", () => {
  const plan = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [
      { pfad: "fehlt.md", groesse: 1 },
      { pfad: "zahl.md", hash: 42, groesse: 1 },
      { pfad: "ok.md", hash: "h", groesse: 1 },
    ],
    index: {},
    entfernt: [],
  });
  assert.deepEqual(plan.hochladen.map((d) => d.pfad), ["ok.md"]);
  assert.equal(plan.uebersprungen.length, 2);
  for (const u of plan.uebersprungen) assert.equal(u.grund, "ungueltiger-hash", u.pfad);
});

test("indexNachSync ueberspringt Eintraege ohne gueltigen hash", () => {
  const neu = indexNachSync({}, [{ pfad: "ohne.md" }, { pfad: "mit.md", hash: "h2" }]);
  assert.equal(neu["mit.md"], "h2");
  assert.equal(Object.keys(neu).length, 1);
});

test("planeOrdnerSync propagiert Loeschungen nicht, sondern weist sie nur aus", () => {
  const plan = planeOrdnerSync({
    listingVollstaendig: true,
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

// Haertung (Paket 2): existiert und lokalText sind additive Signale.
// "anlegen" gibt es nur, wenn BEIDE sagen "da ist nichts". Widersprechen
// sie sich, ist etwas faul (Race, kaputter Adapter) und es wird die
// Konfliktkopie gewaehlt. Ein werfendes existiert ist ebenfalls Konflikt,
// niemals false. relpfad wird wie in keyAusRelpfad auf NFC normalisiert.
test("eingehendeNotiz behandelt Signal-Widerspruch als Konflikt", () => {
  const widerspruch = eingehendeNotiz({
    relpfad: "Ideen/race.md",
    remoteText: "Remote",
    lokalText: "Lokal gelesen",
    existiert: () => false,
  });
  assert.equal(widerspruch.aktion, "konflikt");
  assert.ok(widerspruch.zielPfad.includes("Konflikt"));
});

test("eingehendeNotiz behandelt werfendes existiert als Konflikt", () => {
  let erster = true;
  const e = eingehendeNotiz({
    relpfad: "Ideen/kaputt.md",
    remoteText: "Remote",
    lokalText: null,
    existiert: () => {
      if (erster) {
        erster = false;
        throw new Error("Adapter kaputt");
      }
      return false;
    },
  });
  assert.equal(e.aktion, "konflikt");
  assert.ok(e.zielPfad.includes("Konflikt"));
});

test("eingehendeNotiz normalisiert den Relpfad auf NFC", () => {
  const gesehen = [];
  const nfd = "ide\u0301e.md";
  const nfc = "id\u00e9e.md";
  assert.notEqual(nfd, nfc);
  const e = eingehendeNotiz({
    relpfad: nfd,
    remoteText: "x",
    lokalText: null,
    existiert: (p) => {
      gesehen.push(p);
      return false;
    },
  });
  assert.equal(e.aktion, "anlegen");
  assert.equal(e.zielPfad, nfc);
  assert.equal(gesehen[0], nfc);
});

// Nacharbeit S6: unsichtbare Formatzeichen, getarnte Punkt- und
// Slash-Varianten, Windows-Sonderzeichen, Prozentzeichen und ueberlange
// Segmente. Alles Zeichenklassen, mit denen ein Key am Validator vorbei
// anders aussieht als auf dem Dateisystem.
test("keyAusRelpfad lehnt unsichtbare und getarnte Zeichen ab", () => {
  const faelle = [
    "notes/idee\u200b.md",
    "notes/\u202egetarnt.md",
    "\u2024obsidian/n.md",
    "a\uff0f..\uff0fb.md",
    "a\u2215b.md",
    "notes/ende\u3000/n.md",
    "notes/\u3000anfang.md",
    "notes/50%.md",
    "notes/stern*.md",
    "notes/frage?.md",
    "notes/spitz<.md",
    "notes/pipe|.md",
    "notes/punkt\uff0e\uff0e-tarnung\uff0emd",
  ];
  for (const pfad of faelle) {
    assert.equal(keyAusRelpfad(pfad), null, JSON.stringify(pfad));
  }
});

// S6-Nachtrag: statt Zeichenlisten entscheidet die NFKC-Form. Faltet die
// Kompatibilitaets-Normalisierung ein pfadbedeutsames Zeichen (. / \\ :)
// herbei, das die Originalform nicht hatte, wird abgelehnt. U+2044 und
// U+2215 laesst NFKC gemessen unveraendert stehen und sie bleiben als
// dokumentierte Restliste gesperrt.
test("keyAusRelpfad lehnt NFKC-faltbare und NFKC-resistente Doppelgaenger ab", () => {
  const faelle = [
    "\u2024obsidian/n.md",
    "a\uff0eb/../x.md",
    "notes/\ufe52versteckt.md",
    "a\u2044b.md",
    "a\u2215b.md",
    "halb\u00bd.md",
  ];
  for (const pfad of faelle) {
    assert.equal(keyAusRelpfad(pfad), null, JSON.stringify(pfad));
  }
  assert.ok(keyAusRelpfad("Ideen/Caf\u00e9 Plan \u00e4\u00f6\u00fc.md"), "Umlaute bleiben erlaubt");
});

test("keyAusRelpfad deckelt Segmente auf 255 UTF-8-Bytes", () => {
  const genauAmLimit = "a".repeat(252) + ".md";
  assert.ok(keyAusRelpfad(genauAmLimit), "255 Bytes exakt sind erlaubt");
  const zuLang = "a".repeat(253) + ".md";
  assert.equal(keyAusRelpfad(zuLang), null);
  const umlautGenauAmLimit = "\u00e4".repeat(126) + ".md";
  assert.ok(keyAusRelpfad(umlautGenauAmLimit), "255 Bytes exakt sind erlaubt");
  const umlautZuLang = "\u00e4".repeat(127) + ".md";
  assert.equal(keyAusRelpfad(umlautZuLang), null);
});

test("konfliktErgebnis kuerzt den Stamm unter die Segmentgrenze", () => {
  const name = "k".repeat(249) + ".md";
  const e = eingehendeNotiz({
    relpfad: name,
    remoteText: "Remote",
    lokalText: "Lokal",
    existiert: (p) => p === name,
  });
  assert.equal(e.aktion, "konflikt");
  const segment = e.zielPfad.split("/").pop();
  assert.ok(Buffer.byteLength(segment, "utf8") <= 255, String(Buffer.byteLength(segment, "utf8")));
  assert.ok(segment.includes("(Konflikt)"));
  assert.ok(segment.endsWith(".md"));
});

// Nacharbeit V2: ordner-sync ist ein Standalone-Modul wie die anderen,
// ohne Quer-require auf die Transportschicht; die Objektgrenze ist ein
// Parameter mit lokalem Default.
test("ordner-sync haengt nicht an workspace-sync und maxBytes ist Parameter", () => {
  const quelle = require("node:fs").readFileSync(require.resolve("./ordner-sync"), "utf8");
  assert.ok(!quelle.includes("require(\"./workspace-sync\")"), "kein Quer-require auf die Transportschicht");
  const plan = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: "a.md", hash: "h1", groesse: 11 }],
    index: {},
    entfernt: [],
    maxBytes: 10,
  });
  assert.deepEqual(plan.hochladen, []);
  assert.equal(plan.uebersprungen[0].grund, "zu-gross");
});

// Nacharbeit V6: die eigene begrenzte Suche muss bei ehrlicher Probe
// dieselben Namen erzeugen wie konfliktDateiname aus unitedshare-core.
test("konfliktErgebnis entspricht konfliktDateiname bei ehrlicher Probe", () => {
  const { konfliktDateiname } = require("./unitedshare-core");
  const belegt = new Set(["Ideen/voll.md", "Ideen/voll (Konflikt).md", "Ideen/voll (Konflikt 2).md"]);
  const probe = (p) => belegt.has(p);
  const e = eingehendeNotiz({ relpfad: "Ideen/voll.md", remoteText: "r", lokalText: "l", existiert: probe });
  assert.equal(e.zielPfad, konfliktDateiname("Ideen/voll.md", probe));
});

// Gate-Runde 2, P1: Keys aus dem Netz koennen NFD tragen. relpfadAusKey
// liefert NFC zurueck und die Pruefungen normalisieren selbst, damit der
// Push-Schutz NFD-Listing gegen NFD-Datei nicht als fremd einstuft.
test("relpfadAusKey normalisiert auf NFC und der Plan trifft NFD-Listings", () => {
  const nfdKey = "obsidian/notes/ide\u0301e.md";
  assert.equal(relpfadAusKey(nfdKey), "id\u00e9e.md");
  const plan = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: "ide\u0301e.md", hash: "h1", groesse: 5 }],
    index: { "id\u00e9e.md": "h1" },
    entfernt: [{ key: nfdKey, size: 5 }],
  });
  assert.deepEqual(plan.geloeschtIgnoriert, []);
});

// Gate-Runde 2, P2: Groesse ist NIE hinreichend. Liegen Hashes vor
// (remoteStand aus dem Pull, kuenftig ETag im Listing), entscheiden sie;
// die Groessen-Rueckfallebene ist eine dokumentierte Luecke.
test("groessengleiche Fremdaenderung faellt per Hash auf", () => {
  const plan = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: "doc.md", hash: "h-neu-lokal", groesse: 10 }],
    index: { "doc.md": "h-alt-lokal" },
    entfernt: [{ key: "obsidian/notes/doc.md", size: 7, hash: "remote-neu" }],
    remoteStand: { "doc.md": { size: 7, hash: "remote-alt" } },
  });
  assert.deepEqual(plan.hochladen, []);
  assert.equal(plan.remoteAbweichung.length, 1);
});

// Gate-Runde 2, P3: ein unvollstaendiges Listing (Gateway liefert nur die
// letzten 50) macht den Push fail-closed: Uploads nur fuer gelistete
// Pfade, verwaiste Index-Pfade werden Abweichung, Loesch-Auswertung faellt
// ganz aus.
// P3-Nachtrag: der Default ist der SICHERE Zustand. Wer das Flag nicht
// durchreicht, bekommt das Verhalten fuer unvollstaendige Listings, nie
// stillschweigend den ungeschuetzten Push.
test("ohne listingVollstaendig gilt das Listing als unvollstaendig", () => {
  const plan = planeOrdnerSync({
    dateien: [{ pfad: "neu.md", hash: "h1", groesse: 5 }],
    index: { "verwaist.md": "h9" },
    entfernt: [],
  });
  assert.deepEqual(plan.hochladen, []);
  assert.ok(plan.remoteAbweichung.some((r) => r.pfad === "neu.md"));
  assert.ok(plan.remoteAbweichung.some((r) => r.pfad === "verwaist.md"));
  assert.deepEqual(plan.geloeschtIgnoriert, []);
});

test("unvollstaendiges Listing macht den Push fail-closed", () => {
  const plan = planeOrdnerSync({
    dateien: [
      { pfad: "imListing.md", hash: "h1-neu", groesse: 5 },
      { pfad: "nichtImListing.md", hash: "h2", groesse: 5 },
    ],
    index: { "imListing.md": "h1-alt", "verwaist.md": "h9" },
    entfernt: [{ key: "obsidian/notes/imListing.md", size: 5, hash: "r1" }],
    remoteStand: { "imListing.md": { size: 5, hash: "r1" } },
    listingVollstaendig: false,
  });
  assert.deepEqual(plan.hochladen.map((d) => d.pfad), ["imListing.md"]);
  assert.ok(plan.remoteAbweichung.some((r) => r.pfad === "nichtImListing.md"));
  assert.ok(plan.remoteAbweichung.some((r) => r.pfad === "verwaist.md"));
  assert.deepEqual(plan.geloeschtIgnoriert, []);
});

// Nacharbeit K6: Push-Schutz gegen Last-Writer-Wins. Hat sich die
// Remote-Fassung seit dem letzten gesehenen Stand geaendert (oder wurde
// sie nie gesehen), wird NICHT hochgeladen, sondern als remoteAbweichung
// in den Konfliktpfad gegeben. Reihenfolge ist immer erst Pull, dann Push.
test("fremd geaenderte Remote-Fassungen werden nicht ueberschrieben", () => {
  const plan = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: "doc.md", hash: "h-neu", groesse: 10 }],
    index: { "doc.md": "h-alt" },
    entfernt: [{ key: "obsidian/notes/doc.md", size: 99 }],
    remoteStand: { "doc.md": { size: 10 } },
  });
  assert.deepEqual(plan.hochladen, []);
  assert.deepEqual(plan.remoteAbweichung.map((r) => r.pfad), ["doc.md"]);
});

test("nie gesehene Remote-Fassung zaehlt als Abweichung, bekannte nicht", () => {
  const nieGesehen = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: "neu.md", hash: "h1", groesse: 5 }],
    index: {},
    entfernt: [{ key: "obsidian/notes/neu.md", size: 7 }],
    remoteStand: {},
  });
  assert.deepEqual(nieGesehen.hochladen, []);
  assert.equal(nieGesehen.remoteAbweichung.length, 1);

  const bekannt = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: "ok.md", hash: "h-neu", groesse: 5 }],
    index: { "ok.md": "h-alt" },
    entfernt: [{ key: "obsidian/notes/ok.md", size: 7 }],
    remoteStand: { "ok.md": { size: 7 } },
  });
  assert.deepEqual(bekannt.hochladen.map((d) => d.pfad), ["ok.md"]);
  assert.deepEqual(bekannt.remoteAbweichung, []);

  const ohneRemote = planeOrdnerSync({
    listingVollstaendig: true,
    dateien: [{ pfad: "frisch.md", hash: "h1", groesse: 5 }],
    index: {},
    entfernt: [],
  });
  assert.deepEqual(ohneRemote.hochladen.map((d) => d.pfad), ["frisch.md"]);
});

// Nacharbeit K7: ueberlappende Laeufe und case-insensitive Dateisysteme.
test("laufStarten verhindert ueberlappende Laeufe", () => {
  const zustand = {};
  assert.equal(laufStarten(zustand), true);
  assert.equal(laufStarten(zustand), false);
  laufBeenden(zustand);
  assert.equal(laufStarten(zustand), true);
});

// Gate-Runde 2, Q2: laufend ist transienter Zustand. Ein aus data.json
// geladenes laufend:true (Absturz mitten im Lauf) darf den naechsten Lauf
// nicht fuer immer blockieren.
test("persistiertes laufend-Flag blockiert keinen neuen Lauf", () => {
  const geladen = JSON.parse('{"laufend":true,"warteschlange":[]}');
  assert.equal(laufStarten(geladen), true);
  assert.equal(laufStarten(geladen), false);
  laufBeenden(geladen);
  assert.equal(laufStarten(geladen), true);
});

test("existiert wird case-insensitiv befragt (APFS)", () => {
  const e = eingehendeNotiz({
    relpfad: "README.md",
    remoteText: "Remote",
    lokalText: null,
    existiert: (p) => p === "readme.md",
  });
  assert.equal(e.aktion, "konflikt", "readme.md belegt den Namen auf APFS");
});

// Nacharbeit S1: eingehendeNotiz verlaesst sich nicht darauf, dass der
// Aufrufer nur gueltige Pfade liefert, sondern prueft selbst mit derselben
// Segmentpruefung wie keyAusRelpfad. Auch der erzeugte Konflikt-Zielpfad
// wird vor Rueckgabe gegen die Pruefung gehalten.
test("eingehendeNotiz lehnt ungueltige Relpfade selbst ab", () => {
  const faelle = [
    "../../.obsidian/plugins/x/main.js",
    "/etc/passwd.md",
    ".obsidian/plugins/x/main.js",
    "notes/skript.js",
  ];
  for (const relpfad of faelle) {
    const e = eingehendeNotiz({ relpfad, remoteText: "x", lokalText: null, existiert: () => false });
    assert.equal(e.aktion, "abgelehnt", relpfad);
    assert.equal(e.grund, "ungueltiger-pfad", relpfad);
  }
});

// Haertung (Finding Namenssuche): eine werfende Probe heisst BELEGT, nie
// frei. Sonst koennte die Konfliktkopie einen vergebenen Namen treffen und
// ihn ueberschreiben. Bleibt die Lage unbestaetigt (Wurf) oder ist die
// Suchgrenze erschoepft, traegt das Ergebnis bestaetigungErforderlich und
// der Schreibpfad MUSS exklusiv anlegen (vault.create wirft bei Existenz).
test("werfende Probe fuehrt zum naechsten Kandidaten statt zur Wiederverwendung", () => {
  const e = eingehendeNotiz({
    relpfad: "Ideen/heikel.md",
    remoteText: "Remote",
    lokalText: "Lokal",
    existiert: (p) => {
      if (p === "Ideen/heikel.md") return true;
      if (p === "Ideen/heikel (Konflikt).md") throw new Error("Probe kaputt");
      return false;
    },
  });
  assert.equal(e.aktion, "konflikt");
  assert.notEqual(e.zielPfad, "Ideen/heikel (Konflikt).md");
  assert.equal(e.zielPfad, "Ideen/heikel (Konflikt 2).md");
  assert.equal(e.bestaetigungErforderlich, true);
});

test("durchgehend werfende Probe liefert bestaetigungErforderlich", () => {
  const e = eingehendeNotiz({
    relpfad: "Ideen/blind.md",
    remoteText: "Remote",
    lokalText: "Lokal",
    existiert: (p) => {
      if (p === "Ideen/blind.md") return true;
      throw new Error("Adapter blind");
    },
  });
  assert.equal(e.aktion, "konflikt");
  assert.equal(e.bestaetigungErforderlich, true);
});

test("erschoepfte Suchgrenze ergibt bestaetigungErforderlich mit unerprobtem Kandidaten", () => {
  let proben = 0;
  const e = eingehendeNotiz({
    relpfad: "Ideen/uebervoll.md",
    remoteText: "Remote",
    lokalText: "Lokal",
    existiert: () => {
      proben += 1;
      return true;
    },
  });
  assert.equal(e.aktion, "konflikt");
  assert.equal(e.bestaetigungErforderlich, true);
  assert.equal(e.zielPfad, "Ideen/uebervoll (Konflikt 101).md");
  assert.ok(proben <= 102, `Suchgrenze verletzt: ${proben} Proben`);
});

test("aktion konflikt liefert bei ehrlicher Probe nie einen belegten Zielpfad", () => {
  const belegt = new Set(["Ideen/voll.md", "Ideen/voll (Konflikt).md", "Ideen/voll (Konflikt 2).md"]);
  const e = eingehendeNotiz({
    relpfad: "Ideen/voll.md",
    remoteText: "Remote",
    lokalText: "Lokal",
    existiert: (p) => belegt.has(p),
  });
  assert.equal(e.aktion, "konflikt");
  assert.ok(!belegt.has(e.zielPfad), e.zielPfad);
  assert.equal(e.bestaetigungErforderlich, false);
});

test("eingehendeNotiz verlangt existiert als Funktion", () => {
  assert.throws(
    () => eingehendeNotiz({ relpfad: "a.md", remoteText: "x", lokalText: null }),
    { name: "UnitedShareError", message: /braucht existiert/ }
  );
});

test("indexNachSync uebernimmt die hochgeladenen Staende und vergisst nichts anderes", () => {
  const neu = indexNachSync({ "a.md": "h1" }, [{ pfad: "b.md", hash: "h2" }]);
  assert.equal(neu["a.md"], "h1");
  assert.equal(neu["b.md"], "h2");
  assert.equal(Object.keys(neu).length, 2);
});

// Nacharbeit S7: der Index wird aus den Plugin-Daten geladen und ist damit
// deserialisierte Fremdeingabe. Prototype-Schluessel duerfen weder
// uebernommen werden noch das Ergebnisobjekt vergiften.
test("indexNachSync ist gegen Prototype Pollution gefeit", () => {
  const giftig = JSON.parse('{"__proto__":"boese","constructor":"x","prototype":"y","echt.md":"h1"}');
  const neu = indexNachSync(giftig, [
    { pfad: "__proto__", hash: "boese2" },
    { pfad: "neu.md", hash: "h2" },
  ]);
  assert.equal(neu["echt.md"], "h1");
  assert.equal(neu["neu.md"], "h2");
  assert.equal(Object.keys(neu).sort().join(","), "echt.md,neu.md");
  assert.equal(Object.getPrototypeOf(neu), null);
  assert.equal({}.boese, undefined);
});
