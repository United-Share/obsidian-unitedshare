"use strict";

// Lange Aufgaben: eine stille Denkpause oder ein stilles Programm ist kein
// Netzausfall. Ein Bild ist ein eigener Auftrag, kein Textblock.

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const core = require("./unitedshare-core");
const {
  UnitedShareError,
  completeMessages,
  limitsFromBody,
  runVaultFile,
} = core;

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const BILD_URL = "https://api.unitedshare.ai/v1/images/generations";

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => fertig({ server, port: server.address().port }));
  });
}

function sseDelta(text) {
  return `event: content_block_delta\ndata: ${JSON.stringify({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  })}\n\n`;
}

function warten(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tempVault() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "us-lang-"));
  const root = path.join(parent, "vault");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "still.py"), "print('ok')\n");
  return { parent, root };
}

function kindDasSichSchließt() {
  let killed = false;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    killed = true;
    child.emit("close", null);
  };
  process.nextTick(() => {
    if (!killed) child.emit("close", 0);
  });
  return { child, killed: () => killed };
}

test("Stille vor dem ersten Byte bleibt unter der langen Frist offen", { timeout: 4000 }, async () => {
  const gemeldet = [];
  const { server, port } = await listen(async (_req, res) => {
    await warten(140);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(sseDelta("Da"));
  });
  try {
    const text = await completeMessages({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "k",
      model: "rmxos-mobil2026.1",
      turns: [{ role: "user", content: "Hallo" }],
      live: true,
      timeoutMs: 45,
      dauerMs: 2000,
      wartenNachMs: 20,
      onWarten: (hinweis) => gemeldet.push(hinweis),
    });
    assert.equal(text, "Da");
    assert.deepEqual(gemeldet, ["Die Aufgabe läuft noch."]);
    assert.equal(String(text).includes("nicht erreichbar"), false);
    assert.equal(String(text).includes("nicht rechtzeitig"), false);
  } finally {
    server.close();
  }
});

test("Bytes setzen die Leerlauf-Frist zurück, auch vor einem ganzen Textstück", { timeout: 4000 }, async () => {
  const { server, port } = await listen(async (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("event: content_block_del");
    await warten(80);
    res.write(`ta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "AB" },
    })}\n\n`);
    await warten(80);
    res.write(sseDelta("CD"));
    await warten(80);
    res.end(sseDelta("EF"));
  });
  try {
    const text = await completeMessages({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "k",
      model: "rmxos-mobil2026.1",
      turns: [{ role: "user", content: "Hallo" }],
      live: true,
      timeoutMs: 200,
      dauerMs: 3000,
    });
    assert.equal(text, "ABCDEF");
  } finally {
    server.close();
  }
});

test("nach Bytes beendet Leerlauf die Aufgabe, nicht die lange Frist", { timeout: 4000 }, async () => {
  let geschrieben = false;
  const { server, port } = await listen(async (req, res) => {
    await warten(120);
    geschrieben = !req.destroyed;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("event: noch-kein-text");
  });
  const start = Date.now();
  try {
    await assert.rejects(
      () => completeMessages({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "k",
        model: "rmxos-mobil2026.1",
        turns: [{ role: "user", content: "Hallo" }],
        live: true,
        timeoutMs: 80,
        dauerMs: 1500,
      }),
      (error) => {
        assert.match(error.message, /nicht rechtzeitig/);
        assert.equal(error.message.includes("nicht erreichbar"), false);
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(geschrieben, true);
    assert.ok(Date.now() - start < 500);
  } finally {
    server.close();
  }
});

test("ein geschlossener Port bleibt nicht erreichbar und wartet nicht die lange Frist", { timeout: 4000 }, async () => {
  const server = http.createServer();
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const { port } = server.address();
  await new Promise((fertig) => server.close(fertig));
  const start = Date.now();
  await assert.rejects(
    () => completeMessages({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "k",
      model: "rmxos-mobil2026.1",
      turns: [{ role: "user", content: "Hallo" }],
      live: true,
      timeoutMs: 50,
      dauerMs: 2000,
    }),
    (error) => {
      assert.match(error.message, /nicht erreichbar/);
      return true;
    },
  );
  assert.ok(Date.now() - start < 500);
});

test("eine abgebrochene Verbindung nach den Kopfzeilen wird nicht wiederholt", { timeout: 4000 }, async () => {
  let anfragen = 0;
  const { server, port } = await listen((req, res) => {
    anfragen += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("event: angefangen\n");
    req.socket.destroy();
  });
  try {
    await assert.rejects(
      () => completeMessages({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        apiKey: "k",
        model: "rmxos-mobil2026.1",
        turns: [{ role: "user", content: "Hallo" }],
        live: true,
        timeoutMs: 2000,
        dauerMs: 3000,
      }),
      (error) => {
        assert.equal(error.message, "Die Verbindung endete, während die Aufgabe noch lief.");
        assert.equal(error.retryable, false);
        assert.equal(error.message.includes("nicht erreichbar"), false);
        return true;
      },
    );
    assert.equal(anfragen, 1);
  } finally {
    server.close();
  }
});

test("ohne Frist bleibt ein stilles Programm bis zur langen Decke offen", async () => {
  const { parent, root } = tempVault();
  const delays = [];
  const original = global.setTimeout;
  global.setTimeout = (fn, ms, ...rest) => {
    delays.push(Number(ms));
    return original(fn, ms, ...rest);
  };
  try {
    const hinweise = [];
    const lauf = kindDasSichSchließt();
    const ergebnis = await runVaultFile({
      root,
      relPath: "still.py",
      spawnImpl: () => lauf.child,
      onAktiv: (text) => hinweise.push(text),
    });
    assert.match(ergebnis, /code 0/);
    assert.equal(lauf.killed(), false);
    assert.ok(delays.includes(600000));
    assert.deepEqual(hinweise, ["Die Aufgabe läuft noch."]);
  } finally {
    global.setTimeout = original;
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("eine ausdrücklich kurze Frist beendet das Programm trotzdem", async () => {
  const { parent, root } = tempVault();
  const delays = [];
  const original = global.setTimeout;
  global.setTimeout = (fn, ms, ...rest) => {
    delays.push(Number(ms));
    return original(fn, ms, ...rest);
  };
  try {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("close", null);
    await assert.rejects(
      () => runVaultFile({
        root,
        relPath: "still.py",
        timeoutMs: 30,
        spawnImpl: () => child,
      }),
      /Frist/,
    );
    assert.ok(delays.includes(30));
    assert.equal(delays.includes(600000), false);
  } finally {
    global.setTimeout = original;
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

function bildAntwort(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {},
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("generateImage schickt reemax-image und liest b64_json ohne zweiten Abruf", async () => {
  assert.equal(typeof core.generateImage, "function");
  const calls = [];
  const bild = await core.generateImage({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "geheim",
    prompt: "eine rote Kugel",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return bildAntwort({ data: [{ b64_json: PNG }] });
    },
    onWarten: (text) => calls.push({ warten: text }),
  });
  assert.equal(calls[0].warten, "Die Aufgabe läuft noch.");
  assert.equal(calls[1].url, BILD_URL);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers.Authorization, "Bearer geheim");
  assert.equal(calls[1].init.headers["Content-Type"], "application/json");
  assert.equal(typeof calls[1].init.headers["Content-Length"], "string");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    prompt: "eine rote Kugel",
    model: "reemax-image",
  });
  assert.equal(calls.length, 2);
  assert.equal(bild.mime, "image/png");
  assert.equal(bild.prompt, "eine rote Kugel");
  assert.equal(bild.b64.length > 20, true);
  const bytes = core.bytesFromB64(bild.b64);
  assert.equal(bytes[0], 0x89);
  assert.equal(bytes[1], 0x50);
});

test("generateImage setzt Größe und Format nur, wenn sie gelten", async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return bildAntwort({ data: [{ b64_json: PNG }] });
  };
  const basis = {
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "geheim",
    fetchImpl,
  };
  await core.generateImage({ ...basis, prompt: "hoch", breite: 576, hoehe: 1024, format: "gif" });
  assert.deepEqual(bodies[0], {
    prompt: "hoch",
    model: "reemax-image",
    size: "576x1024",
    output_format: "gif",
  });
  await core.generateImage({ ...basis, prompt: "klein", breite: 10, hoehe: 10, format: "nope" });
  assert.deepEqual(bodies[1], { prompt: "klein", model: "reemax-image" });
  await core.generateImage({ ...basis, prompt: "text", breite: "1024", hoehe: "768", format: "jpg" });
  assert.deepEqual(bodies[2], {
    prompt: "text",
    model: "reemax-image",
    size: "1024x768",
    output_format: "jpeg",
  });
  const gifBytes = Uint8Array.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x3b,
  ]);
  const gif = await core.generateImage({
    ...basis,
    prompt: "gif",
    fetchImpl: async () => bildAntwort({ data: [{ b64_json: core.b64FromBytes(gifBytes) }] }),
  });
  assert.equal(gif.mime, "image/gif");
});

test("eine data-URL wird gelesen, ein fremder Host nicht geholt", async () => {
  const dataUrl = `data:image/png;base64,${PNG}`;
  let abrufe = 0;
  const ausDaten = await core.generateImage({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "geheim",
    prompt: "data",
    fetchImpl: async () => {
      abrufe += 1;
      return bildAntwort({ data: [{ url: dataUrl }] });
    },
  });
  assert.equal(abrufe, 1);
  assert.equal(ausDaten.mime, "image/png");

  abrufe = 0;
  await assert.rejects(
    () => core.generateImage({
      baseUrl: "https://api.unitedshare.ai/v1",
      apiKey: "geheim",
      prompt: "fremd",
      fetchImpl: async () => {
        abrufe += 1;
        return bildAntwort({ data: [{ url: "https://evil.example/bild.png" }] });
      },
    }),
    (error) => {
      assert.equal(error.message, "Das Bild kommt nicht von api.unitedshare.ai.");
      return true;
    },
  );
  assert.equal(abrufe, 1);
});

test("eine Bildadresse desselben Hosts geht mit dem Schlüssel und arrayBuffer", async () => {
  const calls = [];
  const png = Buffer.from(PNG, "base64");
  const bild = await core.generateImage({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "geheim",
    prompt: "gleicher host",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return bildAntwort({
          data: [{ url: "https://api.unitedshare.ai/v1/files/a.png" }],
        });
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "image/png" : "") },
        async arrayBuffer() {
          return png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
        },
      };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, "Bearer geheim");
  assert.equal(bild.mime, "image/png");
});

test("ohne Bildbeschreibung geht kein Auftrag hinaus", async () => {
  let abrufe = 0;
  await assert.rejects(
    () => core.generateImage({
      baseUrl: "https://api.unitedshare.ai/v1",
      apiKey: "geheim",
      prompt: "   ",
      fetchImpl: async () => {
        abrufe += 1;
        return bildAntwort({});
      },
    }),
    (error) => {
      assert.equal(error.message, "Beschreibe das Bild.");
      return true;
    },
  );
  assert.equal(abrufe, 0);
});

test("ein volles Tageslimit am Bild nennt die Auflade-Seite und verwirft eine fremde Adresse", async () => {
  const fehler = await core.generateImage({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "geheim",
    prompt: "zu viel",
    fetchImpl: async () => bildAntwort({
      limits: { rest_tag: 0, rest_monat: 10, aufladen_url: "nicht hier" },
      aufladen_url: "javascript:alert(1)",
    }, 429),
  }).then(() => {
    throw new Error("429 muss scheitern");
  }, (error) => error);
  assert.ok(fehler instanceof UnitedShareError);
  assert.equal(fehler.message, "Das Tageslimit ist aufgebraucht.");
  assert.equal(fehler.aufladenUrl, "https://unitedshare.ai/app/budget/");
  assert.deepEqual(fehler.limits, { rest_tag: 0, rest_monat: 10 });

  const gut = await core.generateImage({
    baseUrl: "https://api.unitedshare.ai/v1",
    apiKey: "geheim",
    prompt: "plan",
    fetchImpl: async () => bildAntwort({
      limits: { rest_tag: 0 },
      aufladen_url: "https://unitedshare.ai/app/budget/nachkauf",
    }, 429),
  }).then(() => null, (error) => error);
  assert.equal(gut.aufladenUrl, "https://unitedshare.ai/app/budget/nachkauf");
});

test("eine abgebrochene Bildaufgabe heißt nicht, der Dienst sei weg", async () => {
  let gesehen = "";
  await assert.rejects(
    () => core.generateImage({
      baseUrl: "https://api.unitedshare.ai/v1",
      apiKey: "geheim",
      prompt: "dauert",
      timeoutMs: 30,
      fetchImpl: () => new Promise(() => {}),
      onWarten: (text) => {
        gesehen = text;
      },
    }),
    (error) => {
      assert.equal(error.message, "Die Bildaufgabe wurde nicht fertig.");
      assert.equal(error.message.includes("nicht erreichbar"), false);
      return true;
    },
  );
  assert.equal(gesehen, "Die Aufgabe läuft noch.");
});

test("ein geschlossener Bild-Port bleibt nicht erreichbar", { timeout: 4000 }, async () => {
  const server = http.createServer();
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  const { port } = server.address();
  await new Promise((fertig) => server.close(fertig));
  await assert.rejects(
    () => core.generateImage({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "geheim",
      prompt: "lokal zu",
    }),
    (error) => {
      assert.match(error.message, /nicht erreichbar/);
      return true;
    },
  );
});

test("svg und javascript sind kein Bild", async () => {
  for (const url of [
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    "data:text/javascript,alert(1)",
  ]) {
    await assert.rejects(
      () => core.generateImage({
        baseUrl: "https://api.unitedshare.ai/v1",
        apiKey: "geheim",
        prompt: "böse",
        fetchImpl: async () => bildAntwort({ data: [{ url }] }),
      }),
      (error) => {
        assert.equal(error.message, "Das Bild hat kein zulässiges Format.");
        return true;
      },
    );
  }
});

test("limitsFromBody lässt die Auflade-Adresse weg", () => {
  assert.deepEqual(limitsFromBody({
    limits: { rest_tag: 3, aufladen_url: "https://unitedshare.ai/app/budget/" },
    aufladen_url: "https://unitedshare.ai/app/budget/",
  }), { rest_tag: 3 });
  assert.equal(core.aufladenAdresse("https://evil.example/app/budget"), "https://unitedshare.ai/app/budget/");
  assert.equal(
    core.aufladenAdresse({ aufladen_url: "https://unitedshare.ai/app/budget/nachkauf" }),
    "https://unitedshare.ai/app/budget/nachkauf",
  );
});

test("Quellen nennen die lange Frist, das Bild und die Auflade-Seite", () => {
  const root = __dirname;
  const main = fs.readFileSync(path.join(root, "main.src.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.match(main, /dauerMs:\s*600000/);
  assert.equal(manifest.version, "1.2.12");
  assert.match(css, /\.unitedshare-bild\.is-laden\s*\{[^}]*aspect-ratio:\s*var\(--unitedshare-bild-ratio/);
  assert.equal(readme.includes("enthält nur Textblöcke"), true);
  assert.equal(readme.includes("POST /v1/images/generations"), true);
  assert.equal(readme.includes("reemax-image"), true);
  assert.equal(readme.includes("**Bild**"), true);
  assert.equal(
    readme.includes("Eine Aufgabe, die noch läuft und nichts ausgibt, bleibt bis zur langen Frist offen. Eine ausdrücklich kurze Frist beendet sie trotzdem."),
    true,
  );
  assert.equal(readme.includes("In den Einstellungen steht **Token aufladen**."), true);
  const bild = css.match(/\.unitedshare-bild\s*\{([^}]*)\}/);
  const img = css.match(/\.unitedshare-bild img\s*\{([^}]*)\}/);
  const knopf = css.match(/\.unitedshare-bild-btn\s*\{([^}]*)\}/);
  const hover = css.match(/\.unitedshare-bild-btn:hover\s*\{([^}]*)\}/);
  assert.ok(bild && /display:\s*flex/.test(bild[1]) && /gap:\s*6px/.test(bild[1]));
  assert.ok(img && /max-width:\s*min\(100%,\s*360px\)/.test(img[1]));
  assert.ok(knopf && /width:\s*22px/.test(knopf[1]) && /height:\s*22px/.test(knopf[1]));
  assert.ok(hover && /--background-modifier-hover/.test(hover[1]));
});
