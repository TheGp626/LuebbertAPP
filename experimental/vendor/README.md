# Fremde Bibliotheken (vendor)

liegen hier fest im repo statt von einem CDN geladen zu werden. so sieht beim öffnen der app kein fremder server
die IP-adresse, die app geht offline besser, und ein update kommt nur, wenn wir es testen und hier einspielen.

| datei | bibliothek | version | lizenz |
| --- | --- | --- | --- |
| `supabase-js-2.119.0.js` | @supabase/supabase-js (`dist/umd/supabase.js`) | 2.119.0 | MIT |
| `jspdf-2.5.1.umd.min.js` | jspdf (`dist/jspdf.umd.min.js`) | 2.5.1 | MIT |
| `pdfjs-3.11.174/pdf.min.js`, `pdf.worker.min.js` | pdfjs-dist (`build/`) | 3.11.174 | Apache-2.0 |
| `chart-4.6.1.umd.min.js` | chart.js (`dist/chart.umd.min.js`) | 4.6.1 | MIT |

lizenzen in `licenses/`, prüfsummen in `SHA256SUMS` (`cd vendor && sha256sum -c SHA256SUMS`).

## update
1. `npm pack <paket>@<version>`, die datei aus der tabelle rausnehmen und mit neuer versionsnummer im namen hier ablegen
2. pfad in `index.html` (und bei pdf.js in `js/ordner.js` und `js/produkte.js`) anpassen, alte datei löschen
3. `SHA256SUMS` neu erzeugen, tabelle oben anpassen
4. testen: login, protokoll-PDF, wochenplan-upload, auftragsbestätigung lesen, diagramme
