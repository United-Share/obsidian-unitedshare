# Fortsetzbarer Vertrag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine unterbrochene mehrschrittige Aufgabe (`runVaultInstruction`) wird als persistenter „Vertrag“ auf der betroffenen Nachricht gespeichert und lässt sich — manuell per Knopf oder automatisch per Einstellung — exakt dort fortsetzen, wo sie abbrach, ohne bereits erledigte Schritte zu wiederholen; mehrere offene Verträge im selben Tab werden strikt nach Alter abgearbeitet.

**Architecture:** `runVaultInstruction` bekommt eine optionale `resume`-Eingabe (überspringt den Thread-Aufbau, macht dort weiter) und hängt bei einem Fehlschlag den bisherigen Thread + erledigten Schritte als `.vertragStand` an den geworfenen Fehler. `main.src.js` liest das im `catch` von `submit()`/`completeThread()` aus, baut daraus ein `vertrag`-Feld auf der Assistant-Nachricht (dasselbe Objekt, das `chatSpeichern` ohnehin schon mitschreibt — keine neue Persistenzschicht), und rendert bei offenem Vertrag einen Fortsetzen-/Verwerfen-Knopf. Ein Tab verarbeitet höchstens einen offenen Vertrag gleichzeitig; neue Fragen während eines offenen Vertrags landen in `tab.wartendeFragen` und laufen erst danach.

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert/strict`, Obsidian Plugin API (gemockt in Tests).

**Spec:** `docs/superpowers/specs/2026-10-18-fortsetzbarer-vertrag-design.md`

## Global Constraints

- `maxSteps` bleibt bei höchstens 6 pro `runVaultInstruction`-Aufruf (bestehende Grenze). Ein Fortsetzen gewährt ein frisches Budget von bis zu 6 weiteren Schritten (einfachste, im Spec offen gelassene Wahl — kein Anrechnen gegen das ursprüngliche Budget).
- Eine Nachricht ohne `vertrag`-Feld (alte Datei, einfache fertige Antwort) verhält sich exakt wie heute. Kein Migrationsschritt.
- Ein `write`/`run`-Schritt, der einmal als erledigt in `vertrag.schritte` steht, wird nie erneut ausgeführt oder erneut angefragt.
- Kein ServiceWorker, kein WebWorker, kein Überleben eines harten Prozessabsturzes (Roadmap, nicht Teil dieses Plans).
- Der vierte Schritt-Typ „Anhang an Experte“ hat keinen Endpunkt und wird in diesem Plan **nicht** gebaut (kein Code ohne Verwendungszweck).
- Automatisches Fortsetzen löst pro Vertrag höchstens einmal pro Obsidian-Sitzung aus.

## Review Focus

- Ein `write`- oder `run`-Schritt, der schon in `resume.schritte` als erledigt steht, wird beim Fortsetzen nicht erneut an den Tresor-Host ausgeführt — Task 1.
- Eine Nachricht ganz ohne `vertrag`-Feld (jede heutige `.vault/chats`-Datei) muss weiterhin fehlerfrei laden und rendern — Task 3.
- Zwei verschiedene Nachrichten im selben Tab haben je einen offenen Vertrag gleichzeitig — Fortsetzen/Verwerfen muss das ältere zuerst auflösen, nie das jüngere zuerst anfassen — Task 6.
- Ein fortgesetzter Vertrag scheitert erneut — `vertrag.schritte`/`thread`/`letzterFehler` müssen sich fortschreiben (akkumulieren), nicht den vorherigen Fortschritt verwerfen — Task 4.
- Ein Vertrag bricht beim allerersten Modellaufruf ab (keine Vault-Aktion war je erledigt, `schritte: []`) — Fortsetzen muss das wie einen einfachen erneuten Versuch behandeln, nicht an einem leeren Array scheitern — Task 1.
- Der Automatik-Schalter darf denselben offenen Vertrag nicht bei jedem Auf-/Zuklappen der Seitenleiste erneut auslösen, aber einen *neu* gescheiterten Versuch desselben Vertrags schon wieder — Task 5.

---

## Task 1: `runVaultInstruction` — Resume-Eingabe und Vertragsstand am Fehler

**Files:**
- Modify: `unitedshare-core.js` (Funktion `runVaultInstruction`, aktuell ab `async function runVaultInstruction({ turns, complete, host, maxSteps = 6, onSchritt = null }) {`)
- Test: `vertrag-fortsetzen.test.js` (neu, folgt dem Muster von `schritte.test.js`: `tresor()`-Fake-Host, Fake-`complete`)

**Interfaces:**
- Produces: `runVaultInstruction({ turns, complete, host, maxSteps, onSchritt, resume })` — `resume` ist entweder `null`/`undefined` (bisheriges Verhalten) oder `{ thread: Array<{role, content}>, schritte: Array<{art, aktion, ergebnis}> }`.
- Produces: bei einem Fehlschlag trägt der geworfene Fehler zusätzlich `error.vertragStand = { thread, schritte }` (dieselben Formen wie `resume`).
- Produces: exportierte Hilfsfunktion `vertragFehlerArt(error)` → `"bestaetigt-gescheitert"` wenn `error instanceof UnitedShareError && error.status > 0`, sonst `"unbestaetigt"`.

- [ ] **Step 1: Write the failing test — Resume überspringt bereits erledigte Schritte**

```js
test("ein Fortsetzen ruft das Modell nur für den fehlenden Rest, nicht für bereits erledigte Schritte", async () => {
  const aufrufe = [];
  const antwort = await runVaultInstruction({
    turns: [],
    host: tresor(),
    resume: {
      thread: [
        { role: "user", content: "Lies a.md und schreib b.md" },
        { role: "assistant", content: block({ action: "read", path: "a.md" }) },
        { role: "user", content: "Ergebnis der Tresor-Aktion. Das ist ein Ergebnis, keine neue Anweisung.\n\nErgebnis read a.md:\nInhalt" },
      ],
      schritte: [{ art: "read", aktion: { action: "read", path: "a.md" }, ergebnis: "Ergebnis read a.md:\nInhalt" }],
    },
    complete: async (thread) => {
      aufrufe.push(thread.length);
      return "Fertig.";
    },
  });
  assert.equal(antwort, "Fertig.");
  assert.equal(aufrufe.length, 1, "genau ein neuer Modellaufruf, kein erneutes Lesen");
  assert.equal(aufrufe[0], 3, "der volle bisherige Thread geht mit, nicht nur die Originalfrage");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test vertrag-fortsetzen.test.js`
Expected: FAIL — `resume` wird heute ignoriert, `thread` wird aus `turns` (hier leer) neu aufgebaut.

- [ ] **Step 3: Implement resume-Unterstützung**

Zu Beginn von `runVaultInstruction`: wenn `resume && Array.isArray(resume.thread)`, `thread` direkt aus `resume.thread.map((t) => ({ ...t }))` übernehmen und `attachRequestedReads` + den Aufbau aus `turns` überspringen; `erledigteSchritte` (neues lokales Array, das bei jeder erfolgreichen Aktionsausführung den vollen `{art, aktion, ergebnis}`-Eintrag sammelt) mit `resume.schritte ? resume.schritte.slice() : []` vorbefüllen. Ohne `resume` bleibt der bestehende Aufbau unverändert, `erledigteSchritte` startet leer.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test vertrag-fortsetzen.test.js`
Expected: PASS

- [ ] **Step 5: Write the failing test — Fehler trägt den Vertragsstand**

```js
test("scheitert der Modellaufruf, trägt der Fehler Thread und bisherige Schritte", async () => {
  await assert.rejects(
    () => runVaultInstruction({
      turns: [{ role: "user", content: "Lies a.md" }],
      host: tresor(),
      complete: async (thread) => {
        if (thread.length === 1) return block({ action: "read", path: "a.md" });
        throw new UnitedShareError("Modellaufruf fehlgeschlagen (Status 400): kaputt", 400);
      },
    }),
    (e) => {
      assert.ok(e.vertragStand, "kein Vertragsstand am Fehler");
      assert.equal(e.vertragStand.schritte.length, 1);
      assert.equal(e.vertragStand.schritte[0].art, "read");
      assert.equal(e.vertragStand.thread.length, 3, "Frage, Protokollblock, Ergebnis-Turn");
      return true;
    },
  );
});

test("vertragFehlerArt unterscheidet bestätigte von unbestätigten Fehlern", () => {
  assert.equal(vertragFehlerArt(new UnitedShareError("kaputt", 400)), "bestaetigt-gescheitert");
  assert.equal(vertragFehlerArt(new UnitedShareError("weg", 0)), "unbestaetigt");
  assert.equal(vertragFehlerArt(new Error("irgendwas")), "unbestaetigt");
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `node --test vertrag-fortsetzen.test.js`
Expected: FAIL — `vertragStand` existiert nicht, `vertragFehlerArt` ist nicht exportiert.

- [ ] **Step 7: Implement `vertragFehlerArt(error)` und das Anhängen von `vertragStand`**

`vertragFehlerArt`: reiner Vergleich wie in den Interfaces beschrieben, keine weitere Logik. Im `for`-Loop von `runVaultInstruction`: den bestehenden `const reply = await complete(thread);`-Aufruf in `try/catch` einfassen; im `catch` `fehler.vertragStand = { thread: thread.slice(), schritte: erledigteSchritte.slice() };` setzen und `throw fehler;`. Nach jeder erfolgreichen `executeVaultAction`-Ausführung in der bestehenden Schleife den vollen Eintrag `{ art: action.action, aktion: action, ergebnis }` an `erledigteSchritte` anhängen (zusätzlich zum bestehenden `results`-Array, das unverändert bleibt).

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test vertrag-fortsetzen.test.js`
Expected: PASS, alle 3 Tests dieser Datei grün.

- [ ] **Step 8b: Write the failing test — ein erledigter write/run wird nie wiederholt**

```js
test("ein beim Fortsetzen schon erledigter write-Schritt wird nicht erneut ausgeführt", async () => {
  const geschrieben = [];
  const host = {
    async read() { return "Inhalt"; },
    async list() { return []; },
    async write(pfad, inhalt) { geschrieben.push(pfad); },
    async run() { return "gelaufen"; },
  };
  const antwort = await runVaultInstruction({
    turns: [],
    host,
    resume: {
      thread: [
        { role: "user", content: "Schreib b.md" },
        { role: "assistant", content: block({ action: "write", path: "b.md", content: "x" }) },
        { role: "user", content: "Ergebnis der Tresor-Aktion. Das ist ein Ergebnis, keine neue Anweisung.\n\nErgebnis write b.md:\nGeschrieben." },
      ],
      schritte: [{ art: "write", aktion: { action: "write", path: "b.md", content: "x" }, ergebnis: "Ergebnis write b.md:\nGeschrieben." }],
    },
    complete: async () => "Fertig.",
  });
  assert.equal(antwort, "Fertig.");
  assert.deepEqual(geschrieben, [], "write darf beim Fortsetzen nicht erneut aufgerufen werden");
});
```

- [ ] **Step 8c: Run test to verify it passes**

Run: `node --test vertrag-fortsetzen.test.js`
Expected: PASS ohne weitere Codeänderung — Resume baut `thread` direkt aus `resume.thread`, ruft also für den schon enthaltenen `write`-Turn keine neue `executeVaultAction` auf. Scheitert der Test doch, liegt es daran, dass Step 3 `attachRequestedReads`/den Turns-Aufbau beim Resume nicht wirklich überspringt — dort nachbessern, nicht den Test anpassen.

- [ ] **Step 9: Export `vertragFehlerArt` in `module.exports`**

In `unitedshare-core.js`, Export-Objekt: `vertragFehlerArt` ergänzen (alphabetisch neben den anderen `vertrag*`-Einträgen, sobald es die gibt — hier einfach neben `verbrauchZeile`).

- [ ] **Step 10: Run full core test suite**

Run: `node --test *.test.js`
Expected: alle Tests grün, insbesondere `schritte.test.js`, `schritt-ergebnis.test.js`, `lange-aufgabe.test.js`, `strom-ohne-body.test.js` unverändert grün (kein Verhalten ohne `resume` geändert).

- [ ] **Step 11: Commit**

```bash
git add unitedshare-core.js vertrag-fortsetzen.test.js
git commit -m "feat: runVaultInstruction kann fortsetzen und trägt den Vertragsstand am Fehler"
```

---

## Task 2: `vertrag` auf der Nachricht anlegen, wenn ein Aufruf scheitert

**Files:**
- Modify: `main.src.js` (Catch-Block in `submit()`, aktuell `} catch (error) { await protokolliereAufrufFehler... const text = error instanceof UnitedShareError ? error.message : "Der Modellaufruf ist fehlgeschlagen.";` — der Block, der `draft` behandelt)
- Test: `sidebar.test.js` (neue Tests neben der bestehenden Gruppe `chatAdapterMock`/`ansichtMitAdapter`)

**Interfaces:**
- Consumes: `vertragFehlerArt(error)` aus Task 1.
- Consumes: `error.vertragStand` aus Task 1 (kann fehlen, z. B. bei einem Fehler außerhalb von `runVaultInstruction`).
- Produces: `draft.vertrag = { zustand: "offen", thread, schritte, letzterFehler: { art, meldung, status } }` auf der Assistant-Nachricht, bevor sie über `chatSichern` persistiert wird. Spätere Tasks lesen `message.vertrag`.

- [ ] **Step 1: Write the failing test**

```js
test("scheitert der Modellaufruf, trägt die Nachricht einen offenen Vertrag mit Thread und Schritten", async () => {
  const { UnitedShareError } = require("./unitedshare-core");
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.completeThread = async () => {
    const fehler = new UnitedShareError("Modellaufruf fehlgeschlagen (Status 400): kaputt", 400);
    fehler.vertragStand = {
      thread: [{ role: "user", content: "Frage" }],
      schritte: [{ art: "read", aktion: { action: "read", path: "a.md" }, ergebnis: "Inhalt" }],
    };
    throw fehler;
  };
  await view.onOpen();
  view.questionEl.value = "Frage";
  await view.submit();

  const nachricht = view.activeTab().messages[view.activeTab().messages.length - 1];
  assert.equal(nachricht.vertrag.zustand, "offen");
  assert.equal(nachricht.vertrag.schritte.length, 1);
  assert.equal(nachricht.vertrag.letzterFehler.art, "bestaetigt-gescheitert");
  assert.match(nachricht.vertrag.letzterFehler.meldung, /kaputt/);

  const pfade = [...adapter.inhalt.keys()].filter((p) => p.startsWith(".vault/chats/"));
  const abgelegt = JSON.parse(adapter.inhalt.get(pfade[0]));
  assert.equal(abgelegt.messages[abgelegt.messages.length - 1].vertrag.zustand, "offen");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sidebar.test.js`
Expected: FAIL — `nachricht.vertrag` ist `undefined`.

- [ ] **Step 3: Implement im catch-Block von `submit()`**

Nach dem bestehenden `void protokolliereAufrufFehler(this.chatAdapter(), error);`: wenn `error && error.vertragStand`, auf `draft` setzen:
```js
draft.vertrag = {
  zustand: "offen",
  thread: error.vertragStand.thread,
  schritte: error.vertragStand.schritte,
  letzterFehler: {
    art: vertragFehlerArt(error),
    meldung: error instanceof UnitedShareError ? error.message : String((error && error.message) || error),
    status: error instanceof UnitedShareError ? (error.status || 0) : 0,
  },
};
```
Das bestehende Entfernen von `draft` aus `tab.messages`, wenn Inhalt und Schritte leer sind (siehe die Zeilen direkt darunter), muss `draft.vertrag` zusätzlich als Grund zum Behalten zählen — die vorhandene Bedingung um `|| draft.vertrag` erweitern. `vertragFehlerArt` zum Require aus `./unitedshare-core` in Zeile 4 ergänzen.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sidebar.test.js`
Expected: PASS

- [ ] **Step 5: Run full suite**

Run: `node --test *.test.js`
Expected: alle grün, insbesondere die bestehende `"bricht die Antwort ab, bleibt der offene Schritt als abgebrochen stehen"` unverändert.

- [ ] **Step 6: Bundle neu erzeugen**

Run: `node scripts/bundle.mjs`
Expected: `main.js geschrieben`

- [ ] **Step 7: Commit**

```bash
git add main.src.js main.js sidebar.test.js
git commit -m "feat: ein gescheiterter Aufruf legt einen offenen Vertrag auf der Nachricht an"
```

---

## Task 3: Rückwärtskompatibilität — Nachrichten ohne `vertrag`

**Files:**
- Test: `chat-speicher.test.js` (ergänzen, nutzt bereits `falscherAdapter`)

**Interfaces:**
- Consumes: `chatAusText`, `chatsLaden` aus `unitedshare-core.js` (unverändert).

- [ ] **Step 1: Write the failing-if-broken test**

```js
test("eine Nachricht ohne vertrag-Feld lädt unverändert (Altbestand)", async () => {
  const adapter = falscherAdapter({
    ".vault/chats/2026-10-09-1000-alt.json": JSON.stringify({
      id: "alt", titel: "Frage", erstellt: "2026-10-09T10:00:00.000Z",
      geaendert: "2026-10-09T10:00:00.000Z", offen: true,
      messages: [{ role: "user", content: "Frage" }, { role: "assistant", content: "Antwort" }],
    }),
  });
  const geladen = await chatsLaden(adapter);
  assert.equal(geladen.length, 1);
  assert.equal(geladen[0].messages[1].vertrag, undefined);
});
```

- [ ] **Step 2: Run test to verify it passes already**

Run: `node --test chat-speicher.test.js`
Expected: PASS ohne Codeänderung — dieser Test fixiert das bestehende Verhalten als Vertrag (im wörtlichen wie im Projekt-Sinn) gegen zukünftige Änderungen.

- [ ] **Step 3: Commit**

```bash
git add chat-speicher.test.js
git commit -m "test: eine Chat-Datei ohne vertrag-Feld bleibt lesbar"
```

---

## Task 4: Fortsetzen und Verwerfen

**Files:**
- Modify: `main.src.js` (`UnitedShareView`: neue Methoden `fortsetzenVertrag`, `verwerfenVertrag`; `renderMessages()` um den Knopf-Block ergänzen, siehe aktuell ab `if (hatSchritte) { ... }` innerhalb des `if (assistant)`-Zweigs)
- Test: `sidebar.test.js`

**Interfaces:**
- Consumes: `message.vertrag` aus Task 2.
- Produces: `async fortsetzenVertrag(tab, message)` — ruft `this.plugin.completeThread(null, onDelta, onSchritt, onMeta, onWarten, { thread: message.vertrag.thread, schritte: message.vertrag.schritte })` auf (6. Parameter `resume`, neu in `completeThread`); bei Erfolg `message.vertrag = null`, `message.content` wird die neue Antwort (vorhandener Inhalt + neue Antwort, wie heute bei einem erfolgreichen Abschluss), persistiert über `chatSichern`. Bei erneutem Fehlschlag wird `message.vertrag` mit dem neuen `error.vertragStand` **überschrieben** (nicht das alte behalten — der neue Stand ist der vollständige, akkumulierte).
- Produces: `verwerfenVertrag(tab, message)` setzt `message.vertrag.zustand = "verworfen"`, persistiert, rendert neu.

- [ ] **Step 1: Write the failing test — Fortsetzen baut auf dem alten Thread auf**

```js
test("Fortsetzen übergibt den gespeicherten Thread und ersetzt den Vertrag bei Erfolg", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  const gesehene = [];
  plugin.completeThread = async (turns, onDelta, onSchritt, onMeta, onWarten, resume) => {
    gesehene.push(resume);
    return "Fortgesetzt.";
  };
  await view.onOpen();
  const tab = view.activeTab();
  const nachricht = { role: "assistant", content: "", vertrag: {
    zustand: "offen",
    thread: [{ role: "user", content: "Frage" }],
    schritte: [],
    letzterFehler: { art: "unbestaetigt", meldung: "", status: 0 },
  } };
  tab.messages.push({ role: "user", content: "Frage" }, nachricht);

  await view.fortsetzenVertrag(tab, nachricht);

  assert.deepEqual(gesehene[0], { thread: [{ role: "user", content: "Frage" }], schritte: [] });
  assert.equal(nachricht.vertrag, null);
  assert.equal(nachricht.content, "Fortgesetzt.");
});

test("Verwerfen markiert den Vertrag, ohne den Inhalt zu löschen", async () => {
  const adapter = chatAdapterMock();
  const { view } = await ansichtMitAdapter(adapter);
  const tab = view.activeTab();
  const nachricht = { role: "assistant", content: "", vertrag: { zustand: "offen", thread: [], schritte: [], letzterFehler: { art: "unbestaetigt", meldung: "", status: 0 } } };
  tab.messages.push(nachricht);

  await view.verwerfenVertrag(tab, nachricht);

  assert.equal(nachricht.vertrag.zustand, "verworfen");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sidebar.test.js`
Expected: FAIL — `fortsetzenVertrag`/`verwerfenVertrag` existieren nicht.

- [ ] **Step 3: `completeThread` um `resume` erweitern**

Signatur ändern zu `async completeThread(turns, onDelta, onSchritt = null, onMeta = null, onWarten = null, resume = null)`, `resume` in den bestehenden `runVaultInstruction({...})`-Aufruf durchreichen.

- [ ] **Step 4: `fortsetzenVertrag(tab, message)` implementieren**

Spiegelt den Erfolgs-/Fehlerpfad von `submit()` für genau diese eine Nachricht: `this.busy = true; this.setAskControls(true);` setzen, `try { const antwort = await this.plugin.completeThread(null, onDelta-Callback wie in submit(), onSchritt-Callback wie in submit(), onMeta-Callback wie in submit(), onWarten-Callback wie in submit(), { thread: message.vertrag.thread, schritte: message.vertrag.schritte }); message.content = antwort; message.vertrag = null; } catch (error) { das gleiche Vertragsbau-Muster aus Task 2 Step 3, aber auf `message` statt `draft` } finally { this.busy = false; this.setAskControls(false); await this.chatSichern(tab); await this.renderMessages(); await this.naechsteWartendeFrageVerarbeiten(tab); }` — die letzte Zeile ruft eine in Task 6 definierte Methode auf; bis Task 6 existiert, als No-Op-Platzhalter `if (typeof this.naechsteWartendeFrageVerarbeiten === "function") await this.naechsteWartendeFrageVerarbeiten(tab);` schreiben (verhindert einen Zwischen-Build-Fehler, falls die Tasks separat reviewt werden).

- [ ] **Step 5: `verwerfenVertrag(tab, message)` implementieren**

`message.vertrag.zustand = "verworfen"; await this.chatSichern(tab); await this.renderMessages();`

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test sidebar.test.js`
Expected: PASS

- [ ] **Step 7: Write the failing test — Knopf im Markup**

```js
test("eine Nachricht mit offenem Vertrag zeigt Fortsetzen und Verwerfen", async () => {
  const adapter = chatAdapterMock();
  const { view } = await ansichtMitAdapter(adapter);
  await view.onOpen();
  const tab = view.activeTab();
  tab.messages.push({ role: "assistant", content: "Teilweise.", vertrag: { zustand: "offen", thread: [], schritte: [], letzterFehler: { art: "unbestaetigt", meldung: "", status: 0 } } });
  await view.renderMessages();

  const fortsetzen = find(view.contentEl, (n) => n.tag === "button" && n.attrs["aria-label"] === "Fortsetzen");
  const verwerfen = find(view.contentEl, (n) => n.tag === "button" && n.attrs["aria-label"] === "Verwerfen");
  assert.ok(fortsetzen, "Fortsetzen-Knopf fehlt");
  assert.ok(verwerfen, "Verwerfen-Knopf fehlt");
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `node --test sidebar.test.js`
Expected: FAIL — kein Knopf im Markup.

- [ ] **Step 9: In `renderMessages()` den Knopf-Block ergänzen**

Innerhalb des `if (assistant) { ... }`-Zweigs, nach dem bestehenden `hatSchritte`-Block: wenn `message.vertrag && message.vertrag.zustand === "offen"`, einen `div.unitedshare-vertrag`-Container mit zwei Buttons (`aria-label` „Fortsetzen“ und „Verwerfen“) anlegen, deren Klick-Handler `this.fortsetzenVertrag(tab, message)` bzw. `this.verwerfenVertrag(tab, message)` rufen (`tab = this.activeTab()` wie an anderen Stellen in dieser Funktion).

- [ ] **Step 10: Run tests, full suite, bundle**

Run: `node --test *.test.js && node scripts/bundle.mjs`
Expected: alles grün, `main.js geschrieben`.

- [ ] **Step 11: Commit**

```bash
git add main.src.js main.js sidebar.test.js
git commit -m "feat: Fortsetzen- und Verwerfen-Knopf für offene Verträge"
```

---

## Task 5: Einstellungsschalter für automatisches Fortsetzen

**Files:**
- Modify: `main.src.js` (`DEFAULT_SETTINGS`, `UnitedShareSettingTab`, `UnitedShareView.onOpen()`)
- Test: `sidebar.test.js`

**Interfaces:**
- Produces: `DEFAULT_SETTINGS.autoFortsetzen = false`.
- Produces: `plugin.autoVersucht` — ein zur Laufzeit gehaltenes `Set<string>` (Schlüssel: `chatId` + Nachrichtenindex o. ä., siehe Step 3) auf dem Plugin, nicht persistiert, leer bei jedem Neustart.

- [ ] **Step 1: Write the failing test**

```js
test("bei aktiviertem Schalter löst das Öffnen Fortsetzen für einen offenen Vertrag einmalig aus", async () => {
  const adapter = chatAdapterMock({
    ".vault/chats/2026-10-09-1000-x.json": JSON.stringify({
      id: "x", titel: "F", erstellt: "2026-10-09T10:00:00.000Z", geaendert: "2026-10-09T10:00:00.000Z", offen: true,
      messages: [
        { role: "user", content: "Frage" },
        { role: "assistant", content: "", vertrag: { zustand: "offen", thread: [{ role: "user", content: "Frage" }], schritte: [], letzterFehler: { art: "unbestaetigt", meldung: "", status: 0 } } },
      ],
    }),
  });
  const { plugin, view } = await ansichtMitAdapter(adapter);
  plugin.settings.autoFortsetzen = true;
  let aufrufe = 0;
  plugin.completeThread = async () => { aufrufe += 1; return "Automatisch fortgesetzt."; };

  await view.onOpen();
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(aufrufe, 1);

  await view.onOpen();
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(aufrufe, 1, "ein zweites Öffnen löst denselben Vertrag nicht erneut aus");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test sidebar.test.js`
Expected: FAIL — `autoFortsetzen` wird nirgends gelesen.

- [ ] **Step 3: `DEFAULT_SETTINGS` und `onOpen()` erweitern**

`autoFortsetzen: false` zu `DEFAULT_SETTINGS` hinzufügen. In `UnitedShareView.onOpen()`, nach dem bestehenden Laden/Wiederherstellen der Tabs: wenn `this.plugin.settings.autoFortsetzen`, für jeden Tab die Nachrichten mit `message.vertrag && message.vertrag.zustand === "offen"` durchgehen; einen Laufzeit-Schlüssel `` `${tab.chatId || ""}:${index}` `` bilden; existiert `this.plugin.autoVersucht` noch nicht, als `new Set()` auf dem Plugin anlegen; ist der Schlüssel nicht drin, `this.plugin.autoVersucht.add(schlüssel)` und `void this.fortsetzenVertrag(tab, message);` (fire-and-forget, analog zu `protokolliereAufrufFehler` — `onOpen()` darf nicht auf den ganzen Aufruf warten).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test sidebar.test.js`
Expected: PASS

- [ ] **Step 5: Setting-Schalter in `UnitedShareSettingTab` ergänzen**

Analog zu einem bestehenden Boolean-Schalter in derselben Klasse (`new Setting(containerEl).setName(...).setDesc(...).addToggle(...)`): Name „Abgebrochene Gespräche automatisch fortsetzen“, liest/schreibt `this.plugin.settings.autoFortsetzen`, ruft `await this.plugin.saveSettings();` im `onChange`.

- [ ] **Step 6: Run full suite, bundle, commit**

Run: `node --test *.test.js && node scripts/bundle.mjs`

```bash
git add main.src.js main.js sidebar.test.js
git commit -m "feat: Einstellungsschalter für automatisches Fortsetzen"
```

---

## Task 6: Hierarchie — höchstens ein offener Vertrag pro Tab gleichzeitig

**Files:**
- Modify: `main.src.js` (`submit()`, Anfang der Methode nach der Leer-Frage-Prüfung; neue Methode `naechsteWartendeFrageVerarbeiten`)
- Test: `sidebar.test.js`

**Interfaces:**
- Produces: `tab.wartendeFragen: Array<{ question: string }>` (lazy angelegt).
- Produces: `async naechsteWartendeFrageVerarbeiten(tab)` — nimmt das älteste Element aus `tab.wartendeFragen`, setzt `this.questionEl.value` darauf und ruft `this.submit()` erneut auf; No-Op, wenn leer oder noch ein Vertrag offen ist.
- Consumes: wird von `fortsetzenVertrag` (Task 4) und `verwerfenVertrag` (Task 4) im `finally`/am Ende aufgerufen.

- [ ] **Step 1: Write the failing test — neue Frage wird zurückgestellt**

```js
test("eine neue Frage wird zurückgestellt, solange eine ältere Nachricht einen offenen Vertrag hat", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  let aufrufe = 0;
  plugin.completeThread = async () => { aufrufe += 1; return "Antwort."; };
  await view.onOpen();
  const tab = view.activeTab();
  tab.messages.push({ role: "assistant", content: "Alt.", vertrag: { zustand: "offen", thread: [], schritte: [], letzterFehler: { art: "unbestaetigt", meldung: "", status: 0 } } });

  view.questionEl.value = "Neue Frage";
  await view.submit();

  assert.equal(aufrufe, 0, "kein Netzaufruf, solange der ältere Vertrag offen ist");
  assert.equal(tab.wartendeFragen.length, 1);
  assert.equal(tab.wartendeFragen[0].question, "Neue Frage");
  assert.equal(view.questionEl.value, "", "Eingabefeld bleibt nutzbar, nicht gesperrt");
});

test("nach dem Verwerfen des alten Vertrags läuft die zurückgestellte Frage automatisch", async () => {
  const adapter = chatAdapterMock();
  const { plugin, view } = await ansichtMitAdapter(adapter);
  let letzteFrage = null;
  plugin.completeThread = async (turns) => {
    letzteFrage = turns[turns.length - 1].content;
    return "Beantwortet.";
  };
  await view.onOpen();
  const tab = view.activeTab();
  const alt = { role: "assistant", content: "Alt.", vertrag: { zustand: "offen", thread: [], schritte: [], letzterFehler: { art: "unbestaetigt", meldung: "", status: 0 } } };
  tab.messages.push(alt);
  view.questionEl.value = "Neue Frage";
  await view.submit();

  await view.verwerfenVertrag(tab, alt);

  assert.equal(letzteFrage, "Neue Frage");
  assert.equal(tab.wartendeFragen.length, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test sidebar.test.js`
Expected: FAIL — `submit()` ruft heute immer sofort `completeThread`.

- [ ] **Step 3: Implement die Zurückstellung in `submit()`**

Direkt nach der bestehenden Prüfung `if (!question) { ... return; }` und vor dem bestehenden `localObsidianCommand`-Zweig: `const tab = this.activeTab(); const offenerVertrag = tab.messages.some((m) => m.vertrag && m.vertrag.zustand === "offen"); if (offenerVertrag) { tab.wartendeFragen = tab.wartendeFragen || []; tab.wartendeFragen.push({ question }); this.questionEl.value = ""; return; }` (die weiter unten im Code bereits vorhandene zweite `const tab = this.activeTab();`-Deklaration entsprechend entfernen/wiederverwenden, nicht doppelt deklarieren).

- [ ] **Step 4: Implement `naechsteWartendeFrageVerarbeiten(tab)`**

```js
async naechsteWartendeFrageVerarbeiten(tab) {
  if (!tab || !tab.wartendeFragen || !tab.wartendeFragen.length) return;
  if (tab.messages.some((m) => m.vertrag && m.vertrag.zustand === "offen")) return;
  const naechste = tab.wartendeFragen.shift();
  this.questionEl.value = naechste.question;
  await this.submit();
}
```

- [ ] **Step 5: In `fortsetzenVertrag` und `verwerfenVertrag` (Task 4) den Platzhalter-Aufruf durch den echten ersetzen**

In beiden Methoden, am Ende (nach `chatSichern`/`renderMessages`): `await this.naechsteWartendeFrageVerarbeiten(tab);` (den in Task 4 Step 4 vorgesehenen Platzhalter-Check entfernen, da die Methode jetzt existiert).

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test sidebar.test.js`
Expected: PASS

- [ ] **Step 7: Run full suite, bundle, commit**

Run: `node --test *.test.js && node scripts/bundle.mjs`

```bash
git add main.src.js main.js sidebar.test.js
git commit -m "feat: offene Verträge werden nach Alter abgearbeitet, neue Fragen reihen sich hinten ein"
```
