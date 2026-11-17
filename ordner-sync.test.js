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
  assert.throws(() => eingehendeNotiz({ relpfad: "a.md", remoteText: "x", lokalText: null }), TypeError);
});

test("indexNachSync uebernimmt die hochgeladenen Staende und vergisst nichts anderes", () => {
  const neu = indexNachSync({ "a.md": "h1" }, [{ pfad: "b.md", hash: "h2" }]);
  assert.deepEqual(neu, { "a.md": "h1", "b.md": "h2" });
});
