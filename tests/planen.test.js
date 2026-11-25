// Run from the repo root: node --test tests/planen.test.js
// PLANEN: pure helpers of js/planen.js (on top of the Besetzungsplaner's js/planer.js).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const plain = v => JSON.parse(JSON.stringify(v));
let ctx;
beforeEach(() => {
  ctx = vm.createContext({ console });
  ['order-slots.js', 'plan-parser.js', 'planer.js', 'planen.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + f), 'utf8'), ctx, { filename: f }));
});

const WEEK = { year: 2026, kw: 49, weekStart: '2026-11-30', weekEnd: '2026-12-06' };
const row = o => Object.assign({ id: 'r', date: '2026-12-01', need: 0, people: [], wann: 'Aufbau: 7 Uhr' }, o || {});
const P = (name, role, id) => ({ user_id: id || null, name, role: role || 'MA' });

test('pnRowState: full, part, empty, or nothing asked for; drivers fill no MA place', () => {
  assert.equal(ctx.pnRowState(row()), 'none');
  assert.equal(ctx.pnRowState(row({ need: 3 })), 'empty');
  assert.equal(ctx.pnRowState(row({ need: 3, people: [P('Konrad')] })), 'part');
  assert.equal(ctx.pnRowState(row({ need: 1, people: [P('Konrad')] })), 'full');
  assert.equal(ctx.pnRowState(row({ need: 1, people: [P('Fritz', 'Fahrer')] })), 'empty');
  assert.equal(ctx.pnRowState(row({ need: 1, people: [P('Konrad')], open_other: [{ role: 'Fahrer', count: 1 }] })), 'part');
});

test('pnSeats: people, then one open seat per missing place (other kinds marked), drivers last', () => {
  const s = ctx.pnSeats(row({ need: 3, people: [P('Fritz', 'Fahrer'), P('Konrad')], open_other: [{ role: 'Fahrer', count: 1 }] }));
  assert.deepEqual(plain(s.map(x => x.kind + (x.role ? ':' + x.role : '') + (x.p ? ':' + x.p.name : ''))),
    ['person:Konrad', 'open', 'open', 'open:Fahrer', 'driver:Fritz']);
});

test('pnDays: seven days, rows sorted by time, open places per day', () => {
  const rows = [row({ id: 'a', need: 4, people: [P('A')], wann: 'Aufbau: 14 Uhr' }), row({ id: 'b', need: 2, wann: 'Aufbau: 7 Uhr' }),
    row({ id: 'c', date: '2026-12-03', need: 1, people: [P('C')] })];
  const d = ctx.pnDays(WEEK, rows);
  assert.equal(d.length, 7);
  assert.deepEqual(plain(d[1].rows.map(r => r.id)), ['b', 'a']);
  assert.equal(d[1].open, 5);
  assert.equal(d[3].open, 0);
  assert.equal(d[0].rows.length, 0);
});

test('pnInitials / pnWeekRange', () => {
  assert.equal(ctx.pnInitials('Piotr B.'), 'PB');
  assert.equal(ctx.pnInitials('Konrad'), 'K');
  assert.equal(ctx.pnInitials(''), '?');
  assert.equal(ctx.pnWeekRange({ weekStart: '2026-12-07', weekEnd: '2026-12-13' }), '7.–13. Dezember');
  assert.equal(ctx.pnWeekRange(WEEK), '30. November – 6. Dezember');
});

test('MA number not entered yet (need null): row state "unknown", counts as 0 open, the day knows it', () => {
  const slot = { job_no: '26-0447.01', phase: 'setup', name: 'Lounge', title: '261201_Estrel_Gala', room: 'Saal', start_at: '2026-12-01T07:00', end_at: '2026-12-01T16:00', needed: null, accepted_ids: [] };
  const r = ctx.plRowFromSlot(slot, WEEK, []);
  assert.equal(r.need, null);
  assert.equal(ctx.pnRowState(r), 'unknown');
  assert.equal(ctx.pnOpenCount(r), 0);
  const d = ctx.pnDays(WEEK, [Object.assign({ id: 'x' }, r), row({ id: 'y', need: 2 })]);
  assert.equal(d[1].open, 2);
  assert.equal(d[1].unknown, 1);
  assert.equal(ctx.pnRowState(row({ need: 0 })), 'none');
});

test('pnChangeLines: unseen changes as readable lines, hand-kept ones say so', () => {
  const r = row({ auftrag_changes: [
    { field: 'wann', from: 'Aufbau: 07:00 Uhr', to: 'Aufbau: 08:00 Uhr', kept: false },
    { field: 'location', from: 'Saal 1', to: 'Gala\nSaal 2', kept: true },
    { field: 'title', from: 'A', to: 'B', kept: false, seen: true }] });
  assert.deepEqual(plain(ctx.pnChangeLines(r)), ['Zeit: Aufbau: 07:00 Uhr → Aufbau: 08:00 Uhr',
    'Raum / Veranstaltung: laut Auftrag jetzt Gala, Saal 2, von Hand Saal 1 behalten']);
  assert.deepEqual(plain(ctx.pnChangeLines(row())), []);
});
