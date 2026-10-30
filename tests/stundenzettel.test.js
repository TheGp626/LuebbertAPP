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

test('shiftWeekVal: ISO weeks across year boundaries', () => {
  const { shiftWeekVal } = load(['shiftWeekVal'], ['pad', 'getMondayFromWeekVal']);
  assert.equal(shiftWeekVal('2026-W44', 1), '2026-W45');
  assert.equal(shiftWeekVal('2026-W44', -1), '2026-W43');
  assert.equal(shiftWeekVal('2026-W53', 1), '2027-W01');
  assert.equal(shiftWeekVal('2027-W01', -1), '2026-W53');
  assert.equal(shiftWeekVal('2025-W01', -1), '2024-W52');
  assert.equal(shiftWeekVal('2026-W01', 0), '2026-W01');
});

test('dayStatus: empty / partial / done / signed', () => {
  const { dayStatus } = load(['dayStatus']);
  assert.equal(dayStatus([{ von: '', bis: '' }], 0), 'empty');
  assert.equal(dayStatus([], 0), 'empty');
  assert.equal(dayStatus([{ von: '08:00', bis: '' }], 0), 'partial');
  assert.equal(dayStatus([{ von: '08:00', bis: '16:00' }, { von: '17:00', bis: '' }], 0), 'partial');
  assert.equal(dayStatus([{ von: '08:00', bis: '16:00' }], 0), 'done');
  assert.equal(dayStatus([{ von: '08:00', bis: '16:00' }], 1), 'signed');
});

test('shiftSummaryLine: net hours (minimum 3 h, over midnight) and pause', () => {
  const { shiftSummaryLine } = load(['shiftSummaryLine'], ['timeToMins']);
  assert.equal(shiftSummaryLine('16:00', '23:30', 0), '7,5 h netto');
  assert.equal(shiftSummaryLine('08:00', '17:00', 30), '8,5 h netto · 30 min Pause');
  assert.equal(shiftSummaryLine('22:00', '02:00', 0), '4 h netto');
  assert.equal(shiftSummaryLine('08:00', '09:00', 0), '3 h netto');
  assert.equal(shiftSummaryLine('08:00', '', 0), '');
  assert.equal(shiftSummaryLine('', '16:00', 0), '');
});

test('openStundenWeekPicker: no invisible keyboard where type=week is unsupported (iPhone Safari)', () => {
  const calls = [];
  const input = type => ({ type, showPicker() { calls.push('picker'); }, focus() { calls.push('focus'); } });
  global.document = { getElementById: () => input('text') };
  const { openStundenWeekPicker } = load(['openStundenWeekPicker']);
  openStundenWeekPicker();
  assert.deepEqual(calls, []);
  global.document = { getElementById: () => input('week') };
  openStundenWeekPicker();
  assert.deepEqual(calls, ['picker']);
  delete global.document;
});

test('login refreshes the Stundenzettel name label (shared device: no stale name)', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  assert.match(auth, /snInput\.value = user\.full_name;[\s\S]{0,200}syncStundenName\(\)/);
});

// ── Bug round 2026-10-30 ──
test('weekToEditorState: a stored Mo–Mi week fills the editor (buildDays must not start empty)', () => {
  const { weekToEditorState } = load(['weekToEditorState'], ['timeToMins', 'autoPause']);
  const w = week('MA frei', [[sh('08:00', '16:00', 'MA frei', { sig: 'SIG', ort: 'Halle' })], [sh('09:00', '17:00', 'MA frei')], [sh('10:00', '14:00', undefined), sh('15:00', '18:00', 'AL frei', { isProtocol: true, protocolId: 'p1' })], [], [], [], []]);
  const st = weekToEditorState(w, 'MA frei');
  assert.equal(st.shiftCounts[0], 1);
  assert.equal(st.shiftCounts[2], 2);
  assert.equal(st.shiftValues[0][0].von, '08:00');
  assert.equal(st.shiftValues[0][0].ort, 'Halle');
  assert.equal(st.shiftSigData['0-0'], 'SIG');
  assert.equal(st.shiftValues[2][0].dept, 'MA frei');
  assert.equal(st.shiftValues[2][1].isProtocol, true);
  assert.equal(st.shiftValues[2][1].protocolId, 'p1');
  assert.deepEqual(st.shiftValues[3], []);
});

test('weekSnapshot: only real input changes it (pause is derived)', () => {
  const { weekSnapshot } = load(['weekSnapshot']);
  const a = [[{ von: '08:00', bis: '12:00', ort: '', al: '', dept: 'MA', sig: null, pause: '0' }], [{ von: '', bis: '', ort: '', al: '', dept: 'MA', sig: null, pause: '0' }]];
  const b = JSON.parse(JSON.stringify(a)); b[0][0].pause = '30';
  assert.equal(weekSnapshot(a), weekSnapshot(b));
  const c = JSON.parse(JSON.stringify(a)); c[1][0].von = '09:00';
  assert.notEqual(weekSnapshot(a), weekSnapshot(c));
  const d = JSON.parse(JSON.stringify(a)); d[0][0].sig = 'data:x';
  assert.notEqual(weekSnapshot(a), weekSnapshot(d));
});

test('splitLegacyStore: legacy weeks go only to the user whose name they carry', () => {
  const { splitLegacyStore } = load(['splitLegacyStore']);
  const legacy = { '2026-W44': { name: 'Erika Muster' }, '2026-W43': { name: ' erika muster ' }, '2026-W42:AL': { name: 'Hans' }, '2026-W41': {} };
  const r = splitLegacyStore(legacy, 'Erika Muster');
  assert.deepEqual(Object.keys(r.mine).sort(), ['2026-W43', '2026-W44']);
  assert.deepEqual(Object.keys(r.rest).sort(), ['2026-W41', '2026-W42:AL']);
  assert.deepEqual(Object.keys(splitLegacyStore(legacy, '').mine), []);
});

test('runSerial: syncs of one week run one after the other, other weeks are independent', async () => {
  const { runSerial, serialBusy } = load(['runSerial', 'serialBusy']);
  const chains = {}, log = [];
  const slow = (name, ms) => () => new Promise(r => { log.push('start ' + name); setTimeout(() => { log.push('end ' + name); r(); }, ms); });
  const p1 = runSerial(chains, 'W1', slow('a', 30));
  const p2 = runSerial(chains, 'W1', slow('b', 1));
  assert.equal(serialBusy(chains, 'W1'), true);
  assert.equal(serialBusy(chains, 'W2'), false);
  await Promise.all([p1, p2]);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b']);
  assert.equal(serialBusy(chains, 'W1'), false);
  await runSerial(chains, 'W1', () => Promise.reject(new Error('x'))).catch(() => {});
  await runSerial(chains, 'W1', slow('c', 1));
  assert.equal(log[log.length - 1], 'end c');
});

test('planWeekDelete: only open manual rows of the card, never booked ones', () => {
  const { planWeekDelete } = load(['planWeekDelete']);
  const ex = [
    { id: 1, status: 'offen', position_role: 'MA frei' }, { id: 2, status: 'eingetragen', position_role: 'MA frei' },
    { id: 3, status: 'offen', position_role: 'AL frei' }, { id: 4, status: 'offen', position_role: null },
  ];
  assert.deepEqual(planWeekDelete(ex, 'MA frei'), [1]);
  assert.deepEqual(planWeekDelete(ex, null), [1, 3, 4]);
});

test('dropSyncedWeeks: empty server → synced weeks go, unsynced weeks stay', () => {
  const { dropSyncedWeeks, weekHasUnsynced } = load(['dropSyncedWeeks', 'weekHasUnsynced']);
  const all = { '2026-W44': { a: 1 }, '2026-W43:AL': { a: 2 }, '2026-W43:MA': { a: 3, unsynced: true }, '2026-W42': { a: 4, unsynced: true } };
  const removed = dropSyncedWeeks(all);
  assert.equal(removed, true);
  assert.deepEqual(Object.keys(all).sort(), ['2026-W42', '2026-W43:AL', '2026-W43:MA']);
  assert.equal(dropSyncedWeeks({ '2026-W42': { unsynced: true } }), false);
});

test('mergeUnseenShifts: server shifts the user never saw are added, typed entries kept, nothing duplicated', () => {
  const { mergeUnseenShifts } = load(['mergeUnseenShifts']);
  const empty = () => sh('', '', 'MA frei');
  const local = week('MA frei', [[empty()], [empty()], [sh('08:00', '12:00', 'MA frei', { sig: 'S' })], [], [], [], []]);
  const server = week('MA frei', [[sh('08:00', '16:00', 'MA frei')], [sh('09:00', '10:00', 'MA frei', { isProtocol: true })], [sh('08:00', '12:00', 'MA frei')], [], [], [], []]);
  const r = mergeUnseenShifts(local, server);
  assert.equal(r.added, 2);
  assert.deepEqual(r.week.days[0].shifts.map(s => s.von), ['08:00']);
  assert.equal(r.week.days[1].shifts[0].isProtocol, true);
  assert.equal(r.week.days[2].shifts.length, 1);
  assert.equal(r.week.days[2].shifts[0].sig, 'S');
  assert.equal(mergeUnseenShifts(local, null).added, 0);
  assert.equal(mergeUnseenShifts(r.week, server).added, 0);
});

test('weekIsBlind: a local save made without having seen the server', () => {
  const { weekIsBlind } = load(['weekIsBlind']);
  assert.equal(weekIsBlind({ '2026-W44:AL': { unsynced: true, blind: true } }, '2026-W44'), true);
  assert.equal(weekIsBlind({ '2026-W44': { unsynced: true } }, '2026-W44'), false);
  assert.equal(weekIsBlind({ '2026-W45': { blind: true } }, '2026-W44'), false);
});
