"use strict";

// Verträge für die Gesprächsablage in <Tresor>/.vault/chats.
//
// ANLASS: Der Verlauf lebte nur im Arbeitsspeicher (this.history). Beim
// Schließen von Obsidian war er weg, und ein angefangenes Gespräch ließ sich
// nicht weiterführen.
//
// WARUM JSON UND NICHT MARKDOWN: Eine Antwort kann selbst Frontmatter und
// verschachtelte Codeblöcke enthalten — in der Notiz zu DIDNS stand genau
// das: "---\ntitle: DIDNS" innerhalb eines ```-Blocks. Jeder Markdown-Trenner
// wäre damit mehrdeutig, und ein Verlauf, der sich nicht verlustfrei
// zurücklesen lässt, ist wertlos. Der Ordner ist versteckt, also liest ihn
// ohnehin kein Obsidian, sondern ein Editor oder jq.
//
// WARUM DIE ADAPTER-API: Die Obsidian-Dokumentation ist dazu eindeutig —
// "The Vault API only allows access to the files visible inside the app,
// files included in hidden folders can only be accessed using the Adapter
// API." Für .vault/chats ist der Adapter also nicht eine Möglichkeit unter
// mehreren, sondern der einzige Weg.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHAT_ORDNER,
  chatAusText,
  chatAlsText,
  chatDateiname,
  chatsLaden,
  chatSpeichern,
} = require("./unitedshare-core");

// Ein Adapter wie Obsidian ihn liefert: list() gibt {files, folders}, nicht
// ein Array. Das steht so in der Dokumentation (ListedFiles) und ist eine
// beliebte Fehlerquelle.
function falscherAdapter(dateien = {}) {
  const inhalt = new Map(Object.entries(dateien));
  const geschrieben = [];
  const angelegt = [];
  return {
    inhalt,
    geschrieben,
    angelegt,
    async exists(pfad) {
      if (inhalt.has(pfad)) return true;
      for (const schluessel of inhalt.keys()) {
        if (schluessel.startsWith(`${pfad}/`)) return true;
      }
      return angelegt.includes(pfad);
    },
    async mkdir(pfad) {
      angelegt.push(pfad);
    },
    async write(pfad, daten) {
      inhalt.set(pfad, daten);
      geschrieben.push(pfad);
    },
    async read(pfad) {
      if (!inhalt.has(pfad)) throw new Error(`nicht da: ${pfad}`);
      return inhalt.get(pfad);
    },
    async list(pfad) {
      const praefix = pfad ? `${pfad}/` : "";
      const files = [];
      for (const schluessel of inhalt.keys()) {
        if (schluessel.startsWith(praefix) && !schluessel.slice(praefix.length).includes("/")) {
          files.push(schluessel);
        }
      }
      return { files, folders: [] };
    },
    async stat(pfad) {
      return inhalt.has(pfad) ? { type: "file", mtime: 1000, size: 1 } : null;
    },
  };
}

function eintrag(zusatz = {}) {
  return Object.assign(
    {
      id: "a3f9c1",
      titel: "Wie viel Uhr ist es?",
      erstellt: "2026-10-09T12:23:00.000Z",
      geaendert: "2026-10-09T12:24:00.000Z",
      messages: [
        { role: "user", content: "Wie viel Uhr ist es?" },
        { role: "assistant", content: "Es ist 14:23 Uhr." },
      ],
    },
    zusatz,
  );
}

// ---------------------------------------------------------------- Rundreise

test("ein Gespräch übersteht Schreiben und Lesen unverändert", () => {
  const vorher = eintrag();
  assert.deepEqual(chatAusText(chatAlsText(vorher)), vorher);
});

test("Frontmatter und verschachtelte Codeblöcke überleben", () => {
  // Genau der Inhalt, an dem ein Markdown-Format zerbrochen wäre.
  const heikel = [
    "Hier die Notiz:",
    "",
    "````markdown",
    "---",
    "title: DIDNS",
    "tags:",
    "  - netz/dienst",
    "---",
    "",
    "```text",
    "did:dns:example.com",
    "```",
    "````",
  ].join("\n");
  const vorher = eintrag({
    messages: [{ role: "assistant", content: heikel }],
  });
  const nachher = chatAusText(chatAlsText(vorher));
  assert.equal(nachher.messages[0].content, heikel);
});

test("Anhänge bleiben erhalten", () => {
  const vorher = eintrag({
    messages: [
      { role: "user", content: "Lies das", files: [{ path: "a.md", text: "x" }] },
    ],
  });
  assert.deepEqual(chatAusText(chatAlsText(vorher)), vorher);
});

test("kaputter Text ergibt null statt eines Absturzes", () => {
  for (const müll of ["", "{", "null", "[]", '{"messages":"nein"}', "kein json"]) {
    assert.equal(chatAusText(müll), null, JSON.stringify(müll));
  }
});

// --------------------------------------------------------------- Dateiname

test("der Dateiname bleibt über mehrere Speichervorgänge gleich", () => {
  const a = eintrag();
  const b = eintrag({ geaendert: "2026-10-09T18:00:00.000Z", titel: "anders" });
  assert.equal(chatDateiname(a), chatDateiname(b),
    "derselbe Chat muss dieselbe Datei treffen, sonst wächst der Ordner bei jeder Antwort");
});

test("der Dateiname trägt Datum und Kennung", () => {
  assert.match(chatDateiname(eintrag()), /^2026-10-09-\d{4}-a3f9c1\.json$/);
});

test("eine fremde Kennung kann den Pfad nicht verlassen", () => {
  for (const böse of ["../../etc/passwd", "a/b", "a\\b", ".", "..", ""]) {
    const name = chatDateiname(eintrag({ id: böse }));
    assert.ok(!name.includes("/"), `Schrägstrich in ${JSON.stringify(name)}`);
    assert.ok(!name.includes(".."), `Aufstieg in ${JSON.stringify(name)}`);
    assert.match(name, /\.json$/);
  }
});

// --------------------------------------------------------------- Speichern

test("Speichern legt den Ordner an und schreibt in .vault/chats", async () => {
  const adapter = falscherAdapter();
  await chatSpeichern(adapter, eintrag());
  assert.equal(adapter.geschrieben.length, 1);
  assert.ok(adapter.geschrieben[0].startsWith(`${CHAT_ORDNER}/`),
    `schreibt nach ${adapter.geschrieben[0]}`);
  assert.ok(adapter.angelegt.includes(CHAT_ORDNER), "Ordner muss angelegt werden");
});

test("zweimal Speichern ergibt eine Datei, nicht zwei", async () => {
  const adapter = falscherAdapter();
  await chatSpeichern(adapter, eintrag());
  await chatSpeichern(adapter, eintrag({ geaendert: "2026-10-09T18:00:00.000Z" }));
  assert.equal(adapter.inhalt.size, 1);
});

test("ein leeres Gespräch wird nicht gespeichert", async () => {
  const adapter = falscherAdapter();
  await chatSpeichern(adapter, eintrag({ messages: [] }));
  assert.equal(adapter.geschrieben.length, 0, "leere Dateien sind nur Müll im Ordner");
});

// ------------------------------------------------------------------- Laden

test("Laden gibt die Gespräche neueste zuerst", async () => {
  const adapter = falscherAdapter();
  for (const [id, zeit] of [["alt", "2026-10-01T10:00:00.000Z"],
                            ["neu", "2026-10-09T10:00:00.000Z"],
                            ["mittel", "2026-10-05T10:00:00.000Z"]]) {
    await chatSpeichern(adapter, eintrag({ id, geaendert: zeit }));
  }
  const geladen = await chatsLaden(adapter);
  assert.deepEqual(geladen.map((e) => e.id), ["neu", "mittel", "alt"]);
});

test("Laden ohne Ordner ergibt eine leere Liste, keinen Fehler", async () => {
  // Nicht deepEqual gegen []: die Liste trägt immer ein Feld uebergangen,
  // damit eine Kappung nie still bleibt. Ein Array mit Zusatzfeld ist nicht
  // deepStrictEqual zu [] — geprüft wird deshalb, was wirklich zählt.
  const geladen = await chatsLaden(falscherAdapter());
  assert.equal(geladen.length, 0);
  assert.equal(geladen.uebergangen, 0);
});

test("eine kaputte Datei lässt die übrigen stehen", async () => {
  const adapter = falscherAdapter();
  await chatSpeichern(adapter, eintrag({ id: "gut" }));
  adapter.inhalt.set(`${CHAT_ORDNER}/2026-10-09-1200-kaputt.json`, "{kein json");
  const geladen = await chatsLaden(adapter);
  assert.equal(geladen.length, 1);
  assert.equal(geladen[0].id, "gut");
});

test("fremde Dateien im Ordner werden übergangen", async () => {
  const adapter = falscherAdapter();
  await chatSpeichern(adapter, eintrag({ id: "gut" }));
  adapter.inhalt.set(`${CHAT_ORDNER}/.DS_Store`, "binär");
  adapter.inhalt.set(`${CHAT_ORDNER}/notiz.md`, "# hallo");
  const geladen = await chatsLaden(adapter);
  assert.equal(geladen.length, 1);
});

test("die Grenze kappt die Liste, und das Gekappte ist zählbar", async () => {
  const adapter = falscherAdapter();
  for (let i = 0; i < 12; i += 1) {
    await chatSpeichern(adapter, eintrag({
      id: `c${String(i).padStart(2, "0")}`,
      geaendert: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
    }));
  }
  const geladen = await chatsLaden(adapter, 5);
  assert.equal(geladen.length, 5);
  assert.equal(geladen.uebergangen, 7,
    "stille Kappung verschweigt dem Nutzer, dass ältere Gespräche da sind");
});
