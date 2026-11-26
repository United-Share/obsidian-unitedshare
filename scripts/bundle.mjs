import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const needle = "const { absichtLokal, adapterVaultHost, akzeptierePairing, applyComposerAnswer, assertLoopbackEmbedUrl, assertTailscaleAdresse, assertSyncRequest, assertVaultRelative, auftragSpalten, aufladenAdresse, bedieneSyncAnfrage, bildAusKoerper, bytesFromB64, b64FromBytes, generateImage, CHAT_ORDNER, chatAlsText, chatDateiname, chatKennung, chatsLaden, chatSpeichern, completeMessages, composerDock, composerPrompt, composerViewState, debugLogSchreiben, dateienAusTreffern, DUCKDB_ANSICHT_ENDUNGEN, duckdbDateiverweiseAusSql, duckdbLaufzeitLuecken, duckdbLaufzeitMeldung, duckdbSqlAusDatei, duckdbTabelleAusZeilen, duckdbVorschauAbfrage, erkenneICloudTresor, erkenneTailscaleAdresse, erzeugePairingAnfrage, erzeugePairingAngebot, executeVaultAction, fluentScriptAlsZeilen, fluentScriptKarten, fluentScriptParsen, fuehreSyncDurch, indexNachziehen, isObsidianModel, istDuckdbAnsichtEndung, keyboardCoverPx, konfliktDateiname, lanAdresseAusInterfaces, leiteSessionSchluesselAb, leseAuftrag, limitMeldung, listIndexedOrHidden, listModels, loadMentionedNotes, loadNamedNotes, localObsidianCommand, lokalText, meshOptionLines, meshPossibilities, mermaidZumEinfuegen, mischeDateien, nativeWerkzeugHinweis, pairingEntschluesseln, pairingVerschluesseln, pairingVersuchErlaubt, pairingVersuchVermerken, PEER_SYNC_TOKEN_HEADER, prepareContextFiles, readIndexedOrHidden, readMeshInventory, runReemax, runVaultFile, runVaultInstruction, schrittText, sidebarPromptOpen, sucheImTresor, tresorIndexPfad, UnitedShareError, verbrauchKompakt, verbrauchProzent, verbrauchZeile, viewSitsUnderKeyboard, visibleStreamText, wikilinkAusPfad } = require(\"./unitedshare-core\");";

const core = readFileSync(join(root, "unitedshare-core.js"), "utf8")
  .replace(/^"use strict";\n+/, "")
  .replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "\n")
  // Die Core-Fassung von utf8ByteLength weicht der fail-closed-Fassung aus
  // key-pruefung (zaehlt Codepoints statt text.length im Fallback). Beide
  // sind Funktionsdeklarationen; die Core-Kopie wird entfernt, damit genau
  // eine Fassung im Bundle lebt.
  .replace(/\nfunction utf8ByteLength\(text\) \{[\s\S]*?\n\}\n/, "\n");

const src = readFileSync(join(root, "main.src.js"), "utf8");
if (!src.includes(needle)) {
  console.error("bundle: die Require-Zeile in main.src.js fehlt");
  process.exit(1);
}

const privacy = readFileSync(join(root, "privacy-template.js"), "utf8")
  .replace(/^"use strict";\n+/, "")
  .replace(/\nmodule\.exports\s*=\s*\{[^}]*\};\s*$/, "\n");
const privacyNeedle = 'const { privateVorlageVorbereiten, privateAntwortAufloesen } = require("./privacy-template");';
if (!src.includes(privacyNeedle)) throw new Error("bundle: privacy-template Require fehlt");
const rmxos = readFileSync(join(root, "rmxos-template.js"), "utf8")
  .replace(/^"use strict";\n+/, "")
  .replace(/\nmodule\.exports\s*=\s*\{[^}]*\};\s*$/, "\n");
const rmxosNeedle = 'const { rmxosEigenschaftenErsetzen } = require("./rmxos-template");';
if (!src.includes(rmxosNeedle)) throw new Error("bundle: rmxos-template Require fehlt");
// Workspace-Sync-Module in Abhaengigkeitsreihenfolge: key-pruefung ist das
// Leaf, workspace-sync und ordner-sync verlieren beim Einbetten ihre
// require-Zeile auf das Leaf (die Bindings leben dann im Bundle-Scope).
function syncModul(name) {
  return readFileSync(join(root, name), "utf8")
    .replace(/^"use strict";\n+/, "")
    .replace(/^const \{[^}]*\} = require\("\.\/key-pruefung"\);\n/m, "")
    .replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "\n");
}
const keyPruefung = syncModul("key-pruefung.js");
const workspaceSync = syncModul("workspace-sync.js");
const ordnerSync = syncModul("ordner-sync.js");
const kpNeedle = 'const { MAX_OBJEKT_BYTES } = require("./key-pruefung");';
const wsNeedle = 'const { CHATS_PRAEFIX, transportBauen, chatSpiegeln, objektSchreiben, objektLesen, objekteListen, wiederherstellbareChats } = require("./workspace-sync");';
const osNeedle = 'const { NOTES_PRAEFIX, laufStarten, laufBeenden, keyAusRelpfad, relpfadAusKey, planeOrdnerSync, eingehendeNotiz, indexNachSync } = require("./ordner-sync");';
for (const [n, name] of [[kpNeedle, "key-pruefung"], [wsNeedle, "workspace-sync"], [osNeedle, "ordner-sync"]]) {
  if (!src.includes(n)) throw new Error("bundle: " + name + " Require fehlt");
}
const bundled = src
  .replace(needle, core.trim())
  .replace(privacyNeedle, privacy.trim())
  .replace(rmxosNeedle, rmxos.trim())
  .replace(kpNeedle, keyPruefung.trim())
  .replace(wsNeedle, workspaceSync.trim())
  .replace(osNeedle, ordnerSync.trim());
const requireReste = ["./unitedshare-core", "./key-pruefung", "./workspace-sync", "./ordner-sync", "./privacy-template", "./rmxos-template"]
  .some((m) => bundled.includes('require("' + m + '")'));
if (requireReste || bundled.includes("module.exports = {")) {
  console.error("bundle: main.js wäre nicht eigenständig");
  process.exit(1);
}

writeFileSync(join(root, "main.js"), bundled);
console.log("main.js geschrieben");
