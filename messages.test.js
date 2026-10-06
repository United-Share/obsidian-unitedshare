"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAnthropicBody,
  completeMessages,
  parseAnthropicContent,
  coveredByKeyboard,
  keyboardCoverPx,
  viewSitsUnderKeyboard,
  isObsidianModel,
  listModels,
  loadMentionedNotes,
  mentionPaths,
  messagesUrl,
  modelsUrl,
  UnitedShareError,
} = require("./unitedshare-core");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

test("coveredByKeyboard hebt nur den verdeckten Prompt", () => {
  const keyboard = { offsetTop: 0, height: 480 };
  assert.equal(coveredByKeyboard({ bottom: 844, height: 760 }, keyboard, 844), 364);
  assert.equal(coveredByKeyboard({ bottom: 844, height: 760 }, { offsetTop: 20, height: 480 }, 844), 344);
  assert.equal(coveredByKeyboard({ bottom: 844, height: 760 }, { offsetTop: 0, height: 844 }, 844), 0);
  assert.equal(coveredByKeyboard({ bottom: 400, height: 360 }, keyboard, 844), 0);
  assert.equal(coveredByKeyboard({ bottom: 480, height: 760 }, keyboard, 844), 364);
  assert.equal(coveredByKeyboard(null, null, 800), 0);
  assert.equal(coveredByKeyboard({ bottom: 800, height: 200 }, { offsetTop: 0, height: 100 }, 800), 200);
});

test("keyboardCoverPx hebt den festen Drawer über --keyboard-height", () => {
  const rect = { bottom: 844, height: 760 };
  const closed = { offsetTop: 0, height: 844 };
  const open = { offsetTop: 0, height: 430 };
  assert.equal(keyboardCoverPx(rect, closed, 844, "300px", { fixedOverlay: true }), 300);
  assert.equal(keyboardCoverPx(rect, closed, 844, "300px", { fixedOverlay: false }), 0);
  assert.equal(keyboardCoverPx(rect, closed, 844, "300px"), 0);
  assert.equal(keyboardCoverPx(rect, open, 844, "300px", { fixedOverlay: true }), 414);
  assert.equal(keyboardCoverPx({ bottom: 844, height: 200 }, closed, 844, "300px", { fixedOverlay: true }), 200);
  assert.equal(keyboardCoverPx(rect, closed, 844, "0px", { fixedOverlay: true }), 0);
  assert.equal(keyboardCoverPx(rect, closed, 844, "1px", { fixedOverlay: true }), 0);
  const pinned = {
    classList: { contains: (name) => name === "is-pinned" },
  };
  const loose = { classList: { contains: () => false } };
  assert.equal(viewSitsUnderKeyboard({ closest: (sel) => (sel === ".workspace-drawer" ? pinned : null) }), false);
  assert.equal(viewSitsUnderKeyboard({ closest: (sel) => (sel === ".workspace-drawer" ? loose : null) }), true);
  assert.equal(viewSitsUnderKeyboard({}), false);
  assert.equal(viewSitsUnderKeyboard(null), false);
});

test("messagesUrl zeigt auf /v1/messages", () => {
  assert.equal(typeof messagesUrl, "function");
  assert.equal(
    messagesUrl("https://api.unitedshare.ai/v1/"),
    "https://api.unitedshare.ai/v1/messages",
  );
});

test("modelsUrl zeigt auf /v1/models", () => {
  assert.equal(typeof modelsUrl, "function");
  assert.equal(
    modelsUrl("https://api.unitedshare.ai/v1/"),
    "https://api.unitedshare.ai/v1/models",
  );
});

test("listModels liest die Kennungen aus einem authentifizierten GET /v1/models", async () => {
  assert.equal(typeof listModels, "function");
  const seen = [];
  const { server, port } = await listen((req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: [
        { id: "devstral" },
        { id: "reemax-cortex" },
        { id: "rmxos-sema2026.1", object: "model" },
        { id: "rmxos-mega2026.1" },
        { id: "  " },
        { id: "rmxos-mega2026.1" },
        { id: "rmxos-mobil2026.1" },
        { id: "nemotron-3-nano" },
        { object: "model" },
      ],
    }));
  });
  try {
    const ids = await listModels({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
    });
    assert.equal(seen[0].method, "GET");
    assert.equal(seen[0].url, "/v1/models");
    assert.equal(seen[0].authorization, "Bearer test-key");
    assert.deepEqual(ids, ["rmxos-sema2026.1", "rmxos-mega2026.1", "rmxos-mobil2026.1"]);
    assert.equal(isObsidianModel("rmxos-mega2026.1"), true);
    assert.equal(isObsidianModel("devstral"), false);
    assert.equal(isObsidianModel("reemax-cortex"), false);
  } finally {
    server.close();
  }
});

test("listModels lehnt einen fehlenden oder abgelehnten Schlüssel ab", async () => {
  await assert.rejects(
    () => listModels({ baseUrl: "http://127.0.0.1:9/v1", apiKey: "" }),
    (error) => {
      assert.ok(error instanceof UnitedShareError);
      assert.match(error.message, /API-Key fehlt/);
      return true;
    },
  );
  const { server, port } = await listen((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end("{}");
  });
  try {
    await assert.rejects(
      () => listModels({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "nope",
      }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.match(error.message, /abgelehnt/);
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("der Körper bleibt ein Textauftrag ohne Werkzeuge und ohne Stream", () => {
  assert.equal(typeof buildAnthropicBody, "function");
  const body = buildAnthropicBody({
    model: "rmxos-mega2026.1",
    system: "Antworte auf Deutsch.",
    turns: [
      { role: "user", content: "Was steht in @\"Notizen/Heute.md\"?", files: [
        { path: "Notizen/Heute.md", text: "Stand: grün" },
      ] },
      { role: "assistant", content: "Kurz." },
      { role: "system", content: "darf nicht in messages landen" },
    ],
    tools: [{ name: "Bash" }],
  });
  assert.equal(body.model, "rmxos-mega2026.1");
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 1200);
  assert.equal(body.system, "Antworte auf Deutsch.");
  assert.equal(Object.hasOwn(body, "tools"), false);
  assert.deepEqual(body.messages.map((message) => message.role), ["user", "assistant"]);
  const blocks = body.messages[0].content;
  assert.ok(blocks.every((block) => block.type === "text"));
  assert.match(blocks[0].text, /Was steht/);
  assert.match(blocks[1].text, /linked_content path="Notizen\/Heute.md"/);
  assert.match(blocks[1].text, /Stand: grün/);
  assert.equal(blocks.some((block) => block.type === "image" || block.type === "tool_use"), false);
});

test("eine fehlende Erwähnung bleibt ein Textblock und wird nicht zum Werkzeug", () => {
  const body = buildAnthropicBody({
    model: "rmxos-mega2026.1",
    system: "s",
    turns: [{
      role: "user",
      content: "Lies @Fehlt.md",
      files: [{ path: "Fehlt.md", missing: true }],
    }],
  });
  assert.match(body.messages[0].content[1].text, /liegt nicht im Tresor/);
  assert.equal(body.stream, false);
});

test("mentionPaths liest @Pfad und @\"Pfad mit Leerzeichen\"", () => {
  assert.equal(typeof mentionPaths, "function");
  assert.deepEqual(
    mentionPaths('Schau @"Notizen/Heute.md" und @Archiv/alt.md und nochmal @Archiv/alt.md'),
    ["Notizen/Heute.md", "Archiv/alt.md"],
  );
});

test("loadMentionedNotes lädt nur den Text der erwähnten Notiz", async () => {
  assert.equal(typeof loadMentionedNotes, "function");
  const read = [];
  const files = await loadMentionedNotes("Bitte @Notizen/Heute.md", async (notePath) => {
    read.push(notePath);
    if (notePath === "Notizen/Heute.md") return "Inhalt";
    return null;
  });
  assert.deepEqual(read, ["Notizen/Heute.md"]);
  assert.deepEqual(files, [{ path: "Notizen/Heute.md", text: "Inhalt" }]);
});

test("ein zitierter JSON-Inhalt wird als Antworttext gelesen", () => {
  assert.equal(
    parseAnthropicContent({
      content: [{ type: "text", text: JSON.stringify("Die Notiz bleibt lokal.") }],
    }),
    "Die Notiz bleibt lokal.",
  );
  assert.equal(
    parseAnthropicContent({
      content: [{
        type: "text",
        text: JSON.stringify({ type: "text", text: "Die Notiz bleibt lokal." }),
      }],
    }),
    "Die Notiz bleibt lokal.",
  );
  assert.equal(
    parseAnthropicContent({
      content: [{
        type: "text",
        text: JSON.stringify({
          content: [{ type: "text", text: "Die Notiz bleibt lokal." }],
        }),
      }],
    }),
    "Die Notiz bleibt lokal.",
  );
  assert.equal(
    parseAnthropicContent({
      content: [{ type: "text", text: '{"name":"Notiz","ok":true}' }],
    }),
    '{"name":"Notiz","ok":true}',
  );
});

test("completeMessages sendet den Anthropic-Körper und liest den Textblock", async () => {
  assert.equal(typeof completeMessages, "function");
  const seen = [];
  const { server, port } = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    seen.push({ url: req.url, authorization: req.headers.authorization, body });
    assert.equal(body.stream, false);
    assert.equal(Object.hasOwn(body, "tools"), false);
    const text = (body.messages || [])
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => {
        const content = message.content;
        if (typeof content === "string") return content;
        return (content || [])
          .filter((part) => part && part.type === "text")
          .map((part) => part.text || "")
          .join("");
      })
      .join("\n");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      content: [{ type: "text", text: `Echo: ${text}` }],
      stop_reason: "end_turn",
      usage: { input_tokens: 3, output_tokens: 2 },
    }));
  });
  try {
    const text = await completeMessages({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "test-key",
      model: "rmxos-mega2026.1",
      system: "Antworte auf Deutsch.",
      turns: [{ role: "user", content: "Hallo @Notiz.md", files: [{ path: "Notiz.md", text: "Zeile" }] }],
    });
    assert.equal(seen[0].url, "/v1/messages");
    assert.equal(seen[0].authorization, "Bearer test-key");
    assert.equal(seen[0].body.system, "Antworte auf Deutsch.");
    assert.match(text, /Echo:/);
    assert.match(text, /Hallo @Notiz.md/);
    assert.match(text, /Zeile/);
  } finally {
    server.close();
  }
});

test("ein reiner tool_use-Block ist keine Antwort", async () => {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }],
      stop_reason: "tool_use",
    }));
  });
  try {
    await assert.rejects(
      () => completeMessages({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "test-key",
        model: "rmxos-mega2026.1",
        system: "s",
        turns: [{ role: "user", content: "lies" }],
      }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.match(error.message, /keine Antwort/);
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("401 auf /v1/messages nennt den Key", async () => {
  const { server, port } = await listen((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
  });
  try {
    await assert.rejects(
      () => completeMessages({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "test-key",
        model: "rmxos-mega2026.1",
        system: "s",
        turns: [{ role: "user", content: "hallo" }],
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
