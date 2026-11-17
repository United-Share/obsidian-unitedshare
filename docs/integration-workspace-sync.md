# Integration von workspace-sync, ordner-sync und key-pruefung in main.src.js

Stand 2026-11-17, nach der ersten Gate-Runde (Bloecke S, K, V eingearbeitet).
Die Module sind vollstaendig getestet (70 Vertraege in workspace-sync,
ordner-sync und key-pruefung; die E2E-Pruefung gegen das echte Gateway wurde
am 2026-11-17 MANUELL von netcup aus durchgefuehrt: schreiben, listen,
zuruecklesen mit identischem Inhalt). Sie sind bewusst NICHT in main.src.js
verdrahtet: der Arbeitsbaum traegt fremde, uncommittete Aenderungen an
main.src.js und scripts/bundle.mjs; jede Verdrahtung haette diese
Aenderungen mitcommittet oder beim Bundeln ueberschrieben. Die Verdrahtung
ist ein eigener, kleiner Schritt NACH dem Review und nachdem der fremde
Stand committet oder verworfen wurde.

## Hook 0, Bundler (Pflicht vor allem anderen)

scripts/bundle.mjs muss drei neue Needles aufnehmen: workspace-sync.js,
ordner-sync.js und key-pruefung.js, damit sie in main.js eingebettet
werden. Die Eigenstaendigkeitspruefung des Bundlers ist um die drei Module
zu erweitern. Modulabhaengigkeiten: key-pruefung haengt an nichts,
workspace-sync haengt nur an key-pruefung, ordner-sync haengt an
key-pruefung und unitedshare-core (UnitedShareError); ordner-sync hat
KEINEN require auf workspace-sync, den Transport macht der Aufrufer.

## Hook 1, Chat-Spiegel (Zuschnitt A)

Im Speicherpfad der Gespraeche, direkt nach dem erfolgreichen
chatSpeichern-Aufruf, in try/catch (die Spiegelung darf das lokale
Chat-Speichern NIE mitreissen):

    const wsync = require("./workspace-sync");
    try {
      await wsync.chatSpiegeln(
        {
          settings: this.settings,
          fetchImpl: requestUrlAsFetch(),
          chatAlsText,
          status: (t) => this.setStatusBarText(t),
          protokoll: (n) => debugLogSchreiben(adapter, n),
        },
        eintrag,
        this.workspaceSyncZustand
      );
    } catch (_fehler) {
      // Spiegel-Fehler sind protokolliert, das Chat-Speichern bleibt heil.
    }

fetchImpl-Vertrag: requestUrlAsFetch() MIT Klammern (es ist eine Fabrik,
die die fetch-artige Funktion zurueckgibt). Die Signatur ist
(url, init) nach {status, headers.get, text(), json()}; init.signal MUSS
unterstuetzt werden, weil workspace-sync jede Anfrage mit AbortController
und Frist versieht (die Anpassung in requestUrlAsFetch ist Teil dieses
Hooks und erst nach Freigabe des fremden Stands moeglich).

Zustandsbesitz: this.workspaceSyncZustand ist { warteschlange: [] }, wird
mit loadData geladen und nach JEDEM Lauf mit saveData gespeichert (die
Warteschlange ueberlebt sonst keinen Neustart).

## Hook 2, Wiederherstellen (Zuschnitt A)

Command-Palette-Befehl "UnitedShare: Chats aus dem Workspace
wiederherstellen": objekteListen mit CHATS_PRAEFIX,
wiederherstellbareChats (filtert feindliche Keys bereits aus), je Key
objektLesen und ueber den bestehenden Chat-Lade-Pfad in .vault/chats
ablegen. Es gelten dieselben Regeln wie fuer Hook 3: NUR Keys anlegen,
die lokal fehlen, und IMMER mit exklusivem Anlegen schreiben. Der lokale
Dateiname wird NIEMALS aus dem Remote-Key abgeleitet, sondern aus dem
Inhalt (eintrag.erstellt plus chatKennung(eintrag.id), also
chatDateiname aus unitedshare-core).

Listing-Vertrag (bekannte Grenze): objekteListen liefert {status, items,
vollstaendig}. Das heutige Gateway liefert hoechstens die letzten 50
Objekte (serverseitiges items.slice(-50)); bei vollstaendig: false dem
Nutzer anzeigen, dass aeltere Chats fehlen koennen. Cursor-Paginierung
ist ein Gateway-Folgethema, nicht Sache des Plugins. Ein echter
Streaming-Abbruch grosser Antworten braucht Transportunterstuetzung
(Obsidians requestUrl puffert nativ, kein ReadableStream); der Schutz
ist Vorab-Header-Pruefung plus Nachmessung und bleibt als bewusste
Transportgrenze notiert.

## Hook 3, Ordner-Sync (Zuschnitt B)

Setting secondBrainOrdner (leer = aus). Befehl "UnitedShare:
Second-Brain-Ordner synchronisieren" plus Spiegelung beim
Datei-Speichern im gewaehlten Ordner, beide in try/catch.

Reihenfolge ist IMMER erst Pull mit Konfliktbehandlung, dann Push:

1. laufStarten(zustand); bei false sofort zurueck (ein Lauf laeuft
   schon). Am Ende laufBeenden(zustand) im finally.
2. Pull: objekteListen mit NOTES_PRAEFIX, je Key objektLesen,
   eingehendeNotiz entscheiden lassen. existiert ist Pflicht und muss
   den echten Dateisystem-Stand pruefen (adapter.exists); die Module
   befragen zusaetzlich die Kleinschreibvariante (APFS/NTFS sind
   case-insensitiv). "anlegen" kommt nur fuer nachweislich fehlende
   Dateien zurueck; Widersprueche, unlesbare Dateien und werfendes
   existiert ergeben die Konfliktkopie. Konflikt-Ergebnisse tragen
   bestaetigungErforderlich: true, wenn die Namenssuche unbestaetigt
   blieb oder die Suchgrenze (100 Kandidaten) erschoepft war; dann ist
   die Nutzer-Nachfrage Pflicht. requireWriteConfirm greift zusaetzlich.
   O-EXCL-Pflicht: JEDES Anlegen (aktion anlegen UND Konfliktkopien)
   laeuft ueber vault.create, das bei Existenz wirft; wirft es, den
   naechsten Kandidaten versuchen oder den Nutzer fragen. Niemals
   Ueberschreib-Write.
3. Danach remoteStand festhalten: je Pfad die gesehene Groesse aus dem
   Listing (Grundlage des Push-Schutzes).
4. Push: lokalen Stand einsammeln (Pfad relativ zum Ordner, SHA256 des
   Inhalts, Groesse), planeOrdnerSync({dateien, index, entfernt,
   remoteStand}) aufrufen. plan.hochladen per objektSchreiben
   uebertragen, indexNachSync persistieren. plan.remoteAbweichung NICHT
   hochladen, sondern in den Konfliktpfad von Schritt 2 geben (die
   Remote-Fassung hat sich seit dem letzten gesehenen Stand geaendert).
5. saveData: Zustand (warteschlange, index, remoteStand) nach jedem
   Lauf speichern.

Protokollpflicht: ALLE Gruende werden ueber das debugLogSchreiben-Muster
protokolliert, mit der Nutzlast {zeit, status, meldung, body} (body ist
der Basename, nie der volle Pfad). Festgelegte meldung-Werte:
"zu-gross", "ungueltiger-pfad", "ungueltige-groesse", "ungueltiger-hash",
"geloescht-ignoriert", "remote-abweichung", "endgueltig-abgelehnt",
"verdraengt", "veraltet-verworfen", "aufgegeben", "aufgeschoben",
"gedeckelt". Protokoll-Aufrufe sind gegen Wuerfe gekapselt und duerfen
den Sync nie anhalten.

## Einschraenkungen des Second-Brain-Zuschnitts (bewusste Produktentscheidung)

Synchronisiert werden ausschliesslich Dateien mit den Endungen .md und
.canvas. Dot-Segmente (insbesondere .obsidian) sind gesperrt, ebenso
Windows-Geraetenamen, Doppelpunkte, Backslashes, unsichtbare
Formatzeichen, NFKC-Doppelgaenger pfadbedeutsamer Zeichen und Pfade
ausserhalb des gewaehlten Ordners. Segmente sind auf 255 UTF-8-Bytes
gedeckelt. Anhaenge (PDF, Bilder) sind kein Teil von Zuschnitt B.
Loeschungen werden nicht propagiert. Objekte sind auf 16 MB begrenzt.

## Sicherheitsrahmen, von den Modulen erzwungen

Ohne gueltigen apiKey (usk-Alphabet nach Trimmen) kein einziger Request.
Die Basis ist auf https://api.unitedshare.ai gepinnt (Loopback nur
numerisch und nur mit expliziter Freischaltung durch Tests); jede andere
Basis waere ein Exfiltrationsvektor. Es gibt keine S3-Credentials im
Plugin. Downloads werden gegen Groesse, NUL-Bytes und feindliche
Content-Length-Header geprueft, Listings auf 500 Items gedeckelt.
Lokale Dateien werden nie stillschweigend ueberschrieben.
