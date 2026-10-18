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

test("ohne passendes Modell bleibt die Frage hier", async () => {
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
    await assert.rejects(
      () => prepareContextFiles(base),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.message, "Auf diesem Rechner liegt kein passendes Embedding-Modell.");
        return true;
      },
    );
    await assert.rejects(
      () => prepareContextFiles({ ...base, embedModel: "bge-m3" }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.message, "Das Embedding-Modell liegt auf diesem Rechner nicht.");
        return true;
      },
    );
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

test("ein stiller Dienst bricht vor dem Modell ab", async () => {
  const { server, port } = await listen(() => {});
  try {
    await assert.rejects(
      () => prepareContextFiles({
        question: "Nordflügel",
        mentioned: [],
        attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
        embedUrl: `http://127.0.0.1:${port}`,
        fetchImpl: globalThis.fetch,
        timeoutMs: 50,
      }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.message, "Das lokale Embedding auf diesem Rechner antwortet nicht.");
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("Status ungleich 200 und ein einzelner Vektor brechen ab", async () => {
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
    await assert.rejects(
      () => prepareContextFiles({
        question: "Nordflügel",
        mentioned: [],
        attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
        embedUrl: `http://127.0.0.1:${port}`,
        fetchImpl: globalThis.fetch,
      }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.message, "Das lokale Embedding auf diesem Rechner antwortet nicht.");
        return true;
      },
    );
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
    await assert.rejects(
      () => prepareContextFiles({
        question: "Nordflügel",
        mentioned: [],
        attached: [{ path: "Probe.md", text: "Der Nordflügel bleibt zu." }],
        embedUrl: `http://127.0.0.1:${single.port}`,
        fetchImpl: globalThis.fetch,
      }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.message, "Die Antwort des lokalen Embeddings war nicht lesbar.");
        return true;
      },
    );
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
  assert.equal(manifest.version, "1.2.13");
  assert.equal(manifest.description.endsWith("."), true);
  assert.equal(manifest.description.length <= 250, true);
  assert.equal(manifest.isDesktopOnly, false);
  assert.equal(readme.includes(`Release-Tag \`${manifest.version}\``), true);
  assert.equal(readme.includes("http://127.0.0.1:11434"), true);
  assert.equal(readme.includes("/api/embed"), true);
  assert.equal(readme.includes("api.unitedshare.ai"), true);
  assert.equal(main.includes('require("./unitedshare-core")'), false);
  assert.equal(main.includes("function prepareContextFiles"), true);
  assert.equal(main.includes("Notiz anhängen"), true);
  assert.equal(main.includes("Einfügen"), true);
});
