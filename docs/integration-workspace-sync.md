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
   Vertrag von eingehendeNotiz (fail-closed): existiert ist Pflicht und
   muss den echten Dateisystem-Stand pruefen (adapter.exists), lokalText
   null heisst "nicht lesbar" und fuehrt bei existierender Datei zur
   Konfliktkopie, niemals zum Ueberschreiben. "anlegen" kommt nur fuer
   nachweislich fehlende Dateien zurueck.
   Uebersprungene Dateien (zu-gross) und geloeschtIgnoriert in das
   fehler-protokoll schreiben.

Sicherheitsrahmen, von den Modulen erzwungen: ohne apiKey kein einziger
Request; der Key verlaesst das Geraet nur als Authorization-Header an die
konfigurierte baseUrl; es gibt keine S3-Credentials im Plugin; Loeschungen
werden nicht propagiert; lokale Dateien werden nie stillschweigend
ueberschrieben.
