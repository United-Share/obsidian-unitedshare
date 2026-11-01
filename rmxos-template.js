"use strict";

// Erst nach dem Parsen ersetzen: Eigenschaften sind Daten, kein FluentScript.
//
// Eigenschaften duerfen auf andere Eigenschaften verweisen. Beispiel:
//   name: Mike
//   surname: Baumgart
//   owner: "{{$name}} {{$surname}}"
// Dann loest "{{$owner}}" spaeter "Mike Baumgart" auf -- auch innerhalb des
// Codeblocks. Die Aufloesung ist rekursiv, aber begrenzt: Zyklen
// (a -> b -> a) und zu tiefe Ketten fallen sichtbar auf den Platzhalter
// zurueck, statt still zu verschwinden oder endlos zu laufen.
const MAX_TIEFE = 8;

function istEinfach(value) {
  return (
    typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  );
}

function rmxosEigenschaftenErsetzen(ketten, frontmatter) {
  const eigenschaften = frontmatter && typeof frontmatter === "object" ? frontmatter : {};

  // Loest den Platzhaltertext eines Frontmatter-Werts auf, mit Schutz vor
  // Zyklen und vor zu tiefer Verschachtelung. `gesehen` traegt die bereits
  // betretenen Eigenschaftsnamen; `tiefe` zaehlt die Stufen.
  const loese = (name, gesehen, tiefe) => {
    if (!Object.hasOwn(eigenschaften, name)) return null;
    if (gesehen.has(name)) return null;
    if (tiefe >= MAX_TIEFE) return null;
    const value = eigenschaften[name];
    if (typeof value === "string") {
      const naechste = new Set(gesehen);
      naechste.add(name);
      return value.replace(/\{\{\$\s*([^{}]+?)\s*\}\}/gu, (original, inner) => {
        const inName = inner.trim();
        const aufgeloest = loese(inName, naechste, tiefe + 1);
        return aufgeloest === null ? original : aufgeloest;
      });
    }
    if (istEinfach(value)) return String(value);
    // null, Arrays, Objekte: komplexe oder fehlende Werte bleiben sichtbar.
    return null;
  };

  const ersetze = (wert) => {
    if (typeof wert !== "string") return wert;
    return wert.replace(/\{\{\$\s*([^{}]+?)\s*\}\}/gu, (original, name) => {
      const key = name.trim();
      const aufgeloest = loese(key, new Set(), 0);
      return aufgeloest === null ? original : aufgeloest;
    });
  };

  return ketten.map((kette) => ({
    ...kette,
    id: ersetze(kette.id),
    aufrufe: kette.aufrufe.map((aufruf) => ({
      ...aufruf,
      args: aufruf.args.map(ersetze),
      benannt: Object.fromEntries(Object.entries(aufruf.benannt).map(([name, wert]) => [name, ersetze(wert)])),
    })),
  }));
}

module.exports = { rmxosEigenschaftenErsetzen };
