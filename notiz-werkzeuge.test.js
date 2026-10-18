"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UnitedShareError,
  completeMessages,
  limitMeldung,
  limitsFromBody,
  limitsFromHeaders,
  mermaidZumEinfuegen,
  verbrauchZeile,
  wikilinkAusPfad,
} = require("./unitedshare-core");

const STARTER = "```mermaid\nflowchart LR\n  A[Notiz]\n```\n";

test("limitsFromBody liest nur endliche Fenster", () => {
  assert.equal(limitsFromBody(null), null);
  assert.equal(limitsFromBody({ error: {} }), null);
  assert.deepEqual(limitsFromBody({
    limits: { rest_tag: 0, rest_monat: "400", nachgekauft: 2, stufe: "basis", reset_monat: "2026-11-01" },
  }), { rest_tag: 0, rest_monat: 400, nachgekauft: 2 });
  assert.equal(limitsFromBody({ limits: { rest_tag: "viel", rest_monat: null } }), null);
});

test("limitsFromHeaders ignoriert X-US-Limit-Remaining", () => {
  assert.equal(limitsFromHeaders({ "X-US-Limit-Remaining": "0" }), null);
  assert.equal(limitsFromHeaders({ "x-us-limit-remaining": "0" }), null);
  const headers = {
    get(name) {
      const map = {
        "x-us-limit-remaining": "0",
        "x-us-limit-rest-tag": "1200",
        "x-us-limit-rest-monat": "40000",
      };
      return map[String(name).toLowerCase()] ?? null;
    },
  };
  assert.deepEqual(limitsFromHeaders(headers), { rest_tag: 1200, rest_monat: 40000 });
  assert.deepEqual(limitsFromHeaders({ "X-US-Limit-Rest-Woche": "80" }), { rest_woche: 80 });
});

test("limitMeldung nennt das Fenster, das leer ist", () => {
  assert.equal(limitMeldung({ rest_tag: 0, rest_monat: 10 }), "Das Tageslimit ist aufgebraucht.");
  assert.equal(limitMeldung({ rest_tag: 4, rest_woche: 0, rest_monat: 10 }), "Das Wochenlimit ist aufgebraucht.");
  assert.equal(limitMeldung({ rest_tag: 4, rest_monat: 0, nachgekauft: 0 }), "Das Monatslimit ist aufgebraucht.");
  assert.equal(limitMeldung({ rest_tag: 4, rest_monat: 0, nachgekauft: 3 }), "");
  assert.equal(limitMeldung(null), "");
  assert.equal(limitMeldung({}), "");
});

test("verbrauchZeile zeigt nur echte Zahlen und sonst nichts", () => {
  assert.equal(verbrauchZeile(null, null), "");
  assert.equal(verbrauchZeile({ rest_tag: "viel" }, { summe: Infinity }), "");
  assert.equal(
    verbrauchZeile({ rest_tag: 1200, rest_monat: 40000, nachgekauft: 0 }, null),
    "Tag 1.200 · Monat 40.000",
  );
  assert.equal(
    verbrauchZeile({ rest_tag: 8, rest_woche: 80, rest_monat: 90, nachgekauft: 1500 }, { summe: 16 }),
    "Tag 8 · Woche 80 · Monat 90 · Nachgekauft 1.500 · Dieser Aufruf: 16 Token",
  );
  assert.equal(
    verbrauchZeile({ verbraucht_tag: 120, limit_tag: 1000, rest_tag: 880, rest_monat: 9000 }, { summe: 40 }),
    "Kontextfenster 120 / 1.000 · Dieser Aufruf: 40 Token",
  );
  assert.equal(
    verbrauchZeile({ verbraucht_tag: 5000, limit_tag: 500000, unbegrenzt: true }, null),
    "Kontextfenster 5.000, ohne Tageslimit",
  );
  assert.equal(verbrauchZeile({ unbegrenzt: true, limit_tag: 1000 }, null), "");
  assert.equal(verbrauchZeile({ verbraucht_tag: 0, limit_tag: 1000 }, null), "Kontextfenster 0 / 1.000");
});

test("verbrauchZeile erfindet keine Woche", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "unitedshare-core.js"), "utf8");
  assert.equal(source.includes("keine eigene Woche"), false);
  assert.equal(verbrauchZeile({ rest_tag: 3, rest_monat: 9 }, null), "Tag 3 · Monat 9");
  assert.equal(verbrauchZeile({ rest_tag: 3, rest_woche: 0, rest_monat: 9 }, null), "Tag 3 · Woche 0 · Monat 9");
});

test("mermaidZumEinfuegen nimmt die Zwischenablage, sonst die Antwort, sonst den Anfang", () => {
  const ausAntwort = "```mermaid\nflowchart LR\n  B[Antwort]\n```\n";
  const ausAblage = "Text\n```mermaid\nflowchart TD\n  C[Ablage]\n```\nweiter";
  assert.equal(mermaidZumEinfuegen(ausAblage, ausAntwort), "```mermaid\nflowchart TD\n  C[Ablage]\n```\n");
  assert.equal(mermaidZumEinfuegen("nur Text", ausAntwort), ausAntwort);
  assert.equal(mermaidZumEinfuegen("", ""), STARTER);
});

test("wikilinkAusPfad nimmt den Namen ohne Ordner und Endung", () => {
  assert.equal(wikilinkAusPfad("Notizen/Heute.md"), "[[Heute]]");
  assert.equal(wikilinkAusPfad("Probe.md"), "[[Probe]]");
  assert.throws(() => wikilinkAusPfad("../Geheim.md"), UnitedShareError);
});

function jsonAntwort(body, status, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers || {},
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

test("429 mit rest_tag 0 meldet das Tageslimit und behält die Zahlen", async () => {
  await assert.rejects(
    () => completeMessages({
      baseUrl: "https://api.unitedshare.ai/v1",
      apiKey: "test-key",
      model: "rmxos-mega2026.1",
      system: "s",
      turns: [{ role: "user", content: "hallo" }],
      fetchImpl: async () => jsonAntwort({
        error: { type: "insufficient_quota", message: "Dein Token-Budget fuer diesen Zeitraum ist aufgebraucht." },
        limits: { rest_tag: 0, rest_monat: 400, nachgekauft: 0 },
      }, 429, { "X-US-Limit-Remaining": "0" }),
    }),
    (error) => {
      assert.ok(error instanceof UnitedShareError);
      assert.equal(error.status, 429);
      assert.equal(error.message, "Das Tageslimit ist aufgebraucht.");
      assert.deepEqual(error.limits, { rest_tag: 0, rest_monat: 400, nachgekauft: 0 });
      return true;
    },
  );
});

test("429 mit rest_monat 0 meldet das Monatslimit", async () => {
  await assert.rejects(
    () => completeMessages({
      baseUrl: "https://api.unitedshare.ai/v1",
      apiKey: "test-key",
      model: "rmxos-mega2026.1",
      system: "s",
      turns: [{ role: "user", content: "hallo" }],
      fetchImpl: async () => jsonAntwort({
        limits: { rest_tag: 4, rest_monat: 0, nachgekauft: 0 },
      }, 429),
    }),
    (error) => error instanceof UnitedShareError && error.message === "Das Monatslimit ist aufgebraucht.",
  );
});

test("429 mit rest_woche 0 meldet das Wochenlimit nur wenn das Feld da ist", async () => {
  await assert.rejects(
    () => completeMessages({
      baseUrl: "https://api.unitedshare.ai/v1",
      apiKey: "test-key",
      model: "rmxos-mega2026.1",
      system: "s",
      turns: [{ role: "user", content: "hallo" }],
      fetchImpl: async () => jsonAntwort({
        limits: { rest_tag: 4, rest_woche: 0, rest_monat: 20 },
      }, 429),
    }),
    (error) => error instanceof UnitedShareError && error.message === "Das Wochenlimit ist aufgebraucht.",
  );
});

test("429 ohne Fensterzahl nennt den Zeitraum", async () => {
  await assert.rejects(
    () => completeMessages({
      baseUrl: "https://api.unitedshare.ai/v1",
      apiKey: "test-key",
      model: "rmxos-mega2026.1",
      system: "s",
      turns: [{ role: "user", content: "hallo" }],
      fetchImpl: async () => jsonAntwort({ error: { message: "nope" } }, 429, { "X-US-Limit-Remaining": "0" }),
    }),
    (error) => {
      assert.equal(error.message, "Das Token-Budget für diesen Zeitraum ist aufgebraucht.");
      assert.equal(error.limits, undefined);
      return true;
    },
  );
});

test("ein fertiger JSON-Körper meldet die echten Token, Remaining 0 zählt nicht", async () => {
  const seen = [];
  const text = await completeMessages({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "test-key",
    model: "rmxos-mega2026.1",
    system: "s",
    turns: [{ role: "user", content: "hallo" }],
    fetchImpl: async () => jsonAntwort({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 12, output_tokens: 4 },
    }, 200, {
      "X-US-Limit-Remaining": "0",
      "X-US-Limit-Rest-Tag": "800",
      "X-US-Limit-Rest-Monat": "40000",
    }),
    onMeta(meta) {
      seen.push(meta);
    },
  });
  assert.equal(text, "ok");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].limits, { rest_tag: 800, rest_monat: 40000 });
  assert.deepEqual(seen[0].usage, { input: 12, output: 4, summe: 16 });
});

test("prompt_tokens im JSON-Körper werden gezählt", async () => {
  const seen = [];
  const text = await completeMessages({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "test-key",
    model: "rmxos-mega2026.1",
    system: "s",
    turns: [{ role: "user", content: "hallo" }],
    fetchImpl: async () => jsonAntwort({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    }, 200),
    onMeta(meta) {
      seen.push(meta);
    },
  });
  assert.equal(text, "ok");
  assert.deepEqual(seen[0].usage, { input: 10, output: 2, summe: 12 });
});

test("der Strom zählt message_start und message_delta nicht als Token", async () => {
  const seen = [];
  const raw = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hallo"}}\n\n',
    'data: {"type":"message_delta","usage":{"output_tokens":3},"delta":{}}\n\n',
  ].join("");
  const text = await completeMessages({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "test-key",
    model: "rmxos-mega2026.1",
    system: "s",
    turns: [{ role: "user", content: "hallo" }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { "X-US-Limit-Remaining": "0", "X-US-Limit-Rest-Tag": "50" },
      text: async () => raw,
    }),
    onMeta(meta) {
      seen.push(meta);
    },
  });
  assert.equal(text, "Hallo");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].usage, null);
  assert.deepEqual(seen[0].limits, { rest_tag: 50 });
});

test("ein unitedshare-Ereignis setzt das Kontextfenster und zählt message_delta nicht", async () => {
  const seen = [];
  const raw = [
    ": ping\n\n",
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":0}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hallo"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3},"delta":{}}\n\n',
    'event: unitedshare\ndata: {"type":"unitedshare","verbraucht_tag":120,"limit_tag":1000,"dieser_aufruf":40,"rest_tag":880,"rest_monat":9000,"nachgekauft":0}\n\n',
  ].join("");
  const text = await completeMessages({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "test-key",
    model: "rmxos-mega2026.1",
    system: "s",
    turns: [{ role: "user", content: "hallo" }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { "X-US-Limit-Rest-Tag": "50" },
      text: async () => raw,
    }),
    onMeta(meta) {
      seen.push(meta);
    },
  });
  assert.equal(text, "Hallo");
  assert.deepEqual(seen[0].usage, { summe: 40 });
  assert.deepEqual(seen[0].limits, {
    rest_tag: 880,
    rest_monat: 9000,
    nachgekauft: 0,
    verbraucht_tag: 120,
    limit_tag: 1000,
  });
});

test("ein Firmenfenster nennt den Verbrauch ohne erfundenes Tageslimit", async () => {
  const seen = [];
  const raw = [
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
    'data: {"type":"unitedshare","verbraucht_tag":5000,"limit_tag":500000,"unbegrenzt":true,"dieser_aufruf":8}\n\n',
  ].join("");
  await completeMessages({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "test-key",
    model: "rmxos-mega2026.1",
    system: "s",
    turns: [{ role: "user", content: "hallo" }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {},
      text: async () => raw,
    }),
    onMeta(meta) {
      seen.push(meta);
    },
  });
  assert.equal(seen[0].limits.unbegrenzt, true);
  assert.equal(seen[0].limits.verbraucht_tag, 5000);
  assert.equal(verbrauchZeile(seen[0].limits, seen[0].usage), "Kontextfenster 5.000, ohne Tageslimit · Dieser Aufruf: 8 Token");
});
