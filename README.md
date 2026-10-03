# UnitedShare für Obsidian

Community-Plugin. Die markierte Frage oder der Text aus dem Fenster verlässt den Tresor und geht an `https://api.unitedshare.ai/v1/chat/completions`. Datenschutz: https://unitedshare.ai/privacy. Bedingungen: https://unitedshare.ai/terms.

Der API-Schlüssel liegt nur in den Plugin-Daten des Tresors (`data.json`, von Git ignoriert). Er steht nicht im Plugin-Ordner, den man weitergibt. Das Plugin selbst nimmt kein Geld ein. Der Dienst hinter der API verlangt einen Schlüssel, deshalb trägt der Community-Eintrag die Preisangabe „Optional payments“.

## Einbinden

Ordner nach `<tresor>/.obsidian/plugins/unitedshare/` kopieren. In Obsidian unter Einstellungen → Community-Plugins den eingeschränkten Modus aus und **UnitedShare** an.

Danach in den Plugin-Einstellungen:

1. API-Schlüssel
2. Basis-URL, Vorgabe `https://api.unitedshare.ai/v1`
3. Modell-Kennung aus einem authentifizierten `GET /v1/models`

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

Lizenz: MIT, weil für dieses Plugin noch keine eigene Produktlizenz vorlag. Öffentliches Repo: https://github.com/mikebaumgart/obsidian-unitedshare. Release-Tag `1.0.1`, ohne `v`. Community-Seite: https://community.obsidian.md/plugins/unitedshare. In den Firmen-Tresor ist das Plugin nicht kopiert.
