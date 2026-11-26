# UnitedShare für Obsidian

UnitedShare ist ein Chat-Agent in der Seitenleiste deines Tresors. Du stellst eine Frage oder markierst eine Notiz, der Auftrag geht als Text an ein Sprachmodell, und die Antwort kann Notizen lesen, auflisten oder schreiben. Lesen und Schreiben passieren über die Obsidian-API auf diesem Gerät. An das Modell geht nur Text, den du geschickt hast.

Das Modell läuft an einem von zwei Orten, deine Wahl in den Einstellungen:

- **Eigener Dienst (on-prem):** Basis-URL auf deinen OpenAI-kompatiblen Endpunkt mit `/v1` setzen, etwa einen selbst betriebenen reemax-Dienst.
- **UnitedShare-API:** Basis-URL auf `https://api.unitedshare.ai/v1` lassen.

Der API-Schlüssel liegt nur in `data.json` in deinem Tresor und wird an keinen Dritten weitergegeben.

## Installation

**Aus dem Community-Store (empfohlen):** In Obsidian unter Einstellungen → Community-Plugins nach "UnitedShare" suchen, installieren, aktivieren.

**Manuell:** Die Dateien `main.js`, `manifest.json` und `styles.css` des neuesten [Releases](https://github.com/United-Share/obsidian-unitedshare/releases/latest) in den Ordner `<Tresor>/.obsidian/plugins/unitedshare/` legen, dann Obsidian neu starten und das Plugin in den Einstellungen aktivieren.

## Nutzung

1. **Einstellungen öffnen:** Einstellungen → UnitedShare. Basis-URL prüfen (on-prem oder `https://api.unitedshare.ai/v1`) und den API-Schlüssel eintragen.
2. **Chat öffnen:** Über das UnitedShare-Symbol in der linken Leiste oder den Befehl "UnitedShare: Chat öffnen" aus der Befehlspalette.
3. **Fragen:** Text in die Seitenleiste tippen. Eine markierte oder verlinkte Notiz hängt sich als Kontext an den Auftrag.
4. **Antworten, die etwas tun:** Bittet die Antwort darum, eine Notiz zu lesen, aufzulisten oder zu schreiben, führt das Plugin die Aktion lokal aus. Du siehst jede Aktion im Verlauf.

Weitere Funktionen (Werkzeuge, gespeicherte Gespräche, Bilder, Geräte-Sync) stehen in der [Dokumentation](https://unitedshare.ai/docs/).

## Netzwerk und Daten

Das Plugin macht genau zwei Arten von Netzwerkaufrufen, beide zu dem Endpunkt, den du in den Einstellungen gesetzt hast:

- Die Chat-Anfrage an das Modell (`/v1/chat/completions` bzw. `/v1/messages`).
- Das Abrufen der verfügbaren Modelle (`/v1/models`).

Es gibt keine Telemetrie und keine Aufrufe an Dritte. Base64-Kodierung (`atob`/`btoa`) wird nur verwendet, um Bilddaten zwischen Tresor und Modell zu übertragen, nicht um Code oder URLs zu verstecken.

## DuckDB-Ansicht (optional, Desktop)

Das Plugin kann `.sql`-Dateien im Tresor gegen eine eingebettete DuckDB-WASM-Laufzeit anzeigen. Diese Laufzeit (`duckdb-eh.wasm` und zwei Begleitdateien) wird aus Größengründen **nicht** über den Community-Store ausgeliefert. Ohne die Dateien bleibt nur dieses eine Zusatzfeature inaktiv; der Rest des Plugins funktioniert normal. Wer die DuckDB-Ansicht nutzen will, kopiert den Ordner [`duckdb/`](https://github.com/United-Share/obsidian-unitedshare/tree/main/duckdb) aus dem Repository in den Plugin-Ordner `<Plugin>/duckdb/`.

## Lizenz und Kontakt

MIT-Lizenz. United Share GmbH, [unitedshare.ai](https://unitedshare.ai). Datenschutz: [unitedshare.ai/privacy](https://unitedshare.ai/privacy) · Bedingungen: [unitedshare.ai/terms](https://unitedshare.ai/terms). Community-Seite: [community.obsidian.md/plugins/unitedshare](https://community.obsidian.md/plugins/unitedshare).
