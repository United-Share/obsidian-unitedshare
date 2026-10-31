"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  UnitedShareError,
  chunkNote,
  dateienAusTreffern,
  indexNachziehen,
  indexPlan,
  locateDuckdb,
  mischeDateien,
  notizStand,
  sucheImTresor,
  sucheStuecke,
  tresorIndexPfad,
  zeilenMitVektoren,
} = require("./unitedshare-core");

const DIM = 1024;

function nodePlatte() {
  return {
    async exists(rel) {
      return fs.existsSync(rel);
    },
    async write(rel, text) {
      fs.mkdirSync(path.dirname(rel), { recursive: true });
      fs.writeFileSync(rel, String(text ?? ""));
    },
    async remove(rel) {
      if (fs.existsSync(rel)) fs.unlinkSync(rel);
    },
    async full(rel) {
      return rel;
    },
  };
}
const MODELL_FEHLER = "Der Tresor-Index nutzt bge-m3 auf diesem Rechner.";
const RAUM_FEHLER = "Der Tresor-Index bleibt im Raum bge-m3.";
const KOERPER_FEHLER = "Die Antwort des lokalen Embeddings war nicht lesbar.";
const DUCKDB = "/opt/homebrew/bin/duckdb";

function achse(index, wert = 1) {
  const row = new Array(DIM).fill(0);
  row[index] = wert;
  return row;
}

function jsonAntwort(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: "http://127.0.0.1:11434/api/embed",
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

function embedServer(vectorsFor) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const target = String(url);
    if (target.endsWith("/api/tags")) {
      return jsonAntwort({ models: [{ name: "bge-m3:latest" }] });
    }
    const body = JSON.parse(opts.body);
    const headers = opts.headers || {};
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers["X-API-Key"], undefined);
    assert.equal(String(body.model).split(":")[0], "bge-m3");
    for (const text of body.input) {
      assert.equal(String(text).startsWith("Represent this sentence"), false);
    }
    return jsonAntwort({ embeddings: body.input.map((text) => vectorsFor(String(text))) });
  };
  return { calls, fetchImpl };
}

function kindProzess({ onSql }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let sql = "";
  child.stdin = {
    write(chunk) {
      sql += String(chunk);
    },
    end() {
      const antwort = onSql(sql);
      process.nextTick(() => {
        if (antwort && antwort.stderr) child.stderr.emit("data", antwort.stderr);
        if (antwort && antwort.stdout) child.stdout.emit("data", antwort.stdout);
        child.emit("close", antwort && antwort.code ? antwort.code : 0);
      });
    },
  };
  child.kill = () => {};
  return child;
}

test("der Stand ist der SHA-256 der ganzen Notiz", () => {
  const text = "Alpha\n";
  const erwartet = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  assert.equal(notizStand(text), erwartet);
  assert.notEqual(notizStand(text), notizStand("Alpha"));
});

test("unveränderte Notizen bleiben, geänderte werden neu zerlegt, fehlende fallen weg", () => {
  const alt = notizStand("Alpha bleibt.");
  const plan = indexPlan(
    [
      { pfad: "A.md", stand: alt },
      { pfad: "B.md", stand: notizStand("Beta alt") },
      { pfad: "Weg.md", stand: notizStand("weg") },
    ],
    [
      { pfad: "A.md", text: "Alpha bleibt." },
      { pfad: "B.md", text: "Beta neu" },
      { pfad: "Neu.md", text: "frisch" },
      { pfad: "Leer.md", text: "   " },
    ],
  );
  assert.equal(plan.behalten, 1);
  assert.deepEqual(plan.loeschen.slice().sort(), ["B.md", "Weg.md"]);
  const pfade = [...new Set(plan.neu.map((row) => row.pfad))];
  assert.deepEqual(pfade, ["B.md", "Neu.md"]);
  const stueck = chunkNote("B.md", "Beta neu")[0];
  assert.deepEqual(plan.neu[0], {
    pfad: "B.md",
    stueck: stueck.index,
    text: stueck.text,
    stand: notizStand("Beta neu"),
  });
});

test("eine leere Notiz löscht die alten Stücke und legt keine neuen an", () => {
  const plan = indexPlan(
    [{ pfad: "Leer.md", stand: "alt" }],
    [{ pfad: "Leer.md", text: "" }],
  );
  assert.deepEqual(plan.loeschen, ["Leer.md"]);
  assert.deepEqual(plan.neu, []);
  assert.equal(plan.behalten, 0);
});

test("Vektoren werden auf bge-m3 gelegt und auf Länge 1 gebracht", () => {
  const zeilen = zeilenMitVektoren(
    [{ pfad: "A.md", stueck: 0, text: "Alpha", stand: "s" }],
    [achse(0, 3)],
    "bge-m3:latest",
  );
  assert.equal(zeilen[0].raum, "bge-m3");
  assert.equal(zeilen[0].modell, "bge-m3:latest");
  assert.equal(zeilen[0].vektor[0], 1);
  assert.equal(zeilen[0].text, "Alpha");
});

test("ein anderer Modellstamm wird nicht in den bge-m3-Raum geschrieben", () => {
  assert.throws(
    () => zeilenMitVektoren(
      [{ pfad: "A.md", stueck: 0, text: "Alpha", stand: "s" }],
      [achse(0)],
      "mxbai-embed-large",
    ),
    (error) => error instanceof UnitedShareError && error.message === MODELL_FEHLER,
  );
});

test("eine falsche Vektorlänge wird abgelehnt", () => {
  assert.throws(
    () => zeilenMitVektoren(
      [{ pfad: "A.md", stueck: 0, text: "Alpha", stand: "s" }],
      [achse(0), achse(1)],
      "bge-m3",
    ),
    (error) => error instanceof UnitedShareError && error.message === KOERPER_FEHLER,
  );
  assert.throws(
    () => zeilenMitVektoren(
      [{ pfad: "A.md", stueck: 0, text: "Alpha", stand: "s" }],
      [[1, 2, 3]],
      "bge-m3",
    ),
    (error) => error instanceof UnitedShareError && error.message === KOERPER_FEHLER,
  );
});

test("die Suche bleibt im Raum bge-m3 und gibt den Satz ohne Vektor zurück", () => {
  const zeilen = [
    { raum: "bge-m3", pfad: "B.md", stueck: 0, text: "Beta", vektor: achse(1) },
    { raum: "bge-m3", pfad: "A.md", stueck: 1, text: "Alpha zwei", vektor: achse(0) },
    { raum: "bge-m3", pfad: "A.md", stueck: 0, text: "Alpha eins", vektor: achse(0) },
    { raum: "bge-m3", pfad: "C.md", stueck: 0, text: "fern", vektor: achse(2) },
  ];
  const treffer = sucheStuecke(achse(0), zeilen, 2);
  assert.deepEqual(treffer, [
    { pfad: "A.md", stueck: 0, text: "Alpha eins", score: 1 },
    { pfad: "A.md", stueck: 1, text: "Alpha zwei", score: 1 },
  ]);
  assert.equal(Object.hasOwn(treffer[0], "vektor"), false);
  assert.throws(
    () => sucheStuecke(achse(0), [{ raum: "mxbai", pfad: "F.md", stueck: 0, text: "x", vektor: achse(0) }], 4),
    (error) => error instanceof UnitedShareError && error.message === RAUM_FEHLER,
  );
});

test("ein schwacher Treffer bleibt in der Liste", () => {
  const treffer = sucheStuecke(achse(3), [
    { raum: "bge-m3", pfad: "A.md", stueck: 0, text: "weit", vektor: achse(0) },
  ], 4);
  assert.equal(treffer.length, 1);
  assert.ok(treffer[0].score < 0.35);
});

test("höchstens acht Stücke, vier wenn nichts genannt ist", () => {
  const zeilen = [];
  for (let index = 0; index < 9; index += 1) {
    zeilen.push({
      raum: "bge-m3",
      pfad: `N${index}.md`,
      stueck: 0,
      text: `Satz ${index}`,
      vektor: achse(0),
    });
  }
  assert.equal(sucheStuecke(achse(0), zeilen).length, 4);
  assert.equal(sucheStuecke(achse(0), zeilen, 100).length, 8);
});

test("Anhänge gewinnen vor dem Tresor, die Reihenfolge der Treffer bleibt", () => {
  const dateien = dateienAusTreffern([
    { pfad: "A.md", stueck: 1, text: "zweiter", score: 0.9 },
    { pfad: "B.md", stueck: 0, text: "beta", score: 0.5 },
    { pfad: "A.md", stueck: 0, text: "erster", score: 0.4 },
  ]);
  assert.deepEqual(dateien, [
    { path: "A.md", text: "zweiter\n\nerster" },
    { path: "B.md", text: "beta" },
  ]);
  const gemischt = mischeDateien(
    [{ path: "A.md", text: "ANGEHANGEN" }],
    [{ path: "A.md", text: "INDEX" }, { path: "B.md", text: "NEU" }],
  );
  assert.deepEqual(gemischt, [
    { path: "A.md", text: "ANGEHANGEN" },
    { path: "B.md", text: "NEU" },
  ]);
});

test("der Index liegt neben dem Plugin", () => {
  assert.equal(tresorIndexPfad(""), "");
  assert.equal(path.basename(tresorIndexPfad("/tmp/plugin")), "vault-index.duckdb");
});

test("DuckDB wird auf diesem Rechner gesucht", () => {
  assert.equal(locateDuckdb({ PATH: "/usr/bin:/bin", HOME: "/tmp" }), "duckdb");
  assert.equal(locateDuckdb(), "duckdb");
});

test("ohne bge-m3 wird nichts geschrieben und nicht auf mxbai ausgewichen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-index-"));
  const dbPath = path.join(dir, "vault-index.duckdb");
  let embeds = 0;
  try {
    await assert.rejects(
      () => indexNachziehen({
        dbPath,
        notizen: [{ pfad: "A.md", text: "Alpha" }],
        embedUrl: "http://127.0.0.1:11434",
        fetchImpl: async (url) => {
          if (String(url).endsWith("/api/tags")) {
            return jsonAntwort({ models: [{ name: "mxbai-embed-large:latest" }] });
          }
          embeds += 1;
          throw new Error("kein Embed");
        },
        spawnImpl: () => {
          throw new Error("kein DuckDB");
        },
      }),
      (error) => error instanceof UnitedShareError && error.message === MODELL_FEHLER,
    );
    assert.equal(embeds, 0);
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("eine Frage ohne Indexdatei ruft weder Ollama noch DuckDB", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-suche-"));
  const dbPath = path.join(dir, "vault-index.duckdb");
  let calls = 0;
  try {
    const treffer = await sucheImTresor({
      dbPath,
      frage: "Alpha",
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("kein Netz");
      },
      spawnImpl: () => {
        throw new Error("kein DuckDB");
      },
    });
    assert.deepEqual(treffer, []);
    assert.equal(calls, 0);
    assert.equal(fs.existsSync(dbPath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("neue Stücke gehen in Bündeln an bge-m3, der Schlüssel nicht", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-batch-"));
  const dbPath = path.join(dir, "vault-index.duckdb");
  const notizen = [];
  for (let index = 0; index < 17; index += 1) notizen.push({ pfad: `N${index}.md`, text: `Satz ${index}` });
  const { calls, fetchImpl } = embedServer(() => achse(0));
  const sqls = [];
  const spawnImpl = (cmd, args, opts) => {
    assert.equal(cmd, "duckdb");
    assert.equal(args.includes("-json"), false);
    assert.equal(opts.shell, false);
    assert.equal(Object.hasOwn(opts.env, "UNITEDSHARE_API_KEY"), false);
    return kindProzess({
      onSql(sql) {
        sqls.push(sql);
        assert.equal(sql.includes("Satz 0"), false);
        const fund = sql.match(/read_ndjson_auto\('([^']+)'\)/g) || [];
        assert.ok(fund.length >= 1);
        return { stdout: "" };
      },
    });
  };
  try {
    const bericht = await indexNachziehen({
      dbPath,
      notizen,
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl,
      spawnImpl,
      env: { PATH: "/usr/bin", HOME: os.homedir(), UNITEDSHARE_API_KEY: "sekret" },
      disk: nodePlatte(),
    });
    assert.equal(bericht.modell, "bge-m3:latest");
    assert.equal(bericht.neu, 17);
    assert.equal(bericht.behalten, 0);
    assert.equal(bericht.weg, 0);
    const embeds = calls.filter((call) => call.url.endsWith("/api/embed"));
    assert.equal(embeds.length, 2);
    assert.equal(JSON.parse(embeds[0].opts.body).input.length, 16);
    assert.equal(JSON.parse(embeds[1].opts.body).input.length, 1);
    assert.equal(JSON.parse(embeds[0].opts.body).input[0], "Satz 0");
    assert.match(sqls[0], /DELETE FROM stuecke WHERE raum <> 'bge-m3'/);
    assert.equal(fs.readdirSync(dir).some((name) => name.endsWith(".ndjson")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ein DuckDB-Fehler zeigt keinen Notiztext", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-fehler-"));
  const dbPath = path.join(dir, "vault-index.duckdb");
  const { fetchImpl } = embedServer(() => achse(0));
  try {
    await assert.rejects(
      () => indexNachziehen({
        dbPath,
        notizen: [{ pfad: "A.md", text: "Geheime Zeile" }],
        embedUrl: "http://127.0.0.1:11434",
        fetchImpl,
        spawnImpl: () => kindProzess({
          onSql() {
            return { code: 1, stderr: "Geheime Zeile kaputt" };
          },
        }),
        disk: nodePlatte(),
      }),
      (error) => {
        assert.ok(error instanceof UnitedShareError);
        assert.equal(error.message, "Der Tresor-Index ließ sich nicht schreiben.");
        assert.equal(error.message.includes("Geheime"), false);
        return true;
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("die Suche schickt die rohe Frage und mischt den Pfad nicht ins SQL", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-frage-"));
  const dbPath = path.join(dir, "vault-index.duckdb");
  fs.writeFileSync(dbPath, "");
  const frage = "Nordflügel 'Zitat'";
  const { calls, fetchImpl } = embedServer((text) => (text === frage ? achse(0) : achse(1)));
  let gesehen = "";
  const spawnImpl = (_cmd, args) => kindProzess({
    onSql(sql) {
      gesehen += sql;
      if (sql.includes("information_schema")) return { stdout: "[{\"da\":1}]" };
      assert.equal(args.includes("-readonly"), true);
      assert.equal(sql.includes(frage), false);
      assert.match(sql, /list_dot_product/);
      assert.match(sql, /LIMIT 4/);
      return {
        stdout: JSON.stringify([
          { pfad: "A.md", stueck: 0, text: "Alpha Satz", score: 0.2 },
        ]),
      };
    },
  });
  try {
    const treffer = await sucheImTresor({
      dbPath,
      frage,
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl,
      spawnImpl,
      disk: nodePlatte(),
    });
    assert.deepEqual(treffer, [{ pfad: "A.md", stueck: 0, text: "Alpha Satz", score: 0.2 }]);
    const embed = calls.find((call) => call.url.endsWith("/api/embed"));
    assert.deepEqual(JSON.parse(embed.opts.body).input, [frage]);
    assert.equal(gesehen.includes(frage), false);
    assert.equal(fs.existsSync(dbPath), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("duckdb speichert bge-m3 und findet den Satz wieder", { skip: !fs.existsSync(DUCKDB) }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-echt-"));
  const dbPath = path.join(dir, "vault-index.duckdb");
  const env = { PATH: "/opt/homebrew/bin:/usr/bin", HOME: os.homedir(), LANG: "de_DE.UTF-8" };
  const notizA = "Alpha Satz \"Nord\"\nzweite Zeile";
  const notizB = "Beta Satz";
  const vektorFuer = (text) => {
    if (text.includes("Alpha")) return achse(0);
    if (text.includes("Beta")) return achse(1);
    return achse(2);
  };
  let embeds = 0;
  const { fetchImpl } = embedServer((text) => {
    if (text !== "tags") embeds += 1;
    return vektorFuer(text);
  });
  const zählEmbeds = () => embeds;
  try {
    const zuerst = await indexNachziehen({
      dbPath,
      notizen: [
        { pfad: "Ordner/A.md", text: notizA },
        { pfad: "B'; DROP.md", text: notizB },
      ],
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl,
      env,
      disk: nodePlatte(),
    });
    assert.equal(zuerst.neu, 2);
    assert.equal(zuerst.behalten, 0);
    const nachEmbed = zählEmbeds();
    const nochmal = await indexNachziehen({
      dbPath,
      notizen: [
        { pfad: "Ordner/A.md", text: notizA },
        { pfad: "B'; DROP.md", text: notizB },
      ],
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl,
      env,
      disk: nodePlatte(),
    });
    assert.equal(nochmal.neu, 0);
    assert.equal(nochmal.behalten, 2);
    assert.equal(zählEmbeds(), nachEmbed);

    const treffer = await sucheImTresor({
      dbPath,
      frage: "Alpha Satz",
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl,
      env,
      k: 4,
      disk: nodePlatte(),
    });
    assert.equal(treffer[0].pfad, "Ordner/A.md");
    assert.equal(treffer[0].text.includes("Alpha Satz"), true);
    assert.equal(treffer[0].text.includes("zweite Zeile"), true);
    assert.ok(Math.abs(treffer[0].score - 1) < 1e-5);
    assert.equal(Object.hasOwn(treffer[0], "vektor"), false);

    const schwach = await sucheImTresor({
      dbPath,
      frage: "keins von beiden",
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl,
      env,
      disk: nodePlatte(),
    });
    assert.ok(schwach.length >= 1);
    assert.ok(schwach[0].score < 0.35);

    const nullen = new Array(DIM).fill(0).join(", ");
    execFileSync(DUCKDB, [
      dbPath,
      "-c",
      `INSERT INTO stuecke VALUES ('mxbai', 'mxbai-embed-large', 'Fremd.md', 0, 'fremd', 'x', [${nullen}]::FLOAT[1024]);`,
    ], { env });
    await indexNachziehen({
      dbPath,
      notizen: [
        { pfad: "Ordner/A.md", text: notizA },
        { pfad: "B'; DROP.md", text: "" },
      ],
      embedUrl: "http://127.0.0.1:11434",
      fetchImpl,
      env,
      disk: nodePlatte(),
    });
    const übrig = execFileSync(DUCKDB, [
      "-json",
      "-c",
      "SELECT raum, pfad FROM stuecke ORDER BY pfad;",
      dbPath,
    ], { env, encoding: "utf8" });
    const zeilen = JSON.parse(übrig);
    assert.deepEqual(zeilen, [{ raum: "bge-m3", pfad: "Ordner/A.md" }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
