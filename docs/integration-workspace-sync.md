# Integration von workspace-sync und ordner-sync in main.src.js

Stand 2026-11-17. Die beiden Module sind vollstaendig getestet (15 Vertraege,
E2E gegen das echte Gateway gruen), aber bewusst NICHT in main.src.js
verdrahtet: der Arbeitsbaum traegt fremde, uncommittete Aenderungen an
main.src.js und am Bundler (scripts/bundle.mjs). Jede Verdrahtung haette
diese Aenderungen mitcommittet oder beim Bundeln ueberschrieben. Die
Verdrahtung ist deshalb ein eigener, kleiner Schritt NACH dem Review und
nachdem der fremde Stand committet oder verworfen wurde.

Die drei Hooks, jeweils wenige Zeilen:

1. Chat-Spiegel (Zuschnitt A). Im Speicherpfad der Gespraeche, direkt nach
   dem erfolgreichen chatSpeichern-Aufruf:

       const wsync = require("./workspace-sync");
       await wsync.chatSpiegeln(
         {
           settings: this.settings,
           fetchImpl: requestUrlAsFetch,
           chatAlsText,
           status: (t) => this.setStatusBarText(t),
           protokoll: (e) => debugLogSchreiben(adapter, e),
         },
         eintrag,
         this.workspaceSyncZustand
       );

   this.workspaceSyncZustand ist { warteschlange: [] } und wird mit den
   Plugin-Daten geladen und gespeichert (persistiert die Nachholliste).

2. Wiederherstellen (Zuschnitt A). Neuer Befehl in der Command Palette
   "UnitedShare: Chats aus dem Workspace wiederherstellen": objekteListen
   mit CHATS_PRAEFIX, wiederherstellbareChats, je Key objektLesen und das
   Ergebnis ueber den bestehenden Chat-Lade-Pfad in .vault/chats ablegen
   (nur Keys, die lokal fehlen).

3. Ordner-Sync (Zuschnitt B). Neues Setting secondBrainOrdner (leer = aus)
   im Settings-Tab. Neuer Befehl "UnitedShare: Second-Brain-Ordner
   synchronisieren": lokalen Stand des Ordners einsammeln (Pfad, SHA256 des
   Inhalts, Groesse), planeOrdnerSync mit dem persistierten Hash-Index und
   dem Listing (objekteListen mit NOTES_PRAEFIX) aufrufen, Plan ausfuehren
   (objektSchreiben je hochladen-Eintrag, indexNachSync persistieren),
   eingehende Notizen ueber eingehendeNotiz behandeln; bei aktion konflikt
   und requireWriteConfirm greift das bestehende Bestaetigungs-Muster.
   Vertrag von eingehendeNotiz (fail-closed, additiv): existiert ist
   Pflicht und muss den echten Dateisystem-Stand pruefen (adapter.exists).
   "anlegen" kommt NUR zurueck, wenn existiert false liefert UND lokalText
   null oder undefined ist. Widerspruechliche Signale (existiert false,
   aber lokalText vorhanden; oder existiert true, aber lokalText fehlt)
   und ein werfendes existiert ergeben immer die Konfliktkopie. Der
   Relpfad wird intern auf NFC normalisiert, konsistent zu keyAusRelpfad.
   Konflikt-Ergebnisse tragen bestaetigungErforderlich: true, wenn die
   Namenssuche unbestaetigt blieb (werfende Probe) oder die Suchgrenze
   (100 Kandidaten) erschoepft war. Unabhaengig davon gilt: Der
   Schreibpfad legt Konfliktkopien IMMER exklusiv an (vault.create, das
   bei Existenz wirft; O_EXCL-Semantik), niemals per Ueberschreib-Write.
   Wirft das exklusive Anlegen, wird der naechste Kandidat versucht oder
   der Nutzer gefragt; bei bestaetigungErforderlich ist die Nachfrage
   Pflicht, requireWriteConfirm greift zusaetzlich.

Einschraenkungen des Second-Brain-Zuschnitts (bewusste Produktentscheidung):
Synchronisiert werden ausschliesslich Dateien mit den Endungen .md und
.canvas. Dot-Segmente (insbesondere .obsidian) sind gesperrt, ebenso
Windows-Geraetenamen, Doppelpunkte, Backslashes und Pfade ausserhalb des
gewaehlten Ordners. Anhaenge (PDF, Bilder) sind kein Teil von Zuschnitt B.
   Uebersprungene Dateien (zu-gross) und geloeschtIgnoriert in das
   fehler-protokoll schreiben.

Sicherheitsrahmen, von den Modulen erzwungen: ohne apiKey kein einziger
Request; der Key verlaesst das Geraet nur als Authorization-Header an die
konfigurierte baseUrl; es gibt keine S3-Credentials im Plugin; Loeschungen
werden nicht propagiert; lokale Dateien werden nie stillschweigend
ueberschrieben.
