"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = __dirname;
const ORG_URL = "https://github.com/United-Share/obsidian-unitedshare";
const PROVIDER = "United Share GmbH";

test("öffentliche Herkunft nennt die Organisation United-Share und den Anbieter United Share GmbH", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const license = fs.readFileSync(path.join(root, "LICENSE"), "utf8");

  assert.equal(readme.includes(ORG_URL), true, "README nennt die Organisations-URL");
  assert.equal(
    readme.includes("github.com/mikebaumgart/obsidian-unitedshare"),
    false,
    "README nennt noch das persönliche Konto",
  );
  assert.equal(readme.includes(PROVIDER), true, "README nennt den Anbieter");
  assert.equal(manifest.author, PROVIDER);
  assert.equal(manifest.authorUrl, "https://unitedshare.ai");
  assert.equal(manifest.version, "1.1.6");
  assert.equal(readme.includes("Release-Tag `1.1.6`"), true);
  assert.equal(license.includes(`Copyright (c) 2026 ${PROVIDER}`), true);
});
