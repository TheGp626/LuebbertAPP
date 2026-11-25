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

test('pnQuickRows: Aufbau alone, or Aufbau + Abbau as a pair; bad days refused', () => {
  const f = o => Object.assign({ venue: 'Estrel', was: '4 Sofas', kind: 'intern', need: 3, setupDate: '2026-12-01', setupTime: '07:00', teardownDate: '', teardownTime: '' }, o || {});
  const one = plain(ctx.pnQuickRows(f(), WEEK, 'P1'));
  assert.equal(one.rows.length, 1);
  assert.deepEqual([one.rows[0].date, one.rows[0].wann, one.rows[0].venue, one.rows[0].title, one.rows[0].need, one.rows[0].kind, one.rows[0].pair_id],
    ['2026-12-01', 'Aufbau: 7 Uhr', 'Estrel', '4 Sofas', 3, 'intern', null]);
  const two = plain(ctx.pnQuickRows(f({ teardownDate: '2026-12-03', teardownTime: '22:30' }), WEEK, 'P1'));
  assert.deepEqual(two.rows.map(r => [r.date, r.wann, r.pair_id]), [['2026-12-01', 'Aufbau: 7 Uhr', 'P1'], ['2026-12-03', 'Abbau: 22.30 Uhr', 'P1']]);
  assert.equal(ctx.pnQuickRows(f({ teardownDate: '2026-11-30' }), WEEK, 'P1').error, 'Der Abbau liegt vor dem Aufbau.');
  assert.equal(ctx.pnQuickRows(f({ setupDate: '2026-12-09' }), WEEK, 'P1').error, 'Der Aufbau muss in KW 49 liegen.');
  assert.equal(ctx.pnQuickRows(f({ venue: '', was: '' }), WEEK, 'P1').error, 'Bitte Ort oder „Was“ eintragen.');
});

test('pnCopyRows: free entries of last week to the same weekdays, without people; Aufträge are never copied', () => {
  const last = { year: 2026, kw: 48, weekStart: '2026-11-23', weekEnd: '2026-11-29' };
  const rows = [row({ id: 'a', date: '2026-11-24', venue: 'Lager', people: [P('Konrad')], need: 2 }),
    row({ id: 'b', date: '2026-11-25', job_no: '26-0001.01', phase: 'setup' })];
  const out = plain(ctx.pnCopyRows(rows, last, WEEK));
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].date, out[0].venue, out[0].need, out[0].people, out[0].year, out[0].kw, 'id' in out[0]], ['2026-12-01', 'Lager', 2, [], 2026, 49, false]);
});

test('pnPublishSummary: counts and who gets a push (people on new or changed entries, and on removed ones)', () => {
  const sh = (people) => ({ people: people.map(n => ({ name: n, userId: 'u-' + n, role: 'MA' })) });
  const parsed = { shifts: [sh(['Konrad', 'Lena']), sh(['Piotr']), sh(['Milan'])] };
  const diff = { status: ['neu', 'geändert', null], removed: [sh(['Sara'])] };
  assert.deepEqual(plain(ctx.pnPublishSummary(diff, parsed)), { neu: 1, geaendert: 1, entfernt: 1, people: ['Konrad', 'Lena', 'Piotr', 'Sara'] });
  // first Stand of a week: everything is new, everyone planned gets one
  assert.deepEqual(plain(ctx.pnPublishSummary(null, parsed)).people, ['Konrad', 'Lena', 'Milan', 'Piotr']);
  // agency names without an account get no push
  assert.deepEqual(plain(ctx.pnPublishSummary(null, { shifts: [{ people: [{ name: 'Zenjob 1', userId: null, role: 'Zenjob' }] }] })).people, []);
});

test('pnWhoText: names with role, then open places; "MA?" without a number', () => {
  assert.equal(ctx.pnWhoText(row({ need: 4, people: [P('Konrad N.', 'AL'), P('Piotr B.')], open_other: [{ role: 'Fahrer', count: 1 }] })), 'Konrad N. (AL), Piotr B., +2 MA, +1 Fahrer');
  assert.equal(ctx.pnWhoText(row({ need: null, people: [] })), 'MA?');
});

test('pnAskTarget: only where the person can answer with „Ich kann“', () => {
  assert.deepEqual(plain(ctx.pnAskTarget(row({ job_no: '26-0001.01', phase: 'setup', need: 3 }), {}, null, {})), { kind: 'order', a: '26-0001.01', b: 'setup' });
  assert.equal(ctx.pnAskTarget(row({ job_no: '26-0001.01', phase: 'setup', need: null }), {}, null, {}), null);
  assert.equal(ctx.pnAskTarget(row({ job_no: '26-0001.01', phase: 'setup', need: 0 }), {}, null, {}), null);
  assert.deepEqual(plain(ctx.pnAskTarget(row({ id: 'f' }), { f: 'k1' }, 'W', { k1: true })), { kind: 'shift', a: 'W', b: 'k1' });
  assert.equal(ctx.pnAskTarget(row({ id: 'f' }), { f: 'k2' }, 'W', { k1: true }), null); // not published yet
  assert.equal(ctx.pnAskTarget(row({ id: 'f' }), { f: 'k1' }, null, {}), null);           // no published week
});

test('pnUnresolvedNames: remembered matches applied, agency workers skipped, the rest counted', () => {
  const parsed = { shifts: [
    { people: [{ name: 'Konrad', userId: null, role: 'MA' }, { name: 'Zenjob 1', userId: null, role: 'Zenjob' }, { name: 'Lena', userId: 'u3', role: 'MA' }] },
    { people: [{ name: 'Konrad', userId: null, role: 'AL' }, { name: 'Mika', userId: null, role: 'MA' }] }] };
  const out = plain(ctx.pnUnresolvedNames(parsed, { [ctx.planAliasKey('Mika')]: 'u9' }));
  assert.deepEqual(out.map(r => [r.name, r.count]), [['Konrad', 2]]);
  assert.equal(parsed.shifts[1].people[1].userId, 'u9');
});

test('pnPublishSummary: someone taken off an entry that stays gets a push too', () => {
  const sh = (people) => ({ people: people.map(n => ({ name: n, userId: 'u-' + n, role: 'MA' })) });
  const parsed = { shifts: [sh(['Konrad'])] };
  const diff = { status: ['geändert'], matched: [sh(['Konrad', 'Piotr'])], removed: [] };
  assert.deepEqual(plain(ctx.pnPublishSummary(diff, parsed)).people, ['Konrad', 'Piotr']);
});

test('pnQuickRows: „Was“ over several lines = title + material lines (Patryk, 25.11.)', () => {
  const r = plain(ctx.pnQuickRows({ venue: 'App Meeting', was: ' Getränke \n4 Monster Energy\n\n2 Club Mate ', kind: 'auftrag', need: 2, setupDate: '2026-12-03', setupTime: '14:30', teardownDate: '', teardownTime: '' }, WEEK, 'P1'));
  assert.equal(r.rows[0].title, 'Getränke');
  assert.equal(r.rows[0].details, '4 Monster Energy\n2 Club Mate');
  const one = plain(ctx.pnQuickRows({ venue: 'X', was: '4 Sofas', kind: 'intern', need: 1, setupDate: '2026-12-01', setupTime: '', teardownDate: '', teardownTime: '' }, WEEK, 'P1'));
  assert.equal(one.rows[0].details, null);
});
