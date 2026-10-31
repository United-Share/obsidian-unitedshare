# Herkunft

Diese drei Dateien stammen unveraendert aus dem npm-Paket `@duckdb/duckdb-wasm`
(Version 1.33.1-dev57.0, MVP-Bundle, MIT-Lizenz, https://github.com/duckdb/duckdb-wasm).
Bezogen am 2026-10-24 per `npm pack @duckdb/duckdb-wasm`.

- duckdb-mvp.wasm (ERSETZT, siehe Nachtrag 4) -- das WebAssembly-Modul (einzelstraengig, kein SharedArrayBuffer noetig)
- duckdb-browser-mvp.worker.js (ERSETZT, siehe Nachtrag 4) -- der dazugehoerige Web Worker
- duckdb-browser.mjs -- die JS-API (AsyncDuckDB, ConsoleLogger, ...), ES-Modul

Lokal eingebettet statt zur Laufzeit von einem CDN geladen, bewusste Entscheidung:
keine Internet-Abhaengigkeit, keine Drittanbieter-CDN-Anfrage bei jedem Start.

## Nachtrag: apache-arrow (Laufzeit-Abhängigkeit von duckdb-browser.mjs)

`duckdb-browser.mjs` importiert `apache-arrow` als bare specifier (`import ... from "apache-arrow"`).
Das war im ersten Entwurf nicht mitvendort und haette den dynamischen `import()` in Obsidian
mit einem Modul-nicht-gefunden-Fehler abbrechen lassen -- das ist am 2026-10-24 per echtem
`node -e "import(...)"`-Aufruf gemessen worden (nicht nur vermutet), vor und nach dem Fix.

Nachtraeglich vendort unter `duckdb/node_modules/` (Standard-Node-Aufloesung greift bei
`import()` automatisch, auch ausserhalb eines echten npm-Projekts):
- `apache-arrow@17.0.0` (die von duckdb-wasm 1.33 geforderte Major-Version, nicht die neueste
  21.x) -- nur Root-Module kopiert, OHNE `dist/` (143 MB Browser-Bundles, ungenutzt bei
  Node-Aufloesung), OHNE `src/` (TypeScript-Quellen), OHNE `.map`/`.ts`-Dateien. 2,5 MB statt
  150 MB entpackt.
- `tslib@2.8.1` -- transitive Abhaengigkeit von apache-arrow, 124 KB.
- `flatbuffers@25.9.23` -- weitere transitive Abhaengigkeit, Root-Dateien ohne `ts/`-Quellen, 444 KB.

Verifiziert (echter Node-Import-Aufruf, kein Vermuten): `node -e 'import("duckdb/duckdb-browser.mjs")'`
läuft bis zum Zugriff auf den globalen `Worker` (Browser-API, in Obsidians Electron-Renderer
vorhanden, in reinem Node nicht) -- das ist der erwartete, letzte Punkt, den nur die echte App
noch zeigen kann.

## Nachtrag 2: CommonJS statt ES-Modul (2026-10-25)

`duckdb-browser.mjs` + `import()` ueber eine `file://`-URL scheiterte in
Obsidians Electron-Fenster mit "Failed to fetch dynamically imported module"
-- gemessen am echten Fehlerprotokoll (.vault/debug.log), nicht vermutet.
Ersetzt durch `duckdb-browser.cjs` (dieselbe API, CommonJS statt ES-Modul)
+ `require()`, das Nodes eigene Dateisystem-Aufloesung nutzt und nicht
ueber Chromiums Fetch-Schicht laeuft. `apache-arrow` entsprechend als
CommonJS-Variante (`Arrow.node.js` statt `Arrow.node.mjs`) neu vendort,
mit echtem `require()`-Aufruf lokal getestet, bevor es ins Repo kam.

## Nachtrag 4: eh-Bundle statt mvp (2026-10-25)

Das mvp-Bundle hat einen bestaetigten Fehler im duckdb-wasm-Projekt selbst
(github.com/duckdb/duckdb-wasm Issue #2267): JEDE DuckDB-Fehlermeldung
(falsches SQL, fehlende Datei, ...) verschluckt sich zu
"ReferenceError: _setThrew is not defined", weil die JS-Ausnahme-
behandlung nie an den echten WASM-Export gebunden wird. Erfolgreiche
Abfragen waeren unbetroffen gewesen, aber eine funktionsfaehige DuckDB-
Ansicht braucht auch funktionierende Fehlermeldungen. Ersetzt durch das
eh-Bundle (duckdb-eh.wasm, duckdb-browser-eh.worker.js) -- native WASM-
Ausnahmebehandlung, kein `_setThrew` im Code. Das Buffer-Stub-Problem aus
Nachtrag 3 gilt unveraendert auch hier, der Patch in main.src.js sucht das
Muster dynamisch und trifft beide Bundles gleichermassen.
