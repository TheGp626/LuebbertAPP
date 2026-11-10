// Run from the repo root: node --test tests/planer.test.js
// Besetzungsplaner: pure helpers of js/planer.js (draft rows ↔ Auftrag slots ↔ the import shape of plan-parser.js).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const plain = v => JSON.parse(JSON.stringify(v));
let ctx;
beforeEach(() => {
  ctx = vm.createContext({ console });
  ['order-slots.js', 'plan-parser.js', 'planer.js'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + f), 'utf8'), ctx, { filename: f }));
});

const USERS = [
  { id: 'u-kac', full_name: 'Kacper Nowak', role: 'AL', is_active: true },
  { id: 'u-mil', full_name: 'Milan Berg', role: 'MA', is_active: true },
  { id: 'u-fe1', full_name: 'Feli Kraus', role: 'MA', is_active: true },
  { id: 'u-fe2', full_name: 'Feli Sommer', role: 'MA', is_active: true },
  { id: 'u-pl', full_name: 'Sabine Lang', role: 'PL', is_active: true },
  { id: 'u-old', full_name: 'Alt Weg', role: 'MA', is_active: false },
  { id: 'u-gast', full_name: 'Gast Zugang', role: 'Gast', is_active: true },
  { id: 'u-bh', full_name: 'Conni Buch', role: 'Buchhaltung', is_active: true }
];
const WEEK = { year: 2026, kw: 46, weekStart: '2026-11-09', weekEnd: '2026-11-15' };
const slot = o => Object.assign({ job_no: '26-0447.01', phase: 'setup', name: 'Loungemöbel', title: '261111_Estrel_Business of Apps',
  room: 'Auditorium', start_at: '2026-11-11T09:00', end_at: '2026-11-11T16:00', needed: 4, accepted_ids: [], notes: null }, o || {});
const row = o => Object.assign({ id: 'r1', year: 2026, kw: 46, date: '2026-11-11', sort: 0, job_no: null, phase: null, venue: 'Estrel',
  location: null, title: 'Stand 06', details: null, wann: 'Aufbau: 10 Uhr', ap: null, ap_user_id: null, notes: null, need: 2, people: [],
  updated_at: '2026-11-10T10:00:00Z' }, o || {});

test('plMonday: Monday of the ISO week, also across a year change', () => {
  assert.equal(ctx.plMonday('2026-11-11'), '2026-11-09');
  assert.equal(ctx.plMonday('2026-11-09'), '2026-11-09');
  assert.equal(ctx.plMonday('2026-11-15'), '2026-11-09');
  assert.equal(ctx.plMonday('2027-01-01'), '2026-12-28');
});

test('plWeekOf: ISO year and KW of the Monday', () => {
  assert.deepEqual(plain(ctx.plWeekOf('2026-11-09')), WEEK);
  assert.deepEqual(plain(ctx.plWeekOf('2026-12-28')), { year: 2026, kw: 53, weekStart: '2026-12-28', weekEnd: '2027-01-03' });
});

test('plShortName: first name, with the surname initial only when the first name is taken twice', () => {
  assert.equal(ctx.plShortName(USERS[1], USERS), 'Milan');
  assert.equal(ctx.plShortName(USERS[2], USERS), 'Feli K.');
  assert.equal(ctx.plShortName(USERS[3], USERS), 'Feli S.');
  assert.equal(ctx.plShortName({ id: 'x', full_name: '' }, USERS), '');
});

test('plWannText: reads back through planWhen', () => {
  assert.equal(ctx.plWannText('setup', '2026-11-11T09:00', '2026-11-11T16:00'), 'Aufbau: 09:00 - 16:00 Uhr');
  assert.equal(ctx.plWannText('teardown', '2026-11-12T18:00', '2026-11-13T01:00'), 'Abbau: 18:00 Uhr');
  assert.equal(ctx.plWannText('teardown', '2026-11-12T18:00', null), 'Abbau: 18:00 Uhr');
  assert.equal(ctx.plWannText('setup', '2026-11-11', null), 'Aufbau');
  assert.deepEqual(plain(ctx.planWhen([ctx.plWannText('setup', '2026-11-11T09:00', '2026-11-11T16:00')])),
    { time: '09:00', end: '16:00', prefix: null, label: 'Aufbau' });
});

test('plRowFromSlot: an Auftrag phase becomes a row with the accepted people already placed', () => {
  const r = plain(ctx.plRowFromSlot(slot({ accepted_ids: ['u-mil', 'u-fe1', 'u-unknown'] }), WEEK, USERS));
  assert.equal(r.year, 2026); assert.equal(r.kw, 46);
  assert.equal(r.date, '2026-11-11');
  assert.equal(r.job_no, '26-0447.01'); assert.equal(r.phase, 'setup');
  assert.equal(r.venue, 'Estrel');
  assert.equal(r.location, 'Business of Apps\nAuditorium');
  assert.equal(r.title, 'Loungemöbel');
  assert.equal(r.wann, 'Aufbau: 09:00 - 16:00 Uhr');
  assert.equal(r.need, 4);
  assert.deepEqual(r.people, [{ user_id: 'u-mil', name: 'Milan', role: 'MA', note: null }, { user_id: 'u-fe1', name: 'Feli K.', role: 'MA', note: null }]);
  assert.equal('id' in r, false);
});

test('plRowFromSlot: no MA number yet and a title without parts', () => {
  const r = plain(ctx.plRowFromSlot(slot({ needed: null, title: 'Lager', room: null, accepted_ids: null }), WEEK, USERS));
  assert.equal(r.need, 0);
  assert.equal(r.venue, 'Lager');
  assert.equal(r.location, null);
  assert.deepEqual(r.people, []);
});

test('plMergeSlots: new phases of the week are added, phases of other weeks are not', () => {
  const m = plain(ctx.plMergeSlots([], [slot(), slot({ phase: 'teardown', start_at: '2026-11-12T19:15', end_at: null }),
    slot({ job_no: '26-0500.01', start_at: '2026-11-18T08:00' })], WEEK, USERS));
  assert.equal(m.add.length, 2);
  assert.deepEqual(m.add.map(r => r.phase), ['setup', 'teardown']);
  assert.deepEqual(m.patch, []);
  assert.deepEqual(m.stale, []);
});

test('plMergeSlots: an existing row keeps its people and texts; day and MA number follow the Auftrag', () => {
  const have = row({ id: 'r9', job_no: '26-0447.01', phase: 'setup', title: 'von Hand geändert', need: 4,
    people: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }] });
  const m = plain(ctx.plMergeSlots([have], [slot({ start_at: '2026-11-12T09:00', needed: 6, accepted_ids: ['u-mil'] })], WEEK, USERS));
  assert.deepEqual(m.add, []);
  assert.deepEqual(m.patch, [{ id: 'r9', changes: { date: '2026-11-12', need: 6 } }]);
});

test('plMergeSlots: nothing to patch when day and number are the same; a missing MA number never zeroes the row', () => {
  const have = row({ id: 'r9', job_no: '26-0447.01', phase: 'setup', need: 4 });
  assert.deepEqual(plain(ctx.plMergeSlots([have], [slot()], WEEK, USERS)).patch, []);
  assert.deepEqual(plain(ctx.plMergeSlots([have], [slot({ needed: null })], WEEK, USERS)).patch, []);
});

test('plMergeSlots: an Auftrag row whose phase left the week is reported, never removed', () => {
  const have = row({ id: 'r9', job_no: '26-0447.01', phase: 'setup' });
  const m = plain(ctx.plMergeSlots([have, row({ id: 'free' })], [slot({ start_at: '2026-11-18T09:00' })], WEEK, USERS));
  assert.deepEqual(m.stale, ['r9']);
  assert.deepEqual(m.add, []); assert.deepEqual(m.patch, []);
  // slots not loaded (null): nothing is called stale
  assert.deepEqual(plain(ctx.plMergeSlots([have], null, WEEK, USERS)).stale, []);
});

test('plRowsFromPlan: an imported week becomes a draft, open places count into the need', () => {
  const rows = plain(ctx.plRowsFromPlan([{ id: 's1', date: '2026-11-11', sort: 3, key: 'k', venue: 'Estrel', location: 'Auditorium\nBoA', title: 'Sofas',
    details: '4 Loungesofa', wann: 'Aufbau: 11 Uhr', ap: 'Sabine', ap_user_id: 'u-pl', notes: 'LeihLkw', open_slots: [{ role: 'MA', count: 2, note: null }],
    plan_assignments: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }, { user_id: null, name: 'Tom', role: 'Zenjob', note: '8 - 16 Uhr' },
      { user_id: 'u-mil', name: 'Milan', role: 'Fahrer', note: 'BAR PL 550' }] }], WEEK));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal('id' in r, false);
  assert.equal(r.date, '2026-11-11'); assert.equal(r.sort, 3);
  assert.equal(r.venue, 'Estrel'); assert.equal(r.location, 'Auditorium\nBoA'); assert.equal(r.details, '4 Loungesofa');
  assert.equal(r.ap, 'Sabine'); assert.equal(r.ap_user_id, 'u-pl');
  assert.equal(r.job_no, null);
  assert.equal(r.need, 4); // AL + Zenjob + 2 open; the driver is extra
  assert.equal(r.people.length, 3);
  assert.deepEqual(r.people[1], { user_id: null, name: 'Tom', role: 'Zenjob', note: '8 - 16 Uhr' });
});

test('plFilled / plOpenSlots: drivers never fill an MA place', () => {
  const r = row({ need: 3, people: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL' }, { user_id: 'u-mil', name: 'Milan', role: 'Fahrer' }] });
  assert.equal(ctx.plFilled(r), 1);
  assert.deepEqual(plain(ctx.plOpenSlots(r)), [{ role: 'MA', count: 2, note: null }]);
  assert.deepEqual(plain(ctx.plOpenSlots(row({ need: 1, people: [{ name: 'A', role: 'MA' }, { name: 'B', role: 'MA' }] }))), []);
  assert.deepEqual(plain(ctx.plOpenSlots(row({ need: null }))), []);
});

test('plToParsed: the shape planParse returns, ordered by day and time', () => {
  const p = plain(ctx.plToParsed(WEEK, [
    row({ id: 'b', date: '2026-11-12', wann: 'Abbau: ab 19.15 Uhr', title: 'Sofas', need: 0 }),
    row({ id: 'a2', date: '2026-11-11', wann: 'Aufbau: 11 Uhr', title: 'Spät', sort: 0 }),
    row({ id: 'a1', date: '2026-11-11', wann: 'Aufbau: 8 Uhr\nLeergut hinter Vorhang', title: 'Früh', location: 'Halle 1\nBoA', details: '4 Sofa\n2 Tische',
      notes: 'LeihLkw', ap: 'Sabine', ap_user_id: 'u-pl', need: 3,
      people: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }, { user_id: null, name: 'Tom', role: 'Zenjob', note: 'ab 9 Uhr' }] })
  ], USERS));
  assert.equal(p.year, 2026); assert.equal(p.kw, 46); assert.equal(p.weekStart, '2026-11-09'); assert.equal(p.weekEnd, '2026-11-15');
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.shifts.map(s => s.title), ['Früh', 'Spät', 'Sofas']);
  assert.deepEqual(p.shifts.map(s => s.sort), [0, 1, 2]);
  const s = p.shifts[0];
  assert.deepEqual(s.location, ['Halle 1', 'BoA']);
  assert.deepEqual(s.details, ['4 Sofa', '2 Tische']);
  assert.deepEqual(s.wann, ['Aufbau: 8 Uhr', 'Leergut hinter Vorhang']);
  assert.deepEqual(s.notes, ['LeihLkw']);
  assert.equal(s.ap, 'Sabine'); assert.equal(s.apUserId, 'u-pl');
  assert.equal(s.key, '2026-11-11|estrel|früh');
  assert.deepEqual(s.open, [{ role: 'MA', count: 1, note: null }]);
  assert.deepEqual(s.people, [{ name: 'Kacper', role: 'AL', note: null, userId: 'u-kac' }, { name: 'Tom', role: 'Zenjob', note: 'ab 9 Uhr', userId: null }]);
  // planShiftRow (plan-parser.js) must accept it as is
  const dbRow = plain(ctx.planShiftRow(s, 'w1', 'neu'));
  assert.equal(dbRow.location, 'Halle 1\nBoA'); assert.equal(dbRow.wann, 'Aufbau: 8 Uhr\nLeergut hinter Vorhang'); assert.equal(dbRow.ap_user_id, 'u-pl');
});

test('plToParsed: same place and title twice on a day get numbered keys like planParse', () => {
  const p = plain(ctx.plToParsed(WEEK, [row({ id: 'a', wann: 'Aufbau: 8 Uhr' }), row({ id: 'b', wann: 'Abbau: 20 Uhr' })], USERS));
  assert.deepEqual(p.shifts.map(s => s.key), ['2026-11-11|estrel|stand 06', '2026-11-11|estrel|stand 06#2']);
});

test('plToParsed: a deactivated or unknown person is published by name only', () => {
  const p = plain(ctx.plToParsed(WEEK, [row({ people: [{ user_id: 'u-old', name: 'Alt', role: 'MA', note: null },
    { user_id: 'u-nobody', name: 'Wer', role: 'MA', note: null }, { name: 'Ohne', role: 'MA' }] })], USERS));
  assert.deepEqual(p.shifts[0].people.map(x => x.userId), [null, null, null]);
  assert.deepEqual(p.shifts[0].people.map(x => x.name), ['Alt', 'Wer', 'Ohne']);
  assert.equal(p.shifts[0].people[2].note, null);
});

test('plToParsed + planDiff: publishing an unchanged draft again marks nothing', () => {
  const rows = [row({ people: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }] })];
  const first = ctx.plToParsed(WEEK, rows, USERS);
  // what the database hands back after the first publish
  const stored = first.shifts.map((s, i) => ctx.planShiftFromDb(Object.assign(plain(ctx.planShiftRow(s, 'w', null)), { id: 'db' + i,
    plan_assignments: s.people.map(x => ({ name: x.name, role: x.role, note: x.note, user_id: x.userId })) })));
  const d = plain(ctx.planDiff(stored, ctx.plToParsed(WEEK, rows, USERS).shifts));
  assert.deepEqual(d.status, [null]);
  assert.deepEqual(d.removed, []);
});

test('plCandidates: applicants first, then free people, blocked ones last; nobody twice', () => {
  const r = row({ id: 'r1', people: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL' }] });
  const other = row({ id: 'r2', people: [{ user_id: 'u-fe2', name: 'Feli S.', role: 'MA' }] });
  const otherDay = row({ id: 'r3', date: '2026-11-12', people: [{ user_id: 'u-mil', name: 'Milan', role: 'MA' }] });
  const c = plain(ctx.plCandidates(r, [r, other, otherDay], USERS, { 'u-fe1|2026-11-11': 'nein', 'u-mil|2026-11-12': 'nein' }, { 'u-pl': 'offen' }));
  assert.deepEqual(c.map(x => x.id), ['u-pl', 'u-mil', 'u-fe2', 'u-fe1']);
  assert.deepEqual(c[0], { id: 'u-pl', name: 'Sabine', applied: 'offen', level: null, busy: false, free: false });
  assert.deepEqual(c[1], { id: 'u-mil', name: 'Milan', applied: null, level: null, busy: false, free: false });
  assert.equal(c[2].busy, true);
  assert.equal(c[3].level, 'nein');
});

test('plCandidates: "nur im Notfall" sits between free and busy; a declined applicant is not pushed forward', () => {
  const r = row({ id: 'r1' });
  const c = plain(ctx.plCandidates(r, [r], USERS, { 'u-kac|2026-11-11': 'notfall' }, { 'u-mil': 'abgelehnt', 'u-fe2': 'angenommen' }));
  assert.equal(c[0].id, 'u-fe2'); assert.equal(c[0].applied, 'angenommen');
  assert.equal(c[c.length - 1].id, 'u-kac');
  assert.equal(c.find(x => x.id === 'u-mil').applied, null);
  assert.equal(c.some(x => ['u-old', 'u-gast', 'u-bh'].indexOf(x.id) !== -1), false);
});

test('plCanEdit / plCanPublish / plCanOpen', () => {
  const job = row({ job_no: '26-0447.01', phase: 'setup' });
  const planner = { id: 'u-mil', role: 'MA', plans: true }, admin = { id: 'a', role: 'Admin', plans: false };
  const pl = { id: 'u-pl', role: 'PL', plans: false }, al = { id: 'u-kac', role: 'AL', plans: false };
  assert.equal(ctx.plCanEdit(row(), planner), true);
  assert.equal(ctx.plCanEdit(row(), admin), true);
  assert.equal(ctx.plCanEdit(row(), pl), false);                       // free row
  assert.equal(ctx.plCanEdit(job, pl), true);                          // AP empty
  assert.equal(ctx.plCanEdit(Object.assign({}, job, { ap_user_id: 'u-pl' }), pl), true);
  assert.equal(ctx.plCanEdit(Object.assign({}, job, { ap_user_id: 'someone' }), pl), false);
  assert.equal(ctx.plCanEdit(job, al), false);
  assert.equal(ctx.plCanPublish(planner), true); assert.equal(ctx.plCanPublish(admin), true); assert.equal(ctx.plCanPublish(pl), false);
  assert.equal(ctx.plCanOpen(pl), true); assert.equal(ctx.plCanOpen(planner), true); assert.equal(ctx.plCanOpen(al), false);
  assert.equal(ctx.plCanOpen({ id: 'g', role: 'Gast', plans: true }), false);
  assert.equal(ctx.plCanOpen(null), false);
});

test('plPublishProblems: an empty draft and a row without place and title are refused', () => {
  assert.deepEqual(plain(ctx.plPublishProblems([])), ['Der Entwurf ist leer. Soll die Woche weg, nimm „Woche löschen“.']);
  assert.deepEqual(plain(ctx.plPublishProblems([row()])), []);
  assert.deepEqual(plain(ctx.plPublishProblems([row({ venue: ' ', title: null })])), ['Ein Eintrag am Mi 11.11. hat weder Ort noch Titel.']);
});

test('plAddPerson / plRemovePerson: no duplicates, the row itself stays untouched', () => {
  const r = row({ people: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }] });
  assert.equal(ctx.plAddPerson(r, { user_id: 'u-kac', name: 'Kacper', role: 'MA' }), null);
  assert.equal(ctx.plAddPerson(r, { user_id: null, name: ' kacper ', role: 'MA' }), null);
  assert.equal(ctx.plAddPerson(r, { name: '  ', role: 'MA' }), null);
  assert.deepEqual(plain(ctx.plAddPerson(r, { user_id: null, name: ' Tom ', role: 'Zenjob', note: '' })),
    [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }, { user_id: null, name: 'Tom', role: 'Zenjob', note: null }]);
  assert.equal(r.people.length, 1);
  assert.deepEqual(plain(ctx.plRemovePerson(r, 0)), []);
  assert.equal(r.people.length, 1);
});

test('plRowPatch: a save is tied to the updated_at that was loaded', () => {
  assert.deepEqual(plain(ctx.plRowPatch(row(), { need: 5 })), { match: { id: 'r1', updated_at: '2026-11-10T10:00:00Z' }, values: { need: 5 } });
});

test('plWerLines: the Wer cell in Daniel\'s notation, read back unchanged by planParseWer', () => {
  const r = row({ need: 5, people: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }, { user_id: 'u-mil', name: 'Milan', role: 'MA', note: 'ab 14 Uhr' },
    { user_id: null, name: 'Tom', role: 'Zenjob', note: null }, { user_id: 'u-fe1', name: 'Feli K.', role: 'Fahrer', note: 'BAR PL 550' }] });
  const lines = plain(ctx.plWerLines(r));
  assert.deepEqual(lines, ['Kacper (AL)', 'Milan (ab 14 Uhr)', '1 x Zenjob', 'Tom', 'BAR PL 550 | Feli K.', '2 MA']);
  const back = plain(ctx.planParseWer(lines));
  assert.deepEqual(back.people.map(p => [p.name, p.role]), [['Kacper', 'AL'], ['Milan', 'MA'], ['Tom', 'Zenjob'], ['Feli K.', 'Fahrer']]);
  assert.deepEqual(back.open, [{ role: 'MA', count: 2, note: null }]);
});

test('plPdfTable: day headings and one line of cells per row', () => {
  const t = plain(ctx.plPdfTable(WEEK, [row({ date: '2026-11-12', title: 'B' }), row({ location: 'Halle 1', details: '4 Sofa', ap: 'Sabine', need: 0 })]));
  assert.deepEqual(t.map(x => x.day || x.cells[1][0]), ['Mittwoch 11.11.26', 'Stand 06', 'Donnerstag 12.11.26', 'B']);
  assert.deepEqual(t[1].cells, [['Estrel', 'Halle 1'], ['Stand 06', '4 Sofa'], ['Aufbau: 10 Uhr'], [], ['Sabine']]);
});

test('plSeed: an uploaded plan becomes the draft, Auftrag phases land on their entry instead of twice', () => {
  const planShifts = [
    { id: 's1', date: '2026-11-11', sort: 0, key: 'k1', venue: 'Estrel', location: 'Auditorium\nBusiness of Apps', title: '4 Loungesofa weiß', wann: 'Aufbau: 11 Uhr',
      open_slots: [], plan_assignments: [{ user_id: 'u-kac', name: 'Kacper', role: 'AL', note: null }] },
    { id: 's2', date: '2026-11-11', sort: 1, key: 'k2', venue: 'Estrel', location: 'Dt. Post Betriebsräte', title: 'CH I', wann: 'Aufbau: 10 Uhr', open_slots: [], plan_assignments: [] }
  ];
  const slots = [slot({ link_set: false }), slot({ phase: 'teardown', start_at: '2026-11-12T19:15', end_at: null, link_set: false, accepted_ids: ['u-mil'] }),
    slot({ job_no: '26-0900.01', start_at: '2026-11-20T08:00', link_set: false })];
  const rows = plain(ctx.plSeed(planShifts, slots, WEEK, USERS));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].job_no, '26-0447.01'); assert.equal(rows[0].phase, 'setup');
  assert.equal(rows[0].need, 4);                       // the PL's number beats the count from the PDF
  assert.equal(rows[0].title, '4 Loungesofa weiß');    // Daniel's text stays
  assert.deepEqual(rows[0].people.map(p => p.name), ['Kacper']);
  assert.equal(rows[1].job_no, null);
  assert.equal(rows[2].phase, 'teardown'); assert.equal(rows[2].date, '2026-11-12');
  assert.deepEqual(rows[2].people.map(p => p.user_id), ['u-mil']);
});

test('plSeed: a week without a plan starts with the Auftrag phases only', () => {
  const rows = plain(ctx.plSeed([], [slot(), slot({ job_no: '26-0900.01', start_at: '2026-11-20T08:00' })], WEEK, USERS));
  assert.deepEqual(rows.map(r => r.job_no), ['26-0447.01']);
  assert.deepEqual(plain(ctx.plSeed([], null, WEEK, USERS)), []);
});

test('plLastChange / plHasUnpublished: edits after publishing are noticed, whatever the timestamp notation', () => {
  const rows = [row({ updated_at: '2026-11-10T10:00:00.5+00:00' }), row({ id: 'r2', updated_at: '2026-11-10T12:30:00.123456+00:00' })];
  assert.equal(ctx.plLastChange(rows), '2026-11-10T12:30:00.123456+00:00');
  assert.equal(ctx.plLastChange([]), null);
  assert.equal(ctx.plHasUnpublished(rows, '2026-11-10T12:30:00.123456+00:00'), false);
  assert.equal(ctx.plHasUnpublished(rows, '2026-11-10T12:30:00.123Z'), false);  // compared to the millisecond, 'Z' and '+00:00' alike
  assert.equal(ctx.plHasUnpublished(rows, '2026-11-10T12:29:59.999Z'), true);
  assert.equal(ctx.plHasUnpublished(rows, '2026-11-10T11:00:00Z'), true);
  assert.equal(ctx.plHasUnpublished(rows, null), false);
});

test('plCandidates: people who keep their Verfügbarkeit and have not blocked the day come before everyone unknown', () => {
  const r = row({ id: 'r1' }), other = row({ id: 'r2', people: [{ user_id: 'u-fe2', name: 'Feli S.', role: 'MA' }] });
  const tracked = { 'u-pl': true, 'u-fe1': true, 'u-fe2': true, 'u-kac': true };
  const c = plain(ctx.plCandidates(r, [r, other], USERS, { 'u-fe1|2026-11-11': 'notfall' }, { 'u-mil': 'offen' }, tracked));
  // Meldung, hat Zeit (Kacper, Sabine), unknown (nobody left), nur im Notfall, schon eingeplant
  assert.deepEqual(c.map(x => x.id), ['u-mil', 'u-kac', 'u-pl', 'u-fe1', 'u-fe2']);
  assert.deepEqual(c.map(x => x.free), [false, true, true, false, false]);
  // someone unknown sits between "hat Zeit" and "nur im Notfall"
  const c2 = plain(ctx.plCandidates(r, [r], USERS, { 'u-fe1|2026-11-11': 'notfall' }, {}, { 'u-pl': true, 'u-fe1': true }));
  assert.deepEqual(c2.map(x => x.id), ['u-pl', 'u-fe2', 'u-kac', 'u-mil', 'u-fe1']);
});

test('plSearchMatch: word beginnings of the short or the full name, without case and accents', () => {
  const m = (q, n, f) => ctx.plSearchMatch(q, n, f);
  assert.equal(m('', 'Patryk', 'Patryk Stańczyk'), true);
  assert.equal(m('pat', 'Patryk', 'Patryk Stańczyk'), true);
  assert.equal(m('STAN', 'Patryk', 'Patryk Stańczyk'), true);
  assert.equal(m('pat st', 'Patryk', 'Patryk Stańczyk'), true);
  assert.equal(m('ryk', 'Patryk', 'Patryk Stańczyk'), false);     // not in the middle of a word
  assert.equal(m('pat x', 'Patryk', 'Patryk Stańczyk'), false);
  assert.equal(m('jorg', 'Jörg', 'Jörg Müller'), true);
  assert.equal(m('mül', 'Jörg', 'Jörg Müller'), true);
  assert.equal(m('k.', 'Feli K.', 'Feli Kraus'), true);
  assert.equal(m('lukasz', 'Łukasz', ''), true);
});

test('plPlaceRole: the picked role, but an app user is never booked as an agency worker', () => {
  assert.equal(ctx.plPlaceRole('AL', true), 'AL');
  assert.equal(ctx.plPlaceRole('Fahrer', true), 'Fahrer');
  assert.equal(ctx.plPlaceRole('Zenjob', true), 'MA');
  assert.equal(ctx.plPlaceRole('Zenjob', false), 'Zenjob');
  assert.equal(ctx.plPlaceRole('ROCKiT', false), 'ROCKiT');
  assert.equal(ctx.plPlaceRole(undefined, true), 'MA');
  assert.equal(ctx.plPlaceRole('Chef', false), 'MA');
});

test('plWasText / plWasSplit: "Was" is one field with a line per item, first line = heading', () => {
  assert.equal(ctx.plWasText(row({ title: '4 Loungesofa weiß', details: '2 Stehtische\n1 Teppich' })), '4 Loungesofa weiß\n2 Stehtische\n1 Teppich');
  assert.equal(ctx.plWasText(row({ title: null, details: null })), '');
  assert.equal(ctx.plWasText(row({ title: null, details: '2 Stehtische' })), '2 Stehtische');
  assert.deepEqual(plain(ctx.plWasSplit(' 4 Loungesofa weiß \n\n2 Stehtische\n 1 Teppich ')), { title: '4 Loungesofa weiß', details: '2 Stehtische\n1 Teppich' });
  assert.deepEqual(plain(ctx.plWasSplit('Nur eine Zeile')), { title: 'Nur eine Zeile', details: null });
  assert.deepEqual(plain(ctx.plWasSplit('')), { title: null, details: null });
  assert.deepEqual(plain(ctx.plWasSplit(null)), { title: null, details: null });
  const r = row({ title: 'A', details: 'B\nC' });
  assert.deepEqual(plain(ctx.plWasSplit(ctx.plWasText(r))), { title: 'A', details: 'B\nC' });
});

test('plIsAppWeek: only while the published Stand of the draft is the current plan', () => {
  assert.equal(ctx.plIsAppWeek({ published_version: 2 }, { version: 2 }), true);
  assert.equal(ctx.plIsAppWeek({ published_version: 2 }, { version: 3 }), false);
  assert.equal(ctx.plIsAppWeek({ published_version: null }, { version: 1 }), false);
  assert.equal(ctx.plIsAppWeek({ published_version: 1 }, null), false);
  assert.equal(ctx.plIsAppWeek(null, { version: 1 }), false);
});

test('plRowKeys: every draft row knows the key of its published entry', () => {
  const k = plain(ctx.plRowKeys(WEEK, [row({ id: 'a', wann: 'Aufbau: 8 Uhr' }), row({ id: 'b', wann: 'Abbau: 20 Uhr' }), row({ id: 'c', title: 'Anderes' })], USERS));
  assert.deepEqual(k, { a: '2026-11-11|estrel|stand 06', b: '2026-11-11|estrel|stand 06#2', c: '2026-11-11|estrel|anderes' });
});

test('plAppliedFor: Auftrag Meldungen and Meldungen on the published entry in one map', () => {
  const job = row({ job_no: '26-0447.01', phase: 'setup' });
  const apps = { '26-0447.01|setup': { 'u-mil': 'offen', 'u-kac': 'abgelehnt' }, '26-0447.01|teardown': { 'u-pl': 'offen' } };
  const interest = { 'k1': { 'u-fe1': 'offen', 'u-kac': 'angenommen', 'u-mil': 'abgelehnt' } };
  assert.deepEqual(plain(ctx.plAppliedFor(job, 'k1', apps, interest)), { 'u-mil': 'offen', 'u-kac': 'angenommen', 'u-fe1': 'offen' });
  assert.deepEqual(plain(ctx.plAppliedFor(row(), 'k1', apps, interest)), { 'u-fe1': 'offen', 'u-kac': 'angenommen', 'u-mil': 'abgelehnt' });
  assert.deepEqual(plain(ctx.plAppliedFor(row(), undefined, apps, interest)), {});
  assert.deepEqual(plain(ctx.plAppliedFor(job, 'nope', null, null)), {});
});

test('plOpenMeldungen: only open ones of people who are not on the row yet', () => {
  const r = row({ people: [{ user_id: 'u-kac', name: 'Kacper', role: 'MA' }] });
  assert.equal(ctx.plOpenMeldungen(r, { 'u-kac': 'offen', 'u-mil': 'offen', 'u-fe1': 'angenommen', 'u-fe2': 'abgelehnt' }), 1);
  assert.equal(ctx.plOpenMeldungen(r, {}), 0);
  assert.equal(ctx.plOpenMeldungen(row(), { 'u-kac': 'offen', 'u-mil': 'offen' }), 2);
});

test('plMeldungTargets: which records change when someone is placed or taken off', () => {
  const job = row({ job_no: '26-0447.01', phase: 'setup' });
  const apps = { '26-0447.01|setup': { 'u-mil': 'offen', 'u-kac': 'angenommen' } }, interest = { k1: { 'u-mil': 'offen', 'u-fe1': 'offen' } };
  assert.deepEqual(plain(ctx.plMeldungTargets(job, 'k1', 'w1', apps, interest, 'u-mil', 'offen')), [
    { kind: 'order', job_no: '26-0447.01', phase: 'setup', user_id: 'u-mil' }, { kind: 'shift', week_id: 'w1', shift_key: 'k1', user_id: 'u-mil' }]);
  assert.deepEqual(plain(ctx.plMeldungTargets(row(), 'k1', 'w1', apps, interest, 'u-fe1', 'offen')), [{ kind: 'shift', week_id: 'w1', shift_key: 'k1', user_id: 'u-fe1' }]);
  assert.deepEqual(plain(ctx.plMeldungTargets(job, 'k1', 'w1', apps, interest, 'u-kac', 'angenommen')), [{ kind: 'order', job_no: '26-0447.01', phase: 'setup', user_id: 'u-kac' }]);
  assert.deepEqual(plain(ctx.plMeldungTargets(job, 'k1', 'w1', apps, interest, 'u-kac', 'offen')), []);      // already answered
  assert.deepEqual(plain(ctx.plMeldungTargets(job, 'k1', 'w1', apps, interest, 'u-pl', 'offen')), []);       // never reported
  assert.deepEqual(plain(ctx.plMeldungTargets(row(), 'k1', null, apps, interest, 'u-fe1', 'offen')), []);    // week not published
});
