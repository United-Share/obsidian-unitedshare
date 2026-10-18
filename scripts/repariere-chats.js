"use strict";

// Repariert gespeicherte Gespraeche in <Tresor>/.vault/chats, die vom
// Nested-Fence-Bug in stripVaultActions getroffen wurden (behoben in
// unitedshare-core.js, 2026-10-18).
//
// WICHTIG: Der urspruengliche Antworttext ist nicht wiederherstellbar. Der
// alte, fehlerhafte stripVaultActions hat ihn beim ersten Speichern bereits
// durch den sichtbaren Rest ersetzt -- dieses Werkzeug kann diesen Rest nur
// durch einen ehrlichen Platzhalter ersetzen, nicht rekonstruieren.
//
// Nutzung:
//   node scripts/repariere-chats.js <pfad-zu-.vault/chats>            # Probelauf, schreibt nichts
//   node scripts/repariere-chats.js <pfad-zu-.vault/chats> --anwenden # schreibt, legt vorher ein .bak an

const fs = require("node:fs");
const path = require("node:path");

const PLATZHALTER_TEXT = "[Diese Antwort wurde durch einen inzwischen behobenen Parsing-Fehler "
  + "beschädigt gespeichert und konnte nicht wiederhergestellt werden. Bitte die Frage erneut stellen.]";

// Der verstuemmelte Rest ist das, was von einem abgebrochenen JSON-Objekt
// uebrig blieb: er endet auf das schliessende Zitat des content-Feldes plus
// die schliessende geschweifte Klammer des Objekts. Das kommt in normalem
// Fliesstext praktisch nie vor.
function istVerstuemmelterProtokollRest(content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) return false;
  return text.endsWith('"}');
}

function bereinigeNachricht(message) {
  if (!message || message.role !== "assistant") return message;
  if (!istVerstuemmelterProtokollRest(message.content)) return message;
  return { ...message, content: PLATZHALTER_TEXT };
}

function bereinigeEintrag(eintrag) {
  const nachrichten = Array.isArray(eintrag && eintrag.messages) ? eintrag.messages : [];
  let anzahl = 0;
  const bereinigt = nachrichten.map((message) => {
    const neu = bereinigeNachricht(message);
    if (neu !== message) anzahl += 1;
    return neu;
  });
  if (!anzahl) return { eintrag, anzahl: 0 };
  return { eintrag: { ...eintrag, messages: bereinigt }, anzahl };
}

function sammleDateien(ordner) {
  return fs.readdirSync(ordner)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(ordner, name));
}

function main() {
  const [, , ordnerArg, modus] = process.argv;
  if (!ordnerArg) {
    console.error("Nutzung: node scripts/repariere-chats.js <pfad-zu-.vault/chats> [--anwenden]");
    process.exitCode = 1;
    return;
  }
  const anwenden = modus === "--anwenden";
  const ordner = path.resolve(ordnerArg);
  let dateien = [];
  try {
    dateien = sammleDateien(ordner);
  } catch (err) {
    console.error(`Ordner nicht lesbar: ${ordner} (${err.message})`);
    process.exitCode = 1;
    return;
  }

  let betroffeneDateien = 0;
  let betroffeneNachrichten = 0;
  for (const datei of dateien) {
    let eintrag;
    try {
      eintrag = JSON.parse(fs.readFileSync(datei, "utf8"));
    } catch (_err) {
      console.warn(`Übersprungen, kein lesbares JSON: ${datei}`);
      continue;
    }
    const { eintrag: bereinigt, anzahl } = bereinigeEintrag(eintrag);
    if (!anzahl) continue;
    betroffeneDateien += 1;
    betroffeneNachrichten += anzahl;
    console.log(`${anwenden ? "Repariert" : "Betroffen"}: ${datei} (${anzahl} Nachricht${anzahl === 1 ? "" : "en"})`);
    if (anwenden) {
      fs.writeFileSync(`${datei}.bak`, fs.readFileSync(datei));
      fs.writeFileSync(datei, `${JSON.stringify(bereinigt, null, 2)}\n`);
    }
  }

  console.log("");
  console.log(`${betroffeneDateien} Datei(en), ${betroffeneNachrichten} Nachricht(en) betroffen.`);
  if (!anwenden && betroffeneDateien) {
    console.log("Probelauf -- nichts geschrieben. Mit --anwenden ausführen, um zu reparieren (legt .bak-Kopien an).");
  }
}

module.exports = {
  PLATZHALTER_TEXT,
  istVerstuemmelterProtokollRest,
  bereinigeNachricht,
  bereinigeEintrag,
};

if (require.main === module) main();
