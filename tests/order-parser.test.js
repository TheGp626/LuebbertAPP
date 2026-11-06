// Run from the repo root: node --test tests/order-parser.test.js
// Fixtures are pdf.js rows of real easyjob Auftragsbestätigungen, anonymised (names, numbers, phones made up).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let ctx;
beforeEach(() => {
  ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/order-parser.js'), 'utf8'), ctx, { filename: 'order-parser.js' });
});
const plain = v => JSON.parse(JSON.stringify(v));

const HEAD = [
  'Muster Event GmbH - Weg 1 - 12345 Ort',
  'Kunde GmbH Datum: Ort,',
  'Sonnenallee 1 Projektnummer: 26-0447',
  'Auftragsbestätigung BER26-0447 / 261112_Estrel_Test Event',
  '261112_Estrel_Test Event',
];
const SINGLE = HEAD.concat([
  '26-0447.01 / Test Event im Auditorium am 12.11.2026',
  'Ihr Zeichen: 11111',
  'Lieferadresse: Hotel GmbH, Sonnenallee 1, 12057 Berlin, Deutschland',
  'Foyer Auditorium, 1st Floor',
  'Aufbau: 11.11.2026 09:00 - 16:00',
  'Veranstaltung: 12.11.2026 09:00 - 18:00',
  'Abbau: 12.11.2026 19:15 - 22:00',
  'Pos. Anzahl Bezeichnung Einzelpreis Faktor Gesamt',
  'Kunde Projektleitung: Erika Muster // Tel. +4930111222333',
  'Kunde Koordination: 0170 1112223',
  'Auf- & Abbauleitung: ???',
  'Aufbauzeit: 11.11.2026 I 11 Uhr',
  'Transport über: rein über Tor 1, raus über Tor 3',
  'Abbauzeit: 12.11.2026 I 19:15 Uhr',
  'Job',
  'Chillout Zone',
  'Job.Gruppe',
  '1 4 Loungesofa 110,00 1,00 440,00',
  '26-0447.01 / Test Event im Auditorium am 12.11.2026 ........................ € 2.009,60',
]);
const MULTI = [
  'Auftragsbestätigung BER26-0394 / 261101-05_Estrel_Kongress',
  '26-0394.01 / CH II // Aufbau 01.11.',
  'Lieferadresse: Hotel GmbH, Sonnenallee 1, 12057 Berlin, Deutschland',
  'Aufbau: 01.11.2026 17:00 - 20:00',
  'Veranstaltung: 02.11.2026 08:00 - 05.11.2026 01:00',
  'Abbau: 05.11.2026 01:00 - 06:00',
  'Pos. Anzahl Bezeichnung Einzelpreis Faktor Gesamt',
  'Auf- & Abbauleitung: ???',
  'Aufbauzeit: So., 01.11. abends: STB',
  'bis Mo., 02.11. 11 Uhr: Deko STB',
  'Umbau: Mi., 04.11. 16 - 19 Uhr Umbau auf AVA',
  'Job',
  '26-0394.02 / CH II // Deko für 02.11.',
  'Lieferadresse: Hotel GmbH, Sonnenallee 1, 12057 Berlin, Deutschland',
  'Aufbau: 02.11.2026 08:00 - 11:00',
  'Veranstaltung: 02.11.2026 08:00 - 05.11.2026 01:00',
  'Abbau: 05.11.2026 01:00 - 06:00',
  'Pos. Anzahl Bezeichnung Einzelpreis Faktor Gesamt',
  'Job',
  '26-0394.04 / Personal- & Transportkosten (Rabatt)',
  'Lieferadresse: Hotel GmbH, Sonnenallee 1, 12057 Berlin, Deutschland',
  'Zeitraum: 01.11.2026 - 05.11.2026 12:00',
  'Pos. Anzahl Bezeichnung Einzelpreis Faktor Gesamt',
  'Job',
  '26-0394.01 / CH II // Aufbau 01.11. ......................... € 2.880,00',
];
const DATE_ONLY = [
  'Auftragsbestätigung BER26-0415 / 261112_Estrel_Vernissage',
  '26-0415.01 / Speicher',
  'Lieferadresse: Hotel GmbH, Sonnenallee 1, 12057 Berlin, Deutschland',
  'Speicherhalle',
  'Aufbau: 09.11.2026 10:00 - 18:00',
  'Veranstaltung: 12.11.2026 18:00 - 13.11.2026',
  'Abbau: 13.11.2026 10:00 - 18:00',
  'Pos. Anzahl Bezeichnung Einzelpreis Faktor Gesamt',
  'Auf- & Abbauleitung: Max // 0176 1234567',
  'Lena // 01578 7654321',
  'Info: Montag Servietten an Service übergeben',
  'Job',
];

test('orderParse: project and title', () => {
  const r = ctx.orderParse(SINGLE);
  assert.equal(r.project, '26-0447');
  assert.equal(r.title, '261112_Estrel_Test Event');
});

test('orderParse: single job with room, times, lead ???', () => {
  const r = plain(ctx.orderParse(SINGLE));
  assert.equal(r.jobs.length, 1); // summary header at the end is not a second job
  const j = r.jobs[0];
  assert.equal(j.jobNo, '26-0447.01');
  assert.equal(j.name, 'Test Event im Auditorium am 12.11.2026');
  assert.equal(j.address, 'Hotel GmbH, Sonnenallee 1, 12057 Berlin, Deutschland');
  assert.equal(j.room, 'Foyer Auditorium, 1st Floor');
  assert.deepEqual(j.setup, { start: '2026-11-11T09:00', end: '2026-11-11T16:00' });
  assert.deepEqual(j.event, { start: '2026-11-12T09:00', end: '2026-11-12T18:00' });
  assert.equal(j.teardown.start, '2026-11-12T19:15');
  assert.equal(j.lead, '');
  assert.match(j.notes, /Aufbauzeit: 11\.11\.2026 I 11 Uhr/);
  assert.match(j.notes, /Transport über:/);
  assert.doesNotMatch(j.notes, /Projektleitung|Koordination|Ihr Zeichen|Loungesofa/);
  assert.deepEqual(r.warnings, []);
});

test('orderParse: multi-day event, cost job dropped, continuation lines kept', () => {
  const r = plain(ctx.orderParse(MULTI));
  assert.deepEqual(r.jobs.map(j => j.jobNo), ['26-0394.01', '26-0394.02']);
  assert.deepEqual(r.jobs[0].event, { start: '2026-11-02T08:00', end: '2026-11-05T01:00' });
  assert.equal(r.jobs[0].notes, 'Aufbauzeit: So., 01.11. abends: STB\nbis Mo., 02.11. 11 Uhr: Deko STB\nUmbau: Mi., 04.11. 16 - 19 Uhr Umbau auf AVA');
  assert.equal(r.jobs[1].notes, '');
});

test('orderParse: end date only, lead phones stripped, second lead kept', () => {
  const j = plain(ctx.orderParse(DATE_ONLY)).jobs[0];
  assert.deepEqual(j.event, { start: '2026-11-12T18:00', end: '2026-11-13' });
  assert.equal(j.lead, 'Max, Lena');
  assert.equal(j.room, 'Speicherhalle');
  assert.equal(j.notes, 'Info: Montag Servietten an Service übergeben');
  for (const r of [SINGLE, MULTI, DATE_ONLY]) {
    const jobs = JSON.stringify(ctx.orderParse(r).jobs.map(x => [x.lead, x.notes, x.room, x.name]));
    assert.doesNotMatch(jobs, /\d[\d \/+-]{6,}\d/, 'no phone-like digit run survives');
  }
});

test('orderParse: no room line when next line is a label', () => {
  assert.equal(ctx.orderParse(MULTI).jobs[0].room, '');
});

test('orderParse: unreadable time → field null + warning', () => {
  const lines = DATE_ONLY.map(l => l.startsWith('Aufbau:') ? 'Aufbau: nach Absprache' : l);
  const r = plain(ctx.orderParse(lines));
  assert.equal(r.jobs[0].setup, null);
  assert.equal(r.jobs.length, 1); // teardown still makes it a job
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /26-0415\.01/);
  assert.match(r.warnings[0], /Aufbau/);
});

test('orderParse: foreign PDF → no jobs, one warning', () => {
  const r = plain(ctx.orderParse(['Rechnung 123', 'Betrag: 10,00 €']));
  assert.deepEqual(r.jobs, []);
  assert.equal(r.warnings.length, 1);
});

test('orderLines: groups items by row, sorts by x', () => {
  const pages = [{ items: [
    { s: '11.11.2026 09:00 - 16:00', x: 145, y: 100.4, h: 8 },
    { s: 'Aufbau:', x: 60, y: 100, h: 8 },
    { s: 'Abbau:', x: 60, y: 112, h: 8 },
  ] }, { items: [{ s: 'Job', x: 57, y: 50, h: 8 }] }];
  assert.deepEqual(plain(ctx.orderLines(pages)), ['Aufbau: 11.11.2026 09:00 - 16:00', 'Abbau:', 'Job']);
});

test('orderIsAb: by file name', () => {
  assert.equal(ctx.orderIsAb('26-0447_Auftragsbestaetigung_Neu.pdf'), true);
  assert.equal(ctx.orderIsAb('Auftragsbestätigung 26-0394.pdf'), true);
  assert.equal(ctx.orderIsAb('Packliste.pdf'), false);
});
