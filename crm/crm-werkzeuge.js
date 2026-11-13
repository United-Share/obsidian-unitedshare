"use strict";

// Die CRM-Daten-Werkzeuge: jede Funktion beantwortet eine konkrete
// CRM-Frage aus einer Parquet-Tabelle im Tresor. Alle Abfragen sind lesend,
// parameterisiert ueber `datei` (tresor-relativ) und `limit`. Der SQL-Text
// jedes Aufrufs liegt im Ergebnis — der Agent (und der Mensch) sehen genau,
// was gerechnet wurde.

const {
  STANDARD_DATEI, LIMIT_MAXIMAL, inGrenzen,
  sichererParquetName, sqlText, ausfuehrenBegrenzt, duckdbJsonAusfuehren,
} = require("./crm-core");

function dateiAus(args) {
  const pruefung = sichererParquetName(args?.datei ?? STANDARD_DATEI);
  if (!pruefung.ok) throw new Error(pruefung.meldung);
  return pruefung.name;
}

function limitAus(args, kontext) {
  return inGrenzen(args?.limit, 1, LIMIT_MAXIMAL, kontext.cfg.limit);
}

const FUELLSTAND_FELDER = ["Rufnummer", "Vorname", "Nachname", "Ort", "Plz", "Geburtsdatum", '"Gueltig bis"'];

function fuellstandSpalten() {
  return FUELLSTAND_FELDER.map((spalte) => {
    const kuerzel = spalte.startsWith('"')
      ? spalte.slice(1, -1).toLowerCase().replace(/\s+/g, "_")
      : spalte.toLowerCase();
    return `  ROUND(100.0 * SUM(CASE WHEN ${spalte} IS NULL OR TRIM(${spalte}) = '' THEN 1 ELSE 0 END) / COUNT(*), 1) AS ohne_${kuerzel}_pct,`;
  }).join("\n");
}

function crmWerkzeuge() {
  return [
    {
      name: "crm_dateien",
      titel: "Parquet-Dateien im Tresor",
      beschreibung: "Listet alle .parquet-Dateien im Tresor mit Zeilenzahl. Erster Anlaufpunkt, wenn die Tabelle unbekannt ist.",
      eingabeSchema: { type: "object", properties: {}, additionalProperties: false },
      ausfuehren: async (_args, kontext) => {
        const daten = [];
        for (const name of await require("./crm-core").parquetDateienImVault(kontext.cfg)) {
          const zeilen = await duckdbJsonAusfuehren(kontext.cfg, `SELECT COUNT(*) AS saetze FROM ${sqlText(name)}`);
          daten.push({ datei: name, saetze: Number(zeilen[0]?.saetze ?? 0) });
        }
        return { daten, zeilen: daten.length, ingesamt: daten.length, abgeschnitten: false };
      },
    },
    {
      name: "crm_schema",
      titel: "Tabellenschema",
      beschreibung: "Zeigt Spalten und Typen einer Parquet-Datei (DESCRIBE).",
      eingabeSchema: {
        type: "object",
        properties: { datei: { type: "string", description: "tresor-relativer .parquet-Name, z. B. adressen.parquet" } },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const datei = dateiAus(args);
        const daten = await duckdbJsonAusfuehren(kontext.cfg, `DESCRIBE FROM ${sqlText(datei)}`);
        return { daten, zeilen: daten.length, ingesamt: daten.length, abgeschnitten: false, datei };
      },
    },
    {
      name: "crm_uebersicht",
      titel: "CRM-Kennzahlen gesamt",
      beschreibung: "Datensaetze, verschiedene Rufnummern, Userchoice-Abdeckung, Dubletten- und Besteller-Zeilen.",
      eingabeSchema: {
        type: "object",
        properties: { datei: { type: "string", description: "tresor-relativer .parquet-Name" } },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const T = sqlText(dateiAus(args));
        const abfrage = `WITH crm AS (
  SELECT COUNT(*) AS datensaetze,
    COUNT(DISTINCT CASE WHEN Rufnummer IS NOT NULL AND TRIM(Rufnummer) <> '' THEN Rufnummer END) AS verschiedene_rufnummern
  FROM ${T}
), kontakt AS (
  SELECT
    SUM(CASE WHEN Telefon_Rufnummer IS NOT NULL THEN 1 ELSE 0 END) AS rufnummer_als_zahl,
    SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) AS mit_email,
    SUM(CASE WHEN Userchoice IS NOT NULL AND TRIM(Userchoice) <> '' THEN 1 ELSE 0 END) AS mit_userchoice
  FROM ${T}
), markierung AS (
  SELECT
    SUM(CASE WHEN ist_dublette THEN 1 ELSE 0 END) AS zeilen_als_dublette,
    SUM(CASE WHEN ist_besteller THEN 1 ELSE 0 END) AS zeilen_besteller
  FROM ${T}
)
SELECT * FROM crm CROSS JOIN kontakt CROSS JOIN markierung`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_fuellstand",
      titel: "Vollstaendigkeit je Kernfeld",
      beschreibung: "Anteil fehlender Werte (in %) fuer Rufnummer, Vorname, Nachname, Ort, Plz, Geburtsdatum, Gueltig bis.",
      eingabeSchema: {
        type: "object",
        properties: { datei: { type: "string", description: "tresor-relativer .parquet-Name" } },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const T = sqlText(dateiAus(args));
        const abfrage = `SELECT
  COUNT(*) AS datensaetze,
${fuellstandSpalten()}
FROM ${T}`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_suchen",
      titel: "Adressen suchen",
      beschreibung: "Sucht Text in Vorname, Nachname, Ort, Rufnummer, Strasse und Plz (Teilstring, Gross-/Kleinschreibung egal).",
      eingabeSchema: {
        type: "object",
        properties: {
          suchtext: { type: "string", description: "Gesuchter Text, z. B. 'Dortmund' oder '0231'" },
          datei: { type: "string", description: "tresor-relativer .parquet-Name" },
          limit: { type: "integer", description: "hoechstens so viele Zeilen (Standard 100, maximal 1000)" },
        },
        required: ["suchtext"],
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const suchtext = String(args?.suchtext ?? "").trim();
        if (!suchtext) {
          throw new Error("Der Parameter suchtext fehlt — gesucht wird in Vorname, Nachname, Ort, Rufnummer, Strasse und Plz.");
        }
        const T = sqlText(dateiAus(args));
        const nadel = sqlText(suchtext);
        const abfrage = `SELECT Anrede, Vorname, Nachname, Strasse, Plz, Ort, Rufnummer, Geburtsdatum, Werbequelle, ist_besteller
FROM ${T}
WHERE contains(lower(COALESCE(Vorname, '')), lower(${nadel}))
   OR contains(lower(COALESCE(Nachname, '')), lower(${nadel}))
   OR contains(lower(COALESCE(Ort, '')), lower(${nadel}))
   OR contains(lower(COALESCE(Rufnummer, '')), lower(${nadel}))
   OR contains(lower(COALESCE(Strasse, '')), lower(${nadel}))
   OR contains(lower(COALESCE(Plz, '')), lower(${nadel}))
ORDER BY Nachname, Vorname`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_geburtsmonat",
      titel: "Geburtstage im Monat",
      beschreibung: "Geburtstage eines Monats (Standard: laufender Monat) — fuer Mailings und Glueckwuensche.",
      eingabeSchema: {
        type: "object",
        properties: {
          monat: { type: "integer", minimum: 1, maximum: 12, description: "Monat 1-12, ohne Angabe der laufende Monat" },
          datei: { type: "string", description: "tresor-relativer .parquet-Name" },
          limit: { type: "integer", description: "hoechstens so viele Zeilen" },
        },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        let monat;
        if (args?.monat === undefined || args.monat === null) {
          monat = "EXTRACT(month FROM CURRENT_DATE)";
        } else {
          const z = Number(args.monat);
          if (!Number.isInteger(z) || z < 1 || z > 12) {
            throw new Error(`monat ist eine Zahl von 1 bis 12 — erhalten: ${JSON.stringify(args.monat)}`);
          }
          monat = String(z);
        }
        const T = sqlText(dateiAus(args));
        const abfrage = `WITH geb AS (
  SELECT Vorname, Nachname, Rufnummer, Ort, Werbequelle,
    TRY_CAST(Geburtsdatum AS DATE) AS geburtsdatum
  FROM ${T}
  WHERE TRY_CAST(Geburtsdatum AS DATE) IS NOT NULL
)
SELECT Vorname, Nachname, Rufnummer, Ort, Werbequelle,
  CAST(geburtsdatum AS VARCHAR) AS geburtsdatum, EXTRACT(day FROM geburtsdatum) AS tag
FROM geb
WHERE EXTRACT(month FROM geburtsdatum) = ${monat}
ORDER BY tag, Nachname, Vorname`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_faelligkeiten",
      titel: "Zulassungen nach Gueltig bis",
      beschreibung: "Liste nach Gueltig bis (Format TT.MM.JJJJ oder ISO). Standard: nur abgelaufene; mit nurAbgelaufen:false alle.",
      eingabeSchema: {
        type: "object",
        properties: {
          nurAbgelaufen: { type: "boolean", default: true, description: "true: nur abgelaufene, false: alle lesbaren" },
          datei: { type: "string", description: "tresor-relativer .parquet-Name" },
          limit: { type: "integer", description: "hoechstens so viele Zeilen" },
        },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const nurAbgelaufen = args?.nurAbgelaufen === undefined ? true : Boolean(args.nurAbgelaufen);
        const einschraenkung = nurAbgelaufen ? "\n  AND gueltig_bis < CURRENT_DATE" : "";
        const T = sqlText(dateiAus(args));
        const abfrage = `WITH ende AS (
  SELECT Vorname, Nachname, Rufnummer, Ort, Werbequelle,
    TRY_STRPTIME("Gueltig bis", ['%d.%m.%Y', '%Y-%m-%d'])::DATE AS gueltig_bis
  FROM ${T}
  WHERE "Gueltig bis" IS NOT NULL AND TRIM("Gueltig bis") <> ''
)
SELECT Vorname, Nachname, Rufnummer, Ort, Werbequelle,
  CAST(gueltig_bis AS VARCHAR) AS gueltig_bis
FROM ende
WHERE gueltig_bis IS NOT NULL${einschraenkung}
ORDER BY gueltig_bis`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_faelligkeiten_zusammenfassung",
      titel: "Faelligkeiten-Zaehlung",
      beschreibung: "Anzahl abgelaufen / laeuft in 30 Tagen ab / spaeter gueltig / nicht lesbar (ehrlich: nicht stille Ausfaelle).",
      eingabeSchema: {
        type: "object",
        properties: { datei: { type: "string", description: "tresor-relativer .parquet-Name" } },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const T = sqlText(dateiAus(args));
        const abfrage = `WITH ende AS (
  SELECT TRY_STRPTIME("Gueltig bis", ['%d.%m.%Y', '%Y-%m-%d'])::DATE AS gueltig_bis
  FROM ${T}
  WHERE "Gueltig bis" IS NOT NULL AND TRIM("Gueltig bis") <> ''
)
SELECT
  SUM(CASE WHEN gueltig_bis IS NOT NULL AND gueltig_bis < CURRENT_DATE THEN 1 ELSE 0 END) AS abgelaufen,
  SUM(CASE WHEN gueltig_bis IS NOT NULL AND gueltig_bis >= CURRENT_DATE AND gueltig_bis <= CURRENT_DATE + 30 THEN 1 ELSE 0 END) AS laeuft_bald_ab,
  SUM(CASE WHEN gueltig_bis IS NOT NULL AND gueltig_bis > CURRENT_DATE + 30 THEN 1 ELSE 0 END) AS weitere_gueltig,
  SUM(CASE WHEN gueltig_bis IS NULL THEN 1 ELSE 0 END) AS nicht_lesbar
FROM ende`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_dubletten",
      titel: "Dubletten ueber Rufnummern",
      beschreibung: "Rufnummern, auf denen mehrere Zeilen sitzen, plus schon als Dublette markierte Zeilen.",
      eingabeSchema: {
        type: "object",
        properties: { datei: { type: "string", description: "tresor-relativer .parquet-Name" } },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const T = sqlText(dateiAus(args));
        const abfrage = `WITH nutzung AS (
  SELECT Rufnummer, COUNT(*) AS zeilen_mit_dieser_rufnummer
  FROM ${T}
  WHERE Rufnummer IS NOT NULL AND TRIM(Rufnummer) <> ''
  GROUP BY Rufnummer
  HAVING COUNT(*) > 1
), mehrfach AS (
  SELECT COUNT(*) AS mehrere_eintraege_rufnummern,
    SUM(zeilen_mit_dieser_rufnummer) AS zeilen_auf_diesen_rufnummern
  FROM nutzung
), markiert AS (
  SELECT SUM(CASE WHEN ist_dublette THEN 1 ELSE 0 END) AS schon_markierte_dubletten
  FROM ${T}
)
SELECT * FROM mehrfach CROSS JOIN markiert`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_werbequellen",
      titel: "Werbequellen-Verteilung",
      beschreibung: "Datensaetze je Werbequelle, absteigend.",
      eingabeSchema: {
        type: "object",
        properties: {
          datei: { type: "string", description: "tresor-relativer .parquet-Name" },
          limit: { type: "integer", description: "hoechstens so viele Gruppen" },
        },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const T = sqlText(dateiAus(args));
        const abfrage = `SELECT Werbequelle, COUNT(*) AS datensaetze
FROM ${T}
WHERE Werbequelle IS NOT NULL AND TRIM(Werbequelle) <> ''
GROUP BY Werbequelle
ORDER BY datensaetze DESC`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_regionen",
      titel: "Orte-Verteilung",
      beschreibung: "Die Orte mit den meisten Datensaetzen, absteigend.",
      eingabeSchema: {
        type: "object",
        properties: {
          datei: { type: "string", description: "tresor-relativer .parquet-Name" },
          limit: { type: "integer", description: "hoechstens so viele Orte" },
        },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const T = sqlText(dateiAus(args));
        const abfrage = `SELECT Ort, COUNT(*) AS datensaetze
FROM ${T}
WHERE Ort IS NOT NULL AND TRIM(Ort) <> ''
GROUP BY Ort
ORDER BY datensaetze DESC`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
    {
      name: "crm_altersgruppen",
      titel: "Altersverteilung",
      beschreibung: "Datensaetze je Altersreihe (die Spalte alter ist vorgerechnet).",
      eingabeSchema: {
        type: "object",
        properties: { datei: { type: "string", description: "tresor-relativer .parquet-Name" } },
        additionalProperties: false,
      },
      ausfuehren: async (args, kontext) => {
        const T = sqlText(dateiAus(args));
        const abfrage = `WITH altersgruppen AS (
  SELECT CASE
    WHEN "alter" IS NULL THEN 'unbekannt'
    WHEN "alter" < 20 THEN 'unter 20'
    WHEN "alter" BETWEEN 20 AND 29 THEN '20-29'
    WHEN "alter" BETWEEN 30 AND 39 THEN '30-39'
    WHEN "alter" BETWEEN 40 AND 49 THEN '40-49'
    WHEN "alter" BETWEEN 50 AND 59 THEN '50-59'
    WHEN "alter" BETWEEN 60 AND 69 THEN '60-69'
    ELSE '70 und aelter'
  END AS altersreihe
  FROM ${T}
)
SELECT altersreihe, COUNT(*) AS datensaetze
FROM altersgruppen
GROUP BY altersreihe
ORDER BY datensaetze DESC`;
        return { ...await ausfuehrenBegrenzt(kontext.cfg, abfrage, limitAus(args, kontext)), sql: abfrage };
      },
    },
  ];
}

module.exports = { crmWerkzeuge, dateiAus, limitAus };
