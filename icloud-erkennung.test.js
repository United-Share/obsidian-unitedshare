"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { erkenneICloudTresor } = require("./unitedshare-core");

test("macOS-iCloud-Drive-Pfad wird erkannt", () => {
  assert.equal(
    erkenneICloudTresor(
      "/Users/reemax/Library/Mobile Documents/iCloud~md~obsidian/Documents/Mobil",
    ),
    true,
  );
});

test("iOS-eigener CloudDocs-Pfad wird erkannt", () => {
  assert.equal(
    erkenneICloudTresor(
      "/private/var/mobile/Library/Mobile Documents/iCloud~md~obsidian/Documents/Mobil",
    ),
    true,
  );
});

test("ein lokaler Tresor ohne iCloud wird nicht erkannt", () => {
  assert.equal(erkenneICloudTresor("/Users/reemax/Dokumente/MeinTresor"), false);
  assert.equal(erkenneICloudTresor("/Volumes/SecondBrainReemax/BA10_BDH"), false);
});

test("ein anderer iCloud-Ordner (keine Obsidian-App) zaehlt nicht", () => {
  assert.equal(
    erkenneICloudTresor("/Users/reemax/Library/Mobile Documents/com~apple~Notes/Notiz"),
    false,
  );
});

test("leerer oder fehlender Pfad ist nicht iCloud", () => {
  assert.equal(erkenneICloudTresor(""), false);
  assert.equal(erkenneICloudTresor(undefined), false);
  assert.equal(erkenneICloudTresor(null), false);
});
