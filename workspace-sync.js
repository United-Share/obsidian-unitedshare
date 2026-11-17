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

const CHATS_PRAEFIX = "obsidian/chats/";

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

async function objektSchreiben(ctx, key, inhalt) {
  const antwort = await ctx.fetchImpl(urlFuerObjekt(ctx.baseUrl, key), {
    method: "POST",
    headers: kopf(ctx.apiKey),
    body: inhalt,
  });
  return { status: antwort.status, ok: antwort.status === 200 };
}

async function objektLesen(ctx, key) {
  const antwort = await ctx.fetchImpl(urlFuerObjekt(ctx.baseUrl, key), {
    method: "GET",
    headers: kopf(ctx.apiKey),
  });
  if (antwort.status !== 200) return { status: antwort.status, text: null };
  return { status: 200, text: await antwort.text() };
}

async function objekteListen(ctx, praefix) {
  const antwort = await ctx.fetchImpl(urlFuerListe(ctx.baseUrl, praefix), {
    method: "GET",
    headers: kopf(ctx.apiKey),
  });
  if (antwort.status !== 200) return { status: antwort.status, items: [] };
  const daten = await antwort.json();
  return { status: 200, items: Array.isArray(daten.items) ? daten.items : [] };
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

  const transport = {
    baseUrl: einstellungen.baseUrl,
    apiKey: einstellungen.apiKey,
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

function wiederherstellbareChats(items) {
  return (Array.isArray(items) ? items : [])
    .map((o) => o && o.key)
    .filter((k) => typeof k === "string" && k.startsWith(CHATS_PRAEFIX))
    .sort();
}

module.exports = {
  CHATS_PRAEFIX,
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
