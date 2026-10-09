# UnitedShare für Obsidian

Das Plugin stellt Fragen aus der Seitenleiste und der markierten Notiz an die Modelle eures UnitedShare. Der Tresor bleibt auf diesem Rechner. Die Antwort erscheint in der Seitenleiste, sobald das Modell Text liefert.

Selbst betreiben, in dieser Reihenfolge:

1. [Dokumentation](https://unitedshare.ai/docs/)
2. [reemax-Handbuch](https://unitedshare.ai/docs/reemax/) für Installation, Mesh und die Befehle `reemax list`, `reemax run` und `reemax serve`
3. [Console](https://console.unitedshare.io/)
4. Dieses Plugin aus den Community-Plugins, danach den Schlüssel über [Zugang für Obsidian](https://unitedshare.ai/app/?q=obsidian)

Der Auftrag geht an `https://api.unitedshare.ai/v1/messages` und enthält nur Textblöcke. Datenschutz: https://unitedshare.ai/privacy. Bedingungen: https://unitedshare.ai/terms.

Die rechte Spalte übernimmt die Chat-Interaktion von [Claudian](https://github.com/YishenTu/claudian) (Yishen Tu, MIT): Gespräch, Tabs und `@`-Erwähnung einer Tresor-Datei. Die erwähnte Notiz wird gelesen und als Textblock `<linked_content>` mitgeschickt. Der Auftrag bittet um einen Strom. Jedes Textstück schreibt die Seitenleiste sofort. Kommt die Antwort in einem JSON-Körper, erscheint der Text in dem Moment, in dem der Körper da ist. Das Gateway führt für das Hausmodell keine Werkzeuge aus. Das Plugin liest eine benannte Datei auf diesem Rechner und schickt den Text mit. Legt die Antwort zu einer Anlagebitte den Inhalt in einen Codeblock `python`, `javascript` oder `bash`, schreibt das Plugin die Datei in den offenen Tresor. Eine Startbitte startet `.py`, `.js`, `.mjs` und `.sh` dort. Ein Block `unitedshare` bleibt für Lesen, Listen, Schreiben und Starten, wenn der Pfad nur in der Antwort steht. Der Pfad bleibt relativ im Tresor. Claudians Agent-SDK und MCP gehören nicht zu diesem Plugin.

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
- **Lesen** und **Listen** nutzen den Tresor. Der Pfad bleibt relativ, ohne `..`. Dateien und Ordner mit führendem Punkt, die Obsidian aus dem Index lässt, liest und listet die Desktop-App vom Datenträger im selben Tresor. Ein Beispiel ist `.cortex/endpoints.md`. `.obsidian`, `.git` und `.trash` bleiben zu.
- **Schreiben** legt eine Datei an oder ändert sie. Eine Anlagebitte mit einem Codeblock `python`, `javascript` oder `bash` speichert diesen Inhalt unter dem genannten Pfad.
- **Starten** führt auf dem Desktop `.py`, `.js`, `.mjs` und `.sh` im Tresor aus.
- Ein Block `unitedshare` mit `read`, `list`, `write` oder `run` tut dasselbe, wenn der Pfad in der Antwort steht.
- Der Block selbst erscheint nie im Gespräch, auch nicht während die Antwort läuft oder wenn ein Schritt fehlschlägt. Er ist Maschinenkommunikation.
- Ein Pfad mit führendem `@` wird auch ohne das Zeichen gesucht. Das `@` stammt aus der Eingabe-Syntax; Modelle nehmen es aus der Frage mit. Der genannte Pfad hat Vorrang, und beim Schreiben gibt es keinen Zweitversuch.
- Schreibt das Modell die Anweisung als blankes JSON statt in den Block, wird sie **nicht** ausgeführt. Stattdessen bekommt es das Format genannt und antwortet erneut. Du siehst also kein rohes JSON, und ausgeführt wird weiterhin nur, was richtig formatiert ist. Das geschieht höchstens einmal je Frage.
- **Beitreten** nimmt eine Einladungs- oder Empfangsdatei im Tresor an. Das Plugin startet dafür nur `reemax mesh join` mit diesem relativen Pfad.
- **Abgleich** startet `reemax sync push` oder `reemax sync pull` für einen Namen, der mit `reemax sync pair` schon eingerichtet ist. Beide Richtungen zugleich gibt es nicht. `reemax mesh sync` prüft den Tunnel und kopiert keine Dateien. Das Plugin legt kein Paar an.
- **Direktes Netz** erscheint, wenn der Schlüssel gespeichert ist und reemax auf diesem Rechner liegt. Es nennt Modell, Agent und Oberfläche und die Gegenstellen, die schon eingerichtet sind. Fehlt die Einrichtung, steht das dort. Das Firmennetz bleibt getrennt.
- **In die Notiz** schreibt die letzte Frage und Antwort an die Cursor-Position der aktiven Notiz.
- `zeige die Graphansicht` oder `öffne den Graphen` öffnet die Graphansicht auf diesem Gerät. `zeige die lokale Graphansicht` und `Graphansicht der Notiz` öffnen den Graphen der offenen Notiz. Diese Sätze gehen nicht ans Modell.
- Ist die Seitenleiste zugeklappt, steht unten im Fenster die UnitedShare-Eingabe. Ein Rechtsklick bietet UnitedShareAI. Enter schickt den Auftrag. Eine Markierung wird nur durch die Antwort ersetzt. Ohne Markierung wird nur die Antwort am Cursor eingefügt.

Enter oder der Pfeil schickt die Nachricht.

Befehl: **UnitedShare fragen**. Eine Markierung wird zur Frage und durch Frage plus Antwort ersetzt. Ohne Markierung öffnet sich ein Fenster.

### Gespräche

Jedes Gespräch liegt als Datei in `.vault/chats` im Tresor, eine Datei je Gespräch, im JSON-Format. Geschrieben wird nach jeder Antwort, nicht erst beim Abschließen — ein Absturz mittendrin kostet damit nichts.

Beim Öffnen der Ansicht kommen die Gespräche zurück: offene in die Reiter, abgeschlossene ins Verlaufsmenü. Nach einem Neustart von Obsidian lässt sich einfach weiterschreiben, und das Modell bekommt den bisherigen Verlauf mit.

Der Ordner beginnt mit einem Punkt. Das heißt: Die Gespräche reisen mit dem Tresor — Sync, Sicherung, Git — erscheinen aber nicht in Obsidians Suche, im Graphen oder in der Dateiliste. Lesen lassen sie sich mit jedem Editor.

Das Verlaufsmenü zeigt die 50 jüngsten. Liegen mehr im Ordner, steht die Zahl in der Entwicklerkonsole; verloren geht keines.

JSON und nicht Markdown, weil eine Antwort selbst Frontmatter und verschachtelte Codeblöcke enthalten kann. Jeder Markdown-Trenner wäre damit mehrdeutig, und ein Verlauf, der sich nicht verlustfrei zurücklesen lässt, ist wertlos.

## Was das Plugin auf diesem Rechner tut

Die Plugin-Prüfung weist auf zwei Dinge hin. Beide stimmen, und hier steht, wofür sie da sind.

**Dateien.** Lesen, Listen und Schreiben im Tresor laufen über die Adapter-API von Obsidian. Sie kennt keine absoluten Pfade und kann den Tresor nicht verlassen. Versteckte Ordner wie `.vault/chats` sind nur über diesen Weg erreichbar — die Vault-API sieht ausschließlich, was die App anzeigt.

**Shell.** Zwei Funktionen starten ein Programm, und dafür braucht es `child_process` und `node:fs`:

- **Starten** führt `.py`, `.js`, `.mjs` oder `.sh` aus dem Tresor aus. Nur auf dem Desktop, nur für einen Pfad, den die Frage nennt.
- **Beitreten** und **Abgleich** rufen `reemax mesh join` beziehungsweise `reemax sync push|pull` auf.

Diese beiden lassen sich nicht ohne Shell bauen — das Ausführen *ist* die Funktion. Sie laufen nie unaufgefordert: Es braucht eine Frage, und in der Antwort einen Block `unitedshare`.

Den Pfad wählt dabei das Modell. Nennt die Frage keinen, schlägt die Antwort einen vor — eine Bitte um eine Notiz kann also eine Datei anlegen, deren Namen das Modell bestimmt hat. Das ist beabsichtigt, denn sonst ließe sich keine neue Notiz erzeugen, aber man sollte es wissen. Die Grenzen gelten in jedem Fall: nur relative Pfade im Tresor, kein `..`, und `.obsidian`, `.git` und `.trash` bleiben zu.

Eine Ausnahme ist der Weg ohne Protokollblock: Erkennt das Plugin eine Anlagebitte an der Frage selbst, nimmt es ausschließlich Pfade, die in der Frage stehen, und nur `.py`, `.js`, `.mjs` und `.sh`.

**Netz.** Ein Ziel: der Endpunkt aus den Einstellungen, voreingestellt `api.unitedshare.ai`. Dorthin geht die Frage als Text. Keine Telemetrie, keine zweite Adresse.

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

Anbieter: United Share GmbH. Lizenz: MIT. Öffentliches Repo: https://github.com/United-Share/obsidian-unitedshare. Release-Tag `1.2.3`, ohne `v`. Community-Seite: https://community.obsidian.md/plugins/unitedshare
