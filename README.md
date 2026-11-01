# UnitedShare für Obsidian

Fragen aus der Seitenleiste oder einer markierten Notiz gehen an die Modelle eures UnitedShare. Der Auftrag enthält nur Textblöcke, der Tresor bleibt auf diesem Rechner. Ein Bild ist ein eigener Auftrag, `POST /v1/images/generations`, Modell `reemax-image`.

Enter erkennt einen Bildauftrag. Ein klares „zeichne“, „male“ oder ein Seitenverhältnis geht an das Bild, der Rest an das Textmodell. Unklare Sätze prüft das lokale Embedding auf diesem Rechner. Mermaid, Diagramme und Fragen über ein Bild bleiben Text. Ein gesetztes lokales Modell unter `absichtModell` formuliert gemischte Sätze, wenn die Zerlegung keinen Rest findet; sonst bleibt es die Textfrage. Der Schlüssel geht dabei nicht an diesen Rechner.

Datenschutz: https://unitedshare.ai/privacy · Bedingungen: https://unitedshare.ai/terms

Die vollständige Übersicht über Werkzeuge, Gespräche und Einstellungen steht in der [Dokumentation](https://unitedshare.ai/docs/). Hier nur, was zum Einrichten und Betreiben nötig ist.

## Einrichten

1. [Dokumentation](https://unitedshare.ai/docs/) lesen, dazu das [reemax-Handbuch](https://unitedshare.ai/docs/reemax/), falls ihr den Dienst selbst betreibt.
2. Zugang über die [Console](https://console.unitedshare.io/) oder direkt den [Zugang für Obsidian](https://unitedshare.ai/app/?q=obsidian) anlegen. Der Schlüssel steht dort einmal — in die Plugin-Einstellungen unter **API-Schlüssel** gehört nur er, nicht die key-ID.
3. Den vollständigen Plugin-Ordner nach `.obsidian/plugins/unitedshare/` kopieren und das Plugin einschalten.

UnitedShare steht **nicht** in den Community-Plugins und wird dort auch nicht angeboten: In der Registry (`community-plugins.json`) gibt es keinen Eintrag, im Registry-Repo keinen Aufnahme-PR und keinen Commit dazu. Ein Store-Installer existiert also nicht; die Installation erfolgt von Hand über den kompletten Ordner samt Unterordner `duckdb/`.

### DuckDB (Parquet/SQL) braucht die mitgelieferte Laufzeit

Die DuckDB-Ansicht für `.parquet` und `.sql` lädt ihre Laufzeit aus dem Unterordner `duckdb/`: `duckdb-eh.wasm` (~36 MB), `duckdb-browser.cjs` und `duckdb-browser-eh.worker.js`. Diese Dateien gehören mit in den kopierten Ordner.

Der Obsidian-Community-Installer und das Release-Workflow liefern **nur** `main.js`, `manifest.json` und `styles.css`. Fehlt der Ordner `duckdb/`, meldet die Ansicht „DuckDB-WASM ließ sich nicht laden." Das trifft jede Installation, die allein aus den drei Release-Dateien besteht.

Ist nach der Anmeldung genau ein unterstütztes Textmodell verfügbar, wählt das Plugin es automatisch. Bei mehreren Modellen erfolgt keine automatische Auswahl, weil deren Kosten und Fähigkeiten hier nicht bekannt sind; ein bereits gewähltes Modell bleibt erhalten. Für die lokale Suche das Feld **Lokale Suche: Modell** leer lassen: Ein unterstütztes bereits installiertes Modell wird automatisch erkannt. Die gesonderte Tresor-Indexsuche benötigt weiterhin `bge-m3`; das Plugin installiert keine Modelle automatisch.

Basis-URL, Standard `https://api.unitedshare.ai/v1`. Der Schlüssel liegt nur in `data.json` im Tresor, nie im weitergegebenen Plugin-Ordner.

Nach dem Einschalten öffnet UnitedShare eine Ansicht in der rechten Seitenleiste. Das Symbol in der linken Leiste und der Befehl **UnitedShare in der Seitenleiste** holen sie nach vorn. Ist die Seitenleiste zugeklappt, steht unten im Fenster eine Eingabe, und ein Rechtsklick in einer Notiz bietet **UnitedShareAI**; eine Markierung wird dort nur durch die Antwort ersetzt.

Unter **Wie ausführlich darf die Antwort sein?** lässt sich das Ausgabelimit zwischen 1.200 und 8.192 Tokens wählen. Der gesamte serialisierte Textauftrag einschließlich Verlauf, RAG-Text und Werkzeugergebnissen ist zusätzlich auf 128.000 UTF-8-Bytes begrenzt. Bei Überschreitung wird der jeweilige Modellaufruf mit einem Hinweis abgelehnt, nicht still gekürzt. Bereits ausgeführte Werkzeugaktionen werden dadurch nicht rückgängig gemacht. Bytes sind keine Tokenzählung: Je nach Modell kann dessen Kontextfenster oder Ausgabelimit trotzdem früher erreicht werden.

Bei Überschreitung zeigt die Fehlermeldung zusätzlich die Textgrößen von Verlauf, Dateien, Werkzeugergebnissen und Systemanweisung, ohne deren Inhalte auszugeben. Diese Anteile sind ohne JSON-Verpackung gemessen und ergeben deshalb nicht zwingend die Gesamtgröße. Scheitert ein Folgeaufruf nach Werkzeugschritten, weist die Meldung darauf hin: Vor einem erneuten Versuch Tresor und Schrittliste prüfen, damit Aktionen nicht unbeabsichtigt wiederholt werden.

Die Seitenleiste baut auf [Claudian](https://github.com/YishenTu/claudian) (Yishen Tu, MIT) auf: Gespräch, Tabs, `@`-Erwähnung einer Tresor-Datei. Die Werkzeuge — **Notiz**, Mermaid, **Bild**, **Beitreten**, **Abgleich**, **Direktes Netz** und mehr — laufen auf diesem Rechner über die Funktionen des Tresors. Was sie genau tun, steht in der Dokumentation.

### Eigenschaften in rmxos-Codeblöcken

Ein `rmxos`-Codeblock kann Eigenschaften seiner eigenen Notiz in Zeichenketten
mit `{{$name}}` anzeigen. Beispiel: Bei `date: 31.10.2026` im Frontmatter
wird `.value("Datum {{$date}}")` als `Datum 31.10.2026` dargestellt.
Text, Zahlen und Wahrheitswerte werden unterstützt. Fehlende oder komplexe
Eigenschaften bleiben als Platzhalter sichtbar. Die Ersetzung erfolgt lokal
nach dem Parsen nur für die Anzeige: Weder die Notiz noch der Codeblock wird
verändert und der Block führt keine Aktion aus. Das gilt nicht automatisch für
gewöhnliche Markdown- oder SQL-Blöcke.

Offen umgegangen wird damit: Obsidian-Verweise in Eigenschaften. `[[Notiz]]`,
`[[Notiz|Anzeige]]` und `[[Notiz#Kopf]]` werden in der Tabelle zu echten Links,
die die verlinkte Notiz öffnen. Einbettungen (`![[Notiz]]`) bleiben ausdrücklich
Text: Der Inhalt anderer Dateien gehört nicht still in eine Zelle. SQL-Ergebnisse
in der DuckDB-Ansicht bleiben ganz ohne Verlinkung. Ein Semikolon hinter dem
letzten Aufruf ist laut Grammatik ungültig und wird als eigener Fehler benannt;
nach jedem `;` muss eine weitere Kette folgen.

## Sicherheit

### Private Cloud-Vorlage (Prototyp)

In einer Notiz über Eigenschaften `unitedshare_privacy` auf `template` setzen und
unter `unitedshare_private_felder` eine Liste der lokalen Property-Namen anlegen.
Beispiel:

```yaml
---
unitedshare_privacy: template
unitedshare_private_felder:
  - kunde
  - frist
kunde: "Müller GmbH"
frist: "3 Monate"
---
```

Mit dem Befehl **UnitedShare: Private Cloud-Vorlage** eine eigene Vorlage eingeben,
z. B. `Erstelle eine Checkliste für {{VAR_1}} bis {{VAR_2}}`. Die Reihenfolge
der Liste bestimmt die Platzhalter. Statt der Nummern dürfen auch die Namen der
selben Eigenschaften stehen: `{{$kunde}}` ist gleichwertig mit `{{VAR_1}}` und
wird nur lokal umgezeichnet, sodass der Eigenschaftsname die Cloud nie erreicht.
Unbekannte Namen wie `{{$aktion}}` werden abgelehnt. Der Dialog zeigt den
konkreten Auftrag und das Ziel vor dem Senden. Die Antwort wird lokal aufgelöst
und nur angezeigt.
Die Vorlage wird nicht automatisch anonymisiert: Sie selbst kann vertrauliche
Informationen enthalten und muss geprüft werden. Die Prüfung auf Property-Werte
ist keine zuverlässige Erkennung aller sensiblen Daten. Ungültige Regeln und
unbekannte Platzhalter werden abgelehnt. Es handelt sich nicht um homomorphe
Verschlüsselung.

**Wichtig:** Diese Regeln gelten ausschließlich für den separaten Befehl. Der
gewöhnliche Chat, Erwähnungen und andere Plugin-Funktionen werden davon nicht
gesperrt. Der aktuelle Cloud-Aufruf nutzt die vorhandene Modell-API, noch keinen
eigenen Agentendienst. Neben der Vorlage und einer festen Format-Anweisung gehen
Modellkennung, Authentifizierung und technische Metadaten an den Dienst.

Die Plugin-Prüfung fragt nach zwei Dingen:

- **Dateien**: Lesen, Listen und Schreiben laufen über Obsidians Adapter-API, relativ im Tresor, nie mit `..`.
- **Shell**: Nur ein Skript aus dem Tresor (`.py`, `.js`, `.mjs`, `.sh`) starten und `reemax mesh join`/`sync` rufen einen Prozess, immer nur auf Wunsch in einer Antwort. Das Plugin legt kein Paar an. Eine Aufgabe, die noch läuft und nichts ausgibt, bleibt bis zur langen Frist offen. Eine ausdrücklich kurze Frist beendet sie trotzdem.

Für neue Installationen ist die Schreibbestätigung eingeschaltet; bestehende Einstellungen bleiben unverändert. Der Dialog zeigt veränderte Zeilen und den vollständigen vorgeschlagenen Inhalt. Hat sich der Dateistand während der Bestätigung geändert, wird nicht geschrieben. Die Prüfung erfolgt unmittelbar vor dem Schreiben, ist aber keine atomare Sperre gegen alle gleichzeitig schreibenden Prozesse.

Netzwerkseitig gibt es zwei Ziele, keine Telemetrie: den Endpunkt aus den Einstellungen (Standard `api.unitedshare.ai`) und, falls aktiv, ein lokales Embedding auf `http://127.0.0.1:11434` (`/api/embed`) — der API-Schlüssel geht dorthin nicht.

In den Einstellungen steht **Token aufladen**. Tag und Monat kommen vom Dienst, Nachkauf und Planwechsel stehen auf der Verbrauchsseite.

## Lange Aufträge und Abbrechen

Ein hängender Chat ohne Meldung ist der schlimmste Zustand. Dagegen greifen drei Vorkehrungen:

- **Stille-Frist**: Kommt vor dem ersten Zeichen zwei Minuten lang nichts vom Modell (die Denkpause vor der ersten Antwort), bricht der Auftrag mit einer benannten Meldung ab. Vorher lief er bis zum harten Zehn-Minuten-Aus still weiter. Nach dem ersten Zeichen übernimmt wieder die normale Leerlauf-Frist.
- **Stopp-Knopf**: Während eines Auftrags erscheint im Eingabefeld ein roter Stopp-Knopf. Er bricht den Modellaufruf ab und beendet gestartete Tresor-Programme (`run`) hart mit SIGKILL, statt sie weiter in den Tresor schreiben zu lassen. Ausserhalb eines Auftrags ist der Knopf ausgeblendet.
- **Mehrstufige Läufe melden sich**: Beginnt nach einer Werkzeugaktion die nächste Runde, zeigt der Status das an ("Nächste Runde läuft"), damit der Chat nicht stumm wirkt.

Ein Nutzerabbruch endet mit der Meldung "Der Auftrag wurde abgebrochen.", offene Schritte stehen als **abgebrochen** da (nicht als fehlgeschlagen), und es erscheint kein zusätzlicher Alarm — der Nutzer hat selbst abgebrochen. Ein echter Fehler meldet dagegen weiter per Hinweis und markiert betroffene Schritte als fehlgeschlagen.

## Entwickeln

```bash
node --test *.test.js       # auch gegen einen echten lokalen Server
node scripts/bundle.mjs     # main.js aus main.src.js + unitedshare-core.js
```

Der Community-Installer lädt nur `main.js`, `manifest.json` und `styles.css`. Ein Tag ohne `v`, gleich der Version in `manifest.json`, löst `.github/workflows/release.yml` aus und erzeugt ein Release mit **nur** diesen drei Dateien — der Ordner `duckdb/` ist darin nicht enthalten.

## Stand

United Share GmbH ([unitedshare.ai](https://unitedshare.ai)), MIT-Lizenz. Repo: https://github.com/United-Share/obsidian-unitedshare — letztes Release `1.2.13`; `manifest.json` steht auf `1.2.14`, dafür gibt es noch keinen Tag und kein Release. Nicht in den Community-Plugins gelistet.
