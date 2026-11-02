"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanProcessEnv, runVaultFile } = require("./unitedshare-core");

const root = __dirname;

function shipped(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

// Die Community-Prüfung liest die Release-Dateien, nicht die Testdateien.
// Diese Muster sind die gemeldeten Funde: Maschinenkennung, Shell, das
// Auflisten des ganzen Tresors, die System-Zwischenablage und zwei CSS-Eigenschaften.
const MAIN_VERBOTEN = [
  /child_process/,
  /require\(\s*["']os["']\s*\)/,
  /require\(\s*["']node:os["']\s*\)/,
  /networkInterfaces/,
  /userInfo/,
  /os\.hostname/,
  /\.hostname\s*\(/,
  /process\.env\.(USER|USERNAME|LOGNAME|HOSTNAME|COMPUTERNAME)\b/,
  /["']USER["']/,
  /["']LOGNAME["']/,
  /["']USERNAME["']/,
  /["']HOSTNAME["']/,
  /["']COMPUTERNAME["']/,
  /\.getFiles\s*\(/,
  /getMarkdownFiles/,
  /getAllLoadedFiles/,
  /navigator\.clipboard/,
  /clipboard/i,
  /\.readText\s*\(/,
  /\.writeText\s*\(/,
];

test("das ausgelieferte Plugin enthält die gemeldeten Prüf-Muster nicht", () => {
  const main = shipped("main.js");
  const treffer = MAIN_VERBOTEN.filter((muster) => muster.test(main)).map((muster) => muster.source);
  assert.deepEqual(treffer, []);
});

test("styles.css meidet die nur teilweise unterstützten Eigenschaften", () => {
  const css = shipped("styles.css");
  assert.equal(/display\s*:\s*contents/.test(css), false);
  assert.equal(/text-decoration-color/.test(css), false);
  assert.equal(/text-decoration\s*:[^;{]*var\(/.test(css), false);
});

test("cleanProcessEnv kopiert keine Kontokennung", () => {
  const env = cleanProcessEnv({
    PATH: "/usr/bin",
    HOME: "/Users/x",
    USER: "reemax",
    LOGNAME: "reemax",
    USERNAME: "reemax",
    HOSTNAME: "mac",
    COMPUTERNAME: "mac",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/Users/x");
  for (const key of ["USER", "LOGNAME", "USERNAME", "HOSTNAME", "COMPUTERNAME"]) {
    assert.equal(Object.hasOwn(env, key), false, key);
  }
});

test("ein Tresor-Skript startet keinen Prozess aus dem Plugin", async () => {
  await assert.rejects(
    () => runVaultFile({ root: "/tmp/unitedshare-kein-tresor", relPath: "a.py", timeoutMs: 200 }),
    (error) => {
      assert.match(String(error && error.message), /Desktop-App/);
      return true;
    },
  );
});
