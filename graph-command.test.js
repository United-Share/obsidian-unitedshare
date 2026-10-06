"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { localObsidianCommand } = require("./unitedshare-core");

test("zeige die Graphansicht öffnet die Graphansicht auf diesem Gerät", () => {
  assert.equal(localObsidianCommand("zeige die Graphansicht"), "graph:open");
  assert.equal(localObsidianCommand("  Zeige   die   Graphansicht. "), "graph:open");
  assert.equal(localObsidianCommand("öffne den Graphen"), "graph:open");
});

test("zeige die lokale Graphansicht öffnet den Graphen der Notiz", () => {
  assert.equal(localObsidianCommand("zeige die lokale Graphansicht"), "graph:open-local");
  assert.equal(localObsidianCommand("Graphansicht der Notiz"), "graph:open-local");
});

test("eine Frage zur Graphansicht bleibt eine Frage", () => {
  assert.equal(localObsidianCommand("Was ist die Graphansicht?"), null);
  assert.equal(localObsidianCommand("zeige die Graphansicht und erkläre sie"), null);
  assert.equal(localObsidianCommand(""), null);
  assert.equal(localObsidianCommand(null), null);
});
