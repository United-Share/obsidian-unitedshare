"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const {
  meshOptionLines,
  meshPossibilities,
  readMeshInventory,
} = require("./unitedshare-core");

const READS = [
  ["version", "--json"],
  ["mesh", "peers", "--json"],
  ["offer", "ls", "--json"],
  ["sync", "pairs", "--json"],
  ["list", "--json"],
];

function cliChild(body, code) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => {
    if (code === "error") {
      child.emit("error", new Error("spawn"));
      return;
    }
    child.stdout.emit("data", body);
    child.emit("close", code);
  });
  return child;
}

test("ohne reemax bleibt die Liste leer", () => {
  const view = meshPossibilities({
    installed: false,
    offers: [{ id: "qwen", kind: "model" }],
  });
  assert.equal(view.installed, false);
  assert.deepEqual(view.kinds.map((kind) => kind.id), ["model", "agent", "ui"]);
  assert.deepEqual(meshOptionLines(view), []);
  assert.equal(JSON.stringify(view).includes("qwen"), false);
});

test("ohne eingerichtetes direktes Netz bleiben Firmenknoten, LiteLLM und eine Datenbank draußen", () => {
  const view = meshPossibilities({
    installed: true,
    version: "0.3.3",
    peers: null,
    offers: {
      v: 1,
      offers: [
        { id: "db", kind: "database", private_key: "LEAK" },
      ],
    },
    pairs: {
      ok: true,
      pairs: [{
        name: "demo",
        peer: "10.73.0.26",
        local: "/Users/reemax/tmp/fabric-demo",
        remote: "coding-workspace/fabric-demo",
      }],
    },
    list: {
      backends: [
        { name: "local-ollama", url: "http://127.0.0.1:11434" },
        { name: "litellm", url: "https://llm.unitedshare.ai/v1" },
        { name: "gx", url: "http://10.73.0.41:11434" },
      ],
      models: [
        { id: "lokal", backend: "local-ollama" },
        { id: "grok-devstral", backend: "litellm" },
        { id: "firma-modell", backend: "gx" },
      ],
    },
  });
  assert.equal(view.installed, true);
  assert.equal(view.ready, false);
  assert.deepEqual(view.kinds.map((kind) => [kind.id, kind.name]), [
    ["model", "Modell"],
    ["agent", "Agent"],
    ["ui", "Oberfläche"],
  ]);
  assert.deepEqual(view.kinds.map((kind) => kind.items), [[], [], []]);
  assert.deepEqual(view.peers, []);
  const dumped = JSON.stringify(view);
  for (const hidden of ["private_key", "LEAK", "database", "127.0.0.1", "grok-devstral", "10.73", "fabric-demo", "llm.unitedshare.ai"]) {
    assert.equal(dumped.includes(hidden), false, hidden);
  }
  assert.deepEqual(meshOptionLines(view), [
    "reemax 0.3.3",
    "Modell: keins",
    "Agent: keins",
    "Oberfläche: keins",
    "Gegenstellen: noch nicht eingerichtet",
    "Dateipaare im Firmennetz: demo",
  ]);
  assert.equal(meshOptionLines(view).some((line) => line.startsWith("Datenbank")), false);
});

test("Angebote auf 10.75 werden Modell, Agent und Oberfläche, Paare tragen ihr Netz", () => {
  const view = meshPossibilities({
    installed: true,
    version: "0.3.3",
    peers: {
      ok: true,
      peers: [
        { name: "mini", address: "10.75.0.2" },
        { name: "firma", ip: "10.73.0.24" },
        { name: "namenlos" },
        { address: "10.75.0.9" },
      ],
    },
    offers: {
      offers: [
        { id: "qwen", kind: "model", peer: "mini", private_key: "LEAK", grant: "owner" },
        { id: "schreiber", kind: "agent", peer: "mini" },
        { id: "tafel", kind: "ui" },
        { id: "db", kind: "database" },
      ],
    },
    pairs: {
      pairs: [
        { name: "noten", peer: "10.75.0.2", local: "/Users/secret", remote: "/remote/secret" },
        { name: "demo", peer: "10.73.0.26", local: "/Users/reemax/tmp/fabric-demo", remote: "coding-workspace/fabric-demo" },
        { name: "../nein", peer: "10.75.0.2", local: "/Users/secret" },
      ],
    },
    list: {
      backends: [
        { name: "local-ollama", url: "http://127.0.0.1:11434" },
        { name: "litellm", url: "https://llm.unitedshare.ai/v1" },
        { name: "gx", url: "http://10.73.0.41:11434" },
        { name: "peer-ollama", url: "http://10.75.0.2:11434" },
      ],
      models: [
        { id: "lokal", backend: "local-ollama" },
        { id: "grok-devstral", backend: "litellm" },
        { id: "firma-modell", backend: "gx" },
        { id: "peer-model", backend: "peer-ollama" },
        { id: "qwen", backend: "peer-ollama" },
      ],
    },
  });
  assert.equal(view.ready, true);
  assert.deepEqual(view.peers, ["mini", "namenlos"]);
  assert.deepEqual(view.kinds.find((kind) => kind.id === "model").items, ["mini:qwen", "peer-model"]);
  assert.deepEqual(view.kinds.find((kind) => kind.id === "agent").items, ["mini:schreiber"]);
  assert.deepEqual(view.kinds.find((kind) => kind.id === "ui").items, ["tafel"]);
  assert.deepEqual(view.pairs.direkt, ["noten"]);
  assert.deepEqual(view.pairs.firma, ["demo"]);
  const dumped = JSON.stringify(view);
  for (const hidden of ["private_key", "LEAK", "database", "127.0.0.1", "grok-devstral", "10.73", "/Users", "fabric-demo", "grant"]) {
    assert.equal(dumped.includes(hidden), false, hidden);
  }
  assert.deepEqual(meshOptionLines(view), [
    "reemax 0.3.3",
    "Modell: mini:qwen, peer-model",
    "Agent: mini:schreiber",
    "Oberfläche: tafel",
    "Gegenstellen: mini, namenlos",
    "Dateipaare im direkten Netz: noten",
    "Dateipaare im Firmennetz: demo",
  ]);
});

test("eine Gegenstellen-Liste der CLI bleibt eine Gegenstelle und lässt Schlüssel weg", async () => {
  const spawnImpl = (_cmd, args) => {
    const key = args.join(" ");
    const bodies = {
      "version --json": 'INFO [reemax] bereit\n{"ok":true,"bin":"reemax","version":"0.3.3","git":"dev"}\n',
      "mesh peers --json": '[{"name":"node","address":"10.75.0.2/32","endpoint":"10.1.101.102:51820","role":"owner","public_key":"LEAKKEY","mesh_id":"LEAKID"},{"name":"firma","address":"10.73.0.24/32","public_key":"LEAK2"}]\n',
      "offer ls --json": '{"v":1,"offers":[]}\n',
      "sync pairs --json": '{"ok":true,"pairs":[{"name":"demo","peer":"10.73.0.26"}]}\n',
      "list --json": '{"backends":[{"name":"litellm","url":"https://llm.unitedshare.ai/v1"}],"models":[{"id":"grok-devstral","backend":"litellm"}]}\n',
    };
    return cliChild(bodies[key], 0);
  };
  const view = await readMeshInventory({ spawnImpl, timeoutMs: 1000 });
  assert.equal(view.ready, true);
  assert.deepEqual(view.peers, ["node"]);
  assert.deepEqual(view.kinds.map((kind) => kind.items), [[], [], []]);
  const dumped = JSON.stringify(view);
  for (const hidden of ["public_key", "LEAKKEY", "LEAKID", "mesh_id", "10.73", "grok-devstral", "10.1.101.102"]) {
    assert.equal(dumped.includes(hidden), false, hidden);
  }
  assert.deepEqual(meshOptionLines(view), [
    "reemax 0.3.3",
    "Modell: keins",
    "Agent: keins",
    "Oberfläche: keins",
    "Gegenstellen: node",
    "Dateipaare im Firmennetz: demo",
  ]);
});

test("readMeshInventory fragt nur lesend und wertet INFO-Zeilen vor dem JSON", async () => {
  const seen = [];
  const spawnImpl = (cmd, args) => {
    seen.push(args.slice());
    assert.equal(cmd, "reemax");
    const key = args.join(" ");
    const bodies = {
      "version --json": 'INFO bereit\n{"ok":true,"bin":"reemax","version":"0.3.3","git":"dev"}\n',
      "mesh peers --json": "run reemax mesh init first\n",
      "offer ls --json": '{"v":1,"offers":[]}\n',
      "sync pairs --json": '{"ok":true,"pairs":[]}\n',
      "list --json": '{"backends":[],"models":[]}\n',
    };
    const code = key === "mesh peers --json" ? 1 : 0;
    return cliChild(bodies[key], code);
  };
  const view = await readMeshInventory({ spawnImpl, cwd: "/tmp/vault", timeoutMs: 1000 });
  assert.deepEqual(seen, READS);
  for (const args of seen) {
    assert.equal(args.includes("init"), false);
    assert.equal(args.includes("invite"), false);
    assert.equal(args.includes("join"), false);
    assert.equal(args.includes("run-agent"), false);
    assert.equal(args.includes("push"), false);
    assert.equal(args.includes("pull"), false);
  }
  assert.equal(view.installed, true);
  assert.equal(view.ready, false);
  assert.equal(view.version, "0.3.3");
  assert.deepEqual(view.kinds.map((kind) => kind.items), [[], [], []]);
});

test("reemax im Benutzerordner zählt auch ohne PATH", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reemax-mesh-"));
  const home = path.join(root, "home");
  const bin = path.join(home, "bin");
  const log = path.join(root, "log");
  fs.mkdirSync(bin, { recursive: true });
  const quoted = log.replace(/'/g, `'\\''`);
  fs.writeFileSync(path.join(bin, "reemax"), `#!/bin/sh
printf '%s\\n' "$*" >> '${quoted}'
case "$1" in
  version)
    printf '%s\\n' '{"ok":true,"bin":"reemax","version":"0.3.3","git":"dev"}'
    ;;
  *)
    printf '%s\\n' '{"ok":true,"peers":[],"offers":[],"pairs":[],"backends":[],"models":[]}'
    ;;
esac
exit 0
`);
  fs.chmodSync(path.join(bin, "reemax"), 0o755);
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = "/usr/bin:/bin";
  process.env.HOME = home;
  try {
    const view = await readMeshInventory({ timeoutMs: 2000 });
    assert.equal(view.installed, true);
    assert.equal(view.version, "0.3.3");
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [
      "version --json",
      "mesh peers --json",
      "offer ls --json",
      "sync pairs --json",
      "list --json",
    ]);
  } finally {
    if (saved.PATH === undefined) delete process.env.PATH;
    else process.env.PATH = saved.PATH;
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ein Startfehler der Version fragt nichts weiter", async () => {
  const seen = [];
  const spawnImpl = () => {
    seen.push("called");
    throw new Error("nicht da");
  };
  const view = await readMeshInventory({ spawnImpl });
  assert.deepEqual(seen, ["called"]);
  assert.equal(view.installed, false);
  assert.deepEqual(meshOptionLines(view), []);
});

test("die Anleitung nennt das direkte Netz und lässt Tag und Einstellungssatz", () => {
  const readme = fs.readFileSync(path.join(__dirname, "README.md"), "utf8");
  const src = fs.readFileSync(path.join(__dirname, "main.src.js"), "utf8");
  assert.match(readme, /\*\*Direktes Netz\*\*/);
  const manifestVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8")).version;
  assert.ok(readme.includes(`Release-Tag \`${manifestVersion}\``),
    `die Anleitung nennt nicht ${manifestVersion}`);
  assert.equal(
    src.includes('text: "Lesen, Listen, Schreiben und Starten laufen auf diesem Rechner über die Funktionen des offenen Tresors. Aktive Notiz setzt @\\"Pfad\\" ins Feld. In die Notiz schreibt Frage und Antwort an den Cursor."'),
    true,
  );
  assert.equal(readme.includes("Eine Datenbank"), false);
});
