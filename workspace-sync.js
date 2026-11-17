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

const { keyPruefen, utf8ByteLength, MAX_OBJEKT_BYTES } = require("./key-pruefung");

const CHATS_PRAEFIX = "obsidian/chats/";
// S4-Nachtrag: Deckel fuer Listing-Items; Ueberschuss wird verworfen.
const ITEM_DECKEL = 500;
// V5: das Gateway liefert hoechstens die letzten 50 Objekte
// (serverseitiges items.slice(-50)); ab dieser Schwelle ist ein Listing
// als unvollstaendig zu betrachten. Cursor-Paginierung ist ein
// Gateway-Folgethema.
const GATEWAY_LISTING_SCHWELLE = 50;
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

// T2: KEINE Kopie von chatKennung aus dem Core (beim Inlining waere das
// eine doppelte Top-Level-Deklaration). Dieser lokale Standard traegt den
// Vertrag; beim Bundeln bindet Hook 1 die Core-Funktion als kennungFn an.
function kennungStandard(id) {
  const roh = String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  return roh || "ohne-kennung";
}

// K1: nach ERSTELLT plus Kennung benannt, wie das Hausmuster chatDateiname.
// UTC, nicht Ortszeit: sonst bekaeme dasselbe Gespraech nach einem Flug
// einen anderen Namen. Der Titel-Slug ist nur lesbares Suffix (maximal 80
// Zeichen), die Endung ist .json, weil der Inhalt JSON ist und chatsLaden
// auf .json filtert.
function chatKey(eintrag, kennungFn = kennungStandard) {
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
  let kennung = String(kennungFn(eintrag && eintrag.id) ?? "");
  let slug = slugAusTitel(eintrag && eintrag.title).slice(0, 80);
  // Z3: Kennung plus Slug unter die 255-Byte-Segmentgrenze kuerzen (der
  // Slug zuerst, die Kennung behaelt mindestens acht Zeichen) und das
  // Ergebnis mit DERSELBEN Pruefung validieren wie die Rueckholung. Ein
  // Key, der nicht rueckholbar waere, wird nie gebaut.
  const segmentVon = () => `${tag}-${stunde}-${kennung}-${slug}.json`;
  while (utf8ByteLength(segmentVon()) > 255 && slug.length > 1) slug = slug.slice(0, -1);
  while (utf8ByteLength(segmentVon()) > 255 && kennung.length > 8) kennung = kennung.slice(0, -1);
  const key = `${CHATS_PRAEFIX}${segmentVon()}`;
  return keyPruefen(CHATS_PRAEFIX, key, ["json"]) ? key : null;
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

// T1: transportBauen ist der EINZIGE erlaubte Weg zu einem Transport-
// Kontext. Es buendelt basisPruefen, apiKeyPruefen und mitFrist.
// T1-Nachtrag: das Register ist out-of-band (WeakSet), weil ein Marker im
// Objekt per Spread kopierbar waere; das ctx ist eingefroren, damit nach
// der Pruefung nichts mutierbar ist, und transportGueltig prueft die Basis
// zur Tiefenverteidigung erneut (rein und billig).
const GEPRUEFTE_TRANSPORTE = new WeakSet();
const AKTIVE_SPIEGEL = new WeakSet();

function transportBauen({ settings, fetchImpl, timeoutMs, erlaubeLoopback } = {}) {
  const einstellungen = settings || {};
  const apiKey = apiKeyPruefen(einstellungen.apiKey);
  if (apiKey === null) return null;
  const basis = basisPruefen(einstellungen.baseUrl, { erlaubeLoopback: erlaubeLoopback === true });
  if (basis === null) return null;
  if (typeof fetchImpl !== "function") return null;
  const roh = Number(timeoutMs ?? einstellungen.timeoutMs);
  const frist = Number.isFinite(roh) && roh > 0 ? roh : TIMEOUT_MS_STANDARD;
  const ctx = Object.freeze({
    baseUrl: basis,
    apiKey,
    fetchImpl: mitFrist(fetchImpl, frist),
  });
  GEPRUEFTE_TRANSPORTE.add(ctx);
  return ctx;
}

// D4: Tag, Stunde und Kennung fuer das Protokoll; der Titel-Slug bleibt
// draussen.
function bodyKurzVon(key, kennung) {
  const basename = String(key ?? "").split("/").pop();
  return `${basename.slice(0, 15)}-${kennung}`;
}

function transportGueltig(ctx) {
  if (!ctx || !GEPRUEFTE_TRANSPORTE.has(ctx)) return false;
  return basisPruefen(ctx.baseUrl, { erlaubeLoopback: true }) !== null;
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

// S4-Nachtrag und T3: strikt dezimal parsen, beide Header-Formen verstehen
// (Headers mit get UND plain Record, case-insensitiv). Fuer die eigenen
// Gateway-Endpunkte gilt fail-closed: ein FEHLENDER Header, ein fehlendes
// headers-Objekt oder ein nicht-dezimaler Wert ist FEINDLICH, denn das
// Gateway setzt Content-Length immer.
function contentLengthVon(antwort) {
  const h = antwort && antwort.headers;
  let roh;
  if (h && typeof h.get === "function") {
    roh = h.get("content-length");
  } else if (h && typeof h === "object") {
    for (const name of Object.keys(h)) {
      if (String(name).toLowerCase() === "content-length") {
        roh = h[name];
        break;
      }
    }
  }
  if (roh === null || roh === undefined) return { wert: null, feindlich: true };
  const s = String(roh).trim();
  if (!/^\d+$/.test(s)) return { wert: null, feindlich: true };
  return { wert: Number(s), feindlich: false };
}

async function objektSchreiben(ctx, key, inhalt) {
  if (!transportGueltig(ctx)) return { status: 0, ok: false, grund: "ungeprueft" };
  const bytes = bodyBytes(inhalt);
  if (bytes === null) {
    return { status: 0, ok: false, grund: "unmessbar" };
  }
  if (bytes > MAX_OBJEKT_BYTES) {
    return { status: 413, ok: false, grund: "zu-gross" };
  }
  // D5: expliziter Content-Type. application/octet-stream statt json,
  // weil der Workspace beliebige Inhalte traegt (Chats sind JSON, Notizen
  // Markdown); das Gateway behandelt den Body ohnehin als Bytes.
  const antwort = await ctx.fetchImpl(urlFuerObjekt(ctx.baseUrl, key), {
    method: "POST",
    headers: { ...kopf(ctx.apiKey), "Content-Type": "application/octet-stream" },
    body: inhalt,
  });
  return { status: antwort.status, ok: antwort.status >= 200 && antwort.status < 300 };
}

// S4: Antworten sind Netz-Eingabe. Content-Length vorab, nach dem Lesen
// erneut messen (fail-closed), NUL-Inhalte verwerfen.
async function objektLesen(ctx, key) {
  if (!transportGueltig(ctx)) return { status: 0, text: null, grund: "ungeprueft" };
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
  if (!transportGueltig(ctx)) return { status: 0, items: [], vollstaendig: false, grund: "ungeprueft" };
  const antwort = await ctx.fetchImpl(urlFuerListe(ctx.baseUrl, praefix), {
    method: "GET",
    headers: kopf(ctx.apiKey),
  });
  if (antwort.status !== 200) return { status: antwort.status, items: [], vollstaendig: false };
  const angekuendigt = contentLengthVon(antwort);
  if (angekuendigt.feindlich) {
    return { status: 200, items: [], grund: "unlesbar", vollstaendig: false };
  }
  if (angekuendigt.wert !== null && angekuendigt.wert > MAX_OBJEKT_BYTES) {
    return { status: 200, items: [], grund: "zu-gross", vollstaendig: false };
  }
  // Dieselbe Schranke wie beim Objekt-Lesen: erst den Text messen, dann
  // parsen. Ein echter Streaming-Abbruch braucht Transportunterstuetzung
  // (requestUrl puffert nativ) und bleibt bewusste Grenze, siehe Doku.
  const text = await antwort.text();
  if (utf8ByteLength(text) > MAX_OBJEKT_BYTES) {
    return { status: 200, items: [], grund: "zu-gross", vollstaendig: false };
  }
  let daten;
  try {
    daten = JSON.parse(text);
  } catch (_fehler) {
    return { status: 200, items: [], grund: "unlesbar", vollstaendig: false };
  }
  if (!daten || typeof daten !== "object" || !Array.isArray(daten.items)) {
    return { status: 200, items: [], grund: "unlesbar", vollstaendig: false };
  }
  const vollstaendig = daten.items.length < GATEWAY_LISTING_SCHWELLE;
  if (daten.items.length > ITEM_DECKEL) {
    return { status: 200, items: daten.items.slice(0, ITEM_DECKEL), grund: "gedeckelt", vollstaendig: false };
  }
  return { status: 200, items: daten.items, vollstaendig };
}

// Spiegelt einen frisch gespeicherten Chat und holt bei Erfolg die
// Warteschlange nach. Der lokale Chat wird hier nie angefasst; Fehlschlaege
// landen als {key, inhalt} in zustand.warteschlange (persistiert der Aufrufer
// in den Plugin-Daten).
async function chatSpiegeln(ctx, eintrag, zustand) {
  const einstellungen = (ctx && ctx.settings) || {};
  const melde = typeof ctx.status === "function" ? ctx.status : () => {};
  const jetzt = typeof ctx.jetzt === "function" ? ctx.jetzt : Date.now;
  // V3: feste Nutzlast {zeit, status, meldung, body}; body ist der Basename
  // des Keys, nie der volle Pfad. Ein werfendes oder asynchron scheiterndes
  // protokoll reisst den Spiegel nicht mit.
  // D4: body ist Tag, Stunde und Kennung, NIE der Titel-Slug; Chat-Titel
  // gehoeren nicht ins debug.log. Fuer Alt-Eintraege ohne bodyKurz bleibt
  // der datumsgenaue Anfang des Basenames.
  const protokolliere = (eintrag) => {
    if (typeof ctx.protokoll !== "function") return;
    const basename = String(eintrag.key ?? "").split("/").pop();
    const nutzlast = {
      zeit: jetzt(),
      status: eintrag.status ?? 0,
      meldung: eintrag.meldung ?? "",
      body: eintrag.bodyKurz ?? basename.slice(0, 15),
    };
    try {
      Promise.resolve(ctx.protokoll(nutzlast)).catch(() => {});
    } catch (_fehler) {
      // bewusst geschluckt, siehe Kommentar oben
    }
  };
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

  const transport = transportBauen({
    settings: einstellungen,
    fetchImpl: ctx.fetchImpl,
    timeoutMs: ctx.timeoutMs,
    erlaubeLoopback: ctx.erlaubeLoopback === true,
  });
  if (transport === null) {
    melde("Workspace-Spiegel aus: Transport nicht baubar");
    return { ergebnis: "keine-basis", nachgeholt: 0 };
  }
  const kennungFuerLog = (typeof ctx.kennungFn === "function" ? ctx.kennungFn : kennungStandard)(eintrag && eintrag.id);
  const key = chatKey(eintrag, typeof ctx.kennungFn === "function" ? ctx.kennungFn : undefined);
  if (key === null) {
    protokolliere({ key: "", status: 0, meldung: "ungueltiger-key", bodyKurz: kennungFuerLog });
    melde("Workspace-Spiegel verworfen: Key nicht baubar");
    return { ergebnis: "verworfen", nachgeholt: 0 };
  }
  const inhalt = typeof ctx.chatAlsText === "function" ? ctx.chatAlsText(eintrag) : JSON.stringify(eintrag);

  // K3: defensive Defaults, ein leerer Zustand wirft nicht.
  const z = zustand && typeof zustand === "object" ? zustand : {};
  if (!Array.isArray(z.warteschlange)) z.warteschlange = [];

  // Q1: Lauf-Lock auch fuer den Spiegel; zwei parallele Laeufe auf
  // derselben Warteschlange wuerden Eintraege doppelt senden.
  if (AKTIVE_SPIEGEL.has(z)) {
    return { ergebnis: "laeuft-bereits", nachgeholt: 0 };
  }
  AKTIVE_SPIEGEL.add(z);
  try {
  let geschrieben;
  try {
    geschrieben = await objektSchreiben(transport, key, inhalt);
  } catch (fehler) {
    geschrieben = { status: 0, ok: false, fehler };
  }

  if (!geschrieben.ok) {
    // Q4: ein unmessbarer Body wird durch Wiederholen nicht messbar.
    if (geschrieben.grund === "unmessbar" || !wiederholbar(geschrieben.status)) {
      // Endgueltige Ablehnung: einmal protokollieren, nie einreihen.
      protokolliere({ key, status: geschrieben.status, meldung: "endgueltig-abgelehnt", bodyKurz: bodyKurzVon(key, kennungFuerLog) });
      melde("Workspace-Spiegel verworfen");
      return { ergebnis: "verworfen", nachgeholt: 0 };
    }
    // Q3: ein Eintrag ueber der Byte-Grenze landet NIE in der Schlange;
    // er wuerde sie nur leeren und selbst nie durchpassen.
    if (utf8ByteLength(String(inhalt ?? "")) > WARTESCHLANGE_MAX_BYTES) {
      protokolliere({ key, status: geschrieben.status, meldung: "zu-gross-fuer-warteschlange", bodyKurz: bodyKurzVon(key, kennungFuerLog) });
      melde("Workspace-Spiegel: Chat zu gross fuer die Warteschlange");
      return { ergebnis: "verworfen", nachgeholt: 0 };
    }
    // Dedupe pro Key: der letzte Stand gewinnt, Position am Ende.
    z.warteschlange = z.warteschlange.filter((w) => w.key !== key);
    const frisch = { key, inhalt, versuche: 0, bodyKurz: bodyKurzVon(key, kennungFuerLog) };
    z.warteschlange.push(frisch);
    while (z.warteschlange.length > WARTESCHLANGE_MAX_EINTRAEGE) {
      const raus = z.warteschlange.shift();
      protokolliere({ key: raus.key, status: 0, meldung: "verdraengt", bodyKurz: raus.bodyKurz });
    }
    // Q3: Byte-Verdraengung trifft zuerst den GROESSTEN Eintrag (nie den
    // frischen), nicht den aeltesten; so ueberleben viele kleine Chats
    // einen einzelnen Brocken.
    const bytesVon = (e) => utf8ByteLength(String(e.inhalt ?? ""));
    let gesamt = z.warteschlange.reduce((summe, e) => summe + bytesVon(e), 0);
    while (gesamt > WARTESCHLANGE_MAX_BYTES && z.warteschlange.length > 1) {
      let groessterIdx = -1;
      let groessterWert = -1;
      for (let n = 0; n < z.warteschlange.length; n += 1) {
        if (z.warteschlange[n] === frisch) continue;
        const b = bytesVon(z.warteschlange[n]);
        if (b > groessterWert) {
          groessterWert = b;
          groessterIdx = n;
        }
      }
      if (groessterIdx === -1) break;
      const raus = z.warteschlange.splice(groessterIdx, 1)[0];
      gesamt -= groessterWert;
      protokolliere({ key: raus.key, status: 0, meldung: "verdraengt", bodyKurz: raus.bodyKurz });
    }
    protokolliere({ key, status: geschrieben.status, meldung: "aufgeschoben", bodyKurz: bodyKurzVon(key, kennungFuerLog) });
    melde("Workspace-Spiegel aufgeschoben");
    return { ergebnis: "aufgeschoben", nachgeholt: 0 };
  }

  // Frischer Erfolg: veraltete Fassungen desselben Keys fliegen raus,
  // niemals landet eine alte Fassung ueber der frischen.
  const vorher = z.warteschlange.length;
  z.warteschlange = z.warteschlange.filter((w) => w.key !== key);
  if (z.warteschlange.length < vorher) {
    protokolliere({ key, status: 0, meldung: "veraltet-verworfen", bodyKurz: bodyKurzVon(key, kennungFuerLog) });
  }

  let nachgeholt = 0;
  let bearbeitet = 0;
  const nachholStart = jetzt();
  while (z.warteschlange.length > 0 && bearbeitet < NACHHOL_MAX_STUECK) {
    // K4: Zeitbudget fuer den gesamten Nachhol-Lauf.
    if (jetzt() - nachholStart >= NACHHOL_BUDGET_MS) break;
    // Q1: VOR dem Schreiben per Identitaet entnehmen; ein blindes shift
    // nach dem await koennte einen fremden Kopf treffen.
    const kopfEintrag = z.warteschlange[0];
    const idx = z.warteschlange.indexOf(kopfEintrag);
    if (idx === -1) break;
    z.warteschlange.splice(idx, 1);
    bearbeitet += 1;
    let r;
    try {
      r = await objektSchreiben(transport, kopfEintrag.key, kopfEintrag.inhalt);
    } catch (_fehler) {
      r = { status: 0, ok: false };
    }
    if (r.ok) {
      nachgeholt += 1;
      continue;
    }
    if (r.grund === "unmessbar" || !wiederholbar(r.status)) {
      protokolliere({ key: kopfEintrag.key, status: r.status, meldung: "endgueltig-abgelehnt", bodyKurz: kopfEintrag.bodyKurz });
      continue;
    }
    kopfEintrag.versuche = (kopfEintrag.versuche ?? 0) + 1;
    if (kopfEintrag.versuche >= VERSUCHE_MAX) {
      protokolliere({ key: kopfEintrag.key, status: r.status, meldung: "aufgegeben", bodyKurz: kopfEintrag.bodyKurz });
      continue;
    }
    // wiederholbar: vorne wieder einsetzen, Lauf endet.
    z.warteschlange.unshift(kopfEintrag);
    break;
  }
  melde(nachgeholt > 0 ? `Workspace-Spiegel ok, ${nachgeholt} nachgeholt` : "Workspace-Spiegel ok");
  return { ergebnis: "gespiegelt", nachgeholt };
  } finally {
    AKTIVE_SPIEGEL.delete(z);
  }
}

// S2: das Listing ist fremde Eingabe; Keys laufen durch dieselbe
// Segmentpruefung wie der Ordner-Sync. Der lokale Dateiname wird ohnehin
// NIE aus dem Remote-Key abgeleitet (siehe Integrationsdoku).
// Z3: nur noch json; der Inhalt der Chats IST JSON, md-Keys im Listing
// sind Fremdkoerper.
function wiederherstellbareChats(items) {
  return (Array.isArray(items) ? items : [])
    .map((o) => o && o.key)
    .filter((k) => keyPruefen(CHATS_PRAEFIX, k, ["json"]))
    .sort();
}

module.exports = {
  CHATS_PRAEFIX,
  transportBauen,
  WARTESCHLANGE_MAX_EINTRAEGE,
  WARTESCHLANGE_MAX_BYTES,
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
