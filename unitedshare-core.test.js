"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const { completeChat, chatCompletionsUrl, UnitedShareError } = require("./unitedshare-core");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

test("chatCompletionsUrl entfernt überzählige Schrägstriche", () => {
  assert.equal(
    chatCompletionsUrl("https://api.unitedshare.ai/v1/"),
    "https://api.unitedshare.ai/v1/chat/completions",
  );
});

test("completeChat sendet Bearer und Modell und liefert den Text", async () => {
  const { server, port } = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(req.headers.authorization, "Bearer test-key");
    assert.equal(body.model, "lokal");
    assert.equal(req.url, "/v1/chat/completions");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "fertig" } }] }));
  });
  try {
    const text = await completeChat({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      model: "lokal",
      messages: [{ role: "user", content: "hallo" }],
    });
    assert.equal(text, "fertig");
  } finally {
    server.close();
  }
});

test("401 nennt den Key und gibt den Rohtext nicht weiter", async () => {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
  });
  try {
    await assert.rejects(
      () =>
        completeChat({
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "test-key",
          model: "lokal",
          messages: [{ role: "user", content: "hallo" }],
        }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.status, 401);
        assert.match(error.message, /API-Key/);
        assert.equal(error.message.includes("Unauthorized"), false);
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("ein Inhalts-Array wird zu einem Text", async () => {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: [{ text: "a" }, "b"] } }],
      }),
    );
  });
  try {
    const text = await completeChat({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      model: "lokal",
      messages: [{ role: "user", content: "hallo" }],
    });
    assert.equal(text, "ab");
  } finally {
    server.close();
  }
});

test("die Release-main.js ist eigenständig", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
  assert.equal(main.includes('require("./unitedshare-core")'), false);
  assert.equal(main.includes("module.exports = {"), false);
  assert.match(main, /async function completeChat/);
  assert.match(main, /ask-unitedshare/);
  assert.match(main, /https:\/\/unitedshare\.ai\/privacy/);
});
