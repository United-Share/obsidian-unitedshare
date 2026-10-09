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

// Bildet das gefixte requestUrlAsFetch aus main.src.js nach: Content-Length wird
// case-insensitiv entfernt, bevor der native requestUrl-Ersatz (hier fetch)
// ihn zu sehen bekommt. "nativ" steht fuer Capacitors requestUrl auf Mobile,
// das bei gesetztem Content-Length wirft -- diese Haerte simuliert der Server
// ueber capacitorNativ() im Content-Length-Regressionstest.
function requestUrlWieObsidian(nativ = fetch) {
  return async (url, init) => {
    const headers = {};
    const given = (init && init.headers) || {};
    for (const key of Object.keys(given)) {
      if (key.toLowerCase() === "content-length") continue;
      headers[key] = given[key];
    }
    const r = await nativ(url, { method: init.method, headers, body: init.body });
    const text = await r.text();
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  };
}

// Simuliert Capacitors native HTTP-Schicht auf Mobile: ein gesetzter
// Content-Length-Header ist verboten und laesst den Request werfen.
function capacitorNativ(url, opts) {
  const headers = opts.headers || {};
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-length") {
      throw new TypeError("Failed to construct 'Request': Content-Length is a forbidden header name");
    }
  }
  return fetch(url, opts);
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

async function frage(port, fetchImpl = requestUrlWieObsidian()) {
  return completeMessages({
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "usk_test",
    model: "m",
    system: "",
    turns: [{ role: "user", content: "Sag ok" }],
    timeoutMs: 5000,
    live: false,
    fetchImpl,
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

test("ein 401 heisst 'Key abgelehnt', nicht 'nicht erreichbar'", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid api key" } }));
  });
  try {
    await assert.rejects(frage(port), (err) => {
      assert.ok(err instanceof UnitedShareError);
      assert.equal(err.status, 401);
      assert.match(err.message, /API-Key wurde abgelehnt/);
      assert.doesNotMatch(err.message, /nicht erreichbar/);
      return true;
    });
  } finally {
    server.close();
  }
});

test("Content-Length wirft nicht auf simuliertem Capacitor-Mobile", async () => {
  // Regression: jsonPostHeaders setzt immer Content-Length. Ungefiltert wirft
  // Capacitors natives requestUrl -> frueher als "nicht erreichbar" fehlgedeutet.
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] }));
  });
  try {
    assert.equal(await frage(port, requestUrlWieObsidian(capacitorNativ)), "ok");
  } finally {
    server.close();
  }
});

test("ein 401 wirft auch auf simuliertem Capacitor-Mobile korrekt", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "invalid api key" } }));
  });
  try {
    await assert.rejects(frage(port, requestUrlWieObsidian(capacitorNativ)), (err) => {
      assert.ok(err instanceof UnitedShareError);
      assert.match(err.message, /API-Key wurde abgelehnt/);
      assert.doesNotMatch(err.message, /nicht erreichbar/);
      return true;
    });
  } finally {
    server.close();
  }
});
