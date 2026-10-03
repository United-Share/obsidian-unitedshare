"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = __dirname;
const workflowPath = path.join(root, ".github", "workflows", "release.yml");

function workflowText() {
  return fs.readFileSync(workflowPath, "utf8");
}

function subjectBlock(text) {
  const start = text.indexOf("subject-path:");
  assert.ok(start >= 0, "subject-path fehlt");
  const nextStep = text.indexOf("\n      - ", start);
  return text.slice(start, nextStep === -1 ? text.length : nextStep);
}

test("der Release-Workflow attestiert main.js, manifest.json und styles.css", () => {
  const text = workflowText();
  assert.match(text, /attestations:\s*write/);
  assert.match(text, /id-token:\s*write/);
  assert.match(text, /contents:\s*write/);
  assert.match(text, /actions\/attest@v4/);
  const block = subjectBlock(text);
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    assert.ok(block.includes(name), `${name} fehlt in subject-path`);
  }
  const buildAt = text.indexOf("node scripts/bundle.mjs");
  const attestAt = text.indexOf("actions/attest@v4");
  assert.ok(buildAt >= 0, "Build muss node scripts/bundle.mjs sein");
  assert.ok(attestAt > buildAt, "Attestierung steht nach dem Build");
  assert.equal(text.includes("npm install"), false);
  assert.equal(text.includes("npm ci"), false);
});

test("Tags ohne v lösen den Release aus und müssen zur Manifest-Version passen", () => {
  const text = workflowText();
  assert.match(text, /workflow_dispatch/);
  assert.match(text, /tags:/);
  assert.match(text, /\^\[0-9\]\+\\.\[0-9\]\+\\.\[0-9\]\+\$/);
  assert.match(text, /manifest\.json/);
  assert.match(text, /gh release create/);
  assert.match(text, /main\.js manifest\.json styles\.css/);
});

test("ein erneuter Bundle trifft die veröffentlichte main.js", () => {
  const mainPath = path.join(root, "main.js");
  const before = fs.readFileSync(mainPath);
  execFileSync(process.execPath, ["scripts/bundle.mjs"], { cwd: root });
  const after = fs.readFileSync(mainPath);
  assert.deepEqual(after, before);
});
