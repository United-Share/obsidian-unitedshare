"use strict";

// Verträge für den Strompfad -- gegen einen echten Server.
//
// ANLASS (2026-10-09): Nachdem der Gateway /v1/messages als SSE auslieferte,
// meldete Obsidian Fehler. Der Strompfad war bis dahin nie wirklich
// gelaufen: der Gateway schickte unabhängig vom stream-Wunsch immer einen
// fertigen Körper.
//
// WARUM EIN ECHTER SERVER UND KEIN MOCK: selectTransport ignoriert bei
// live=true das übergebene fetchImpl und nimmt nodeStreamFetch. Ein
// eingespeister fetch wird also gar nicht aufgerufen -- ein Test damit prüft
// nichts und wäre schlimmer als keiner, weil er Sicherheit vortäuscht. Der
// Weg, den Obsidian auf dem Desktop wirklich geht, führt über node:http.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { completeMessages } = require("./unitedshare-core");

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((fertig) => {
    server.listen(0, "127.0.0.1", () => fertig({ server, port: server.address().port }));
  });
}

function sseText(stuecke) {
  const zeilen = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"m","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  ];
  for (const s of stuecke) {
    zeilen.push(`event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta", index: 0, delta: { type: "text_delta", text: s },
    })}`);
  }
  zeilen.push('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}');
  zeilen.push('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}');
  zeilen.push('event: message_stop\ndata: {"type":"message_stop"}');
  return `${zeilen.join("\n\n")}\n\n`;
}

function koerper(text) {
  return JSON.stringify({
    id: "m", type: "message", role: "assistant", model: "m",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
  });
}

async function gegen(handler, onDelta) {
  const { server, port } = await listen(handler);
  try {
    return await completeMessages({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "k",
      model: "rmxos-mobil2026.1",
      turns: [{ role: "user", content: "Sag Hallo." }],
      onDelta,
      live: true,
      timeoutMs: 8000,
    });
  } finally {
    server.close();
  }
}

function sendeSse(stuecke, { stueckweise = false } = {}) {
  return async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const roh = sseText(stuecke);
    if (!stueckweise) {
      res.end(roh);
      return;
    }
    // Wie ein echter Strom: Pakete enden mitten in einer Zeile.
    const mitte = Math.floor(roh.length / 2);
    res.write(roh.slice(0, mitte));
    await new Promise((w) => setTimeout(w, 10));
    res.end(roh.slice(mitte));
  };
}

test("ein SSE-Strom wird gelesen und stückweise gemeldet", async () => {
  const stand = [];
  const antwort = await gegen(sendeSse(["Hallo", " aus ", "dem Strom"]), (t) => stand.push(t));
  assert.equal(antwort, "Hallo aus dem Strom");
  assert.ok(stand.length >= 1, "onDelta muss gerufen werden");
  assert.equal(stand[stand.length - 1], "Hallo aus dem Strom");
});

test("ein in der Mitte geteiltes Paket wird zusammengesetzt", async () => {
  assert.equal(await gegen(sendeSse(["Erst", "zweit"], { stueckweise: true }), null),
    "Erstzweit");
});

test("ein fertiger JSON-Körper funktioniert weiterhin", async () => {
  // So lief es bis heute -- und so läuft es, wenn der Gateway nicht streamt.
  // Diese Regression ist der Grund, warum der Strom am Gateway vorerst wieder
  // aus ist.
  const antwort = await gegen(async (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(koerper("Fertige Antwort"));
  }, null);
  assert.equal(antwort, "Fertige Antwort");
});

test("Sonderzeichen überstehen den Strom", async () => {
  const text = 'Anführung "hier", Umlaute äöü und ein Backslash \\';
  assert.equal(await gegen(sendeSse([text]), null), text);
});

test("eine leere Antwort meldet sich als solche", async () => {
  await assert.rejects(() => gegen(async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end("");
  }, null));
});

test("Müll statt Antwort wirft eine lesbare Meldung", async () => {
  await assert.rejects(
    () => gegen(async (req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>Gateway kaputt</html>");
    }, null),
    (e) => {
      assert.match(String(e.message), /Antwort/);
      return true;
    },
  );
});

test("ein Abbruch mitten im Strom liefert das bisher Gelesene", async () => {
  // Ein Netz bricht ab. Was bis dahin kam, ist mehr wert als ein Fehler.
  const antwort = await gegen(async (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(sseText(["Angefangen"]).split("event: content_block_stop")[0]);
    res.end();
  }, null);
  assert.equal(antwort, "Angefangen");
});

// ANLASS (2026-10-10): "ab und zu" meldete das Plugin "Das Modell hat keine
// Antwort geliefert", obwohl das Modell nur noch nicht angefangen hatte zu
// antworten. "mega" braucht bis zu zwanzig Sekunden Stille vor dem ersten
// Zeichen (siehe completeThread in main.src.js) -- bricht in dieser Zeit
// irgendwo zwischen hier und dem Modell die Verbindung ab (ein Proxy mit
// kürzerem Leerlauf-Timeout als unsere 90 Sekunden, ein Netzwerk-Hänger),
// kommt null Bytes an. Das ist von einer echten leeren Antwort nicht zu
// unterscheiden, aber im Unterschied dazu ein einmaliger Netz-Zufall, kein
// Urteil über die Frage. Ein einziger stiller Wiederholungsversuch kostet
// nichts (es wurde ja nichts erzeugt) und behebt die meisten Fälle.
test("eine einmalig leere Antwort wird automatisch wiederholt", async () => {
  let versuch = 0;
  const antwort = await gegen(async (req, res) => {
    versuch += 1;
    if (versuch === 1) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(sseText(["Beim zweiten Versuch da"]));
  }, null);
  assert.equal(antwort, "Beim zweiten Versuch da");
  assert.equal(versuch, 2);
});

test("bleibt die Antwort dauerhaft leer, wird nach einem Versuch mehr trotzdem aufgegeben", async () => {
  let versuche = 0;
  await assert.rejects(() => gegen(async (req, res) => {
    versuche += 1;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end("");
  }, null));
  assert.equal(versuche, 2, "genau ein Wiederholungsversuch, dann aufgeben, keine Endlosschleife");
});

test("Müll statt Antwort wird nicht wiederholt (kein Verbindungsabbruch, sondern eine echte Antwort)", async () => {
  let versuche = 0;
  await assert.rejects(() => gegen(async (req, res) => {
    versuche += 1;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html>Gateway kaputt</html>");
  }, null));
  assert.equal(versuche, 1, "Muell ist eine echte Antwort, kein Verbindungsabbruch -- kein Wiederholungsgrund");
});

// ANLASS (2026-10-17): "ab und zu" meldete das Plugin bei einem 400 nur
// "Modellaufruf fehlgeschlagen, Status 400." -- unabhaengig davon, was der
// Gateway tatsaechlich bemaengelt hat. drainError liest den Antwortkoerper
// zwar schon fuer die 429-Budgetgrenzen, wirft die Meldung fuer jeden
// anderen Status aber weg. Ohne sie laesst sich "warum" nie beantworten.
test("ein 400 mit lesbarer Gateway-Meldung zeigt die echte Ursache, nicht nur den Status", async () => {
  await assert.rejects(
    () => gegen(async (req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: { type: "invalid_request_error", message: "model rmxos-mobil2026.1 ist unbekannt" },
      }));
    }, null),
    (e) => {
      assert.match(String(e.message), /model rmxos-mobil2026\.1 ist unbekannt/);
      assert.equal(e.status, 400);
      assert.equal(e.detail, "model rmxos-mobil2026.1 ist unbekannt");
      return true;
    },
  );
});

test("ein 400 ohne lesbaren Grund fällt auf die generische Meldung zurück", async () => {
  await assert.rejects(
    () => gegen(async (req, res) => {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("nope");
    }, null),
    (e) => {
      assert.equal(String(e.message), "Modellaufruf fehlgeschlagen, Status 400.");
      assert.equal(e.detail, "");
      return true;
    },
  );
});
