import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const needle = 'const { assertVaultRelative, completeMessages, executeVaultAction, loadMentionedNotes, resolveInsideVault, runVaultFile, runVaultInstruction, UnitedShareError } = require("./unitedshare-core");';

const core = readFileSync(join(root, "unitedshare-core.js"), "utf8")
  .replace(/^"use strict";\n+/, "")
  .replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "\n");

const src = readFileSync(join(root, "main.src.js"), "utf8");
if (!src.includes(needle)) {
  console.error("bundle: die Require-Zeile in main.src.js fehlt");
  process.exit(1);
}

const bundled = src.replace(needle, core.trim());
if (bundled.includes("unitedshare-core") || bundled.includes("module.exports = {")) {
  console.error("bundle: main.js wäre nicht eigenständig");
  process.exit(1);
}

writeFileSync(join(root, "main.js"), bundled);
console.log("main.js geschrieben");
