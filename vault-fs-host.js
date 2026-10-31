"use strict";

// Testdoppel für eine Platte außerhalb von Obsidian. Die ausgelieferte
// main.js bindet diese Datei nicht ein. Im Plugin lesen und schreiben
// Tresor-Dateien über die Vault-API und den FileSystemAdapter.

const fs = require("node:fs");
const path = require("node:path");
const {
  UnitedShareError,
  assertSyncRequest,
  assertVaultRelative,
  runReemax,
  runVaultFile,
} = require("./unitedshare-core");

const VAULT_PATH_ERROR = "Der Pfad bleibt im Tresor.";
const BLOCKED = new Set([".obsidian", ".git", ".trash"]);

function outsideVault(rootReal, target) {
  const fromRoot = path.relative(rootReal, target);
  if (!fromRoot) return false;
  return fromRoot.startsWith("..") || path.isAbsolute(fromRoot);
}

function realPathBlocked(rootReal, target) {
  const fromRoot = path.relative(rootReal, target);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return false;
  return fromRoot.split(path.sep).some((part) => BLOCKED.has(part));
}

function resolveInsideVault(root, rel) {
  const safe = assertVaultRelative(rel);
  let rootReal;
  try {
    rootReal = fs.realpathSync(root);
  } catch (_err) {
    throw new UnitedShareError(VAULT_PATH_ERROR, 0);
  }
  const parts = safe.split("/");
  let current = rootReal;
  for (let i = 0; i < parts.length; i += 1) {
    const next = path.join(current, parts[i]);
    if (fs.existsSync(next)) {
      let real;
      try {
        real = fs.realpathSync(next);
      } catch (_err) {
        throw new UnitedShareError(VAULT_PATH_ERROR, 0);
      }
      if (outsideVault(rootReal, real) || realPathBlocked(rootReal, real)) {
        throw new UnitedShareError(VAULT_PATH_ERROR, 0);
      }
      current = real;
    } else {
      const rest = path.join(current, ...parts.slice(i));
      if (outsideVault(rootReal, rest) || realPathBlocked(rootReal, rest)) {
        throw new UnitedShareError(VAULT_PATH_ERROR, 0);
      }
      return { abs: rest, rel: safe, root: rootReal };
    }
  }
  return { abs: current, rel: safe, root: rootReal };
}

function fsVaultHost(root, options = {}) {
  return {
    async read(rel) {
      const { abs } = resolveInsideVault(root, rel);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
      return fs.readFileSync(abs, "utf8");
    },
    async list(rel) {
      const rootReal = fs.realpathSync(root);
      const target = rel ? resolveInsideVault(root, rel).abs : rootReal;
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        throw new UnitedShareError("Der Ordner liegt nicht im Tresor.", 0);
      }
      return fs.readdirSync(target);
    },
    async write(rel, content) {
      const { abs, root: rootReal } = resolveInsideVault(root, rel);
      const dir = path.dirname(abs);
      if (outsideVault(rootReal, dir)) throw new UnitedShareError(VAULT_PATH_ERROR, 0);
      fs.mkdirSync(dir, { recursive: true });
      const dirReal = fs.realpathSync(dir);
      if (outsideVault(rootReal, dirReal)) throw new UnitedShareError(VAULT_PATH_ERROR, 0);
      fs.writeFileSync(abs, String(content ?? ""));
    },
    async run(rel) {
      const opts = { root, relPath: rel };
      if (options.spawnImpl) opts.spawnImpl = options.spawnImpl;
      if (options.env) opts.env = options.env;
      if (options.timeoutMs) opts.timeoutMs = options.timeoutMs;
      if (options.onAktiv) opts.onAktiv = options.onAktiv;
      return runVaultFile(opts);
    },
    async meshJoin(rel) {
      const located = resolveInsideVault(root, rel);
      if (!fs.existsSync(located.abs) || !fs.statSync(located.abs).isFile()) {
        throw new UnitedShareError("Die Einladung liegt nicht im Tresor.", 0);
      }
      const opts = { cwd: located.root };
      if (options.spawnImpl) opts.spawnImpl = options.spawnImpl;
      if (options.env) opts.env = options.env;
      if (options.timeoutMs) opts.timeoutMs = options.timeoutMs;
      if (options.onAktiv) opts.onAktiv = options.onAktiv;
      return runReemax(["mesh", "join", located.abs], opts);
    },
    async sync(request) {
      const { peer, direction } = assertSyncRequest(request && request.peer, request && request.direction);
      const opts = { cwd: fs.realpathSync(root) };
      if (options.spawnImpl) opts.spawnImpl = options.spawnImpl;
      if (options.env) opts.env = options.env;
      if (options.timeoutMs) opts.timeoutMs = options.timeoutMs;
      if (options.onAktiv) opts.onAktiv = options.onAktiv;
      return runReemax(["sync", direction, peer], opts);
    },
  };
}

module.exports = {
  fsVaultHost,
  resolveInsideVault,
};
