"use strict";

// Werkzeuge fuer freie lesende SQL, fuer die .sql-Abfragedateien aus
// crm/ im Tresor, und die Ressourcen-Ansicht (MCP resources). Hier liegt
// auch die Werkzeugliste und die Kontext-Fabrik, die MCP/ACP/Server/CLI
// gemeinsam nutzen.

const {
  istLesendeAbfrage, leseAbfrageDatei, parquetDateienImVault,
  abfrageDateienImVault, sichererParquetName, sqlText, duckdbJsonAusfuehren,
  ausfuehrenBegrenzt,
} = require("./crm-core");
const { crmWerkzeuge: crmDatenWerkzeuge, limitAus } = require("./crm-werkzeuge");

const freieWerkzeuge = [
  {
    name: "crm_sql",
    titel: "Freie lesende Abfrage",
    beschreibung: "Fuehrt EINE lesende SQL-Anweisung aus (muss mit SELECT oder WITH beginnen; Schreiben/Verwalten wird abgewiesen). Ergebnisblock nennt ingesamt und abgeschnitten — nichts wird still gekuerzt.",
    eingabeSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "eine Anweisung, z. B. SELECT Ort, COUNT(*) FROM 'adressen.parquet' GROUP BY Ort" },
        limit: { type: "integer", description: "hoechstens so viele Zeilen (Standard 100, maximal 1000)" },
      },
      required: ["sql"],
      additionalProperties: false,
    },
    ausfuehren: async (args, kontext) => {
      const pruefung = istLesendeAbfrage(args?.sql);
      if (!pruefung.ok) throw new Error(pruefung.meldung);
      return {
        ...await ausfuehrenBegrenzt(kontext.cfg, pruefung.abfrage, limitAus(args, kontext)),
        sql: pruefung.abfrage,
      };
    },
  },
  {
    name: "crm_abfragen",
    titel: "Abfragedateien im Tresor",
    beschreibung: "Listet die .sql-Abfragedateien im Ordner crm/ des Tresors mit ihrem Kopf-Kommentar.",
    eingabeSchema: { type: "object", properties: {}, additionalProperties: false },
    ausfuehren: async (_args, kontext) => {
      const daten = [];
      for (const datei of await abfrageDateienImVault(kontext.cfg)) {
        const text = await leseAbfrageDatei(kontext.cfg, datei);
        const kopf = text.split("\n").find((zeile) => zeile.trim().startsWith("--"));
        daten.push({ datei, hinweis: kopf ? kopf.replace(/^\s*--\s*/, "").trim() : null });
      }
      return { daten, zeilen: daten.length, ingesamt: daten.length, abgeschnitten: false };
    },
  },
  {
    name: "crm_abfrage_datei",
    titel: "Abfragedatei ausfuehren",
    beschreibung: "Fuehrt eine .sql-Datei aus dem Ordner crm/ des Tresors aus (lesend, mit Limit und Zaehlung).",
    eingabeSchema: {
      type: "object",
      properties: {
        datei: { type: "string", description: "Dateiname innerhalb crm/, z. B. aviso-uebersicht.sql" },
        limit: { type: "integer", description: "hoechstens so viele Zeilen" },
      },
      required: ["datei"],
      additionalProperties: false,
    },
    ausfuehren: async (args, kontext) => {
      const text = await leseAbfrageDatei(kontext.cfg, args?.datei);
      const pruefung = istLesendeAbfrage(text);
      if (!pruefung.ok) {
        throw new Error(`Die Abfragedatei ist keine einzelne lesende Abfrage: ${pruefung.meldung}`);
      }
      return {
        ...await ausfuehrenBegrenzt(kontext.cfg, pruefung.abfrage, limitAus(args, kontext)),
        datei: args.datei,
        sql: pruefung.abfrage,
      };
    },
  },
];

function crmWerkzeugeAlle() {
  return [...crmDatenWerkzeuge(), ...freieWerkzeuge];
}

// ---------------------------------------------------------------- Ressourcen

async function ressourcenLaden(cfg) {
  const liste = [];
  for (const name of await parquetDateienImVault(cfg)) {
    liste.push({
      uri: `crm://daten/${name}`,
      name,
      description: `Parquet-Tabelle im Tresor (Lesen liefert das Schema)`,
      mimeType: "application/x-parquet",
    });
  }
  for (const name of await abfrageDateienImVault(cfg)) {
    liste.push({
      uri: `crm://abfrage/${name}`,
      name,
      description: "CRM-Abfragedatei (.sql) aus crm/ im Tresor",
      mimeType: "text/x-sql",
    });
  }
  return liste;
}

async function ressourceLesen(cfg, uri) {
  if (typeof uri !== "string") throw new Error("Die Ressourcen-URI fehlt.");
  if (uri.startsWith("crm://daten/")) {
    const name = uri.slice("crm://daten/".length);
    const pruefung = sichererParquetName(name);
    if (!pruefung.ok) throw new Error(pruefung.meldung);
    const zeilen = await duckdbJsonAusfuehren(cfg, `DESCRIBE FROM ${sqlText(name)}`);
    return { uri, mimeType: "application/json", text: JSON.stringify(zeilen, null, 2) };
  }
  if (uri.startsWith("crm://abfrage/")) {
    const name = uri.slice("crm://abfrage/".length);
    const text = await leseAbfrageDatei(cfg, name);
    return { uri, mimeType: "text/x-sql", text };
  }
  throw new Error(`Unbekannte Ressourcen-URI: ${uri}. crm://daten/<datei> oder crm://abfrage/<datei>.`);
}

// ------------------------------------------------------------------- Kontext

// Der Kontext ist die eine Schnittstelle, die MCP, ACP, Server und CLI
// gemeinsam benutzen: Tresor-Konfiguration plus Werkzeug-/Ressourcen-Zugriff.
function erstelleKontext(cfg) {
  return {
    cfg,
    werkzeuge: () => crmWerkzeugeAlle(),
    ressourcen: () => ressourcenLaden(cfg),
    ressourceLesen: (uri) => ressourceLesen(cfg, uri),
  };
}

module.exports = { crmWerkzeugeAlle, ressourcenLaden, ressourceLesen, erstelleKontext };
