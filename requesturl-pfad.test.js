"use strict";

// Verträge für den requestUrl-Pfad (live=false) -- gegen einen echten Server.
//
// ANLASS (2026-10-09): Seit der Gateway /v1/messages als SSE ausliefert, meldete
// das Plugin auf Obsidian Mobil "api.unitedshare.ai ist nicht erreichbar.",
// obwohl API, Key und Modell funktionierten. Ursache: requestUrl liefert den
// Körper am Stück und ohne body-Strom; readVisible rief response.json() auf
// den event-stream, der SyntaxError landete in mapTransportError.
//
// Der Ersatz für requestUrl bildet Obsidian nach: text ist der Rohtext, json
// parst ihn und wirft auf allem, was kein JSON ist.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { completeMessages, UnitedShareError } = require("./unitedshare-core");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => fertig({ server, port: server.address().port }));
  });
}

// Wie requestUrlAsFetch in main.src.js, mit Obsidians requestUrl darunter.
function requestUrlWieObsidian() {
  return async (url, init) => {
    const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
    const text = await r.text();
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
}

function sse(stuecke) {
  const z = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"m","content":[]}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  ];
  for (const s of stuecke) {
    z.push(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: s } })}`);
  }
  z.push('event: message_stop\ndata: {"type":"message_stop"}');
  return z.join("\n\n") + "\n\n";
}

async function frage(port) {
  return completeMessages({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "usk_test",
    model: "m",
    system: "",
    turns: [{ role: "user", content: "Sag ok" }],
    timeoutMs: 5000,
    live: false,
    fetchImpl: requestUrlWieObsidian(),
  });
}

test("requestUrl-Pfad liest eine SSE-Antwort am Stück", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(sse(["o", "k"]));
  });
  try {
    assert.equal(await frage(port), "ok");
  } finally {
    server.close();
  }
});

test("requestUrl-Pfad liest weiterhin einen fertigen JSON-Körper", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] }));
  });
  try {
    assert.equal(await frage(port), "ok");
  } finally {
    server.close();
  }
});

test("unlesbare Antwort heißt nicht 'nicht erreichbar'", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("kein json, kein sse");
  });
  try {
    await assert.rejects(frage(port), (err) => {
      assert.ok(err instanceof UnitedShareError);
      assert.doesNotMatch(err.message, /nicht erreichbar/);
      return true;
    });
  } finally {
    server.close();
  }
});

test("ein echter Netzfehler bleibt 'nicht erreichbar'", async () => {
  const { server, port } = await listen(() => {});
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(frage(port), /nicht erreichbar/);
});
