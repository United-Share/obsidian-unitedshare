# Integration von workspace-sync, ordner-sync und key-pruefung in main.src.js

Stand 2026-11-17 nach Gate-Runde zwei (Bloecke T, P, Q, Z, D eingearbeitet).
Die Module tragen 94 Vertraege in drei Testdateien; die E2E-Pruefung gegen
das echte Gateway wurde am 2026-11-17 MANUELL von netcup aus durchgefuehrt
(schreiben, listen, zuruecklesen mit identischem Inhalt). Verdrahtet wird
NACH der Freigabe und nachdem der fremde Stand von main.src.js und
scripts/bundle.mjs committet oder verworfen wurde.

## Hook 0, Bundler (Pflicht vor allem anderen)

Drei neue Needles: workspace-sync.js, ordner-sync.js, key-pruefung.js.
Modulgraph: key-pruefung haengt an nichts, workspace-sync und ordner-sync
haengen NUR an key-pruefung; keines der drei requirt den Core oder die
Transportschicht. Beim Inlining gilt: KEIN eingebettetes Modul darf einen
Top-Level-Namen aus dem Core oder einem Geschwistermodul erneut
deklarieren (ein Meta-Test sichert utf8ByteLength, MAX_OBJEKT_BYTES und
chatKennung); bundle.mjs soll kuenftig doppelte Top-Level-Bindings
generisch pruefen, das ist eine Pflicht fuer den fremden Bundler-Stand.

## Transportvertrag (T1, T3, K4)

transportBauen({settings, fetchImpl, timeoutMs, erlaubeLoopback}) ist der
EINZIGE Weg zu einem Transport-Kontext: es prueft Basis (Pinning auf
https://api.unitedshare.ai) und apiKey, versieht jeden Request mit Frist
(AbortController plus Race) und liefert ein eingefrorenes, out-of-band
registriertes ctx oder null. objektSchreiben, objektLesen und
objekteListen lehnen alles andere mit grund ungeprueft ab.

fetchImpl-Vertrag: requestUrlAsFetch() MIT Klammern (Fabrik). Signatur
(url, init) nach {status, headers, text(), json()}; headers darf ein
Headers-Objekt mit get ODER ein plain Record sein (case-insensitiv), und
init.signal MUSS unterstuetzt werden (Anpassung in requestUrlAsFetch ist
Teil von Hook 1, erst nach Freigabe des fremden Stands). Die eigenen
Gateway-Endpunkte setzen Content-Length immer; ein fehlender oder
nicht-dezimaler Header wird deshalb als feindlich abgelehnt. Ein echter
Streaming-Abbruch grosser Antworten braucht Transportunterstuetzung
(requestUrl puffert nativ) und bleibt bewusste Grenze.

## Hook 1, Chat-Spiegel (Zuschnitt A)

Im Speicherpfad der Gespraeche, nach erfolgreichem chatSpeichern, in
try/catch (die Spiegelung darf das lokale Speichern NIE mitreissen):

    const wsync = require("./workspace-sync");
    try {
      await wsync.chatSpiegeln(
        {
          settings: this.settings,
          fetchImpl: requestUrlAsFetch(),
          chatAlsText,
          kennungFn: chatKennung,
          status: (t) => this.setStatusBarText(t),
          protokoll: (n) => debugLogSchreiben(adapter, n),
        },
        eintrag,
        this.workspaceSyncZustand
      );
    } catch (_fehler) {
      // Spiegel-Fehler sind protokolliert, das Chat-Speichern bleibt heil.
    }

kennungFn: beim Bundeln wird die Core-Funktion chatKennung angebunden;
ohne sie gilt der gleichwertige lokale Standard aus workspace-sync.

Ergebnis-Union von chatSpiegeln und erwartete Reaktion:
- leer: nichts tun (leere Chats werden nie gespiegelt)
- kein-schluessel: Statusleiste zeigt den Hinweis, kein Fehler
- keine-basis: Statusleiste, Settings pruefen lassen
- verworfen: protokolliert (endgueltige Ablehnung, unmessbarer Body,
  Chat zu gross fuer die Warteschlange, Key nicht baubar); nicht erneut
  versuchen
- aufgeschoben: Warteschlange gefuellt, saveData aufrufen
- laeuft-bereits: nichts tun, ein Lauf ist aktiv
- gespiegelt: optional saveData (Warteschlange kann sich geleert haben)

Zustandsbesitz: this.workspaceSyncZustand ist { warteschlange: [] },
geladen mit loadData, nach JEDEM Lauf saveData. laufend-Zustaende gehoeren
NICHT in saveData; die Locks leben in WeakSets der Module und sind nach
jedem Neustart frei.

## Hook 2, Wiederherstellen (Zuschnitt A)

Befehl "UnitedShare: Chats aus dem Workspace wiederherstellen":

    const ctx = wsync.transportBauen({ settings: this.settings, fetchImpl: requestUrlAsFetch() });
    if (!ctx) return; // Statusleiste: Settings pruefen
    const listing = await wsync.objekteListen(ctx, wsync.CHATS_PRAEFIX);
    // listing.vollstaendig === false dem Nutzer anzeigen: aeltere Chats
    // koennen fehlen (Gateway liefert hoechstens die letzten 50 Objekte).
    for (const key of wsync.wiederherstellbareChats(listing.items)) { ... }

Es gelten dieselben Regeln wie Hook 3: NUR lokal fehlende Chats anlegen,
IMMER exklusiv (vault.create wirft bei Existenz). Der lokale Dateiname
wird NIEMALS aus dem Remote-Key abgeleitet, sondern aus dem Inhalt
(chatDateiname aus erstellt plus chatKennung). wiederherstellbareChats
akzeptiert nur json-Keys.

## Hook 3, Ordner-Sync (Zuschnitt B)

Setting secondBrainOrdner (leer = aus), Befehl plus Spiegelung beim
Speichern, beide in try/catch. Reihenfolge IMMER erst Pull mit
Konfliktbehandlung, dann Push:

1. laufStarten(zustand); bei false sofort zurueck; laufBeenden im finally.
2. Pull: objekteListen mit NOTES_PRAEFIX; je Key objektLesen;
   eingehendeNotiz entscheidet. existiert ist Pflicht und DATEISYSTEMTREU
   (adapter.exists; auf APFS und NTFS case-insensitiv, genau darauf
   verlaesst sich der Vertrag). anlegen nur fuer nachweislich Fehlendes;
   Widersprueche, Unlesbares und werfendes existiert ergeben die
   Konfliktkopie; bestaetigungErforderlich macht die Nachfrage Pflicht;
   requireWriteConfirm greift zusaetzlich. O-EXCL fuer JEDES Anlegen.
   Beim Pull je gelesenem Objekt den Inhalt hashen und als
   remoteStand[pfad] = {size, hash} festhalten: das ist die Grundlage des
   Push-Schutzes (P2). Ohne Hash vergleicht der Plan nur Groessen, und
   groessengleiche Fremdaenderungen sieht er nicht; das ist eine
   DOKUMENTIERTE LUECKE, bis das Gateway ETags liefert.
3. Push: planeOrdnerSync({dateien, index, entfernt, remoteStand,
   listingVollstaendig: listing.vollstaendig}). Das Flag MUSS explizit
   durchgereicht werden; der Modul-Default ist false (sicher). Bei
   unvollstaendigem Listing laufen Uploads nur fuer gelistete Pfade, der
   Rest geht nach remoteAbweichung, die Loesch-Auswertung entfaellt, und
   der Nutzer bekommt eine Statusmeldung. Cursor-Paginierung im Gateway
   ist die BLOCKIERENDE Voraussetzung fuer Ordner-Sync jenseits von 50
   Objekten. plan.remoteAbweichung fuehrt in den Konfliktpfad von Schritt
   2, plan.hochladen per objektSchreiben, indexNachSync persistieren.
4. saveData: warteschlange, index und remoteStand nach jedem Lauf; der
   Umfang waechst mit dem Ordner, deshalb gehoeren index und remoteStand
   in eine eigene Datei unter .vault statt in data.json (D6).

Skalierung (D6, Integrationspflichten): mtime-plus-groesse-Vorfilter vor
dem Hashen, Upload-Parallelitaet drei bis vier, Fortschritt und Abbruch
ueber das Schritt-Muster aus main.src.js.

## Protokoll (V3, D3, D4)

Nutzlast {zeit, status, meldung, body}; body ist Tag, Stunde und Kennung,
NIE der Titel-Slug und nie der volle Pfad (Chat-Titel gehoeren nicht ins
debug.log). Aufrufe sind gegen Wuerfe und Promise-Fehler gekapselt.
meldung-Werte: zu-gross, zu-gross-fuer-warteschlange, ungueltiger-pfad,
ungueltige-groesse, ungueltiger-hash, ungueltiger-key, unmessbar,
unlesbar, geloescht-ignoriert, remote-abweichung, listing-unvollstaendig,
endgueltig-abgelehnt, verdraengt, veraltet-verworfen, aufgegeben,
aufgeschoben, gedeckelt. Alle Plan-Gruende sind protokollpflichtig.

## Einschraenkungen des Second-Brain-Zuschnitts (bewusste Produktentscheidung)

Nur .md und .canvas werden gesynct; Chats nur .json. Leere Chats werden
nicht gespiegelt. Dot-Segmente, Geraetenamen, Doppelpunkte, Backslashes,
Steuer- und Formatzeichen, Variation Selectors, Mark-Spielereien,
NFKC-Doppelgaenger, Prozentzeichen und Windows-Sonderzeichen sind
gesperrt; Segmente maximal 255 UTF-8-Bytes, Objekte maximal 16 MB,
Loeschungen werden nicht propagiert. Die Prozent-Sperre heisst konkret:
eine Notiz "100% Plan.md" wird nicht gesynct; die Statusmeldung dafuer
soll das Zeichen benennen ("Prozentzeichen im Dateinamen werden nicht
synchronisiert"), nicht nur "ungueltiger Pfad".

## Sicherheitsrahmen, von den Modulen erzwungen

Kein Request ohne gueltigen Key und gepinnte Basis; Transport-Kontexte
sind eingefroren und nur ueber transportBauen zu bekommen; Downloads
werden gegen Groesse, NUL-Bytes und feindliche Content-Length geprueft;
Listings sind auf 500 Items gedeckelt und ab 50 als unvollstaendig
markiert; die Warteschlange dedupliziert pro Key, nimmt keine Riesen an
und verdraengt zuerst den groessten Eintrag; lokale Dateien werden nie
stillschweigend ueberschrieben.
