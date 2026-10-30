// Run: node --test supabase/functions/_shared/plan-ics.test.mjs
// The Edge Function copy of planIcs must produce exactly the same calendar as js/plan-parser.js (browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planIcs } from './plan-ics.mjs';

const browser = createRequire(import.meta.url)('../../../js/plan-parser.js');

const STAMP = '20261030T080000Z';
const ME = 'u-me';
const shift = (o) => ({
  date: '2026-11-03', venue: 'Messe Nord', title: 'Sommerfest Beispiel GmbH', location: ['Beispielweg 1', '12345 Musterstadt', 'Halle 3', 'Sommerfest Beispiel GmbH'],
  wann: ['Aufbau: 8 - 9 Uhr'], plan_assignments: [{ user_id: ME, role: 'MA' }, { user_id: 'u-other', role: 'AL' }], ...o,
});
const fixtures = {
  'normal time': [shift({})],
  'single time': [shift({ wann: ['Abbau: 17 Uhr'] })],
  'end time past midnight': [shift({ wann: ['Abbau: 22 - 2 Uhr'] })],
  'night before 04:00': [shift({ wann: ['Abbau: 0.30 Uhr'] })],
  '24 Uhr midnight and en-dash': [shift({ wann: ['Abbau: 21 – 24 Uhr'] })],
  'bis deadline is all-day': [shift({ wann: ['Aufbau Deko: bis 11 Uhr'] })],
  'no time': [shift({ wann: ['KW 45-46'] })],
  'empty wann': [shift({ wann: [] })],
  'wann as string': [shift({ wann: 'Aufbau: 8 Uhr\nLeergut hinter Vorhang' })],
  'equipment title': [shift({ title: '4 STB weiß', location: 'Beispielweg 1\n12345 Musterstadt\nHerbstgala Beispiel AG' })],
  'room title': [shift({ title: 'Saal Europa', location: ['12345 Musterstadt', 'Saal Europa'] })],
  'work step title': [shift({ title: 'Abbau', location: ['12345 Musterstadt', 'Anlieferung über Hof!!'] })],
  'material without location': [shift({ title: '10 Hocker', location: [], venue: 'Hotel Beispiel' })],
  'special chars': [shift({ title: 'Gala; Tanz, Musik \\ Show', wann: ['Aufbau: 9 Uhr', 'Zeile mit; Komma, und Umlauten äöü'] })],
  'long title folding': [shift({ title: 'Internationaler Kongress für außergewöhnlich lange Veranstaltungstitel mit Ümläuten und vielen Wörtern Beispiel GmbH' })],
  'explicit key and no assignment': [shift({ key: 'fester|schluessel', plan_assignments: [] })],
  'several shifts': [shift({}), shift({ date: '2026-11-04', title: 'Herbstgala Beispiel AG', wann: ['Abbau: 0.30 Uhr'] }), shift({ date: '2026-11-05', wann: [] })],
  'no shifts': [],
};

test('planIcs matches the browser parser', () => {
  for (const [name, shifts] of Object.entries(fixtures)) {
    assert.equal(planIcs(shifts, ME, STAMP), browser.planIcs(shifts, ME, STAMP), name);
  }
  assert.equal(planIcs(null, ME, STAMP), browser.planIcs(null, ME, STAMP));
});

test('planIcs: subscribers get a refresh hint', () => {
  const ics = planIcs([shift({})], ME, STAMP);
  assert.match(ics, /X-WR-CALNAME:Lübbert Schichten\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\n/);
});

test('planIcs: long lines are folded to 75 bytes', () => {
  const ics = planIcs(fixtures['long title folding'], ME, STAMP);
  ics.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l) <= 75, l));
});
