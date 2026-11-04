# Lübbert App

> gebaut weil Zettelwirtschaft und manuelle Stundenberechnung beschissen sind.

angefangen als kleiner Stundenzettel für mich selbst, jetzt irgendwie eine halbe Unternehmens-Software geworden. läuft als PWA: im browser öffnen, zum homescreen hinzufügen, fertig. funktioniert offline, keine installation über einen store nötig.

🌐 **live:** https://thegp626.github.io/LuebbertAPP/
🧪 **testversion:** https://thegp626.github.io/LuebbertAPP/experimental/ (orangener balken unten, eigenes homescreen-icon)

---

## was drin ist

### 🏠 Startseite
- "Hallo \<name\>" + dein nächster einsatz aus dem wochenplan
- kacheln für alles, was deine rolle sehen darf

### ⏱️ Stundenzettel
- woche auswählen, tage aufklappen, zeiten eintragen — pause wird automatisch berechnet (0/30/45 min je nach schichtlänge)
- mehrere schichten pro tag, abteilung pro schicht (standard MA frei)
- 3h minimum wird automatisch angerechnet
- live-verdienst basierend auf deinem stundenlohn
- mehrere abteilungen in einer woche → im verlauf eine karte ("KW 44 gemischt"), beim export trotzdem getrennte PDFs
- schichten aus einem protokoll ersetzen deine eigene schicht am selben tag zur selben zeit (keine doppelten stunden)
- monatliche übersicht exportierbar, stichtag zentral vom admin eingestellt (standard 20.)
- AL-unterschrift direkt aufs handy zeichnen, landet im PDF
- alles wird in supabase gesichert — trägst du eine schicht von vor zwei wochen ein, steht im dashboard trotzdem das richtige datum

### 📋 Protokoll
- aufbauprotokolle direkt aufs handy, kein papier mehr
- dein name wird automatisch als AL eingetragen, personal kann aus dem wochenplan vorbefüllt werden
- transport: fahrzeuge mit fahrer, fahrerstunden, pünktlichkeit, verspätungsminuten
- equipment: 5 gewerke mit status und anmerkungen, bei stoffe werden hussen gezählt
- personal: alle leute mit position, zeiten, fest/frei — zenjob/rockit wird automatisch nach tag/nacht/sonntag/feiertag aufgeteilt
- live-kostenkalkulation während du tippst
- nach dem speichern geht das protokoll als PDF per mail an die zuständige PL
- vertippt? im verlauf bearbeiten und neu abschicken
- alles wird lokal gespeichert während du tippst, handy weggelegt ist egal
- nachträgliche protokolle funktionieren, datum ist frei wählbar

### 📅 Wochenplan
- PL lädt den wochenplan als PDF hoch, die app liest ihn selbst aus
- "meine schichten" + die ganze woche für alle
- kalender-abo (iPhone, google kalender) oder .ics zum runterladen
- push wenn sich dein plan ändert, optional abends eine erinnerung für morgen

### 📦 Produktdatenbank
- alle produkte mit fotos, PDFs, videos und aufbau-dateien
- AL / PL / Admin können pflegen, alle anderen schauen

### 📁 Projektordner
- ordner + unterordner pro projekt, dateien hochladen und mit anmerkung versehen
- einsätze mit datum und AL — die zugewiesenen ALs kriegen eine push
- ordner löschen sich 7 tage nach dem letzten einsatz von selbst (datum anpassbar)
- dateien sind privat und öffnen nur über die app (link gilt 1 stunde)

### 🔔 Erinnerungen
- fehlt nach einem einsatz das protokoll: tag 1–5 push an die AL, ab tag 6 eine mail an die PL
- banner in der app, solange noch was offen ist

### 📊 Dashboard (AL, PL, Buchhaltung, Admin)
- **protokolle:** alles auf einen blick mit suche, kosten pro monat, bearbeiten
- **mitarbeiter:** alle schichten eines MAs nach tatsächlichem arbeitsdatum, ausstehendes wird rot, monat als PDF
- schichten als "eingetragen" verbuchen — nur buchhaltung / admin
- mitarbeiter anlegen, bearbeiten, deaktivieren — PL, buchhaltung, admin
- **einstellungen (admin):** erinnerungen, pushes, protokoll-mail, stichtag, fahrzeugsätze an/aus bzw. einstellen

---

## login

| wer | wie |
|---|---|
| alle (außer gast) | namen wählen + **eigene 4-stellige PIN** |
| gast (zenjob / rockit) | "Gast Zugang" wählen, keine PIN |

- beim ersten login denkst du dir deine PIN selbst aus (AL / PL / buchhaltung / admin brauchen dafür ein letztes mal das alte passwort)
- pro gerät 30 tage eingeloggt, danach fragt die app nochmal
- PIN ändern: oben rechts **„…" → „PIN ändern"**
- PIN vergessen: AL oder PL bescheid sagen → **„…" → „PIN zurücksetzen"** (AL → MA, PL → AL/MA, admin → alle)
- nach 5 falschen versuchen 15 minuten pause

---

## wer darf was

| | MA | AL | PL | buchhaltung | admin | gast |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| eigene stunden | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| protokolle schreiben / alle sehen | – | ✅ | ✅ | ✅ | ✅ | – |
| wochenplan sehen | ✅ | ✅ | ✅ | ✅ | ✅ | – |
| wochenplan hochladen, projektordner pflegen | – | – | ✅ | – | ✅ | – |
| produkte pflegen | – | ✅ | ✅ | – | ✅ | – |
| stundensätze & e-mails sehen | nur eigene | nur eigene | ✅ | ✅ | ✅ | – |
| mitarbeiter anlegen / bearbeiten | – | – | ✅¹ | ✅ | ✅ | – |
| schichten verbuchen | – | – | – | ✅ | ✅ | – |
| produkte & projektordner ansehen | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

¹ PL vergibt nie buchhaltung/admin, bearbeitet keine buchhaltung/admin-konten und ändert die eigene rolle nicht.

---

## sicherheit

- jeder hat einen echten login, die datenbank prüft bei **jeder** abfrage, wer du bist und welche rolle du hast. ein MA kann keine daten von anderen sehen, auch nicht wenn er wüsste wie.
- der supabase anon-key liegt im code — das ist so designed. ohne login darf er nichts außer die namensliste für den login holen.
- stundensätze, verdienstgrenze und e-mails liegen in einer eigenen tabelle, die nur PL / buchhaltung / admin lesen.
- projektdateien sind privat, öffnen nur mit kurzlebigem link aus der app.
- datenbank in der EU (supabase, irland).

---

## für entwickler

- vanilla JS, kein build — `index.html` + `js/*.js` + `css/`, service worker in `sw.js`
- **nach jeder änderung:** `?v=` der geänderten scripts in `index.html` hochzählen **und** `CACHE` in `sw.js`, sonst behalten installierte apps den alten code
- tests: `node --test tests/*.test.js supabase/functions/**/*.test.mjs`
- datenbank-änderungen: `supabase/migrations/`, dazu immer rollback (`supabase/rollback/`) und prüfskript (`supabase/tests/`, nur in einer transaktion mit rollback ausführen)
- edge functions (mails, pushes, PIN-login, kalender-feed, ordner-aufräumen): `supabase/functions/`
- branch `experimental` = testversion, gebaut in den ordner `experimental/` auf `main`

---

## easter egg

🤐

---

gebaut mit zu viel koffein und zu wenig schlaf. funktioniert trotzdem.
