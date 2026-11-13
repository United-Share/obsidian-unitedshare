# UnitedShare Headless-CRM

Parquet-Vault-CRM ohne Obsidian: liest Parquet-Dateien direkt aus einem
Tresor-Ordner mit der installierten **duckdb-CLI** (getestet mit v1.4.0).
Vollständig lesend, vollständig lokal — und für Agenten über **MCP** und
**ACP** ansprechbar.

## Bausteine

| Datei | Aufgabe |
|---|---|
| `crm-core.js` | Konfiguration, SQL-/Datei-Absicherungen, duckdb-CLI-Laufzeit, Grenzen |
| `crm-werkzeuge.js` | die 12 CRM-Daten-Werkzeuge (Kennzahlen, Suche, Dubletten, …) |
| `crm-abfragen-tools.js` | `crm_sql`, `crm_abfragen`, `crm_abfrage_datei`, Ressourcen, Kontext |
| `crm-mcp.js` | MCP-Protokoll (JSON-RPC 2.0): initialize, tools, resources; stdio |
| `crm-acp.js` | ACP-REST (Agent Communication Protocol 0.2.0, Subset) |
| `crm-server.js` | HTTP-Server: `POST /mcp`, `/acp/*`, `/health` — hinter Token |
| `crm-agent-client.js` | ausgehende Aufrufe an `api.unitedshare.ai` — **abgeschaltet bis Freigabe** |
| `crm-cli.js` | Kommandozeile |

## Schnellstart

Kein absoluter Pfad nötig: der Tresor wird **gefunden**. Starte den Aufruf
im Tresor (oder in einem Unterordner) — die CLI geht von dort nach oben,
bis ein Ordner `.obsidian` liegt (bis zu 6 Ebenen). Wer es zeigen will,
kann `--vault <pfad>` oder `CRM_VAULT` mitgeben; das hat Vorrang.

```sh
# im Tresor-Ordner starten:
node crm/crm-cli.js status
node crm/crm-cli.js tool crm_uebersicht
node crm/crm-cli.js sql "SELECT Ort, COUNT(*) FROM 'adressen.parquet' GROUP BY Ort LIMIT 5"
node crm/crm-cli.js abfrage aviso-uebersicht.sql

# von außerhalb, mit benanntem Tresor (relativ zum Aufrufort):
node crm/crm-cli.js status --vault ../mein-tresor
```

`status` nennt ehrlich, woher der Tresor kommt (`tresorQuelle`:
`angabe`, `umgebung` oder `auto` — der Marker `.obsidian` macht ihn
findbar). Findet die Automatik nichts, bleibt sie nicht still: die
Meldung sagt, dass ein Tresor fehlt.

Die `.sql`-Abfragedateien aus `crm/` im Tresor (z. B. die 9 aviso-*.sql)
sind über `crm_abfragen` und `crm_abfrage_datei` erreichbar und liefern
exakt dieselben Werte wie die SQL-Ansicht im Obsidian-Plugin (live geprüft:
22.050 Sätze, 12 Rufnummern, 8 Dubletten, 107 Besteller).

## Server (MCP + ACP)

```sh
node crm/crm-cli.js server --port 8787      # im Tresor starten — der Tresor wird gefunden
```

Bindet auf `127.0.0.1` (Loopback), druckt einen zufälligen Token (oder
`--token`/`CRM_TOKEN`). **Jeder Aufruf braucht den Token, auch `/health`**,
weil sie den Tresor nennt. Ein anderer Host (z. B. die Tailscale-Adresse)
nur mit ausdrücklichem `--host` — sinnvoll, wenn der UnitedShare AI Agent
auf einem anderen Gerät im Mesh läuft.

| Endpunkt | Bedeutung |
|---|---|
| `POST /mcp` | MCP Streamable HTTP (JSON-RPC). `initialize` antwortet mit `Mcp-Session-Id`; danach ist der Kopf Pflicht, sonst 400/404. `DELETE /mcp` beendet die Sitzung. |
| `GET /mcp` | 405 — kein SSE-Push in diesem Bau. |
| `GET /acp/ping`, `GET /acp/agents`, `GET /acp/agents/{name}` | ACP-Discovery (Spec 0.2.0). |
| `POST /acp/runs` | Lauf starten: `{agent_name, input, mode}`. Eingabe-Text ist `{"werkzeug","argumente"}` (JSON) oder lesendes SQL (SELECT/WITH). `mode: sync` → fertiger Lauf, `async` → 202 mit fertigen Lauf, `stream` → `run.created` + `run.completed|failed` als SSE. |
| `GET /acp/runs/{id}`, `/cancel`, `/events` | Laufzustand, Abbruch (Buchung; Laeufe sind synchron), Ereignisse. |
| `GET /health` | Status, Tresor, Dateien, Werkzeugliste. |

Fehler folgen der ACP-Form `{code, message[, data]}` mit
`invalid_input | not_found | server_error`. Unklare Eingaben sind HTTP 400
(kein failed-Run); echte Ausführungsfehler werden zu `status: "failed"`.

MCP über stdio für lokale Agenten: `node crm/crm-cli.js stdio`
(eine JSON-RPC-Nachricht je Zeile; Begleittext nur auf stderr, kein Token).

## Ehrliche Grenzen und Entscheidungen

- **Nur lesend.** Die Abfrageprüfung (in `crm-core.js`, zeichenweise, kennt
  Zeichenketten und `"alter"`-Spalten) verlangt EINE Anweisung ab SELECT/WITH
  und weist CREATE/INSERT/UPDATE/DELETE/DROP/ALTER/COPY/ATTACH/SET/PRAGMA/…
  benannt ab. Änderungen an Dateien gibt es nicht; die CRM-Quellwahrheit
  bleibt dein Export.
- **Kein stilles Kürzen.** Jedes Ergebnis trägt `zeilen`, `ingesamt`,
  `abgeschnitten`, `limit` (Standard 100, hartes Maximum 1000).
- **Nur tresor-relativ.** Parquet- und SQL-Namen ohne `/`, `\`, `..`;
  `crm/`-Ordner des Tresors ist der einzige Ort für Abfragedateien.
- **`duckdb`-CLI nötig.** Fehlt sie, nennen Tests und Werkzeuge das benannt
  (`DuckDB-Laufzeit „duckdb" liess sich nicht starten: …`). Pfad über
  `--duckdb` bzw. `CRM_DUCKDB_BIN`. Die CLI schreibt nur in den Speicher;
  mit `--vault` als Arbeitsordner lösen relative Dateiverweise.
- **ACP ist ein Subset von Spec 0.2.0** (i-am-bee/acp). Implementiert:
  Discovery, sync/async/stream-Läufe, Events, Cancel-Buchung, Spec-Fehler.
  Nicht implementiert: Sessions-Verlauf (`/session/{id}`), `await`-Läufe,
  multipart-Eingaben, abonnierte Ressourcen.
- **Agent-Client gegen `api.unitedshare.ai`:** Geprüft am 13.11.2026 antworten
  `/mcp` und `/acp` mit HTTP 200 und **leerem Körper** (Caddy-Platzhalter) —
  dort steht (noch) kein echter Endpunkt. Der Client (`agent info|werkzeuge|
  tool|acp`) ist deshalb so gebaut, dass er gegen einen echten MCP-/ACP-Endpunkt
  funktioniert und bis dahin eine benannte Meldung liefert. **Ohne `--erlaubt`
  wird nichts gesendet** — jede Cloud-Anfrage braucht die ausdrückliche Freigabe.

## Sicherheit

- Server nur Loopback, Tokenpflicht (timing-sicherer Vergleich), Korpuslimit
  1 MB, Abfrage-Timeout 30 s.
- Kein Geheimnis im Klartext-Log außer dem Token-Druck beim Serverstart
  (der Token IST der Zugangscode; wer die Konsole sieht, darf rein).
- Tests (`crm-headless.test.js`, Teil der Plugin-Suite) decken Absicherungen,
  Werkzeuge, MCP, ACP, Server und den Verweigerungsfall ab; der Agent-Client
  wird end-to-end gegen den eigenen Server geprüft, nie gegen Cloud.
