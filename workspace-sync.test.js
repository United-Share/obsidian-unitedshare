"use strict";

// Vertraege fuer das Chat-Backup in den persoenlichen Vault-Workspace.
//
// ANLASS: Chats leben in <Tresor>/.vault/chats und damit nur auf diesem
// Geraet. Das Gateway (api.unitedshare.ai/v1/workspace) bietet seit 11/2026
// einen identitaetsgebundenen Speicher: derselbe apiKey, der die Modellaufrufe
// macht, oeffnet auch den eigenen ws-Bucket. Dieses Modul spiegelt gespeicherte
// Chats dorthin und holt sie auf neuen Geraeten zurueck.
//
// WARUM KEIN NEUES CREDENTIAL: Der Workspace haengt an der Identitaet des
// usk-Keys. Ein zweites Secret im Plugin waere ein zweiter Leak-Kanal ohne
// Gewinn. Ohne apiKey wird schlicht nicht gespiegelt, niemals gefragt.
//
// WARUM EINE WARTESCHLANGE: Obsidian laeuft offline. Ein fehlgeschlagener
// Spiegel darf den lokalen Chat nie anfassen und muss beim naechsten
// erfolgreichen Speichern nachgeholt werden.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  CHATS_PRAEFIX,
  MAX_OBJEKT_BYTES,
  slugAusTitel,
  chatKey,
  urlFuerObjekt,
  urlFuerListe,
  objektSchreiben,
  objektLesen,
  objekteListen,
  chatSpiegeln,
  wiederherstellbareChats,
} = require("./workspace-sync");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => fertig({ server, port: server.address().port }));
  });
}

test("slugAusTitel normalisiert Umlaute und Sonderzeichen", () => {
  assert.equal(slugAusTitel("Projekt: Ö/Ä Test"), "projekt-test");
  assert.equal(slugAusTitel("  Café---Plan!  "), "caf-plan");
  assert.equal(slugAusTitel("+++"), "chat");
  assert.equal(slugAusTitel(""), "chat");
});

test("chatKey baut den Schluessel aus Datum und Titel", () => {
  const eintrag = { title: "Projektplanung Q1", messages: [{ role: "user", content: "x" }] };
  assert.equal(chatKey(eintrag, "2026-11-17"), "obsidian/chats/2026-11-17-projektplanung-q1.md");
  assert.equal(chatKey(eintrag, "2026-11-17T15:40:00Z"), "obsidian/chats/2026-11-17-projektplanung-q1.md");
  assert.ok(chatKey(eintrag, "2026-11-17").startsWith(CHATS_PRAEFIX));
});

test("urlFuerObjekt percent-encodiert den Key, urlFuerListe den Praefix", () => {
  assert.equal(
    urlFuerObjekt("https://api.unitedshare.ai/v1", "obsidian/chats/Café Plan.md"),
    "https://api.unitedshare.ai/v1/workspace/object?key=obsidian%2Fchats%2FCaf%C3%A9%20Plan.md"
  );
  assert.equal(
    urlFuerObjekt("https://api.unitedshare.ai/v1/", "a.md"),
    "https://api.unitedshare.ai/v1/workspace/object?key=a.md"
  );
  assert.equal(
    urlFuerListe("https://api.unitedshare.ai/v1", CHATS_PRAEFIX),
    "https://api.unitedshare.ai/v1/workspace/objects?prefix=obsidian%2Fchats%2F"
  );
  assert.equal(urlFuerListe("https://api.unitedshare.ai/v1"), "https://api.unitedshare.ai/v1/workspace/objects");
});

test("objektSchreiben, objektLesen und objekteListen sprechen das Gateway-Protokoll", async () => {
  const ablage = new Map();
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.headers.authorization !== "Bearer usk_test_1") {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"invalid_token"}');
    }
    const key = url.searchParams.get("key");
    if (req.method === "POST" && url.pathname === "/v1/workspace/object") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        ablage.set(key, body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ key, bytes: body.length }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/v1/workspace/object") {
      if (!ablage.has(key)) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end('{"error":"not_found"}');
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(ablage.get(key));
    }
    if (req.method === "GET" && url.pathname === "/v1/workspace/objects") {
      const items = [...ablage.entries()].map(([k, v]) => ({ key: k, size: v.length }));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ bucket: "ws-test", items }));
    }
    res.writeHead(404);
    res.end();
  });
  try {
    const ctx = { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "usk_test_1", fetchImpl: fetch };
    const w = await objektSchreiben(ctx, "obsidian/chats/2026-11-17-ä test.md", "Inhalt mit Ümlaut");
    assert.equal(w.status, 200);
    const r = await objektLesen(ctx, "obsidian/chats/2026-11-17-ä test.md");
    assert.equal(r.status, 200);
    assert.equal(r.text, "Inhalt mit Ümlaut");
    const fehlt = await objektLesen(ctx, "obsidian/chats/nix.md");
    assert.equal(fehlt.status, 404);
    assert.equal(fehlt.text, null);
    const liste = await objekteListen(ctx, CHATS_PRAEFIX);
    assert.equal(liste.status, 200);
    assert.equal(liste.items.length, 1);
    assert.equal(liste.items[0].key, "obsidian/chats/2026-11-17-ä test.md");
  } finally {
    server.close();
  }
});

// Haertung nach Security-Finding 3: die Byte-Grenze wird am tatsaechlichen
// Body durchgesetzt, nicht nur an Metadaten. Ein zu grosser Body verlaesst
// das Geraet gar nicht erst.
test("objektSchreiben lehnt einen Body ueber dem Gateway-Limit ohne Request ab", async () => {
  let treffer = 0;
  const ctx = {
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "usk_test_1",
    fetchImpl: async () => {
      treffer += 1;
      throw new Error("darf nicht passieren");
    },
  };
  const zuGross = "x".repeat(MAX_OBJEKT_BYTES + 1);
  const e = await objektSchreiben(ctx, "obsidian/chats/riesig.md", zuGross);
  assert.equal(e.ok, false);
  assert.equal(e.status, 413);
  assert.equal(e.grund, "zu-gross");
  assert.equal(treffer, 0);
});

test("chatSpiegeln ohne apiKey macht keinen Request und meldet sich in der Statusleiste", async () => {
  let treffer = 0;
  const hinweise = [];
  const ctx = {
    settings: { apiKey: "", baseUrl: "http://127.0.0.1:1/v1" },
    fetchImpl: async () => {
      treffer += 1;
      throw new Error("darf nicht passieren");
    },
    status: (text) => hinweise.push(text),
  };
  const zustand = { warteschlange: [] };
  const e = await chatSpiegeln(ctx, { title: "T", messages: [{ role: "user", content: "x" }] }, zustand);
  assert.equal(e.ergebnis, "kein-schluessel");
  assert.equal(treffer, 0);
  assert.equal(zustand.warteschlange.length, 0);
  assert.equal(hinweise.length, 1);
});

test("chatSpiegeln bei 401 schreibt ins Protokoll und stellt den Chat in die Warteschlange", async () => {
  const protokoll = [];
  const { server, port } = await listen((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end('{"error":"invalid_token"}');
  });
  try {
    const ctx = {
      settings: { apiKey: "usk_falsch", baseUrl: `http://127.0.0.1:${port}/v1` },
      fetchImpl: fetch,
      protokoll: (eintrag) => protokoll.push(eintrag),
    };
    const zustand = { warteschlange: [] };
    const e = await chatSpiegeln(ctx, { title: "Wichtig", messages: [{ role: "user", content: "x" }] }, zustand);
    assert.equal(e.ergebnis, "aufgeschoben");
    assert.equal(zustand.warteschlange.length, 1);
    assert.ok(zustand.warteschlange[0].key.startsWith(CHATS_PRAEFIX));
    assert.equal(protokoll.length, 1);
  } finally {
    server.close();
  }
});

test("chatSpiegeln holt die Warteschlange beim naechsten Erfolg nach", async () => {
  const ablage = new Map();
  const { server, port } = await listen((req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      ablage.set(url.searchParams.get("key"), body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"key":"x","bytes":1}');
    });
  });
  try {
    const ctx = {
      settings: { apiKey: "usk_test_1", baseUrl: `http://127.0.0.1:${port}/v1` },
      fetchImpl: fetch,
    };
    const zustand = { warteschlange: [{ key: "obsidian/chats/2026-11-16-alt.md", inhalt: "alter chat" }] };
    const e = await chatSpiegeln(ctx, { title: "Neu", messages: [{ role: "user", content: "y" }] }, zustand);
    assert.equal(e.ergebnis, "gespiegelt");
    assert.equal(e.nachgeholt, 1);
    assert.equal(zustand.warteschlange.length, 0);
    assert.equal(ablage.size, 2);
    assert.equal(ablage.get("obsidian/chats/2026-11-16-alt.md"), "alter chat");
  } finally {
    server.close();
  }
});

test("wiederherstellbareChats filtert auf den Chat-Praefix und sortiert", () => {
  const items = [
    { key: "obsidian/notes/a.md", size: 1 },
    { key: "obsidian/chats/2026-11-17-b.md", size: 2 },
    { key: "obsidian/chats/2026-11-15-a.md", size: 3 },
    { key: "anderes/x.md", size: 4 },
  ];
  assert.deepEqual(wiederherstellbareChats(items), [
    "obsidian/chats/2026-11-15-a.md",
    "obsidian/chats/2026-11-17-b.md",
  ]);
});
