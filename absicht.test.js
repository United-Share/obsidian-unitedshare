"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UnitedShareError,
  absichtAusNaehe,
  absichtBeispiele,
  absichtLokal,
  auftragSpalten,
  bildTextAusAntwort,
  lokalText,
} = require("./unitedshare-core");

const ACHSE = {
  bild: [1, 0, 0],
  text: [0, 1, 0],
  nie: [0, 0, 1],
};

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

test("ein klarer Satz wird ohne Netz in Bild und Text zerlegt", () => {
  const kugel = auftragSpalten("zeichne eine rote Kugel");
  assert.equal(kugel.bild, true);
  assert.equal(kugel.text, false);
  assert.equal(kugel.bildPrompt, "rote Kugel");
  assert.equal(kugel.textPrompt, "");
  assert.equal(Object.hasOwn(kugel, "breite"), false);
  assert.equal(Object.hasOwn(kugel, "hoehe"), false);

  const gemischt = auftragSpalten("zeichne eine rote Kugel und nenne den Durchmesser");
  assert.equal(gemischt.bild, true);
  assert.equal(gemischt.text, true);
  assert.equal(gemischt.bildPrompt, "rote Kugel");
  assert.equal(gemischt.textPrompt, "nenne den Durchmesser");

  const fassade = auftragSpalten("male mir ein Bild von der Nordfassade");
  assert.equal(fassade.bildPrompt, "Nordfassade");
  assert.equal(fassade.text, false);

  const foto = auftragSpalten("ein Foto von einem Apfel");
  assert.equal(foto.bild, true);
  assert.equal(foto.bildPrompt, "einem Apfel");
  assert.equal(foto.text, false);

  const weit = auftragSpalten("16:9 von der fassade bei nacht");
  assert.equal(weit.bild, true);
  assert.equal(weit.text, false);
  assert.equal(weit.bildPrompt, "fassade bei nacht");
  assert.equal(weit.breite, 1024);
  assert.equal(weit.hoehe, 576);

  const formate = [
    ["21:9 von der fassade", 1344, 576],
    ["9:16 von der fassade", 576, 1024],
    ["4:3 von der fassade", 1024, 768],
    ["3:2 von der fassade", 1152, 768],
    ["1:1 von der fassade", 1024, 1024],
  ];
  for (const [satz, breite, hoehe] of formate) {
    const plan = auftragSpalten(satz);
    assert.equal(plan.bild, true, satz);
    assert.equal(plan.bildPrompt, "fassade", satz);
    assert.equal(plan.breite, breite, satz);
    assert.equal(plan.hoehe, hoehe, satz);
  }

  for (const satz of [
    "Was ist 16:9",
    "16:9",
    "116:9 von der fassade",
    "16:90 von der fassade",
    "zeichne ein Sequenzdiagramm",
    "beschreibe das Bild in der Notiz",
    "wie binde ich ein PNG ein",
  ]) {
    const plan = auftragSpalten(satz);
    assert.equal(plan.bild, false, satz);
    assert.equal(plan.text, true, satz);
    assert.equal(plan.textPrompt, satz, satz);
    assert.equal(Object.hasOwn(plan, "breite"), false, satz);
  }
});

test("zwei Klassenmaxima entscheiden Bild, Text oder beides", () => {
  const beispiele = [
    { klasse: "bild", vektor: ACHSE.bild },
    { klasse: "text", vektor: ACHSE.text },
    { klasse: "nie", vektor: ACHSE.nie },
  ];
  assert.deepEqual(absichtAusNaehe([1, 0, 0], beispiele), { bild: true, text: false });
  assert.deepEqual(absichtAusNaehe([0, 1, 0], beispiele), { bild: false, text: true });
  assert.deepEqual(absichtAusNaehe([0, 0, 1], beispiele), { bild: false, text: true });
  assert.deepEqual(absichtAusNaehe([1, 1, 0], beispiele), { bild: false, text: true });
  assert.deepEqual(absichtAusNaehe([1, 0.9, 0], beispiele), { bild: true, text: true });
  assert.deepEqual(absichtAusNaehe([0, 0, 0], beispiele), { bild: false, text: true });
  assert.deepEqual(absichtAusNaehe(null, beispiele), { bild: false, text: true });
});

test("eine gemischte Antwort ist nur JSON mit beiden Teilen", () => {
  assert.deepEqual(
    bildTextAusAntwort('Vorweg {"bild":" rote Kugel ","text":" nenne den Durchmesser "} danach'),
    { bild: "rote Kugel", text: "nenne den Durchmesser" },
  );
  assert.equal(bildTextAusAntwort("nur ein Satz ohne Klammern"), null);
  assert.equal(bildTextAusAntwort('{"bild":"","text":"eine Frage"}'), null);
  assert.equal(bildTextAusAntwort('{"bild":"eine Fassade","text":""}'), null);
  assert.equal(bildTextAusAntwort('{"bild":"ein Mermaid Ablauf","text":"nenne den Schritt"}'), null);
  assert.equal(bildTextAusAntwort("nicht { json"), null);
});

test("lokalText bleibt auf diesem Rechner und schickt keinen Schlüssel", async () => {
  let called = 0;
  const leer = await lokalText({
    origin: "http://127.0.0.1:9",
    model: "   ",
    prompt: "Hallo",
    fetchImpl: async () => {
      called += 1;
      throw new Error("nicht rufen");
    },
  });
  assert.equal(leer, "");
  assert.equal(called, 0);

  let seen = null;
  const text = await lokalText({
    origin: "http://127.0.0.1:11434",
    model: "qwen3:8b",
    prompt: "Hallo",
    fetchImpl: async (url, init) => {
      seen = { url, headers: init.headers, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ response: "ok" }) };
    },
  });
  assert.equal(text, "ok");
  assert.equal(seen.url, "http://127.0.0.1:11434/api/generate");
  assert.deepEqual(seen.body, { model: "qwen3:8b", prompt: "Hallo", stream: false });
  assert.equal(seen.headers.Authorization, undefined);
  assert.equal(seen.headers.authorization, undefined);

  const ohne = await lokalText({
    origin: "http://127.0.0.1:11434",
    model: "qwen3:8b",
    prompt: "Hallo",
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  assert.equal(ohne, "");

  called = 0;
  await assert.rejects(
    () => lokalText({
      origin: "http://10.0.0.8:11434",
      model: "qwen3:8b",
      prompt: "Hallo",
      fetchImpl: async () => {
        called += 1;
        throw new Error("nicht rufen");
      },
    }),
    (error) => {
      assert.ok(error instanceof UnitedShareError);
      assert.equal(error.message, "Das lokale Embedding bleibt auf diesem Rechner.");
      return true;
    },
  );
  assert.equal(called, 0);
});

test("das lokale Embedding moderiert, ein klares Nein bleibt Text", async () => {
  const beispiele = absichtBeispiele();
  const achse = new Map(beispiele.map((row) => [row.text, ACHSE[row.klasse]]));
  let mode = "embed";
  const embedBodies = [];
  const { server, port } = await listen(async (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    if (req.method === "GET") {
      const name = mode === "kein-modell" ? "llama3:8b" : "bge-m3:latest";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name }] }));
      return;
    }
    const body = await readBody(req);
    const allein = Array.isArray(body.input) && body.input.length === 1;
    const embeddings = (body.input || []).map((text) => {
      if (allein && text === "beides") return [1, 0.9, 0];
      if (allein && text === "zeichne ein sequenzdiagramm") return [1, 0, 0];
      return achse.get(text) || [0, 1, 0];
    });
    embedBodies.push(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ embeddings }));
  });
  const origin = `http://127.0.0.1:${port}`;
  const cache = {};
  let umformen = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(String(url).startsWith(origin), true);
    assert.equal(init.headers.Authorization, undefined);
    assert.equal(init.headers.authorization, undefined);
    return globalThis.fetch(url, init);
  };
  try {
    const bild = await absichtLokal({
      frage: "16:9 von der fassade im abendlicht",
      origin,
      fetchImpl,
      timeoutMs: 8000,
      cache,
      umformen: async () => {
        umformen += 1;
        return '{"bild":"x","text":"y"}';
      },
    });
    assert.equal(bild.bild, true);
    assert.equal(bild.text, false);
    assert.equal(bild.bildPrompt, "fassade im abendlicht");
    assert.equal(bild.breite, 1024);
    assert.equal(bild.hoehe, 576);
    assert.equal(bild.moderator, "bge-m3:latest");
    assert.equal(bild.auftrag, "bild");
    assert.equal(umformen, 0);
    assert.equal(embedBodies.length, 2);
    assert.equal(embedBodies[0].input.length, 24);
    assert.deepEqual(embedBodies[1].input, ["16:9 von der fassade im abendlicht"]);

    await absichtLokal({
      frage: "16:9 von der fassade im abendlicht",
      origin,
      fetchImpl,
      timeoutMs: 8000,
      cache,
    });
    assert.equal(embedBodies.length, 3);
    assert.equal(embedBodies[2].input.length, 1);

    const beide = await absichtLokal({
      frage: "beides",
      origin,
      fetchImpl,
      timeoutMs: 8000,
      cache,
      umformen: async (satz) => {
        umformen += 1;
        assert.equal(satz, "beides");
        return 'Satz {"bild":"rote Kugel","text":"nenne den Durchmesser"} Ende';
      },
    });
    assert.equal(umformen, 1);
    assert.equal(beide.bild, true);
    assert.equal(beide.text, true);
    assert.equal(beide.bildPrompt, "rote Kugel");
    assert.equal(beide.textPrompt, "nenne den Durchmesser");
    assert.equal(beide.auftrag, "beide");
    assert.equal(beide.moderator, "bge-m3:latest");

    const ohne = await absichtLokal({
      frage: "beides",
      origin,
      fetchImpl,
      timeoutMs: 8000,
      cache,
    });
    assert.equal(ohne, null);

    const geworfen = await absichtLokal({
      frage: "beides",
      origin,
      fetchImpl,
      timeoutMs: 8000,
      cache,
      umformen: async () => {
        throw new Error("weg");
      },
    });
    assert.equal(geworfen, null);

    const hart = await absichtLokal({
      frage: "zeichne ein sequenzdiagramm",
      origin,
      fetchImpl,
      timeoutMs: 8000,
      cache,
      umformen: async () => {
        umformen += 1;
        return '{"bild":"haus","text":"frage"}';
      },
    });
    assert.equal(hart.bild, false);
    assert.equal(hart.auftrag, "text");
    assert.equal(hart.moderator, "bge-m3:latest");
    assert.equal(umformen, 1);

    const vorher = embedBodies.length;
    mode = "kein-modell";
    const fehlt = await absichtLokal({
      frage: "eine fassade bei nacht",
      origin,
      fetchImpl,
      timeoutMs: 8000,
      cache,
    });
    assert.equal(fehlt, null);
    assert.equal(embedBodies.length, vorher);
  } finally {
    server.close();
  }

  let called = 0;
  await assert.rejects(
    () => absichtLokal({
      frage: "eine fassade",
      origin: "http://evil.example:11434",
      fetchImpl: async () => {
        called += 1;
        throw new Error("nicht rufen");
      },
    }),
    (error) => {
      assert.ok(error instanceof UnitedShareError);
      assert.equal(error.message, "Das lokale Embedding bleibt auf diesem Rechner.");
      return true;
    },
  );
  assert.equal(called, 0);
});
