"use strict";

// Verträge für den Tresor-Zugriff über die Obsidian-Adapter-API.
//
// ANLASS: Die Plugin-Prüfung meldet "Direct Filesystem Access: Uses the
// Node.js fs module to access the filesystem outside of the Obsidian vault
// API. Can read and write any file on the system."
//
// Der Vorwurf trifft zu: fsVaultHost liest, listet und schreibt über
// node:fs. Für Dateien im Tresor ist das unnötig — die Adapter-API kann
// dasselbe, und sie kann den Tresor gar nicht verlassen. Danach bleibt
// node:fs nur noch dort, wo ohnehin eine Shell startet (Ausführen, reemax
// suchen). Diese Warnung lässt sich nicht wegbauen, ohne die Funktion
// aufzugeben; der Dateizugriff schon.
//
// HEIKEL: fs.readdirSync liefert NAMEN ("notiz.md"), die Adapter-API liefert
// volle PFADE ("ordner/notiz.md"). Wer das übersieht, baut einen Fehler ein,
// den kein Typ und kein Linter zeigt — nur eine Liste, die plötzlich anders
// aussieht. Darum steht es hier als eigener Test.

const test = require("node:test");
const assert = require("node:assert/strict");

const { adapterVaultHost } = require("./unitedshare-core");

function falscherAdapter(dateien = {}, ordner = []) {
  const inhalt = new Map(Object.entries(dateien));
  return {
    inhalt,
    geschrieben: [],
    async exists(pfad) {
      return inhalt.has(pfad) || ordner.includes(pfad);
    },
    async read(pfad) {
      if (!inhalt.has(pfad)) throw new Error(`nicht da: ${pfad}`);
      return inhalt.get(pfad);
    },
    async write(pfad, daten) {
      inhalt.set(pfad, daten);
      this.geschrieben.push(pfad);
    },
    async mkdir(pfad) {
      ordner.push(pfad);
    },
    async list(pfad) {
      const praefix = pfad ? `${pfad}/` : "";
      const files = [];
      const folders = [];
      for (const schluessel of inhalt.keys()) {
        if (!schluessel.startsWith(praefix)) continue;
        const rest = schluessel.slice(praefix.length);
        if (!rest.includes("/")) files.push(schluessel);
      }
      for (const o of ordner) {
        if (o.startsWith(praefix) && !o.slice(praefix.length).includes("/")) folders.push(o);
      }
      return { files, folders };
    },
  };
}

test("list liefert Namen, nicht Pfade", async () => {
  // Die fs-Fassung gab readdirSync zurück, also blosse Namen. Wer auf
  // volle Pfade umstellt, bricht jeden Aufrufer — still.
  const host = adapterVaultHost(falscherAdapter({
    "notizen/eins.md": "a",
    "notizen/zwei.md": "b",
  }, ["notizen"]));
  const namen = await host.list("notizen");
  assert.deepEqual(namen.sort(), ["eins.md", "zwei.md"]);
});

test("list nennt auch Unterordner", async () => {
  const host = adapterVaultHost(falscherAdapter(
    { "a/datei.md": "x" },
    ["a", "a/unter"],
  ));
  const namen = await host.list("a");
  assert.ok(namen.includes("datei.md"));
  assert.ok(namen.includes("unter"));
});

test("list im Wurzelordner", async () => {
  const host = adapterVaultHost(falscherAdapter({ "oben.md": "x" }));
  assert.deepEqual(await host.list(""), ["oben.md"]);
});

test("read gibt den Inhalt", async () => {
  const host = adapterVaultHost(falscherAdapter({ ".vault/chats/a.json": "{}" }));
  assert.equal(await host.read(".vault/chats/a.json"), "{}");
});

test("read gibt null statt zu werfen, wenn nichts da ist", async () => {
  // Die fs-Fassung gab null zurueck (existsSync-Pruefung). Ein Wurf statt
  // null wuerde die Aufrufer anders laufen lassen.
  const host = adapterVaultHost(falscherAdapter());
  assert.equal(await host.read("fehlt.md"), null);
});

test("write legt fehlende Ordner an", async () => {
  const adapter = falscherAdapter();
  const host = adapterVaultHost(adapter);
  await host.write("tief/drin/datei.md", "inhalt");
  assert.equal(adapter.inhalt.get("tief/drin/datei.md"), "inhalt");
});

test("ohne Adapter gibt es keinen Host", () => {
  assert.equal(adapterVaultHost(null), null);
  assert.equal(adapterVaultHost(undefined), null);
});

test("ein Pfad kann den Tresor nicht verlassen", async () => {
  // Der Adapter arbeitet immer tresorrelativ. Anders als bei node:fs gibt es
  // hier keinen Weg nach draussen -- das ist der eigentliche Gewinn der
  // Umstellung und wird deshalb festgeschrieben.
  const adapter = falscherAdapter();
  const host = adapterVaultHost(adapter);
  await assert.rejects(() => host.write("../ausserhalb.md", "x"));
  await assert.rejects(() => host.write("/etc/passwd", "x"));
  assert.equal(adapter.geschrieben.length, 0);
});
