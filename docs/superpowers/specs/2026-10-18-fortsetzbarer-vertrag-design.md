# Fortsetzbarer Vertrag für mehrschrittige Aufgaben

## Intent und Warum

Mehrschrittige Aufgaben (Lesen, Schreiben, Starten, Mesh-Aktionen) laufen heute als
Schleife in `runVaultInstruction` (unitedshare-core.js), bis zu sechs Durchgänge,
jeder ein eigener Netzaufruf an api.unitedshare.ai. Der gesamte Zwischenverlauf
dieser Schleife — welche Schritte schon liefen, mit welchem Ergebnis — existiert
nur im Arbeitsspeicher dieses einen Funktionsaufrufs. Bricht ein Durchgang ab
(Netzfehler, 400, Zeitüberschreitung), ist dieser Zwischenstand verloren. Was in
`.vault/chats` überlebt, ist nur die gekürzte Anzeige-Kette (`schritte`, auf 120
Zeichen gekürzte Ergebnisse) — genug zum Anzeigen, nicht genug zum exakten
Fortsetzen.

Ziel: eine mehrschrittige Aufgabe ist ein **Vertrag** zwischen Nutzer und Dienst.
Bricht er ab, bleibt er unerfüllt, aber nicht verloren — er lässt sich fortsetzen,
ohne bereits erledigte Schritte zu wiederholen, auch über einen Neustart von
Obsidian hinweg, weil der Kontext dafür ohnehin schon im Tresor liegt.

## Ziele

- Jede mehrschrittige Aufgabe wird als Vertrag mit einer geordneten Liste von
  Schritten modelliert und **vollständig** (nicht nur gekürzt zur Anzeige) in
  `.vault/chats` persistiert — Fortsetzen funktioniert auch nach einem
  Obsidian-Neustart.
- Ein unterbrochener Vertrag lässt sich fortsetzen: dem Modell wird nur der
  fehlende Rest vorgelegt, bereits abgeschlossene Schritte werden nicht
  wiederholt.
- Zwei Unterbrechungsarten des *Modellaufrufs* zwischen zwei Schritten werden
  unterschieden, beide als „unerfüllt“ behandelt:
  - **bestätigt gescheitert** — eine Antwort (auch eine Fehlerantwort) kam an.
  - **unbestätigt** — abgeschickt, keine Antwort, Status unbekannt.
- Default: manuelles Fortsetzen über einen Knopf an der Nachricht. Ein
  Einstellungsschalter („Abgebrochene Gespräche automatisch fortsetzen“,
  default aus) schaltet auf automatisches Fortsetzen beim Öffnen der Ansicht um.
- Hierarchie: pro Tab ist höchstens ein Vertrag gleichzeitig „in Arbeit“. Eine
  neue Frage, während eine ältere noch offen ist, blockiert die Eingabe nicht,
  wird aber erst bearbeitet, nachdem der ältere Vertrag fortgesetzt+erfüllt oder
  bewusst verworfen wurde.
- Ein Anhang, der an einen MCP-„Experten“ geschickt wird, ist ein vierter
  Schritt-Typ im selben Vertrag, genauso fortsetzbar wie Lesen/Schreiben/Starten.
- Zero-Config: außer dem einen Schalter entstehen keine neuen Einstellungen.

## Nicht-Ziele

- Keine Client-seitige Logik, welcher Experte zu einem Anhang passt — das bleibt
  serverseitig (api.unitedshare.ai, vermutlich das bestehende BA10-Routing).
- Kein Multi-Backend-Routing auf Client-Seite. Es gibt nur eine Gegenstelle;
  MCP-Zugriff ist planabhängig serverseitig gesteuert, nicht clientseitig.
- Kein ServiceWorker (auf der Obsidian-Plattform — Electron-Fenster bzw. Mobile
  WebView — ohne eigene Origin nicht verfügbar) und kein WebWorker (kein Bedarf:
  die Schleife ist bereits nicht-blockierendes `await` auf I/O, kein
  rechenintensiver Code).
- Keine serverseitige Umsetzung in diesem Projekt. Der Endpunkt für den
  Anhang-an-Experte-Schritt existiert laut Gespräch noch nicht (die
  Embedding-/MCP-Dienste entstehen gerade erst) — dieser Schritt-Typ wird als
  Erweiterungspunkt vorbereitet, aber nicht an einen echten Endpunkt
  angeschlossen.
- Kein Überleben eines harten Absturzes oder erzwungenen Beendens von Obsidian
  mitten in einem Schritt. Das würde inkrementelles Schreiben nach jedem
  einzelnen Schritt verlangen (mehr Festplattenzugriffe während der ganzen
  Aufgabe) und ist bewusst auf die Roadmap verschoben. Abgedeckt wird jeder
  normale Abbruch: Netzfehler, Zeitüberschreitung, Fehlerantwort, sowie
  Schließen und Neustarten von Obsidian. Betroffen ist vor allem ein laufendes
  `run`: stürzt Obsidian während eines gestarteten Skripts hart ab, bleibt
  dieser eine Schritt beim Fortsetzen ein hingenommener Wiederholungsfall.

## Anti-Ziele

Auch wenn es „funktioniert“, gilt es als Fehlschlag, wenn:

- ein Schreiben oder Starten beim Fortsetzen unbemerkt doppelt ausgeführt wird;
- bestehende `.vault/chats`-Dateien ohne das neue Vertragsfeld beim Laden
  unlesbar werden (Rückwärtskompatibilität ist Pflicht);
- das Eingabefeld gesperrt wird, solange ein älterer Vertrag offen ist;
- einer der bestehenden grünen Verträge rot wird: `schritte.test.js`,
  `schritt-ergebnis.test.js`, `lange-aufgabe.test.js`, `chat-speicher.test.js`,
  `requesturl-pfad.test.js`, `cursor-composer.test.js`, `strom-ohne-body.test.js`,
  `fehler-protokoll.test.js`, `sidebar.test.js`.

## Randbedingungen

- Bestehende Architektur bleibt: `runVaultInstruction` treibt die Schritt-Schleife
  (unitedshare-core.js), `chatSpeichern`/`chatsLaden` persistieren JSON in
  `.vault/chats`, `main.src.js` orchestriert View, Adapter und Einstellungen.
- `maxSteps` bleibt bei höchstens 6 — das ist eine bestehende Grenze, nicht Teil
  dieses Umbaus.
- `debugLogSchreiben`/`.vault/debug.log` (gerade fertiggestellt) bleibt
  unverändert bestehen. Diagnose (warum scheiterte ein Aufruf) und
  Fortsetzbarkeit (wie geht die Aufgabe trotzdem weiter) sind zwei
  unterschiedliche, nebeneinander bestehende Belange.

## Entschiedene Teile

### Datenmodell: der Vertrag

Jede `assistant`-Nachricht, die aus einer mehrschrittigen Aufgabe entsteht, trägt
zusätzlich zur bestehenden `schritte`-Anzeige-Liste ein `vertrag`-Feld:

```json
{
  "role": "assistant",
  "content": "...",
  "schritte": [ /* wie heute: gekürzt, nur für die Anzeige */ ],
  "vertrag": {
    "zustand": "offen",
    "thread": [
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "...roher Protokollblock..." },
      { "role": "user", "content": "Ergebnis der Tresor-Aktion. ..." }
    ],
    "schritte": [
      {
        "art": "read",
        "aktion": { "action": "read", "path": "a.md" },
        "ergebnis": "...voller, ungekürzter Inhalt..."
      }
    ],
    "letzterFehler": {
      "art": "bestaetigt-gescheitert",
      "meldung": "Modellaufruf fehlgeschlagen (Status 400): ..."
    }
  }
}
```

- **Korrektur gegenüber einem ersten Entwurf:** `executeVaultAction` fängt
  jeden Fehler selbst ab und liefert immer ein eindeutiges Ergebnis zurück —
  eine Vault-Aktion (Lesen, Schreiben, Starten, Mesh, Experte) bleibt nie in
  der Schwebe. Nur der Modellaufruf *zwischen* zwei Aktionen kann es. Deshalb
  trägt `vertrag.schritte` ausschließlich bereits abgeschlossene Aktionen
  (kein `zustand`-Feld pro Eintrag nötig), und die Unterbrechung selbst steht
  getrennt in `vertrag.letzterFehler` — das ist es, was „Fortsetzen“ erneut
  versucht.
- `vertrag.thread` übernimmt genau das, was `runVaultInstruction` heute nur im
  Speicher aufbaut (die `{role, content}`-Zwischenschritte, inklusive der
  „Ergebnis der Tresor-Aktion“-Turns). Das macht exaktes Fortsetzen möglich,
  unabhängig vom Schritt-Typ, ohne Sonderfälle pro Aktionsart.
- `vertrag.schritte` trägt die vollen Ergebnisse (nicht auf 120 Zeichen gekürzt
  wie die Anzeige-Liste) — getrennter Zweck, getrenntes Feld.
- Fehlt `vertrag` (alte Datei, oder eine Aufgabe ohne Schritt-Schleife), verhält
  sich alles wie heute. Rückwärtskompatibilität ist durch bloßes Fehlen des
  Felds gegeben, keine Migration nötig.
- `zustand`: `"offen"` (noch nicht erfüllt), `"erfuellt"` (fertige Antwort ohne
  weitere Aktion), `"verworfen"` (Nutzer hat bewusst abgebrochen).

### Zwei Unterbrechungsarten

Beide betreffen ausschließlich den Modellaufruf zwischen zwei abgeschlossenen
Vault-Aktionen (siehe Korrektur im Datenmodell oben) — nie eine Vault-Aktion
selbst.

- **bestätigt gescheitert**: der Modellaufruf liefert eine Antwort — auch eine
  Fehlerantwort (z. B. `UnitedShareError` mit Status 400). Wir wissen, was
  passiert ist; die Meldung landet in `vertrag.letzterFehler.meldung`.
- **unbestätigt**: der Aufruf wirft, ohne dass irgendeine Antwort ankam
  (Netzabbruch mitten in der Anfrage). Kein Status, keine Meldung bekannt.
- Beide führen zum selben äußeren Vertragszustand `"offen"`. Der Unterschied ist
  reines Diagnose-Metadatum (für die Anzeige „woran es lag“), ändert aber nichts
  am Fortsetzen selbst: der nächste Modellaufruf wird beim Fortsetzen erneut
  gestellt, gleich aus welchem Grund er zuvor fehlte.

### Fortsetzen

- Baut aus `vertrag.thread` plus den noch fehlenden Schritten einen neuen Aufruf
  an `complete()` — strukturell derselbe Übergang, den `runVaultInstruction`
  heute schon zwischen zwei Schritten macht. Neu ist nur, dass das auch nach
  einem Absturz oder Neustart möglich ist, weil `thread` jetzt auf der Platte
  liegt statt nur im Speicher.
- Ein Schritt mit `zustand: "fertig"` wird nie erneut ausgeführt oder erneut
  angefragt — auch ein Lese-Schritt nicht, trotz geringer Kosten eines zweiten
  Lesens: Konsistenz eines einzigen Mechanismus für alle Schritt-Arten vor
  Mikro-Optimierung einzelner Arten.
- UI: eine Nachricht mit `vertrag.zustand === "offen"` zeigt einen
  „Fortsetzen“-Knopf (und einen „Verwerfen“-Knopf) direkt an der Nachricht.
- Einstellungsschalter **„Abgebrochene Gespräche automatisch fortsetzen“**
  (default aus = manuell): steht er auf automatisch, löst das Plugin
  „Fortsetzen“ für offene Verträge selbst aus, sobald die Ansicht öffnet
  (`onOpen`), ohne Klick.
- Der Automatik-Schalter löst je offenem Vertrag höchstens einmal pro
  Obsidian-Sitzung aus, nicht bei jedem Auf- und Zuklappen der Seitenleiste —
  sonst entstünden wiederholte stille API-Aufrufe. Ein neuer Absturz desselben
  Vertrags setzt diese Sperre für ihn zurück.

### Hierarchie zwischen mehreren offenen Verträgen

- Pro Tab ist höchstens ein Vertrag gleichzeitig „in Arbeit“.
- Stellt der Nutzer eine neue Frage, während eine ältere Nachricht im selben Tab
  noch `vertrag.zustand === "offen"` hat: Die neue Frage wird **nicht**
  blockiert — das Eingabefeld bleibt nutzbar, die Frage wird als neue Nachricht
  angehängt. Ihre Bearbeitung (der Netzaufruf) beginnt aber erst, nachdem der
  ältere Vertrag entweder fortgesetzt und erfüllt, oder bewusst verworfen wurde.
  *(Entscheidung des Verfassers, da offen gelassen: ein komplett gesperrtes
  Eingabefeld widerspräche dem Zero-Config-Anspruch. Zu korrigieren, falls
  falsch.)*
- „Verwerfen“ ist immer eine ausdrückliche Nutzerhandlung. Das Plugin verwirft
  nie selbsttätig einen offenen Vertrag.

### Anhänge an einen MCP-Experten (vierter Schritt-Typ)

- Neuer Schritt-Typ `"experte"` im selben Protokollformat wie heute
  (`parseVaultActions`), etwa `{"action": "experte", "anhang": {"name": "...",
  "mime": "..."}}`.
- Die Format-Erkennung und Experten-Auswahl bleibt serverseitig. Der Client
  schickt nur Dateiname, grob lokal erkannten MIME-Typ und den vollen Inhalt,
  getrennt vom Fließtext der Frage.
- **Nicht Teil dieser Umsetzung:** Der genaue Endpunkt existiert heute noch
  nicht. Dieser Schritt-Typ wird im Code als Erweiterungspunkt vorbereitet
  (Schema, Zustände, Platz in der Schritt-Kette), aber nicht an einen echten
  Dienst angeschlossen, bis der Service ihn anbietet.

## Was dem Bauenden offen bleibt

- Exakte Beschriftung/Platzierung von „Fortsetzen“ und „Verwerfen“.
- Ob `vertrag.thread` 1:1 übernommen wird oder bei großen Dateianhängen ein
  kompakteres Format braucht (Speicherplatz in der Chat-Datei).
- Exakter Text des Einstellungsschalters.
- Testfall, der nachweist, dass eine alte Chat-Datei ohne `vertrag`-Feld
  weiterhin fehlerfrei lädt.
