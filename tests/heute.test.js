// Run from the repo root: node --test tests/heute.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/heute.js');

test('week strip Mon–Sun, today and own days', () => {
  const w = H.heuteWeekStrip('2026-11-25', ['2026-11-23', '2026-11-27']);
  assert.equal(w.length, 7); assert.equal(w[0].date, '2026-11-23'); assert.equal(w[0].dow, 'Mo');
  assert.equal(w[0].day, 23); assert.equal(w[6].dow, 'So');
  assert.equal(w[2].today, true); assert.equal(w[0].has, true); assert.equal(w[1].has, false); assert.equal(w[4].has, true);
});

test('week strip on a Sunday belongs to the week starting Monday before', () => {
  assert.equal(H.heuteWeekStrip('2026-11-29', [])[0].date, '2026-11-23');
  assert.equal(H.heuteWeekStrip('2026-11-29', [])[6].today, true);
});

test('week strip across a month and a DST change (no UTC drift)', () => {
  assert.deepEqual(H.heuteWeekStrip('2026-10-28', []).map(d => d.date),
    ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
});

test('missing hours: past own plan days without entry', () => {
  assert.deepEqual(H.heuteMissingHourDays('2026-11-26', ['2026-11-23', '2026-11-24', '2026-11-26'], ['2026-11-24']), ['2026-11-23']);
  assert.deepEqual(H.heuteMissingHourDays('2026-11-23', ['2026-11-23'], []), []); // today not counted yet
  assert.deepEqual(H.heuteMissingHourDays('2026-11-26', ['2026-11-25', '2026-11-23', '2026-11-25', '2026-11-16'], []), ['2026-11-23', '2026-11-25']); // sorted, unique, this week only
});

test('open slots that fit', () => {
  const s = (key, date, role) => ({ week_id: 'w', key, date, open_slots: [{ role }], plan_assignments: [] });
  const shifts = [s('a', '2026-11-25', 'MA'), s('b', '2026-11-25', 'AL'), s('c', '2026-11-25', 'Fahrer'), s('d', '2026-11-20', 'MA')];
  assert.equal(H.heuteOpenSlotCount(shifts, 'me', 'MA', false, '2026-11-24', []), 1);
  assert.equal(H.heuteOpenSlotCount(shifts, 'me', 'AL', true, '2026-11-24', []), 3);
  assert.equal(H.heuteOpenSlotCount(shifts, 'me', 'MA', false, '2026-11-24', ['w|a']), 0);
});

test('open slots: own shifts and filled slots do not count', () => {
  const mine = { week_id: 'w', key: 'a', date: '2026-11-25', open_slots: [{ role: 'MA', count: 1 }], plan_assignments: [{ user_id: 'me' }] };
  const full = { week_id: 'w', key: 'b', date: '2026-11-25', open_slots: [{ role: 'MA', count: 0 }], plan_assignments: [] };
  const none = { week_id: 'w', key: 'c', date: '2026-11-25', open_slots: [], plan_assignments: [] };
  assert.equal(H.heuteOpenSlotCount([mine, full, none], 'me', 'MA', false, '2026-11-24', []), 0);
});

test('helpers tolerate empty/undefined input', () => {
  assert.equal(H.heuteOpenSlotCount(undefined, 'me', 'MA', false, '2026-11-24', undefined), 0);
  assert.deepEqual(H.heuteMissingHourDays('2026-11-24', undefined, undefined), []);
  assert.equal(H.heuteWeekStrip('2026-11-24', undefined).filter(d => d.has).length, 0);
});

test('today summary', () => {
  const sh = [{ venue: 'Messe Hamburg', plan_assignments: [{ user_id: 'a', name: 'Max' }, { user_id: 'b', name: 'Lena' }] },
              { venue: 'CCH', plan_assignments: [{ user_id: 'a', name: 'Max' }, { user_id: null, name: 'Tom' }] }];
  assert.deepEqual(H.heuteTodaySummary(sh), { count: 2, venues: ['Messe Hamburg', 'CCH'], people: 3 });
  assert.deepEqual(H.heuteTodaySummary([]), { count: 0, venues: [], people: 0 });
  assert.deepEqual(H.heuteTodaySummary(undefined), { count: 0, venues: [], people: 0 });
});

test('today summary: same venue once, agency people do not count', () => {
  const sh = [{ venue: 'CCH', plan_assignments: [{ user_id: null, name: 'Firma X', role: 'Fremdfirma' }] }, { venue: 'CCH', plan_assignments: [] }];
  assert.deepEqual(H.heuteTodaySummary(sh, ['Fremdfirma']), { count: 2, venues: ['CCH'], people: 0 });
});

test('unbooked protocols', () => {
  assert.equal(H.heuteUnbookedProtocols([{ id: 'p1' }, { id: 'p2' }],
    [{ protocol_id: 'p1', status: 'eingetragen' }, { protocol_id: 'p2', status: 'offen' }]), 1);
  assert.equal(H.heuteUnbookedProtocols([{ id: 'p1' }], [{ protocol_id: 'p1', status: 'offen' }, { protocol_id: 'p1', status: 'offen' }, { protocol_id: 'p9', status: 'offen' }]), 1);
  assert.equal(H.heuteUnbookedProtocols(undefined, undefined), 0);
});

test('night shift: a shift dated yesterday still running counts for its date, and its hours are not "missing" yet', () => {
  // 00:30 on Wed 25.11: Tuesday's "Abbau 0.30 Uhr" is still running (nextOwnShift returns it)
  assert.equal(H.heuteWeekStrip('2026-11-25', ['2026-11-24'])[1].has, true);
  assert.deepEqual(H.heuteMissingHourDays('2026-11-25', ['2026-11-23', '2026-11-24'], [], '2026-11-24'), ['2026-11-23']);
  assert.deepEqual(H.heuteMissingHourDays('2026-11-25', ['2026-11-23', '2026-11-24'], []), ['2026-11-23', '2026-11-24']);
});

test('crew render never keeps the previous user\'s strip and rows (shared phone)', async () => {
  const vm = require('node:vm'), fs = require('fs'), path = require('path');
  const els = { 'heute-week': { innerHTML: 'OLD-STRIP' }, 'heute-todo': { innerHTML: 'OLD-ROWS' }, 'heute-office': { innerHTML: '' } };
  const ctx = { document: { getElementById: id => els[id] || null }, currentUser: { id: 'lena' }, userRole: 'MA',
    localDateStr: () => '2026-11-25', window: {}, module: undefined };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/heute.js'), 'utf8'), ctx);
  await vm.runInContext('renderHeute()', ctx); // offline: no supabaseClient
  assert.ok(!els['heute-week'].innerHTML.includes('OLD-STRIP'));
  assert.equal(els['heute-todo'].innerHTML, '');
});
