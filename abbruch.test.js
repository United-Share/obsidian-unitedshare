"use strict";

// Ein haengender Chat ist der schlimmste Zustand: keine Meldung, kein Ende,
// kein Plan. Diese Vertraege halten fest, dass ein Auftrag von aussen
// abgebrochen werden kann (Stopp-Knopf), dass eine nie in Gang kommende
// Antwort nach der Stille-Frist mit klarer Meldung endet -- und dass
// gestartete Tresor-Programme beim Abbruch sterben, statt weiterzuschreiben.

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  UnitedShareError,
  completeMessages,
  executeVaultAction,
  runVaultFile,
  runVaultInstruction,
} = require("./unitedshare-core");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => fertig({ server, port: server.address().port }));
  });
}

function schliessen(server) {
  server.close();
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
}

function basis(port, extra = {}) {
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: "k",
    model: "m",
    form: "chat",
    turns: [{ role: "user", content: "Hallo" }],
    live: true,
    dauerMs: 600000,
    timeoutMs: 3000,
    ...extra,
  };
}

test("ein äußerer Abbruch beendet die wartende Antwort und nennt sich beim Namen", { timeout: 5000 }, async () => {
  let verbunden = false;
  const { server, port } = await listen((_req, res) => {
    verbunden = true;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // Erstes Byte kommt an, danach herrscht Stille. Ohne Abbruch wartete der
    // Auftrag bis zur Stille-Frist.
  });
  const steuer = new AbortController();
  setTimeout(() => steuer.abort(), 60);
  try {
    await assert.rejects(
      () => completeMessages(basis(port, { signal: steuer.signal })),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.message, "Der Auftrag wurde abgebrochen.");
        assert.equal(error.abgebrochen, true);
        // Nicht wiederholbar: der Nutzer hat selbst abgebrochen.
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(verbunden, true);
  } finally {
    schliessen(server);
  }
});

test("ein bereits abgebrochenes Signal startet die Anfrage gar nicht erst", { timeout: 5000 }, async () => {
  let anfragen = 0;
  const { server, port } = await listen((_req, res) => {
    anfragen += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end("event: message_start\ndata: {\"type\":\"message_start\"}\n\n");
  });
  const steuer = new AbortController();
  steuer.abort();
  try {
    await assert.rejects(
      () => completeMessages(basis(port, { signal: steuer.signal })),
      (error) => {
        assert.equal(error.message, "Der Auftrag wurde abgebrochen.");
        assert.equal(error.abgebrochen, true);
        return true;
      },
    );
    assert.equal(anfragen, 0);
  } finally {
    schliessen(server);
  }
});

test("ein Abbruch, der zwischen Prüfung und Eintragen feuert, wird nicht verpasst", { timeout: 5000 }, async () => {
  // Deckt die Lücke zwischen der ersten Prüfung und dem Eintragen des
  // Zuhoerers ab: ein Signal, das genau dazwischen abbricht, darf den Auftrag
  // nicht bis zur harten Frist hängen lassen.
  let anfragen = 0;
  const { server, port } = await listen((_req, res) => {
    anfragen += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // Kein Byte Inhalt: ohne den Fix bliebe dieser Aufruf bis zur harten
    // Frist offen -- und der Test liefe in seinen eigenen Timeout.
  });
  let zugegriffen = 0;
  // Die erste Abfrage (Vortest) sagt "noch nicht abgebrochen"; jede weitere
  // sagt "abgebrochen". So faellt der Abbruch exakt in das Zeitfenster
  // zwischen Vortest und Nachpruefung.
  const signal = {
    get aborted() {
      zugegriffen += 1;
      return zugegriffen > 1;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  try {
    await assert.rejects(
      () => completeMessages(basis(port, { signal, stilleMs: 100, timeoutMs: 60000, onWarten: () => {} })),
      (error) => {
        assert.equal(error.message, "Der Auftrag wurde abgebrochen.");
        assert.equal(error.abgebrochen, true);
        return true;
      },
    );
    assert.equal(anfragen, 0, "die Anfrage darf nach dem Abbruch gar nicht erst starten");
  } finally {
    schliessen(server);
  }
});

test("ohne ein einziges Byte endet der Auftrag nach der Stille-Frist mit klarer Meldung", { timeout: 6000 }, async () => {
  let verbunden = false;
  const { server, port } = await listen((_req, res) => {
    verbunden = true;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // Nur die Header, kein Byte Inhalts. Genau der Fall "haengt, keine Meldung".
  });
  const start = Date.now();
  try {
    await assert.rejects(
      () => completeMessages(basis(port, {
        stilleMs: 200,
        timeoutMs: 60000,
        onWarten: () => {},
      })),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.match(error.message, /kam nicht in Gang/);
        assert.match(error.message, /lang kam nichts vom Modell/);
        assert.equal(error.abgebrochen, undefined);
        return true;
      },
    );
    const gedauert = Date.now() - start;
    assert.ok(gedauert >= 190, `Stille-Frist griff zu frueh: ${gedauert} ms`);
    assert.ok(gedauert < 5000, `Stille-Frist griff nicht: ${gedauert} ms`);
    assert.equal(verbunden, true);
  } finally {
    schliessen(server);
  }
});

test("nach dem ersten Byte entschärft touch die Stille-Frist und die Antwort kommt an", { timeout: 6000 }, async () => {
  const { server, port } = await listen(async (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    // Mitten in der Stille-Frist kommt das erste Byte: die Frist wird
    // entschaerft, die Leerlauf-Frist (timeoutMs) uebernimmt.
    await new Promise((f) => setTimeout(f, 80));
    if (res.destroyed) return;
    res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Da"}}\n\n');
    await new Promise((f) => setTimeout(f, 120));
    if (res.destroyed) return;
    res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" ist sie"}}\n\n');
    res.end();
  });
  try {
    const text = await completeMessages(basis(port, {
      stilleMs: 200,
      timeoutMs: 2000,
    }));
    assert.equal(text, "Da ist sie");
  } finally {
    schliessen(server);
  }
});

test("runVaultFile tötet ein laufendes Programm beim äußeren Abbruch mit SIGKILL", { timeout: 8000 }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "unitedshare-ab-"));
  const datei = path.join(ordner, "lauf.js");
  fs.writeFileSync(datei, "setInterval(() => {}, 1000);\n");
  const kinder = [];
  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.stdout = new EventEmitter();
      this.stderr = new EventEmitter();
      this.kills = [];
      kinder.push(this);
    }
    kill(signal) {
      this.kills.push(signal);
      // Ein echtes Kind stirbt: close kommt verzoegert zurueck.
      setTimeout(() => this.emit("close", signal === "SIGKILL" ? 137 : 0), 5);
      return true;
    }
  }
  const spawnImpl = () => new FakeChild();
  const steuer = new AbortController();
  try {
    const lauf = runVaultFile({
      abs: datei,
      cwd: ordner,
      relPath: "lauf.js",
      spawnImpl,
      env: {},
      signal: steuer.signal,
    });
    setTimeout(() => steuer.abort(), 40);
    await assert.rejects(lauf, (error) => {
      assert.equal(error.message, "Der Auftrag wurde abgebrochen.");
      assert.equal(error.abgebrochen, true);
      return true;
    });
    assert.equal(kinder.length, 1);
    assert.deepEqual(kinder[0].kills, ["SIGKILL"]);
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test("runVaultFile mit bereits abgebrochenem Signal startet das Programm nicht", { timeout: 5000 }, async () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), "unitedshare-ab2-"));
  const datei = path.join(ordner, "lauf.js");
  fs.writeFileSync(datei, "console.log('darf nicht starten');\n");
  let gestartet = 0;
  const spawnImpl = () => { gestartet += 1; throw new Error("darf nicht spawnen"); };
  const steuer = new AbortController();
  steuer.abort();
  try {
    await assert.rejects(
      () => runVaultFile({
        abs: datei,
        cwd: ordner,
        relPath: "lauf.js",
        spawnImpl,
        env: {},
        signal: steuer.signal,
      }),
      (error) => {
        assert.equal(error.abgebrochen, true);
        return true;
      },
    );
    assert.equal(gestartet, 0);
  } finally {
    fs.rmSync(ordner, { recursive: true, force: true });
  }
});

test("executeVaultAction meldet den Ausgang abgebrochen, wenn der Lauf hart stirbt", async () => {
  const gesehen = [];
  const host = {
    run: async (rel, optionen) => {
      gesehen.push(optionen && optionen.signal);
      const error = new UnitedShareError("Der Auftrag wurde abgebrochen.", 0);
      error.abgebrochen = true;
      throw error;
    },
  };
  const text = await executeVaultAction(
    { action: "run", path: "werkzeug.py" },
    host,
    {
      confirm: async () => true,
      signal: { aborted: false },
      onAusgang: (zustand) => gesehen.push(`ausgang:${zustand}`),
    },
  );
  assert.match(text, /Der Auftrag wurde abgebrochen\./);
  // Zuerst das durchgereichte Signal, zuletzt der Ausgang -- und der ist
  // "abgebrochen", nicht "fehlgeschlagen".
  assert.deepEqual(gesehen[0], { aborted: false });
  assert.equal(gesehen[gesehen.length - 1], "ausgang:abgebrochen");
});

test("executeVaultAction reicht das Signal an meshJoin und sync weiter", async () => {
  const steuer = new AbortController();
  const gesehen = [];
  const host = {
    meshJoin: async (_rel, optionen) => { gesehen.push(optionen); return "verbunden"; },
    sync: async (request) => { gesehen.push(request); return "abgeglichen"; },
  };
  const optionen = { confirm: async () => true, signal: steuer.signal };
  await executeVaultAction({ action: "mesh-join", path: "einladung.txt" }, host, optionen);
  await executeVaultAction({ action: "sync", peer: "zweitgeraet", direction: "push" }, host, optionen);
  assert.equal(gesehen[0].signal, steuer.signal);
  assert.equal(gesehen[1].signal, steuer.signal);
});

test("ein Nutzerabbruch trägt keine Werkzeug-Warnung an seiner Meldung", { timeout: 8000 }, async () => {
  // Der Warnsatz über bereits bearbeitete Werkzeugschritte gilt einem
  // Fehlschlag, nicht einem bewussten Stopp. Sonst stünde an der klaren
  // Abbruchmeldung ein Satz, der einen Unfall nahelegt.
  const steuer = new AbortController();
  const fence = (action) => ["```unitedshare", JSON.stringify(action), "```"].join("\n");
  let runde = 0;
  let gesehen = null;
  // Nach der ersten Runde (eine Werkzeugaktion) bricht der Nutzer ab.
  const complete = async () => {
    runde += 1;
    if (runde === 1) return fence({ action: "read", path: "notiz.md" });
    // Zweite Runde: der Abbruch ist gefallen, der Aufruf meldet ihn.
    if (!steuer.signal.aborted) steuer.abort();
    const error = new UnitedShareError("Der Auftrag wurde abgebrochen.", 0);
    error.abgebrochen = true;
    throw error;
  };
  await assert.rejects(
    () => runVaultInstruction({
      turns: [{ role: "user", content: "Lies die Notiz." }],
      host: { read: async () => "Inhalt" },
      signal: steuer.signal,
      confirm: async () => true,
      complete,
    }).catch((error) => {
      gesehen = error;
      throw error;
    }),
    (error) => {
      assert.equal(error.message, "Der Auftrag wurde abgebrochen.");
      assert.equal(error.message.includes("Werkzeugschritte"), false);
      return true;
    },
  );
  assert.ok(gesehen);
  assert.equal(gesehen.abgebrochen, true);
});

test("runVaultInstruction reicht das Signal an den Modellaufruf durch", async () => {
  const steuer = new AbortController();
  let gesehen = null;
  await runVaultInstruction({
    turns: [{ role: "user", content: "Fasse zusammen." }],
    host: {},
    signal: steuer.signal,
    complete: async () => {
      gesehen = steuer.signal;
      return "Hier die Zusammenfassung.";
    },
  });
  assert.equal(gesehen, steuer.signal);
});

test("runVaultInstruction reicht das Signal bis in die Werkzeugschritte durch", async () => {
  const steuer = new AbortController();
  const schritte = [];
  const signale = [];
  let runde = 0;
  const fence = (action) => ["```unitedshare", JSON.stringify(action), "```"].join("\n");
  await runVaultInstruction({
    turns: [{ role: "user", content: "Führe das Skript aus." }],
    host: {
      run: async (_rel, optionen) => {
        signale.push(optionen && optionen.signal);
        return "code 0\nfertig";
      },
    },
    signal: steuer.signal,
    confirm: async () => true,
    complete: async () => {
      runde += 1;
      if (runde === 1) return fence({ action: "run", path: "werkzeug.py" });
      return "Erledigt.";
    },
    onSchritt: (schritt) => schritte.push(schritt),
  });
  // Der Schritt lief und wurde als fertig gemeldet...
  assert.ok(schritte.some((s) => s.zustand === "fertig"));
  // ...und der Auftrag hat sein Signal bis in den Werkzeuglauf gereicht.
  assert.equal(signale.length, 1);
  assert.equal(signale[0], steuer.signal);
});
