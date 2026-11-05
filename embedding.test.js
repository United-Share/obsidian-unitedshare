"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UnitedShareError,
  assertLoopbackEmbedUrl,
  chunkNote,
  pickEmbedModel,
  prepareContextFiles,
} = require("./unitedshare-core");

const PLACEHOLDER = "Die Notiz ist angehängt. Lies sie im Tresor, bevor du sie schreibst.";

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

test("eine fremde Embedding-Adresse wird nicht gefragt", async () => {
  const rejected = [
    "https://127.0.0.1:11434",
    "http://evil.example:11434",
    "http://192.168.1.20:11434",
    "http://0.0.0.0:11434",
    "http://user:secret@127.0.0.1:11434",
    "http://127.0.0.1:11434/ollama",
    "http://127.0.0.1:11434/?x=1",
  ];
  for (const embedUrl of rejected) {
    let called = 0;
    await assert.rejects(
      () => prepareContextFiles({
        question: "Nordflügel",
        mentioned: [],
        attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
        embedUrl,
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
    assert.equal(called, 0, embedUrl);
  }
  assert.equal(assertLoopbackEmbedUrl("http://localhost:11434"), "http://localhost:11434");
  assert.equal(assertLoopbackEmbedUrl("http://[::1]:11434"), "http://[::1]:11434");
});

test("eine fehlende Anlage ruft das Embedding nicht", async () => {
  let called = 0;
  const files = await prepareContextFiles({
    question: "Was steht in der Notiz?",
    mentioned: [{ path: "Erwaehnt.md", text: "Der volle Text bleibt." }],
    attached: [{ path: "Fehlt.md", missing: true }],
    embedUrl: "http://127.0.0.1:9",
    fetchImpl: async () => {
      called += 1;
      throw new Error("nicht rufen");
    },
  });
  assert.equal(called, 0);
  assert.deepEqual(files, [
    { path: "Fehlt.md", missing: true },
    { path: "Erwaehnt.md", text: "Der volle Text bleibt." },
  ]);
});

test("ohne passendes Modell geht die ganze Notiz mit", async () => {
  const { server, port } = await listen((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    if (req.url !== "/api/tags") {
      res.writeHead(500);
      res.end("embed darf nicht drankommen");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "glm-4.7-flash:latest" }] }));
  });
  try {
    const base = {
      question: "Nordflügel",
      mentioned: [],
      attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
      embedUrl: `http://127.0.0.1:${port}`,
      fetchImpl: globalThis.fetch,
    };
    const ganz = [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }];
    assert.deepEqual(await prepareContextFiles(base), ganz);
    assert.deepEqual(await prepareContextFiles({ ...base, embedModel: "bge-m3" }), ganz);
  } finally {
    server.close();
  }
});

test("eine Antwort ausserhalb dieses Rechners wird verworfen", async () => {
  await assert.rejects(
    () => prepareContextFiles({
      question: "Nordflügel",
      mentioned: [],
      attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl: async () => ({
        ok: true,
        url: "https://evil.example/api/tags",
        json: async () => ({ models: [{ name: "nomic-embed-text:latest" }] }),
      }),
    }),
    (error) => {
      assert.ok(error instanceof UnitedShareError);
      assert.equal(error.message, "Das lokale Embedding bleibt auf diesem Rechner.");
      return true;
    },
  );
});

test("ein stiller Dienst lässt die ganze Notiz durch", async () => {
  const { server, port } = await listen(() => {});
  try {
    const files = await prepareContextFiles({
      question: "Nordflügel",
      mentioned: [],
      attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
      embedUrl: `http://127.0.0.1:${port}`,
      fetchImpl: globalThis.fetch,
      timeoutMs: 50,
    });
    assert.deepEqual(files, [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }]);
  } finally {
    server.close();
  }
});

test("Status ungleich 200 und ein einzelner Vektor lassen die Notiz durch", async () => {
  const { server, port } = await listen(async (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    if (req.url === "/api/tags") {
      res.writeHead(503);
      res.end("down");
      return;
    }
    res.writeHead(404);
    res.end("nein");
  });
  try {
    assert.deepEqual(await prepareContextFiles({
      question: "Nordflügel",
      mentioned: [],
      attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
      embedUrl: `http://127.0.0.1:${port}`,
      fetchImpl: globalThis.fetch,
    }), [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }]);
  } finally {
    server.close();
  }

  const single = await listen(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ embedding: [1, 0] }));
  });
  try {
    assert.deepEqual(await prepareContextFiles({
      question: "Nordflügel",
      mentioned: [],
      attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
      embedUrl: `http://127.0.0.1:${single.port}`,
      fetchImpl: globalThis.fetch,
    }), [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }]);
  } finally {
    single.server.close();
  }
});

test("die nächsten Abschnitte gehen mit, der Rest wird zum Hinweis", async () => {
  const seen = [];
  const { server, port } = await listen(async (req, res) => {
    assert.equal(req.headers.authorization, undefined);
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }));
      return;
    }
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/embed");
    const body = await readBody(req);
    seen.push(body);
    assert.equal(body.model, "nomic-embed-text:latest");
    const embeddings = body.input.map((text) => {
      const match = String(text).match(/MARKE-(\d+)/);
      const mark = match ? Number(match[1]) : 0;
      return [mark, 1];
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ embeddings }));
  });
  try {
    const attached = [];
    for (let index = 0; index < 10; index += 1) {
      attached.push({ path: `Notiz-${index}.md`, text: `MARKE-${index} steht allein.` });
    }
    const files = await prepareContextFiles({
      question: "MARKE-9",
      mentioned: [{ path: "Erwaehnt.md", text: "GANZER TEXT DER ERWAEHNUNG" }],
      attached,
      embedUrl: `http://127.0.0.1:${port}`,
      fetchImpl: globalThis.fetch,
    });
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.text]));
    assert.match(byPath["Notiz-9.md"], /MARKE-9/);
    assert.match(byPath["Notiz-2.md"], /MARKE-2/);
    assert.equal(byPath["Notiz-1.md"], PLACEHOLDER);
    assert.equal(byPath["Notiz-0.md"], PLACEHOLDER);
    assert.equal(byPath["Erwaehnt.md"], "GANZER TEXT DER ERWAEHNUNG");
    assert.equal(seen.length, 1);
    assert.equal(seen[0].input.includes("GANZER TEXT DER ERWAEHNUNG"), false);
  } finally {
    server.close();
  }
});

const GROSS_HINWEIS = "Diese Datei ist zu groß für den Auftrag. Lies sie mit action read und nur den Abschnitt, den die Frage braucht.";

test("eine Notiz über 128000 Bytes wird ohne Embedding zum Pfad", async () => {
  const { server, port } = await listen((req, res) => {
    if (req.url !== "/api/tags") {
      res.writeHead(500);
      res.end("embed darf nicht drankommen");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "glm-4.7-flash:latest" }] }));
  });
  const gross = { path: "Gross.md", text: "G".repeat(128001) };
  const genau = { path: "Genau.md", text: "K".repeat(128000) };
  const art = [];
  const basis = {
    question: "Nordflügel",
    embedUrl: `http://127.0.0.1:${port}`,
    fetchImpl: globalThis.fetch,
    onArt(name) { art.push(name); },
  };
  try {
    const zuGross = await prepareContextFiles({ ...basis, mentioned: [], attached: [gross] });
    assert.deepEqual(art, ["roh"]);
    assert.equal(zuGross[0].path, "Gross.md");
    assert.equal(zuGross[0].text, GROSS_HINWEIS);
    assert.equal(gross.text.length, 128001);
    const genauSo = await prepareContextFiles({ ...basis, mentioned: [], attached: [genau] });
    assert.deepEqual(art, ["roh", "roh"]);
    assert.equal(genauSo[0], genau);
    assert.equal(genau.text.length, 128000);
  } finally {
    server.close();
  }
});

test("zwei Notizen über der Summe werden verkleinert, bis sie in 128000 Bytes passen", async () => {
  const { server, port } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ models: [{ name: "glm-4.7-flash:latest" }] }));
  });
  const erste = { path: "Erste.md", text: "A".repeat(70000) };
  const zweite = { path: "Zweite.md", text: "B".repeat(90000) };
  const fehlt = { path: "Fehlt.md", missing: true };
  try {
    const files = await prepareContextFiles({
      question: "beide",
      mentioned: [],
      attached: [erste, zweite, fehlt],
      embedUrl: `http://127.0.0.1:${port}`,
      fetchImpl: globalThis.fetch,
    });
    assert.equal(files[0], erste);
    assert.equal(files[1].path, "Zweite.md");
    assert.equal(files[1].text, GROSS_HINWEIS);
    assert.equal(files[2], fehlt);
    assert.equal(erste.text, "A".repeat(70000));
    assert.equal(zweite.text.length, 90000);
    const summe = files.reduce((acc, file) => acc + Buffer.byteLength(String(file.text || ""), "utf8"), 0);
    assert.ok(summe <= 128000);
  } finally {
    server.close();
  }
});

test("ohne Einbettung ruft der Auftrag das Modell nicht und kürzt nur die große Datei", async () => {
  let called = 0;
  const art = [];
  const kurz = { path: "Kurz.md", text: "Der Nordflügel bleibt zu." };
  const gross = { path: "Gross.md", text: "G".repeat(128001) };
  const files = await prepareContextFiles({
    question: "Nordflügel",
    mentioned: [kurz],
    attached: [gross],
    embedUrl: "http://evil.example:11434",
    ohneEinbettung: true,
    fetchImpl: async () => {
      called += 1;
      throw new Error("nicht rufen");
    },
    onArt(name) { art.push(name); },
  });
  assert.equal(called, 0);
  assert.deepEqual(art, ["roh"]);
  assert.equal(files[0].text, GROSS_HINWEIS);
  assert.equal(files[1], kurz);
});

test("ein Treffer meldet Embedding, eine zu große Erwähnung bleibt draußen", async () => {
  const gesehen = [];
  const art = [];
  const { server, port } = await listen(async (req, res) => {
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "bge-m3:latest" }] }));
      return;
    }
    const body = await readBody(req);
    gesehen.push(...body.input);
    const embeddings = body.input.map((text) => [String(text).includes("MARKE") ? 1 : 0, 1]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ embeddings }));
  });
  const riesig = "R".repeat(128001);
  try {
    const files = await prepareContextFiles({
      question: "MARKE",
      mentioned: [{ path: "Riesig.md", text: riesig }],
      attached: [{ path: "Klein.md", text: "MARKE steht hier." }],
      embedUrl: `http://127.0.0.1:${port}`,
      fetchImpl: globalThis.fetch,
      onArt(name) { art.push(name); },
    });
    const byPath = Object.fromEntries(files.map((file) => [file.path, file.text]));
    assert.deepEqual(art, ["embedding"]);
    assert.match(byPath["Klein.md"], /MARKE/);
    assert.equal(byPath["Riesig.md"], GROSS_HINWEIS);
    assert.equal(gesehen.some((text) => String(text).includes(riesig.slice(0, 20))), false);
  } finally {
    server.close();
  }
});

test("eine fremde Adresse meldet die Art nicht", async () => {
  let art = "unberührt";
  await assert.rejects(
    () => prepareContextFiles({
      question: "Nordflügel",
      mentioned: [],
      attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
      embedUrl: "http://evil.example:11434",
      fetchImpl: async () => {
        throw new Error("nicht rufen");
      },
      onArt(name) { art = name; },
    }),
    (error) => error instanceof UnitedShareError && error.message === "Das lokale Embedding bleibt auf diesem Rechner.",
  );
  assert.equal(art, "unberührt");
});

test("bevorzugt wird bge-m3, ein gesetztes Modell muss installiert sein", () => {
  assert.equal(
    pickEmbedModel(["glm-4.7-flash:latest", "nomic-embed-text:latest"], ""),
    "nomic-embed-text:latest",
  );
  assert.equal(
    pickEmbedModel(["nomic-embed-text:latest", "bge-m3:latest"], ""),
    "bge-m3:latest",
  );
  assert.equal(pickEmbedModel(["nomic-embed-text:latest"], "bge-m3"), null);
  assert.equal(pickEmbedModel(["nomic-embed-text:latest"], "nomic-embed-text"), "nomic-embed-text:latest");
});

test("eine lange Notiz wird in Abschnitte geteilt", () => {
  const chunks = chunkNote("Lang.md", `${"A".repeat(700)}\n\n${"B".repeat(700)}`);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].path, "Lang.md");
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[0].text, "A".repeat(700));
  assert.equal(chunks[1].text, "B".repeat(700));
});

test("Anleitung und Fassung nennen das lokale Embedding", () => {
  const root = __dirname;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const src = fs.readFileSync(path.join(root, "main.src.js"), "utf8");
  assert.equal(manifest.version, "1.2.17");
  assert.equal(manifest.description.endsWith("."), true);
  assert.equal(manifest.description.length <= 250, true);
  assert.match(manifest.description, /Agent/);
  assert.match(manifest.description, /on-prem/);
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(readme.includes(`Release-Tag \`${manifest.version}\``), true);
  assert.equal(readme.includes("http://127.0.0.1:11434"), true);
  assert.equal(readme.includes("/api/embed"), true);
  assert.equal(readme.includes("api.unitedshare.ai"), true);
  assert.equal(main.includes('require("./unitedshare-core")'), false);
  assert.equal(main.includes("function prepareContextFiles"), true);
  assert.equal(main.includes("Notiz anhängen"), true);
  assert.equal(main.includes("Einfügen"), true);
  assert.equal(src.includes("geht die ganze Notiz mit der Frage an das Modell"), false);
  assert.equal(src.includes("eine große nur als Pfad"), true);
  assert.equal(readme.includes("eine angehängte Notiz geht im Ganzen mit"), false);
  assert.equal(readme.includes("die Notiz im Ganzen."), false);
  assert.equal(readme.includes("eine große nur als Pfad"), true);
  assert.equal(readme.includes("Agent im Tresor"), true);
  assert.equal(readme.includes("On-prem"), true);
  assert.equal(readme.includes("noch keinen eigenen Agentendienst"), false);
  assert.equal(readme.includes("zeigt derzeit Version 1.2.15"), false);
});
