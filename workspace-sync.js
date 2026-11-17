"use strict";

// Chat-Backup in den persoenlichen Vault-Workspace (Zuschnitt A).
//
// Das Gateway api.unitedshare.ai/v1/workspace ist identitaetsgebunden: der
// vorhandene apiKey (usk) der Modellaufrufe oeffnet auch den eigenen
// ws-Bucket, der Client traegt nie S3-Credentials. Dieses Modul ist reine
// Logik plus Transport ueber ein injiziertes fetch (requestUrlAsFetch auf
// Mobil, fetch im Test); es kennt weder Obsidian noch main.src.js.
//
// Vertraege und Begruendungen: workspace-sync.test.js.

const { keyPruefen } = require("./key-pruefung");

const CHATS_PRAEFIX = "obsidian/chats/";
// Objektgrenze des Gateways. Am tatsaechlichen Body durchgesetzt
// (Security-Finding 3), nicht nur an Metadaten.
const MAX_OBJEKT_BYTES = 16 * 1024 * 1024;

function slugAusTitel(titel) {
  const roh = String(titel ?? "").toLowerCase();
  let slug = "";
  let strich = false;
  for (const zeichen of roh) {
    if (/[a-z0-9]/.test(zeichen)) {
      slug += zeichen;
      strich = false;
    } else if (!strich && slug.length > 0) {
      slug += "-";
      strich = true;
    }
  }
  slug = slug.replace(/-+$/, "");
  return slug.length > 0 ? slug : "chat";
}

function chatKey(eintrag, datum) {
  const tag = String(datum ?? "").slice(0, 10);
  const titel = eintrag && eintrag.title ? eintrag.title : "";
  return `${CHATS_PRAEFIX}${tag}-${slugAusTitel(titel)}.md`;
}

function basis(baseUrl) {
  return String(baseUrl ?? "").replace(/\/+$/, "");
}

// S3: Basis-URL und apiKey sind Settings und damit beeinflussbare Eingabe.
// Host-Pinning: Solange es keine kundeneigenen Gateways gibt, ist jede
// andere Basis ein Exfiltrationsvektor fuer Key und Inhalte. Kommen
// Enterprise-eigene Gateways, wird deren Freigabe ein bewusster,
// dokumentierter Konfigurationsschritt, kein freies Textfeld. Die
// Loopback-Ausnahme gilt nur numerisch (127.0.0.1, [::1]) und nur, wenn
// der Aufrufer sie explizit freischaltet (Tests); localhost loest ueber
// den Resolver auf und bleibt deshalb immer verboten.
const ERLAUBTER_ORIGIN = "https://api.unitedshare.ai";

function basisPruefen(baseUrl, optionen) {
  let u;
  try {
    u = new URL(String(baseUrl ?? ""));
  } catch (_fehler) {
    return null;
  }
  if (u.username || u.password || u.hash || u.search) return null;
  const loopbackFrei = Boolean(optionen && optionen.erlaubeLoopback === true);
  const numerischLokal = u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  const erlaubt =
    u.origin === ERLAUBTER_ORIGIN ||
    (loopbackFrei && u.protocol === "http:" && numerischLokal);
  if (!erlaubt) return null;
  return `${u.origin}${u.pathname}`.replace(/\/+$/, "");
}

function apiKeyPruefen(apiKey) {
  const k = String(apiKey ?? "").trim();
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : null;
}

function urlFuerObjekt(baseUrl, key) {
  return `${basis(baseUrl)}/workspace/object?key=${encodeURIComponent(String(key ?? ""))}`;
}

function urlFuerListe(baseUrl, praefix) {
  const grund = `${basis(baseUrl)}/workspace/objects`;
  if (!praefix) return grund;
  return `${grund}?prefix=${encodeURIComponent(praefix)}`;
}

function kopf(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

// Hausmuster aus unitedshare-core: Buffer nur mit Guard, der
// Bundler-Buffer-Stub hat kein byteLength.
function utf8ByteLength(text) {
  if (typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function") {
    return Buffer.byteLength(text, "utf8");
  }
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

// S5: typfeste Messung. Alles ohne messbare Groesse wird abgelehnt statt
// geraten; URLSearchParams und beliebige Objekte haben keine Byte-Laenge.
function bodyBytes(inhalt) {
  if (typeof inhalt === "string") return utf8ByteLength(inhalt);
  if (typeof ArrayBuffer !== "undefined") {
    if (inhalt instanceof ArrayBuffer) return inhalt.byteLength;
    if (ArrayBuffer.isView(inhalt)) return inhalt.byteLength;
  }
  return null;
}

function contentLengthVon(antwort) {
  if (!antwort || !antwort.headers || typeof antwort.headers.get !== "function") return null;
  const roh = antwort.headers.get("content-length");
  if (roh === null || roh === undefined) return null;
  const n = Number(roh);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function objektSchreiben(ctx, key, inhalt) {
  const bytes = bodyBytes(inhalt);
  if (bytes === null) {
    return { status: 0, ok: false, grund: "unmessbar" };
  }
  if (bytes > MAX_OBJEKT_BYTES) {
    return { status: 413, ok: false, grund: "zu-gross" };
  }
  const antwort = await ctx.fetchImpl(urlFuerObjekt(ctx.baseUrl, key), {
    method: "POST",
    headers: kopf(ctx.apiKey),
    body: inhalt,
  });
  return { status: antwort.status, ok: antwort.status >= 200 && antwort.status < 300 };
}

// S4: Antworten sind Netz-Eingabe. Content-Length vorab, nach dem Lesen
// erneut messen (fail-closed), NUL-Inhalte verwerfen.
async function objektLesen(ctx, key) {
  const antwort = await ctx.fetchImpl(urlFuerObjekt(ctx.baseUrl, key), {
    method: "GET",
    headers: kopf(ctx.apiKey),
  });
  if (antwort.status !== 200) return { status: antwort.status, text: null };
  const angekuendigt = contentLengthVon(antwort);
  if (angekuendigt !== null && angekuendigt > MAX_OBJEKT_BYTES) {
    return { status: 200, text: null, grund: "zu-gross" };
  }
  const text = await antwort.text();
  if (utf8ByteLength(text) > MAX_OBJEKT_BYTES) {
    return { status: 200, text: null, grund: "zu-gross" };
  }
  if (text.includes("\u0000")) {
    return { status: 200, text: null, grund: "unlesbar" };
  }
  return { status: 200, text };
}

async function objekteListen(ctx, praefix) {
  const antwort = await ctx.fetchImpl(urlFuerListe(ctx.baseUrl, praefix), {
    method: "GET",
    headers: kopf(ctx.apiKey),
  });
  if (antwort.status !== 200) return { status: antwort.status, items: [] };
  const angekuendigt = contentLengthVon(antwort);
  if (angekuendigt !== null && angekuendigt > MAX_OBJEKT_BYTES) {
    return { status: 200, items: [], grund: "zu-gross" };
  }
  let daten;
  try {
    daten = await antwort.json();
  } catch (_fehler) {
    return { status: 200, items: [], grund: "unlesbar" };
  }
  if (!daten || typeof daten !== "object" || !Array.isArray(daten.items)) {
    return { status: 200, items: [], grund: "unlesbar" };
  }
  return { status: 200, items: daten.items };
}

// Spiegelt einen frisch gespeicherten Chat und holt bei Erfolg die
// Warteschlange nach. Der lokale Chat wird hier nie angefasst; Fehlschlaege
// landen als {key, inhalt} in zustand.warteschlange (persistiert der Aufrufer
// in den Plugin-Daten).
async function chatSpiegeln(ctx, eintrag, zustand) {
  const einstellungen = (ctx && ctx.settings) || {};
  const melde = typeof ctx.status === "function" ? ctx.status : () => {};
  const protokolliere = typeof ctx.protokoll === "function" ? ctx.protokoll : () => {};
  if (!einstellungen.apiKey) {
    melde("Workspace-Spiegel aus: kein API-Key hinterlegt");
    return { ergebnis: "kein-schluessel", nachgeholt: 0 };
  }
  const apiKey = apiKeyPruefen(einstellungen.apiKey);
  if (apiKey === null) {
    melde("Workspace-Spiegel aus: API-Key unbrauchbar");
    return { ergebnis: "kein-schluessel", nachgeholt: 0 };
  }
  const sichereBasis = basisPruefen(einstellungen.baseUrl, { erlaubeLoopback: ctx.erlaubeLoopback === true });
  if (sichereBasis === null) {
    melde("Workspace-Spiegel aus: Basis-URL unsicher");
    return { ergebnis: "keine-basis", nachgeholt: 0 };
  }

  const transport = {
    baseUrl: sichereBasis,
    apiKey,
    fetchImpl: ctx.fetchImpl,
  };
  const datum = ctx.datum ?? new Date().toISOString();
  const key = chatKey(eintrag, datum);
  const inhalt = typeof ctx.chatAlsText === "function" ? ctx.chatAlsText(eintrag) : JSON.stringify(eintrag);

  let geschrieben;
  try {
    geschrieben = await objektSchreiben(transport, key, inhalt);
  } catch (fehler) {
    geschrieben = { status: 0, ok: false, fehler };
  }
  if (!geschrieben.ok) {
    zustand.warteschlange.push({ key, inhalt });
    protokolliere({ quelle: "workspace-sync", key, status: geschrieben.status });
    melde("Workspace-Spiegel aufgeschoben");
    return { ergebnis: "aufgeschoben", nachgeholt: 0 };
  }

  let nachgeholt = 0;
  while (zustand.warteschlange.length > 0) {
    const naechster = zustand.warteschlange[0];
    let gelungen = false;
    try {
      gelungen = (await objektSchreiben(transport, naechster.key, naechster.inhalt)).ok;
    } catch (_fehler) {
      gelungen = false;
    }
    if (!gelungen) break;
    zustand.warteschlange.shift();
    nachgeholt += 1;
  }
  melde(nachgeholt > 0 ? `Workspace-Spiegel ok, ${nachgeholt} nachgeholt` : "Workspace-Spiegel ok");
  return { ergebnis: "gespiegelt", nachgeholt };
}

// S2: das Listing ist fremde Eingabe; Keys laufen durch dieselbe
// Segmentpruefung wie der Ordner-Sync. Der lokale Dateiname wird ohnehin
// NIE aus dem Remote-Key abgeleitet (siehe Integrationsdoku).
function wiederherstellbareChats(items) {
  return (Array.isArray(items) ? items : [])
    .map((o) => o && o.key)
    .filter((k) => keyPruefen(CHATS_PRAEFIX, k, ["json", "md"]))
    .sort();
}

module.exports = {
  CHATS_PRAEFIX,
  MAX_OBJEKT_BYTES,
  basisPruefen,
  apiKeyPruefen,
  slugAusTitel,
  chatKey,
  urlFuerObjekt,
  urlFuerListe,
  objektSchreiben,
  objektLesen,
  objekteListen,
  chatSpiegeln,
  wiederherstellbareChats,
};
