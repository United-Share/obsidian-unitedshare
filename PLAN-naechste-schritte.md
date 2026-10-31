# Offene Vorhaben (nicht Teil der aktuellen Session)

## 1. DuckDB-Abfragen über das eigene Geräte-Mesh (Quack)

- **Idee:** DuckDB 2.0 hat ein eingebautes Server-Protokoll ("Quack"):
  `ATTACH 'quack:host' AS db; SELECT * FROM db.tabelle` fragt eine
  DuckDB-Instanz auf einem ANDEREN Rechner über HTTP ab (Port 9494,
  Token-Auth), ohne Dateien zu kopieren.
- **Warum relevant:** passt zum bestehenden Geräte-Pairing (LAN/Tailscale,
  ECDH, verschlüsselt) aus dieser Session — der Mac könnte künftig eine
  DuckDB-Instanz auf einem anderen eigenen Gerät direkt abfragen, statt
  Parquet-Dateien hin- und herzukopieren.
- **Status:** nicht begonnen. Erster Schritt bei Aufnahme: prüfen, ob
  Quack im vendorten `duckdb-browser.cjs`/`duckdb-eh.wasm` (Version
  1.33.1-dev57.0) überhaupt enthalten ist, oder ob das eine neuere
  DuckDB-Version voraussetzt.

## 2. SQL-/rmxos-Ergebnis als echte Markdown-Tabelle

- **Problem:** Aktuell ersetzt `renderSqlCodeBlock`/`renderRmxosCodeBlock`
  den Codeblock nur optisch per DOM (`createEl("table", ...)`) — das
  Ergebnis existiert nie als echter Text in der Notiz. Export, andere
  Markdown-Renderer oder das Plugin deaktiviert zeigen nur den rohen
  SQL-/rmxos-Text, keine Tabelle.
- **Offene Entscheidung (noch nicht beantwortet):**
  - (a) Ergebnis als **echte Markdown-Tabelle in die Datei zurückschreiben**
    (bleibt als Text erhalten, auch ohne Plugin lesbar), oder
  - (b) Obsidians `![[datei]]`-**Embed-Syntax** für `.parquet`/`.sql`-Dateien
    unterstützen (wie Bilder/PDFs eingebettet werden).
  - Diese Entscheidung muss vor dem Bauen geklärt werden — nicht raten.
- **Status:** nicht begonnen.
