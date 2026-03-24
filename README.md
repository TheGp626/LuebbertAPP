# Lübbert App

gebaut weil Zettelwirtschaft und manuelle Stundenberechnung beschissen sind. angefangen als kleiner Stundenzettel für mich selbst, jetzt irgendwie eine halbe Unternehmens-Software geworden. läuft als PWA, also installierbar auf android, funktioniert offline, keine Installation nötig.

---

## was drin ist

### Stundenzettel
- woche auswählen, tage aufklappen, zeiten eintragen — pause wird automatisch berechnet (0/30/45 min je nach schichtlänge)
- mehrere schichten pro tag, abteilung pro schicht umschaltbar
- 3h minimum wird automatisch angerechnet
- live-verdienst berechnung basierend auf deinem stundenlohn in den einstellungen
- wenn du mehrere abteilungen in einer woche hattest bekommst du automatisch getrennte PDFs
- monatliche übersicht exportierbar, stichtag konfigurierbar (standard 20.)
- al-unterschrift direkt aufs handy zeichnen, landet im PDF
- alles wird in supabase gesichert — trägst du eine schicht von vor zwei wochen ein, steht im dashboard trotzdem das richtige datum

### Protokoll
- aufbauprotokolle direkt aufs handy, kein papier mehr
- wenn du eingeloggt bist wird dein name automatisch als AL eingetragen
- transport: fahrzeuge mit fahrer, pünktlichkeit, verspätungsminuten
- equipment: 5 kategorien mit status und anmerkungen, bei stoffe werden hussen gezählt
- personal: alle leute mit position, zeiten, fest/frei — zenjob/rockit wird automatisch nach tag/nacht/sonntag/feiertag aufgeteilt
- live-kostenkalkulation während du tippst
- protokolle landen im verlauf, vertippt einfach bearbeiten und neu abschicken
- alles wird lokal gespeichert während du tippst, handy weggelegt ist egal
- nachträgliche protokolle funktionieren, datum ist frei wählbar

### Dashboard (AL, PL, Buchhaltung, Admin)
- alle protokolle und schichten auf einen blick mit suchfunktion
- schichten als "eingetragen" markierbar, ausstehendes wird rot
- buchhaltungsansicht zeigt alle schichten eines MAs sortiert nach tatsächlichem arbeitsdatum
- admins können neue nutzer direkt in der app anlegen

## login

MA: namen aus der liste wählen, fertig.
AL / PL / Buchhaltung / Admin: namen wählen + master-PIN.

---

## sicherheit

der supabase anon-key liegt im code — das ist so designed. der anon-key ist public by nature und hat nur die rechte die RLS erlaubt. kein service-key, keine echten credentials, ist fine.

---

## easter egg

🤐

---

gebaut mit zu viel koffein und zu wenig schlaf. funktioniert trotzdem.
