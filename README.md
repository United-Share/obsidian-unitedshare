# UnitedShare für Obsidian

Community-Plugin. Die markierte Frage oder der Text aus dem Fenster verlässt den Tresor und geht an `https://api.unitedshare.ai/v1/messages`. Datenschutz: https://unitedshare.ai/privacy. Bedingungen: https://unitedshare.ai/terms.

Die rechte Spalte übernimmt die Chat-Interaktion von [Claudian](https://github.com/YishenTu/claudian) (Yishen Tu, MIT): Gespräch, Tabs und `@`-Erwähnung einer Tresor-Datei. Die erwähnte Notiz wird gelesen und als Textblock `<linked_content>` mitgeschickt. Der Auftrag setzt `stream` auf false und enthält nur Textblöcke. Das Gateway führt für das Hausmodell keine Werkzeuge aus. Das Plugin liest eine benannte Datei auf diesem Rechner und schickt den Text mit. Legt die Antwort zu einer Anlagebitte den Inhalt in einen Codeblock `python`, `javascript` oder `bash`, schreibt das Plugin die Datei in den offenen Tresor. Eine Startbitte startet `.py`, `.js`, `.mjs` und `.sh` dort. Ein Block `unitedshare` bleibt für Lesen, Listen, Schreiben und Starten, wenn der Pfad nur in der Antwort steht. Der Pfad bleibt relativ im Tresor. Claudians Agent-SDK und MCP gehören nicht zu diesem Plugin.

Der API-Schlüssel liegt nur in den Plugin-Daten des Tresors (`data.json`, von Git ignoriert). Er steht nicht im Plugin-Ordner, den man weitergibt. Das Plugin selbst nimmt kein Geld ein. Der Dienst hinter der API verlangt einen Schlüssel, deshalb trägt der Community-Eintrag die Preisangabe „Optional payments“.

## Einbinden

Ordner nach `<tresor>/.obsidian/plugins/unitedshare/` kopieren. In Obsidian unter Einstellungen → Community-Plugins den eingeschränkten Modus aus und **UnitedShare** an.

Danach in den Plugin-Einstellungen. Die Anmeldung ist der API-Schlüssel. Ein Browser-Login legt in diesem Plugin keinen Chat-Schlüssel an.

1. API-Schlüssel. Sobald er gespeichert ist, lädt die Aufklappliste die Modellnamen von `GET /v1/models`.
2. Basis-URL, Vorgabe `https://api.unitedshare.ai/v1`
3. Modell aus der Liste. Eine schon gespeicherte Kennung bleibt wählbar, auch wenn sie in der Liste fehlt. Ohne gespeicherte Kennung bleibt die Auswahl leer.

Dieselbe Liste steht in der Seitenleiste unter dem Eingabefeld.

Nach dem Einschalten öffnet UnitedShare eine Ansicht in der rechten Seitenleiste. Das Symbol **UnitedShare** in der linken Leiste und der Befehl **UnitedShare in der Seitenleiste** holen dieselbe Ansicht nach vorn. Die Ansicht ist eine Chat-Spalte: die Gesprächsnummer und die Symbole für neuen Tab, neues Gespräch und Verlauf stehen über dem Eingabefeld, der Verlauf darüber, der Willkommenstext **UnitedShare** solange das Gespräch leer ist. **Aktive Notiz** setzt den Pfad der offenen Notiz als `@"Pfad"` in das Feld. Eine Bitte, eine benannte Datei zu lesen, schickt ihren Text mit. Eine Bitte, eine benannte Quelldatei anzulegen, speichert den Codeblock aus der Antwort. Eine Bitte, sie zu starten, führt sie im Tresor aus. Ein Block `unitedshare` mit `read`, `list`, `write` oder `run` tut dasselbe, wenn der Pfad in der Antwort steht. Enter oder der Pfeil schickt die Nachricht. **In die Notiz** schreibt die letzte Frage und Antwort an die Cursor-Position der aktiven Notiz.

Befehl: **UnitedShare fragen**. Eine Markierung wird zur Frage und durch Frage plus Antwort ersetzt. Ohne Markierung öffnet sich ein Fenster.

## Prüfen

```bash
node --test unitedshare-core.test.js
```

Der Test spricht einen lokalen HTTP-Server an, nicht `api.unitedshare.ai`.

`main.js` für Katalog und Release entsteht aus `main.src.js` und `unitedshare-core.js`:

```bash
node scripts/bundle.mjs
```

Der Community-Installer lädt nur `main.js`, `manifest.json` und `styles.css`. Die Release-Datei `main.js` enthält den Kern deshalb schon und lädt keine Nachbardatei.

Ein Tag `1.2.3` ohne `v`, gleich der Version in `manifest.json`, startet `.github/workflows/release.yml`. Der Lauf baut `main.js` und schreibt die Herkunftsnachweise für `main.js`, `manifest.json` und `styles.css`.

## Stand

Anbieter: United Share GmbH. Lizenz: MIT, weil für dieses Plugin noch keine eigene Produktlizenz vorlag. Öffentliches Repo: https://github.com/United-Share/obsidian-unitedshare. Release-Tag `1.1.1`, ohne `v`. Community-Seite: https://community.obsidian.md/plugins/unitedshare. In den Firmen-Tresor ist das Plugin nicht kopiert.
