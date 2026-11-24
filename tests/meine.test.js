// Run from the repo root: node --test tests/meine.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/meine.js');

const range = { from: '2026-10-20', to: '2026-11-19' };
const prot = (id, date, s, e, pause, extra) => Object.assign({ id, user_id: 'u', start_time: s, end_time: e, pause_mins: pause, status: 'offen',
  shift_date: date, protocol_id: 'p' + id, protocols: { date, al_name_fallback: 'Paul', projects: { name: 'IPM FBF', location: 'Estrel' } } }, extra || {});

test('meineAddMonths', () => {
  assert.equal(M.meineAddMonths('2026-11', -1), '2026-10');
  assert.equal(M.meineAddMonths('2026-01', -1), '2025-12');
  assert.equal(M.meineAddMonths('2026-12', 1), '2027-01');
});

test('meineRows: protocol and own shifts, newest first, pending planned days', () => {
  const shifts = [
    prot(1, '2026-11-10', '07:00:00', '15:30:00', 30),
    prot(2, '2026-11-10', '07:00:00', '15:30:00', 30, { id: 9 }), // same protocol/time/date → once
    { id: 3, start_time: '18:00:00', end_time: '23:00:00', pause_mins: 0, status: 'eingetragen', shift_date: '2026-11-12', protocol_id: null, ort: 'Adlon' },
    prot(4, '2026-11-25', '08:00:00', '12:00:00', 0), // other period
  ];
  shifts[1].protocol_id = 'p1';
  const planned = [{ date: '2026-11-10', venue: 'Estrel' }, { date: '2026-11-14', venue: 'Rotes Rathaus', title: 'Empfang' }, { date: '2026-11-18', venue: 'Zukunft' }];
  const rows = M.meineRows(shifts, planned, range, '2026-11-15');
  assert.deepEqual(rows.map(r => r.date), ['2026-11-14', '2026-11-12', '2026-11-10']);
  assert.equal(rows[0].pending, true);
  assert.equal(rows[0].place, 'Rotes Rathaus · Empfang');
  assert.equal(rows[1].source, 'selbst'); assert.equal(rows[1].booked, true); assert.equal(rows[1].place, 'Adlon');
  assert.equal(rows[2].source, 'protokoll'); assert.equal(rows[2].mins, 480); assert.equal(rows[2].al, 'Paul'); assert.equal(rows[2].place, 'IPM FBF');
  assert.equal(rows[2].von, '07:00'); assert.equal(rows[2].bis, '15:30');
});

test('meineRows: night shift over midnight, empty input', () => {
  const r = M.meineRows([prot(1, '2026-11-01', '22:00:00', '04:00:00', 30)], [], range, '2026-11-15');
  assert.equal(r[0].mins, 330);
  assert.deepEqual(M.meineRows(null, null, range, '2026-11-15'), []);
});

test('meineHours and meineDayLabel', () => {
  assert.equal(M.meineHours(480), '8');
  assert.equal(M.meineHours(450), '7,5');
  assert.deepEqual(M.meineDayLabel('2026-11-24'), { dow: 'Di', dm: '24.11.' });
});
