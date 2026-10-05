# UnitedShare für Obsidian

UnitedShare ist das Netz und die Modelle, die ihr bei euch betreibt. Damit arbeiten das Team, interne und externe Mitarbeitende, Community-Mitglieder und weitere Mandanten. Obsidian bleibt der Tresor auf dem eigenen Rechner: Notizen, Code, HTML-Seiten und die anderen Dateien, die Obsidian öffnet. Das Plugin nutzt die Funktionen dieses Tresors und spricht mit rmxos-mega2026.1, rmxos-sema2026.1 und rmxos-mobil2026.1.

Die reemax-Befehlszeile bringt den Rechner in dasselbe Netz. Die IT gibt jedem Teilnehmenden eine WireGuard-Datei. `reemax login` übernimmt sie, `reemax up` öffnet den Tunnel. Für eine direkte Verbindung erzeugt reemax eine Einladungsdatei. Die andere Person nimmt sie mit `reemax mesh join` an.

Community-Plugin. Die markierte Frage oder der Text aus dem Fenster verlässt den Tresor und geht an `https://api.unitedshare.ai/v1/messages`. Datenschutz: https://unitedshare.ai/privacy. Bedingungen: https://unitedshare.ai/terms.

Die rechte Spalte übernimmt die Chat-Interaktion von [Claudian](https://github.com/YishenTu/claudian) (Yishen Tu, MIT): Gespräch, Tabs und `@`-Erwähnung einer Tresor-Datei. Die erwähnte Notiz wird gelesen und als Textblock `<linked_content>` mitgeschickt. Der Auftrag setzt `stream` auf false und enthält nur Textblöcke. Das Gateway führt für das Hausmodell keine Werkzeuge aus. Das Plugin liest eine benannte Datei auf diesem Rechner und schickt den Text mit. Legt die Antwort zu einer Anlagebitte den Inhalt in einen Codeblock `python`, `javascript` oder `bash`, schreibt das Plugin die Datei in den offenen Tresor. Eine Startbitte startet `.py`, `.js`, `.mjs` und `.sh` dort. Ein Block `unitedshare` bleibt für Lesen, Listen, Schreiben und Starten, wenn der Pfad nur in der Antwort steht. Der Pfad bleibt relativ im Tresor. Claudians Agent-SDK und MCP gehören nicht zu diesem Plugin.

Der API-Schlüssel liegt nur in den Plugin-Daten des Tresors (`data.json`, von Git ignoriert). Er steht nicht im Plugin-Ordner, den man weitergibt. Das Plugin selbst nimmt kein Geld ein. Der Dienst hinter der API verlangt einen Schlüssel, deshalb trägt der Community-Eintrag die Preisangabe „Optional payments“.

## Einbinden

Ordner nach `<tresor>/.obsidian/plugins/unitedshare/` kopieren. In Obsidian unter Einstellungen → Community-Plugins den eingeschränkten Modus aus und **UnitedShare** an.

### Anmeldung

1. Im Browser [Zugang für Obsidian](https://unitedshare.ai/app/?q=obsidian) öffnen und mit dem UnitedShare-Konto anmelden.
2. Zugang anlegen. Der Name **Obsidian** ist schon eingetragen, solange noch kein Zugang da ist. Du siehst eine key-ID und einen Schlüssel. Die key-ID bleibt auf der Seite. Den Schlüssel siehst du einmal.
3. In den Plugin-Einstellungen nur den Schlüssel unter **API-Schlüssel** einfügen, nicht die key-ID.

Der Browser schreibt den Schlüssel nicht von allein in das Plugin. Die Adresse enthält keinen Schlüssel. Der Schlüssel liegt nur in den Plugin-Daten des Tresors.

Basis-URL, Vorgabe `https://api.unitedshare.ai/v1`.

### Modelle

Sobald der Schlüssel gespeichert ist, lädt die Aufklappliste `GET /v1/models` und zeigt nur die drei Hauptmodelle:

- `rmxos-mega2026.1`
- `rmxos-sema2026.1`
- `rmxos-mobil2026.1`

Andere Kennungen aus dem Katalog bleiben in Obsidian unsichtbar, auch wenn der Zugang sie sonst sieht. Eine gespeicherte Kennung außerhalb dieser drei fällt weg. Ohne gespeicherte Kennung bleibt die Auswahl leer. Dieselbe Liste steht in der Seitenleiste unter dem Eingabefeld.

### Tresor

Nach dem Einschalten öffnet UnitedShare eine Ansicht in der rechten Seitenleiste. Das Symbol **UnitedShare** in der linken Leiste und der Befehl **UnitedShare in der Seitenleiste** holen dieselbe Ansicht nach vorn. Die Ansicht ist eine Chat-Spalte: die Gesprächsnummer und die Symbole für neuen Tab, neues Gespräch und Verlauf stehen über dem Eingabefeld, der Verlauf darüber, der Willkommenstext **UnitedShare** solange das Gespräch leer ist.

Die Werkzeuge laufen auf diesem Rechner, mit den Funktionen des offenen Tresors. Das Gateway führt sie nicht aus.

- **Aktive Notiz** setzt den Pfad der offenen Notiz als `@"Pfad"` in das Feld.
- `@Pfad` und `@"Pfad mit Leerzeichen"` lesen die Notiz und schicken den Text mit.
- **Lesen** und **Listen** nutzen den Tresor. Der Pfad bleibt relativ, ohne `..`.
- **Schreiben** legt eine Datei an oder ändert sie. Eine Anlagebitte mit einem Codeblock `python`, `javascript` oder `bash` speichert diesen Inhalt unter dem genannten Pfad.
- **Starten** führt auf dem Desktop `.py`, `.js`, `.mjs` und `.sh` im Tresor aus.
- Ein Block `unitedshare` mit `read`, `list`, `write` oder `run` tut dasselbe, wenn der Pfad in der Antwort steht.
- **In die Notiz** schreibt die letzte Frage und Antwort an die Cursor-Position der aktiven Notiz.

Enter oder der Pfeil schickt die Nachricht.

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

Anbieter: United Share GmbH. Lizenz: MIT, weil für dieses Plugin noch keine eigene Produktlizenz vorlag. Öffentliches Repo: https://github.com/United-Share/obsidian-unitedshare. Release-Tag `1.1.4`, ohne `v`. Community-Seite: https://community.obsidian.md/plugins/unitedshare. In den Firmen-Tresor ist das Plugin nicht kopiert.
