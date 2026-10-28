// Run from the repo root: node --test tests/stundenzettel.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '../js/' + f), 'utf8');
const grabFrom = src => name => { const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\r?\\n}\\r?\\n')); if (!m) throw new Error(name + ' missing'); return m[0]; };
const gu = grabFrom(read('utils.js')), gs = grabFrom(read('stundenzettel.js'));
const load = (names, utilNames = []) => new Function(utilNames.map(gu).join('\n') + names.map(gs).join('\n') + '; return {' + names.join(',') + '};')();

const sh = (von, bis, dept, extra) => Object.assign({ von, bis, pause: '0', ort: '', al: '', dept }, extra || {});
const week = (abt, dayShifts, extra) => Object.assign({
  name: 'Erika', abt, weekStart: '2026-W44', weekLabel: 'KW 44', saved: 'T1',
  days: dayShifts.map((s, i) => ({ day: 'D' + i, date: pad2(26 + i) + '.10.2026', shifts: s })),
}, extra || {});
function pad2(n) { return String(n).padStart(2, '0'); }

test('weekPartKey: full department name, so "AL fest" and "AL frei" do not collide', () => {
  const { weekPartKey } = load(['weekPartKey']);
  assert.equal(weekPartKey('2026-W44', 'AL fest'), '2026-W44:AL fest');
  assert.notEqual(weekPartKey('2026-W44', 'AL fest'), weekPartKey('2026-W44', 'AL frei'));
});

test('removeWeekEntries: plain key and every dept part, nothing else', () => {
  const { removeWeekEntries } = load(['removeWeekEntries']);
  const all = { '2026-W44': { a: 1 }, '2026-W44:AL': { a: 2 }, '2026-W44:MA frei': { a: 3 }, '2026-W45': { a: 4 }, '2026-W4': { a: 5 } };
  const removed = removeWeekEntries(all, '2026-W44');
  assert.deepEqual(Object.keys(all).sort(), ['2026-W4', '2026-W45']);
  assert.deepEqual(removed.map(e => e.a).sort(), [1, 2, 3]);
});

test('buildWeekEntries: one dept → plain key; mixed → one part per full dept name', () => {
  const { buildWeekEntries } = load(['buildWeekEntries', 'splitWeekByDepts', 'weekPartKey'], ['timeToMins']);
  const single = week('MA frei', [[sh('08:00', '12:00', 'MA frei')], [], [], [], [], [], []]);
  assert.deepEqual(Object.keys(buildWeekEntries(single)), ['2026-W44']);

  const mixed = week('AL frei', [[sh('08:00', '12:00', 'AL frei'), sh('13:00', '17:00', 'AL fest')], [sh('08:00', '16:00', 'MA frei', { pause: '30' })], [], [], [], [], []], { unsynced: true });
  const e = buildWeekEntries(mixed);
  assert.deepEqual(Object.keys(e).sort(), ['2026-W44:AL fest', '2026-W44:AL frei', '2026-W44:MA frei']);
  assert.equal(e['2026-W44:AL fest'].histKey, '2026-W44:AL fest');
  assert.equal(e['2026-W44:AL fest'].abt, 'AL fest');
  assert.equal(e['2026-W44:AL fest'].total, '4');
  assert.equal(e['2026-W44:MA frei'].total, '7.50');
  assert.equal(e['2026-W44:MA frei'].unsynced, true);
  assert.equal(e['2026-W44:MA frei'].days[0].shifts.length, 0);
});

test('mergeWeekParts: loading one dept card edits the whole week', () => {
  const { mergeWeekParts } = load(['mergeWeekParts']);
  const all = {
    '2026-W44:AL frei': week('AL frei', [[sh('08:00', '12:00', 'AL frei', { sig: 'SIG' })], [], [], [], [], [], []]),
    '2026-W44:MA frei': week('MA frei', [[sh('13:00', '17:00', undefined)], [sh('08:00', '16:00', 'MA frei')], [], [], [], [], []]),
    '2026-W45': week('MA frei', [[sh('09:00', '10:00', 'MA frei')], [], [], [], [], [], []], { weekStart: '2026-W45' }),
  };
  const w = mergeWeekParts(all, '2026-W44');
  assert.equal(w.weekStart, '2026-W44');
  assert.equal(w.days.length, 7);
  assert.deepEqual(w.days[0].shifts.map(s => [s.von, s.dept]), [['08:00', 'AL frei'], ['13:00', 'MA frei']]);
  assert.equal(w.days[0].shifts[0].sig, 'SIG');
  assert.deepEqual(w.days[1].shifts.map(s => s.von), ['08:00']);
  assert.equal(mergeWeekParts(all, '2026-W46'), null);
  // a single entry comes back unchanged (also keeps legacy day formats intact)
  assert.equal(mergeWeekParts(all, '2026-W45'), all['2026-W45']);
});

test('mergeWeekParts: a legacy plain key next to its part keys does not duplicate shifts', () => {
  const { mergeWeekParts } = load(['mergeWeekParts']);
  const all = {
    '2026-W44': week('AL frei', [[sh('08:00', '12:00', 'AL frei'), sh('13:00', '17:00', 'MA frei')], [], [], [], [], [], []]),
    '2026-W44:AL frei': week('AL frei', [[sh('08:00', '12:00', 'AL frei', { sig: 'SIG' })], [], [], [], [], [], []]),
    '2026-W44:MA frei': week('MA frei', [[sh('13:00', '17:00', 'MA frei')], [], [], [], [], [], []]),
  };
  const w = mergeWeekParts(all, '2026-W44');
  assert.deepEqual(w.days[0].shifts.map(s => [s.von, s.dept]), [['08:00', 'AL frei'], ['13:00', 'MA frei']]);
  assert.equal(w.days[0].shifts[0].sig, 'SIG', 'the copy with the signature is kept');
});

test('unsyncedWeekKeys: each waiting week once, parts collapsed to their week', () => {
  const { unsyncedWeekKeys } = load(['unsyncedWeekKeys']);
  const all = { '2026-W44:AL frei': { unsynced: true }, '2026-W44:MA frei': { unsynced: true }, '2026-W45': { unsynced: true }, '2026-W46': {} };
  assert.deepEqual(unsyncedWeekKeys(all), ['2026-W44', '2026-W45']);
  assert.deepEqual(unsyncedWeekKeys({}), []);
});

test('weekHasUnsynced / clearUnsyncedFlag', () => {
  const { weekHasUnsynced, clearUnsyncedFlag } = load(['weekHasUnsynced', 'clearUnsyncedFlag']);
  const all = { '2026-W44:AL frei': { saved: 'T1', unsynced: true }, '2026-W44:MA frei': { saved: 'T1', unsynced: true }, '2026-W45': { saved: 'T0' } };
  assert.equal(weekHasUnsynced(all, '2026-W44'), true);
  assert.equal(weekHasUnsynced(all, '2026-W45'), false);
  // an older sync finishing after a newer save must not clear the newer save's flag
  assert.equal(clearUnsyncedFlag(all, '2026-W44', 'T0'), false);
  assert.equal(weekHasUnsynced(all, '2026-W44'), true);
  assert.equal(clearUnsyncedFlag(all, '2026-W44', 'T1'), true);
  assert.equal(weekHasUnsynced(all, '2026-W44'), false);
});

test('planWeekSync: booked (eingetragen) shifts are never deleted nor re-inserted', () => {
  const { planWeekSync } = load(['planWeekSync']);
  const existing = [
    { id: 'e1', shift_date: '2026-10-26', start_time: '08:00:00', end_time: '12:00:00', status: 'eingetragen', position_role: 'MA frei', pause_mins: 0, ort: null },
    { id: 'o1', shift_date: '2026-10-27', start_time: '08:00:00', end_time: '16:00:00', status: 'offen', position_role: 'MA frei', pause_mins: 30, ort: 'Messe' },
    { id: 'o2', shift_date: '2026-10-28', start_time: '09:00:00', end_time: '13:00:00', status: 'offen', position_role: 'MA frei', pause_mins: 0, ort: null },
  ];
  const desired = [
    { shift_date: '2026-10-26', start_time: '08:00', end_time: '12:00', position_role: 'MA frei', pause_mins: 0, ort: null, status: 'offen' }, // booked → skip
    { shift_date: '2026-10-27', start_time: '08:00', end_time: '16:00', position_role: 'MA frei', pause_mins: 30, ort: 'Messe', status: 'offen' }, // unchanged → keep
    { shift_date: '2026-10-28', start_time: '09:00', end_time: '14:00', position_role: 'MA frei', pause_mins: 0, ort: null, status: 'offen' }, // changed
  ];
  const p = planWeekSync(existing, desired);
  assert.deepEqual(p.deleteIds, ['o2']);
  assert.deepEqual(p.insert, [desired[2]]);
});

test('planWeekSync: a booked shift removed locally stays; duplicates are matched one-to-one', () => {
  const { planWeekSync } = load(['planWeekSync']);
  const existing = [
    { id: 'e1', shift_date: '2026-10-26', start_time: '08:00:00', end_time: '12:00:00', status: 'eingetragen', position_role: 'MA frei' },
    { id: 'o1', shift_date: '2026-10-27', start_time: '08:00:00', end_time: '12:00:00', status: 'offen', position_role: 'MA frei', pause_mins: 0, ort: null },
  ];
  const d = { shift_date: '2026-10-27', start_time: '08:00', end_time: '12:00', position_role: 'MA frei', pause_mins: 0, ort: null };
  const p = planWeekSync(existing, [d, Object.assign({}, d)]);
  assert.deepEqual(p.deleteIds, []);
  assert.equal(p.insert.length, 1);
  assert.deepEqual(planWeekSync([], []), { deleteIds: [], insert: [] });
});
