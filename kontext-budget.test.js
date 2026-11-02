"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChatBody, chunkNote, completeMessages, executeVaultAction, runVaultInstruction, UnitedShareError } = require("./unitedshare-core");

function transport(aufrufe) {
  return async (url, options) => {
    aufrufe.push({ url, options });
    return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

test("Antwortbudget wird für Chat- und Messages-API übertragen", async () => {
  for (const form of ["chat", "messages"]) {
    const calls = [];
    await completeMessages({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test", form, turns: [{ role: "user", content: "Hallo" }], maxTokens: 4096, fetchImpl: transport(calls) });
    assert.equal(JSON.parse(calls[0].options.body).max_tokens, 4096);
  }
});

test("zu großer aggregierter Kontext wird vor jedem Netzwerkaufruf abgelehnt", async () => {
  const calls = [];
  await assert.rejects(completeMessages({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test", form: "chat", turns: [{ role: "user", content: "Frage", files: [{ path: "a.md", text: "ä".repeat(64000) }] }], fetchImpl: transport(calls) }), /128\.000 UTF-8-Bytes/);
  assert.equal(calls.length, 0);
});

test("auch Werkzeugergebnisse im Verlauf zählen zum Budget", async () => {
  const calls = [];
  await assert.rejects(completeMessages({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test", form: "chat", turns: [{ role: "user", content: "Ergebnis der Tresor-Aktion: " + "x".repeat(128000) }], fetchImpl: transport(calls) }), /zu groß/);
  assert.equal(calls.length, 0);
});

test("ungültiges Antwortbudget wird vor Netzwerkaufruf abgelehnt", async () => {
  const calls = [];
  await assert.rejects(completeMessages({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test", turns: [], maxTokens: 8193, fetchImpl: transport(calls) }), /Antwortlänge/);
  assert.equal(calls.length, 0);
});

test("Budgetfehler zeigt nur Größen, keine vertraulichen Inhalte", async () => {
  const calls = [];
  await assert.rejects(completeMessages({ baseUrl: "https://example.test/v1", apiKey: "test", model: "test", form: "chat", system: "System", turns: [{ role: "user", content: "Geheimfrage", files: [{ path: "geheim.md", text: "G".repeat(128000) }] }], fetchImpl: transport(calls) }), (error) => {
    assert.match(error.message, /Verlauf \d+, Dateien \d+, Werkzeugergebnisse \d+, System \d+ Bytes/);
    assert.doesNotMatch(error.message, /Geheimfrage|geheim\.md/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("eine data-URL im Verlauf wird vor dem Versand ersetzt", () => {
  const blob = "A".repeat(80);
  const body = buildChatBody({
    model: "test",
    turns: [{
      role: "user",
      content: `Siehe data:image/png;base64,${blob} Ende`,
      files: [{ path: "bild.md", text: `Vorher ![](data:image/png;base64,${blob}) Danach` }],
    }],
  });
  const text = body.messages.map((message) => message.content).join("\n");
  assert.equal(text.includes("data:image"), false);
  assert.match(text, /\[Bild ausgelassen\]/);
  assert.match(text, /Ende/);
  assert.match(text, /Vorher/);
  assert.match(text, /Danach/);
});

test("Einbettungsstücke tragen keine data-URL", () => {
  const blob = "A".repeat(80);
  const pieces = chunkNote("a.md", `Anfang\n\ndata:image/png;base64,${blob}\n\nEnde`);
  const joined = pieces.map((piece) => piece.text).join("\n");
  assert.equal(joined.includes("data:image"), false);
  assert.match(joined, /Anfang/);
  assert.match(joined, /Ende/);
});

test("Schreiben legt keine data-URL in die Datei", async () => {
  const blob = "A".repeat(80);
  const geschrieben = [];
  await executeVaultAction(
    { action: "write", path: "a.md", content: `Vorher\ndata:image/png;base64,${blob}\nEnde` },
    { async write(pfad, inhalt) { geschrieben.push({ pfad, inhalt }); } },
  );
  assert.equal(geschrieben.length, 1);
  assert.equal(geschrieben[0].inhalt.includes("data:image"), false);
  assert.match(geschrieben[0].inhalt, /Vorher/);
  assert.match(geschrieben[0].inhalt, /Ende/);
});

test("Fehler nach Werkzeugschritt warnt vor erneutem Versuch ohne Zustand zu verlieren", async () => {
  let calls = 0;
  let schreibt = 0;
  const ausgang = new UnitedShareError("Kontext zu groß", 400);
  await assert.rejects(runVaultInstruction({
    turns: [{ role: "user", content: "Schreibe" }],
    host: { async write() { schreibt += 1; } },
    complete: async () => {
      calls += 1;
      if (calls === 1) return '```unitedshare\n{"action":"write","path":"a.md","content":"A"}\n```';
      throw ausgang;
    },
  }), (error) => {
    assert.equal(error, ausgang);
    assert.equal(error.status, 400);
    assert.match(error.message, /nicht automatisch rückgängig/);
    return true;
  });
  assert.equal(schreibt, 1);
});
