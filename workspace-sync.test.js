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
  basisPruefen,
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

// Nacharbeit K1: nach ERSTELLT plus Kennung benannt, wie das Hausmuster
// chatDateiname. Der Name muss ueber alle Speichervorgaenge derselbe
// bleiben (sonst waechst der Workspace bei jeder Antwort um ein Objekt),
// zwei Chats gleichen Titels duerfen nie kollidieren, und die Endung ist
// .json, weil der Inhalt JSON ist.
test("chatKey ist stabil ueber Speichervorgaenge und kollisionsfrei", () => {
  const a = { title: "Planung", erstellt: "2026-11-17T09:15:00Z", id: "abc123", messages: [{ role: "user", content: "x" }] };
  const b = { title: "Planung", erstellt: "2026-11-17T11:40:00Z", id: "zzz999", messages: [{ role: "user", content: "y" }] };
  assert.equal(chatKey(a), chatKey(a));
  assert.equal(chatKey(a), "obsidian/chats/2026-11-17-0915-abc123-planung.json");
  assert.notEqual(chatKey(a), chatKey(b));
  assert.ok(chatKey(b).endsWith(".json"));
});

test("chatKey vertraegt Date, Millisekunden und Muell als erstellt", () => {
  const alsDate = { title: "T", erstellt: new Date(Date.UTC(2026, 10, 17, 9, 15)), id: "d1", messages: [{}] };
  assert.ok(chatKey(alsDate).startsWith("obsidian/chats/2026-11-17-0915-d1-"));
  const alsMs = { title: "T", erstellt: Date.UTC(2026, 10, 17, 9, 15), id: "m1", messages: [{}] };
  assert.ok(chatKey(alsMs).startsWith("obsidian/chats/2026-11-17-0915-m1-"));
  const muell = { title: "T", erstellt: "kein datum", id: "x!/..y", messages: [{}] };
  assert.ok(chatKey(muell).startsWith("obsidian/chats/1970-01-01-0000-xy-"));
});

test("chatKey deckelt den Titel-Slug auf 80 Zeichen", () => {
  const lang = { title: "w".repeat(200), erstellt: "2026-11-17T00:00:00Z", id: "l1", messages: [{}] };
  const slugTeil = chatKey(lang).split("-l1-")[1];
  assert.equal(slugTeil, "w".repeat(80) + ".json");
});

test("chatSpiegeln spiegelt leere Chats nicht", async () => {
  let treffer = 0;
  const e = await chatSpiegeln(
    {
      settings: { apiKey: "usk_test_1", baseUrl: "https://api.unitedshare.ai/v1" },
      fetchImpl: async () => {
        treffer += 1;
        throw new Error("darf nicht passieren");
      },
    },
    { title: "Leer", erstellt: "2026-11-17T00:00:00Z", id: "e1", messages: [] },
    { warteschlange: [] }
  );
  assert.equal(e.ergebnis, "leer");
  assert.equal(treffer, 0);
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

// Nacharbeit S4: Antworten des Gateways sind Netz-Eingabe. Content-Length
// wird vorab geprueft, nach dem Lesen wird erneut gemessen (fail-closed),
// NUL-Inhalte und unlesbares JSON werden verworfen statt durchgereicht.
function fakeAntwort({ status = 200, body = "", jsonWert, contentLength } = {}) {
  return {
    status,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === "content-length"
          ? (contentLength ?? String(Buffer.byteLength(body, "utf8")))
          : null,
    },
    text: async () => body,
    json: async () => {
      if (jsonWert !== undefined) return jsonWert;
      return JSON.parse(body);
    },
  };
}

test("objekteListen verwirft kaputtes oder leeres JSON als unlesbar", async () => {
  const kaputt = await objekteListen(
    { baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", fetchImpl: async () => fakeAntwort({ body: "{kaputt" }) },
    CHATS_PRAEFIX
  );
  assert.equal(kaputt.status, 200);
  assert.deepEqual(kaputt.items, []);
  assert.equal(kaputt.grund, "unlesbar");

  const nullwert = await objekteListen(
    { baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", fetchImpl: async () => fakeAntwort({ jsonWert: null }) },
    CHATS_PRAEFIX
  );
  assert.deepEqual(nullwert.items, []);
  assert.equal(nullwert.grund, "unlesbar");

  const leer = await objekteListen(
    { baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", fetchImpl: async () => fakeAntwort({ body: '{"bucket":"b","items":[]}' }) },
    CHATS_PRAEFIX
  );
  assert.deepEqual(leer.items, []);
  assert.equal(leer.grund, undefined);
});

test("objektLesen verwirft Riesen-Inhalte und NUL-Bytes fail-closed", async () => {
  const angekuendigt = await objektLesen(
    {
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "k",
      fetchImpl: async () => fakeAntwort({ body: "klein", contentLength: String(MAX_OBJEKT_BYTES + 1) }),
    },
    "obsidian/chats/a.json"
  );
  assert.equal(angekuendigt.text, null);
  assert.equal(angekuendigt.grund, "zu-gross");

  const gelogen = await objektLesen(
    {
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "k",
      fetchImpl: async () => fakeAntwort({ body: "x".repeat(MAX_OBJEKT_BYTES + 1), contentLength: "5" }),
    },
    "obsidian/chats/a.json"
  );
  assert.equal(gelogen.text, null);
  assert.equal(gelogen.grund, "zu-gross");

  const nul = await objektLesen(
    { baseUrl: "http://127.0.0.1:1/v1", apiKey: "k", fetchImpl: async () => fakeAntwort({ body: "ok\u0000boese" }) },
    "obsidian/chats/a.json"
  );
  assert.equal(nul.text, null);
  assert.equal(nul.grund, "unlesbar");
});

// S4-Nachtrag: Content-Length wird strikt geparst; ein nicht-dezimaler
// oder mehrwertiger Header ist FEINDLICH und wird abgelehnt, nicht wie ein
// fehlender behandelt. Und das Listing bekommt dieselbe Groessen-Schranke
// wie das Objekt-Lesen plus einen Item-Deckel.
test("feindliche Content-Length-Header werden abgelehnt statt ignoriert", async () => {
  const faelle = [
    { contentLength: "abc", grund: "unlesbar" },
    { contentLength: "1,2", grund: "unlesbar" },
    { contentLength: ` ${MAX_OBJEKT_BYTES + 1} `, grund: "zu-gross" },
  ];
  for (const fall of faelle) {
    const e = await objektLesen(
      {
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "k",
        fetchImpl: async () => fakeAntwort({ body: "klein", contentLength: fall.contentLength }),
      },
      "obsidian/chats/a.json"
    );
    assert.equal(e.text, null, fall.contentLength);
    assert.equal(e.grund, fall.grund, fall.contentLength);
  }
});

test("objekteListen deckelt Body-Groesse und Item-Anzahl", async () => {
  const riesig = await objekteListen(
    {
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "k",
      fetchImpl: async () => {
        const body = "x".repeat(MAX_OBJEKT_BYTES + 1);
        return { status: 200, headers: { get: () => null }, text: async () => body };
      },
    },
    CHATS_PRAEFIX
  );
  assert.deepEqual(riesig.items, []);
  assert.equal(riesig.grund, "zu-gross");

  const viele = {
    bucket: "b",
    items: Array.from({ length: 501 }, (_x, i) => ({ key: `obsidian/chats/${i}.json`, size: 1 })),
  };
  const gedeckelt = await objekteListen(
    {
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "k",
      fetchImpl: async () => fakeAntwort({ body: JSON.stringify(viele) }),
    },
    CHATS_PRAEFIX
  );
  assert.equal(gedeckelt.items.length, 500);
  assert.equal(gedeckelt.grund, "gedeckelt");
});

// Nacharbeit S5: Body-Messung typfest nach dem utf8ByteLength-Hausmuster.
// Alles ohne messbare Groesse wird fail-closed abgelehnt, bevor ein Request
// entsteht; der Bundler-Buffer-Stub hat kein byteLength.
test("objektSchreiben misst auch Binaer-Bodies und lehnt Unmessbares ab", async () => {
  let treffer = 0;
  const ctx = {
    baseUrl: "http://127.0.0.1:1/v1",
    apiKey: "k",
    fetchImpl: async () => {
      treffer += 1;
      throw new Error("darf nicht passieren");
    },
  };
  const riesig = await objektSchreiben(ctx, "obsidian/chats/a.json", new ArrayBuffer(32 * 1024 * 1024));
  assert.equal(riesig.ok, false);
  assert.equal(riesig.grund, "zu-gross");

  const objekt = await objektSchreiben(ctx, "obsidian/chats/a.json", { nicht: "messbar" });
  assert.equal(objekt.ok, false);
  assert.equal(objekt.grund, "unmessbar");

  const params = await objektSchreiben(ctx, "obsidian/chats/a.json", new URLSearchParams("a=1"));
  assert.equal(params.ok, false);
  assert.equal(params.grund, "unmessbar");

  assert.equal(treffer, 0);
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

// Nacharbeit S3: Basis-URL und apiKey sind Settings und damit beeinflussbar.
// Nur https (Ausnahme loopback fuer Tests), keine Zugangsdaten, kein Hash
// und kein Query in der Basis; der Key muss nach dem Trimmen dem
// usk-Alphabet entsprechen. Bei Verstoss verlaesst kein Request das Geraet.
test("chatSpiegeln lehnt unsichere Basis-URLs ohne Request ab", async () => {
  const faelle = [
    "http://api.unitedshare.ai/v1",
    "ftp://api.unitedshare.ai/v1",
    "https://api.unitedshare.ai/v1#frag",
    "https://api.unitedshare.ai/v1?x=1",
    "https://user:pw@api.unitedshare.ai/v1",
    "",
  ];
  for (const baseUrl of faelle) {
    let treffer = 0;
    const e = await chatSpiegeln(
      {
        settings: { apiKey: "usk_test_1", baseUrl },
        fetchImpl: async () => {
          treffer += 1;
          throw new Error("darf nicht passieren");
        },
      },
      { title: "T", erstellt: "2026-11-17T10:00:00Z", id: "c1", messages: [{ role: "user", content: "x" }] },
      { warteschlange: [] }
    );
    assert.equal(e.ergebnis, "keine-basis", baseUrl);
    assert.equal(treffer, 0, baseUrl);
  }
});

// S3-Nachtrag: Host-Pinning. Solange es keine kundeneigenen Gateways gibt,
// ist jede fremde Basis ein Exfiltrationsvektor fuer Key und Inhalte; die
// fruehere Erlaubnis beliebiger https-Hosts ist revidiert. Die
// Loopback-Ausnahme gilt nur numerisch (127.0.0.1, [::1]) und nur, wenn
// der Aufrufer sie explizit freischaltet; localhost loest auf und bleibt
// deshalb immer verboten.
test("basisPruefen pinnt den Host auf api.unitedshare.ai", () => {
  assert.equal(basisPruefen("https://api.unitedshare.ai/v1"), "https://api.unitedshare.ai/v1");
  assert.equal(basisPruefen("https://angreifer.example/v1"), null);
  assert.equal(basisPruefen("https://api.unitedshare.ai.angreifer.example/v1"), null);
});

test("basisPruefen erlaubt Loopback nur numerisch und nur mit Freischaltung", () => {
  assert.equal(basisPruefen("http://127.0.0.1:9/v1", { erlaubeLoopback: true }), "http://127.0.0.1:9/v1");
  assert.equal(basisPruefen("http://[::1]:9/v1", { erlaubeLoopback: true }), "http://[::1]:9/v1");
  assert.equal(basisPruefen("http://127.0.0.1:9/v1"), null);
  assert.equal(basisPruefen("http://localhost:9/v1", { erlaubeLoopback: true }), null);
  assert.equal(basisPruefen("http://localhost:9/v1"), null);
});

test("chatSpiegeln lehnt fremde https-Hosts ab", async () => {
  let treffer = 0;
  const e = await chatSpiegeln(
    {
      settings: { apiKey: "usk_test_1", baseUrl: "https://andere.example/v1" },
      fetchImpl: async () => {
        treffer += 1;
        throw new Error("darf nicht passieren");
      },
    },
    { title: "T", erstellt: "2026-11-17T10:00:00Z", id: "c1", messages: [{ role: "user", content: "x" }] },
    { warteschlange: [] }
  );
  assert.equal(e.ergebnis, "keine-basis");
  assert.equal(treffer, 0);
});

test("chatSpiegeln lehnt unbrauchbare apiKeys ohne Request ab", async () => {
  for (const apiKey of [" ", "usk\r\nX-Injekt: 1", "usk test", "usk,komma"]) {
    let treffer = 0;
    const e = await chatSpiegeln(
      {
        settings: { apiKey, baseUrl: "https://api.unitedshare.ai/v1" },
        fetchImpl: async () => {
          treffer += 1;
          throw new Error("darf nicht passieren");
        },
      },
      { title: "T", erstellt: "2026-11-17T10:00:00Z", id: "c1", messages: [{ role: "user", content: "x" }] },
      { warteschlange: [] }
    );
    assert.equal(e.ergebnis, "kein-schluessel", JSON.stringify(apiKey));
    assert.equal(treffer, 0);
  }
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
      erlaubeLoopback: true,
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
      erlaubeLoopback: true,
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

// Nacharbeit S2: das Listing kommt vom Netz und ist damit fremde Eingabe.
// Keys werden mit derselben Segmentpruefung wie im Ordner-Sync gefiltert;
// der lokale Dateiname wird ohnehin NIE aus dem Remote-Key abgeleitet.
test("wiederherstellbareChats verwirft Angriffs-Keys aus dem Listing", () => {
  const items = [
    { key: "obsidian/chats/../geheim.json", size: 1 },
    { key: "obsidian/chats/.versteckt.json", size: 2 },
    { key: "obsidian/chats/a:b.json", size: 3 },
    { key: "obsidian/chats/evil.js", size: 4 },
    { key: "obsidian/chats/2026-11-17-1200-abc.json", size: 5 },
    { key: "obsidian/chats/2026-11-15-alt.md", size: 6 },
  ];
  assert.deepEqual(wiederherstellbareChats(items), [
    "obsidian/chats/2026-11-15-alt.md",
    "obsidian/chats/2026-11-17-1200-abc.json",
  ]);
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
