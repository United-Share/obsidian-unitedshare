import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const needle = "const { absichtLokal, adapterVaultHost, akzeptierePairing, applyComposerAnswer, assertLoopbackEmbedUrl, assertTailscaleAdresse, assertSyncRequest, assertVaultRelative, auftragSpalten, aufladenAdresse, bedieneSyncAnfrage, bildAusKoerper, bytesFromB64, b64FromBytes, generateImage, chatsLaden, chatSpeichern, completeMessages, composerDock, composerPrompt, composerViewState, debugLogSchreiben, dateienAusTreffern, DUCKDB_ANSICHT_ENDUNGEN, duckdbDateiverweiseAusSql, duckdbSqlAusDatei, duckdbTabelleAusZeilen, duckdbVorschauAbfrage, erkenneICloudTresor, erkenneTailscaleAdresse, erzeugePairingAnfrage, erzeugePairingAngebot, executeVaultAction, fluentScriptAlsZeilen, fluentScriptKarten, fluentScriptParsen, fuehreSyncDurch, indexNachziehen, isObsidianModel, istDuckdbAnsichtEndung, keyboardCoverPx, konfliktDateiname, lanAdresseAusInterfaces, leiteSessionSchluesselAb, limitMeldung, listIndexedOrHidden, listModels, loadMentionedNotes, loadNamedNotes, localObsidianCommand, lokalText, meshOptionLines, meshPossibilities, mermaidZumEinfuegen, mischeDateien, pairingEntschluesseln, pairingVerschluesseln, pairingVersuchErlaubt, pairingVersuchVermerken, PEER_SYNC_TOKEN_HEADER, prepareContextFiles, readIndexedOrHidden, readMeshInventory, runReemax, runVaultFile, runVaultInstruction, schrittText, sidebarPromptOpen, sucheImTresor, tresorIndexPfad, UnitedShareError, verbrauchKompakt, verbrauchProzent, verbrauchZeile, viewSitsUnderKeyboard, visibleStreamText, wikilinkAusPfad } = require(\"./unitedshare-core\");";

const core = readFileSync(join(root, "unitedshare-core.js"), "utf8")
  .replace(/^"use strict";\n+/, "")
  .replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, "\n");

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
const bundled = src.replace(needle, core.trim()).replace(privacyNeedle, privacy.trim()).replace(rmxosNeedle, rmxos.trim());
if (bundled.includes("unitedshare-core") || bundled.includes("module.exports = {")) {
  console.error("bundle: main.js wäre nicht eigenständig");
  process.exit(1);
}

writeFileSync(join(root, "main.js"), bundled);
console.log("main.js geschrieben");
