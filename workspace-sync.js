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
// S4-Nachtrag: Deckel fuer Listing-Items; Ueberschuss wird verworfen.
const ITEM_DECKEL = 500;
// K3: die Warteschlange ist ein Puffer, kein Archiv. Obergrenzen mit
// Verdraengung des Aeltesten, Versuchslimit je Eintrag, und endgueltige
// Ablehnungen werden gar nicht erst eingereiht.
const WARTESCHLANGE_MAX_EINTRAEGE = 50;
const WARTESCHLANGE_MAX_BYTES = 4 * 1024 * 1024;
const VERSUCHE_MAX = 5;
const NACHHOL_MAX_STUECK = 10;

function wiederholbar(status) {
  return status === 0 || status === 429 || status >= 500;
}

// K4: jeder Request bekommt eine Frist. AbortController signalisiert dem
// Transport den Abbruch (requestUrlAsFetch muss init.signal unterstuetzen,
// siehe Integrationsdoku), das Race beendet den Aufruf auch dann, wenn der
// Transport das Signal ignoriert.
const TIMEOUT_MS_STANDARD = 15000;
const NACHHOL_BUDGET_MS = 30000;

function mitFrist(fetchImpl, timeoutMs) {
  return (url, init) => {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer;
    const frist = new Promise((_aufloesen, ablehnen) => {
      timer = setTimeout(() => {
        if (controller) controller.abort();
        ablehnen(new Error("zeitueberschreitung"));
      }, timeoutMs);
    });
    const anfrage = Promise.resolve(
      fetchImpl(url, controller ? { ...(init || {}), signal: controller.signal } : init)
    );
    return Promise.race([anfrage, frist]).finally(() => clearTimeout(timer));
  };
}

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

// Lokale Kopie des Kennungs-Musters aus unitedshare-core (chatKennung):
// alles ausser Buchstaben, Ziffern, Strich und Unterstrich fliegt raus.
function chatKennung(id) {
  const roh = String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return roh || "ohne-kennung";
}

// K1: nach ERSTELLT plus Kennung benannt, wie das Hausmuster chatDateiname.
// UTC, nicht Ortszeit: sonst bekaeme dasselbe Gespraech nach einem Flug
// einen anderen Namen. Der Titel-Slug ist nur lesbares Suffix (maximal 80
// Zeichen), die Endung ist .json, weil der Inhalt JSON ist und chatsLaden
// auf .json filtert.
function chatKey(eintrag) {
  const roh = eintrag ? eintrag.erstellt : undefined;
  const zeitpunkt =
    roh instanceof Date
      ? roh
      : typeof roh === "number" && Number.isFinite(roh)
        ? new Date(roh)
        : new Date(String(roh ?? ""));
  const iso = Number.isNaN(zeitpunkt.getTime()) ? "1970-01-01T00:00:00.000Z" : zeitpunkt.toISOString();
  const tag = iso.slice(0, 10);
  const stunde = iso.slice(11, 16).replace(":", "");
  const slug = slugAusTitel(eintrag && eintrag.title).slice(0, 80);
  return `${CHATS_PRAEFIX}${tag}-${stunde}-${chatKennung(eintrag && eintrag.id)}-${slug}.json`;
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

// S4-Nachtrag: strikt dezimal parsen. Ein nicht-dezimaler oder
// mehrwertiger Header ist FEINDLICH (Smuggling-Geruch), nicht abwesend.
function contentLengthVon(antwort) {
  if (!antwort || !antwort.headers || typeof antwort.headers.get !== "function") {
    return { wert: null, feindlich: false };
  }
  const roh = antwort.headers.get("content-length");
  if (roh === null || roh === undefined) return { wert: null, feindlich: false };
  const s = String(roh).trim();
  if (!/^\d+$/.test(s)) return { wert: null, feindlich: true };
  return { wert: Number(s), feindlich: false };
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
  if (angekuendigt.feindlich) {
    return { status: 200, text: null, grund: "unlesbar" };
  }
  if (angekuendigt.wert !== null && angekuendigt.wert > MAX_OBJEKT_BYTES) {
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
  if (angekuendigt.feindlich) {
    return { status: 200, items: [], grund: "unlesbar" };
  }
  if (angekuendigt.wert !== null && angekuendigt.wert > MAX_OBJEKT_BYTES) {
    return { status: 200, items: [], grund: "zu-gross" };
  }
  // Dieselbe Schranke wie beim Objekt-Lesen: erst den Text messen, dann
  // parsen. Ein echter Streaming-Abbruch braucht Transportunterstuetzung
  // (requestUrl puffert nativ) und bleibt bewusste Grenze, siehe Doku.
  const text = await antwort.text();
  if (utf8ByteLength(text) > MAX_OBJEKT_BYTES) {
    return { status: 200, items: [], grund: "zu-gross" };
  }
  let daten;
  try {
    daten = JSON.parse(text);
  } catch (_fehler) {
    return { status: 200, items: [], grund: "unlesbar" };
  }
  if (!daten || typeof daten !== "object" || !Array.isArray(daten.items)) {
    return { status: 200, items: [], grund: "unlesbar" };
  }
  if (daten.items.length > ITEM_DECKEL) {
    return { status: 200, items: daten.items.slice(0, ITEM_DECKEL), grund: "gedeckelt" };
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
  // K1: leere Chats werden nicht gespiegelt; es gaebe nichts zurueckzuholen.
  if (!eintrag || !Array.isArray(eintrag.messages) || eintrag.messages.length === 0) {
    return { ergebnis: "leer", nachgeholt: 0 };
  }
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

  const rohTimeout = Number(ctx.timeoutMs ?? einstellungen.timeoutMs);
  const timeoutMs = Number.isFinite(rohTimeout) && rohTimeout > 0 ? rohTimeout : TIMEOUT_MS_STANDARD;
  const transport = {
    baseUrl: sichereBasis,
    apiKey,
    fetchImpl: mitFrist(ctx.fetchImpl, timeoutMs),
  };
  const jetzt = typeof ctx.jetzt === "function" ? ctx.jetzt : Date.now;
  const key = chatKey(eintrag);
  const inhalt = typeof ctx.chatAlsText === "function" ? ctx.chatAlsText(eintrag) : JSON.stringify(eintrag);

  // K3: defensive Defaults, ein leerer Zustand wirft nicht.
  const z = zustand && typeof zustand === "object" ? zustand : {};
  if (!Array.isArray(z.warteschlange)) z.warteschlange = [];

  let geschrieben;
  try {
    geschrieben = await objektSchreiben(transport, key, inhalt);
  } catch (fehler) {
    geschrieben = { status: 0, ok: false, fehler };
  }

  if (!geschrieben.ok) {
    if (!wiederholbar(geschrieben.status)) {
      // Endgueltige Ablehnung: einmal protokollieren, nie einreihen.
      protokolliere({ quelle: "workspace-sync", key, status: geschrieben.status, endgueltig: true });
      melde("Workspace-Spiegel verworfen");
      return { ergebnis: "verworfen", nachgeholt: 0 };
    }
    // Dedupe pro Key: der letzte Stand gewinnt, Position am Ende.
    z.warteschlange = z.warteschlange.filter((w) => w.key !== key);
    z.warteschlange.push({ key, inhalt, versuche: 0 });
    // Obergrenzen: Anzahl und Gesamtbytes, Verdraengung des Aeltesten.
    while (z.warteschlange.length > WARTESCHLANGE_MAX_EINTRAEGE) {
      const raus = z.warteschlange.shift();
      protokolliere({ quelle: "workspace-sync", key: raus.key, status: 0, verdraengt: true });
    }
    let gesamt = z.warteschlange.reduce((summe, w) => summe + utf8ByteLength(String(w.inhalt ?? "")), 0);
    while (gesamt > WARTESCHLANGE_MAX_BYTES && z.warteschlange.length > 1) {
      const raus = z.warteschlange.shift();
      gesamt -= utf8ByteLength(String(raus.inhalt ?? ""));
      protokolliere({ quelle: "workspace-sync", key: raus.key, status: 0, verdraengt: true });
    }
    protokolliere({ quelle: "workspace-sync", key, status: geschrieben.status });
    melde("Workspace-Spiegel aufgeschoben");
    return { ergebnis: "aufgeschoben", nachgeholt: 0 };
  }

  // Frischer Erfolg: veraltete Fassungen desselben Keys fliegen raus,
  // niemals landet eine alte Fassung ueber der frischen.
  const vorher = z.warteschlange.length;
  z.warteschlange = z.warteschlange.filter((w) => w.key !== key);
  if (z.warteschlange.length < vorher) {
    protokolliere({ quelle: "workspace-sync", key, status: 0, veraltetVerworfen: true });
  }

  let nachgeholt = 0;
  let bearbeitet = 0;
  const nachholStart = jetzt();
  while (z.warteschlange.length > 0 && bearbeitet < NACHHOL_MAX_STUECK) {
    // K4: Zeitbudget fuer den gesamten Nachhol-Lauf.
    if (jetzt() - nachholStart >= NACHHOL_BUDGET_MS) break;
    const kopfEintrag = z.warteschlange[0];
    bearbeitet += 1;
    let r;
    try {
      r = await objektSchreiben(transport, kopfEintrag.key, kopfEintrag.inhalt);
    } catch (_fehler) {
      r = { status: 0, ok: false };
    }
    if (r.ok) {
      z.warteschlange.shift();
      nachgeholt += 1;
      continue;
    }
    if (!wiederholbar(r.status)) {
      // Endgueltig abgelehnt: raus damit, der Kopf blockiert nicht.
      z.warteschlange.shift();
      protokolliere({ quelle: "workspace-sync", key: kopfEintrag.key, status: r.status, endgueltig: true });
      continue;
    }
    kopfEintrag.versuche = (kopfEintrag.versuche ?? 0) + 1;
    if (kopfEintrag.versuche >= VERSUCHE_MAX) {
      z.warteschlange.shift();
      protokolliere({ quelle: "workspace-sync", key: kopfEintrag.key, status: r.status, aufgegeben: true });
      continue;
    }
    break;
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
  WARTESCHLANGE_MAX_EINTRAEGE,
  ITEM_DECKEL,
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
