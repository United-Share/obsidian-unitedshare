# UnitedShare für Obsidian

Fragen aus der Seitenleiste oder einer markierten Notiz gehen an die Modelle eures UnitedShare. Der Auftrag enthält nur Textblöcke, der Tresor bleibt auf diesem Rechner. Ein Bild ist ein eigener Auftrag, `POST /v1/images/generations`, Modell `reemax-image`.

Datenschutz: https://unitedshare.ai/privacy · Bedingungen: https://unitedshare.ai/terms

Die vollständige Übersicht über Werkzeuge, Gespräche und Einstellungen steht in der [Dokumentation](https://unitedshare.ai/docs/). Hier nur, was zum Einrichten und Betreiben nötig ist.

## Einrichten

1. [Dokumentation](https://unitedshare.ai/docs/) lesen, dazu das [reemax-Handbuch](https://unitedshare.ai/docs/reemax/), falls ihr den Dienst selbst betreibt.
2. Zugang über die [Console](https://console.unitedshare.io/) oder direkt den [Zugang für Obsidian](https://unitedshare.ai/app/?q=obsidian) anlegen. Der Schlüssel steht dort einmal — in die Plugin-Einstellungen unter **API-Schlüssel** gehört nur er, nicht die key-ID.
3. Plugin aus den Community-Plugins installieren und einschalten.

Basis-URL, Standard `https://api.unitedshare.ai/v1`. Der Schlüssel liegt nur in `data.json` im Tresor, nie im weitergegebenen Plugin-Ordner.

Nach dem Einschalten öffnet UnitedShare eine Ansicht in der rechten Seitenleiste. Das Symbol in der linken Leiste und der Befehl **UnitedShare in der Seitenleiste** holen sie nach vorn. Ist die Seitenleiste zugeklappt, steht unten im Fenster eine Eingabe, und ein Rechtsklick in einer Notiz bietet **UnitedShareAI**; eine Markierung wird dort nur durch die Antwort ersetzt.

Die Seitenleiste baut auf [Claudian](https://github.com/YishenTu/claudian) (Yishen Tu, MIT) auf: Gespräch, Tabs, `@`-Erwähnung einer Tresor-Datei. Die Werkzeuge — **Notiz**, Mermaid, **Bild**, **Beitreten**, **Abgleich**, **Direktes Netz** und mehr — laufen auf diesem Rechner über die Funktionen des Tresors. Was sie genau tun, steht in der Dokumentation.

## Sicherheit

Die Plugin-Prüfung fragt nach zwei Dingen:

- **Dateien**: Lesen, Listen und Schreiben laufen über Obsidians Adapter-API, relativ im Tresor, nie mit `..`.
- **Shell**: Nur ein Skript aus dem Tresor (`.py`, `.js`, `.mjs`, `.sh`) starten und `reemax mesh join`/`sync` rufen einen Prozess, immer nur auf Wunsch in einer Antwort. Das Plugin legt kein Paar an. Eine Aufgabe, die noch läuft und nichts ausgibt, bleibt bis zur langen Frist offen. Eine ausdrücklich kurze Frist beendet sie trotzdem.

Netzwerkseitig gibt es zwei Ziele, keine Telemetrie: den Endpunkt aus den Einstellungen (Standard `api.unitedshare.ai`) und, falls aktiv, ein lokales Embedding auf `http://127.0.0.1:11434` (`/api/embed`) — der API-Schlüssel geht dorthin nicht.

In den Einstellungen steht **Token aufladen**. Tag und Monat kommen vom Dienst, Nachkauf und Planwechsel stehen auf der Verbrauchsseite.

## Entwickeln

```bash
node --test *.test.js       # auch gegen einen echten lokalen Server
node scripts/bundle.mjs     # main.js aus main.src.js + unitedshare-core.js
```

Der Community-Installer lädt nur `main.js`, `manifest.json` und `styles.css`. Ein Tag ohne `v`, gleich der Version in `manifest.json`, löst `.github/workflows/release.yml` aus und erzeugt das Release mit diesen drei Dateien.

## Stand

United Share GmbH ([unitedshare.ai](https://unitedshare.ai)), MIT-Lizenz. Repo: https://github.com/United-Share/obsidian-unitedshare — Release-Tag `1.2.12` — [Community-Seite](https://community.obsidian.md/plugins/unitedshare)
