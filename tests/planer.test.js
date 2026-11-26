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
  { id: 'u-kac', full_name: 'Konrad Nowak', role: 'AL', is_active: true },
  { id: 'u-mil', full_name: 'Mats Berg', role: 'MA', is_active: true },
  { id: 'u-fe1', full_name: 'Frida Kraus', role: 'MA', is_active: true },
  { id: 'u-fe2', full_name: 'Frida Sommer', role: 'MA', is_active: true },
  { id: 'u-pl', full_name: 'Sabine Lang', role: 'PL', is_active: true },
  { id: 'u-old', full_name: 'Alt Weg', role: 'MA', is_active: false },
  { id: 'u-gast', full_name: 'Gast Zugang', role: 'Gast', is_active: true },
  { id: 'u-bh', full_name: 'Clara Buch', role: 'Buchhaltung', is_active: true }
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
  assert.equal(ctx.plShortName(USERS[1], USERS), 'Mats');
  assert.equal(ctx.plShortName(USERS[2], USERS), 'Frida K.');
  assert.equal(ctx.plShortName(USERS[3], USERS), 'Frida S.');
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
  assert.deepEqual(r.people, [{ user_id: 'u-mil', name: 'Mats', role: 'MA', note: null }, { user_id: 'u-fe1', name: 'Frida K.', role: 'MA', note: null }]);
  assert.equal('id' in r, false);
});

test('plRowFromSlot: no MA number yet and a title without parts', () => {
  const r = plain(ctx.plRowFromSlot(slot({ needed: null, title: 'Lager', room: null, accepted_ids: null }), WEEK, USERS));
  assert.equal(r.need, null); // "MA?" in PLANEN until someone enters the number
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
    people: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }] });
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
    plan_assignments: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }, { user_id: null, name: 'Tom', role: 'Zenjob', note: '8 - 16 Uhr' },
      { user_id: 'u-mil', name: 'Mats', role: 'Fahrer', note: 'BAR PL 550' }] }], WEEK));
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
  const r = row({ need: 3, people: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL' }, { user_id: 'u-mil', name: 'Mats', role: 'Fahrer' }] });
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
      people: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }, { user_id: null, name: 'Tom', role: 'Zenjob', note: 'ab 9 Uhr' }] })
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
  assert.deepEqual(s.people, [{ name: 'Konrad', role: 'AL', note: null, userId: 'u-kac' }, { name: 'Tom', role: 'Zenjob', note: 'ab 9 Uhr', userId: null }]);
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
  const rows = [row({ people: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }] })];
  const first = ctx.plToParsed(WEEK, rows, USERS);
  // what the database hands back after the first publish
  const stored = first.shifts.map((s, i) => ctx.planShiftFromDb(Object.assign(plain(ctx.planShiftRow(s, 'w', null)), { id: 'db' + i,
    plan_assignments: s.people.map(x => ({ name: x.name, role: x.role, note: x.note, user_id: x.userId })) })));
  const d = plain(ctx.planDiff(stored, ctx.plToParsed(WEEK, rows, USERS).shifts));
  assert.deepEqual(d.status, [null]);
  assert.deepEqual(d.removed, []);
});

test('plCandidates: applicants first, then free people, blocked ones last; nobody twice', () => {
  const r = row({ id: 'r1', people: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL' }] });
  const other = row({ id: 'r2', people: [{ user_id: 'u-fe2', name: 'Frida S.', role: 'MA' }] });
  const otherDay = row({ id: 'r3', date: '2026-11-12', people: [{ user_id: 'u-mil', name: 'Mats', role: 'MA' }] });
  const c = plain(ctx.plCandidates(r, [r, other, otherDay], USERS, { 'u-fe1|2026-11-11': 'nein', 'u-mil|2026-11-12': 'nein' }, { 'u-pl': 'offen' }));
  assert.deepEqual(c.map(x => x.id), ['u-pl', 'u-mil', 'u-fe2', 'u-fe1']);
  assert.deepEqual(c[0], { id: 'u-pl', name: 'Sabine', applied: 'offen', level: null, busy: false, free: false });
  assert.deepEqual(c[1], { id: 'u-mil', name: 'Mats', applied: null, level: null, busy: false, free: false });
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
  const r = row({ people: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }] });
  assert.equal(ctx.plAddPerson(r, { user_id: 'u-kac', name: 'Konrad', role: 'MA' }), null);
  assert.equal(ctx.plAddPerson(r, { user_id: null, name: ' konrad ', role: 'MA' }), null);
  assert.equal(ctx.plAddPerson(r, { name: '  ', role: 'MA' }), null);
  assert.deepEqual(plain(ctx.plAddPerson(r, { user_id: null, name: ' Tom ', role: 'Zenjob', note: '' })),
    [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }, { user_id: null, name: 'Tom', role: 'Zenjob', note: null }]);
  assert.equal(r.people.length, 1);
  assert.deepEqual(plain(ctx.plRemovePerson(r, 0)), []);
  assert.equal(r.people.length, 1);
});

test('plRowPatch: a save is tied to the updated_at that was loaded', () => {
  assert.deepEqual(plain(ctx.plRowPatch(row(), { need: 5 })), { match: { id: 'r1', updated_at: '2026-11-10T10:00:00Z' }, values: { need: 5 } });
});

test('plWerLines: the Wer cell in Dennis\'s notation, read back unchanged by planParseWer', () => {
  const r = row({ need: 5, people: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }, { user_id: 'u-mil', name: 'Mats', role: 'MA', note: 'ab 14 Uhr' },
    { user_id: null, name: 'Tom', role: 'Zenjob', note: null }, { user_id: 'u-fe1', name: 'Frida K.', role: 'Fahrer', note: 'BAR PL 550' }] });
  const lines = plain(ctx.plWerLines(r));
  assert.deepEqual(lines, ['Konrad (AL)', 'Mats (ab 14 Uhr)', '1 x Zenjob', 'Tom', 'BAR PL 550 | Frida K.', '2 MA']);
  const back = plain(ctx.planParseWer(lines));
  assert.deepEqual(back.people.map(p => [p.name, p.role]), [['Konrad', 'AL'], ['Mats', 'MA'], ['Tom', 'Zenjob'], ['Frida K.', 'Fahrer']]);
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
      open_slots: [], plan_assignments: [{ user_id: 'u-kac', name: 'Konrad', role: 'AL', note: null }] },
    { id: 's2', date: '2026-11-11', sort: 1, key: 'k2', venue: 'Estrel', location: 'Dt. Post Betriebsräte', title: 'CH I', wann: 'Aufbau: 10 Uhr', open_slots: [], plan_assignments: [] }
  ];
  const slots = [slot({ link_set: false }), slot({ phase: 'teardown', start_at: '2026-11-12T19:15', end_at: null, link_set: false, accepted_ids: ['u-mil'] }),
    slot({ job_no: '26-0900.01', start_at: '2026-11-20T08:00', link_set: false })];
  const rows = plain(ctx.plSeed(planShifts, slots, WEEK, USERS));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].job_no, '26-0447.01'); assert.equal(rows[0].phase, 'setup');
  assert.equal(rows[0].need, 4);                       // the PL's number beats the count from the PDF
  assert.equal(rows[0].title, '4 Loungesofa weiß');    // Dennis's text stays
  assert.deepEqual(rows[0].manual, ['wann', 'location', 'title']); // and a revised Bestätigung never overwrites it
  assert.equal('manual' in rows[2], false);             // a phase that came without plan entry follows the Auftrag
  assert.deepEqual(rows[0].people.map(p => p.name), ['Konrad']);
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
  const r = row({ id: 'r1' }), other = row({ id: 'r2', people: [{ user_id: 'u-fe2', name: 'Frida S.', role: 'MA' }] });
  const tracked = { 'u-pl': true, 'u-fe1': true, 'u-fe2': true, 'u-kac': true };
  const c = plain(ctx.plCandidates(r, [r, other], USERS, { 'u-fe1|2026-11-11': 'notfall' }, { 'u-mil': 'offen' }, tracked));
  // Meldung, hat Zeit (Konrad, Sabine), unknown (nobody left), nur im Notfall, schon eingeplant
  assert.deepEqual(c.map(x => x.id), ['u-mil', 'u-kac', 'u-pl', 'u-fe1', 'u-fe2']);
  assert.deepEqual(c.map(x => x.free), [false, true, true, false, false]);
  // someone unknown sits between "hat Zeit" and "nur im Notfall"
  const c2 = plain(ctx.plCandidates(r, [r], USERS, { 'u-fe1|2026-11-11': 'notfall' }, {}, { 'u-pl': true, 'u-fe1': true }));
  assert.deepEqual(c2.map(x => x.id), ['u-pl', 'u-fe2', 'u-kac', 'u-mil', 'u-fe1']);
});

test('plSearchMatch: word beginnings of the short or the full name, without case and accents', () => {
  const m = (q, n, f) => ctx.plSearchMatch(q, n, f);
  assert.equal(m('', 'Piotr', 'Piotr Sieńkowski'), true);
  assert.equal(m('pio', 'Piotr', 'Piotr Sieńkowski'), true);
  assert.equal(m('SIEN', 'Piotr', 'Piotr Sieńkowski'), true);
  assert.equal(m('pio si', 'Piotr', 'Piotr Sieńkowski'), true);
  assert.equal(m('otr', 'Piotr', 'Piotr Sieńkowski'), false);     // not in the middle of a word
  assert.equal(m('pio x', 'Piotr', 'Piotr Sieńkowski'), false);
  assert.equal(m('jorg', 'Jörg', 'Jörg Müller'), true);
  assert.equal(m('mül', 'Jörg', 'Jörg Müller'), true);
  assert.equal(m('k.', 'Frida K.', 'Frida Kraus'), true);
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
  const r = row({ people: [{ user_id: 'u-kac', name: 'Konrad', role: 'MA' }] });
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

test('plKindOfColor: Dennis\'s row colours → Art', () => {
  const k = c => ctx.plKindOfColor(c);
  assert.equal(k(null), 'auftrag'); assert.equal(k(''), 'auftrag'); assert.equal(k('#ffffff'), 'auftrag'); assert.equal(k('#d9d9d9'), 'auftrag');
  assert.equal(k('#8db4e2'), 'angebot'); assert.equal(k('#9dc3e6'), 'angebot'); assert.equal(k('#00b0f0'), 'angebot'); assert.equal(k('#0070c0'), 'angebot');
  assert.equal(k('#00b050'), 'bus'); assert.equal(k('#92d050'), 'bus');
  assert.equal(k('#ffff00'), 'intern'); assert.equal(k('#fcd5b4'), 'intern'); assert.equal(k('#ccc0da'), 'intern');
  assert.equal(k('kein hex'), 'auftrag');
});

test('plKind: unset is an Auftrag; without the column nothing is assumed', () => {
  assert.equal(ctx.plKind(row()), null);                                            // column not there yet
  assert.equal(ctx.plKind(row({ kind: null })), 'auftrag');                         // free entry
  assert.equal(ctx.plKind(row({ kind: null, job_no: '26-0447.01', phase: 'setup' })), 'auftrag');
  assert.equal(ctx.plKind(row({ kind: 'angebot', job_no: '26-0447.01', phase: 'setup' })), 'angebot');
  assert.equal(ctx.plKind(row({ kind: 'unsinn' })), 'auftrag');
  assert.equal(ctx.plKind(row({ kind: 'intern' })), 'intern');
});

test('Art: seeded from Auftrag and from the uploaded plan, published as the row colour', () => {
  assert.equal(ctx.plRowFromSlot(slot(), WEEK, USERS).kind, 'auftrag');
  const seeded = plain(ctx.plRowsFromPlan([{ id: 's1', date: '2026-11-11', venue: 'A', title: 'weiß', color: null, plan_assignments: [] },
    { id: 's2', date: '2026-11-11', venue: 'B', title: 'gelb', color: '#ffff00', plan_assignments: [] },
    { id: 's3', date: '2026-11-11', venue: 'C', title: 'grün', color: '#00b050', plan_assignments: [] }], WEEK));
  assert.deepEqual(seeded.map(r => r.kind), ['auftrag', 'intern', 'bus']);
  const p = plain(ctx.plToParsed(WEEK, [row({ id: 'a', title: 'A', kind: 'auftrag' }), row({ id: 'b', title: 'B', kind: 'angebot' }),
    row({ id: 'c', title: 'C', kind: 'intern' }), row({ id: 'd', title: 'D', kind: 'bus' }), row({ id: 'e', title: 'E', kind: null }), row({ id: 'f', title: 'F' })], USERS));
  assert.deepEqual(p.shifts.map(s => s.color), [null, '#8db4e2', '#ffff00', '#00b050', null, null]);
  // what gets published reads back as the same Art
  assert.deepEqual(p.shifts.slice(0, 4).map(s => ctx.plKindOfColor(s.color)), ['auftrag', 'angebot', 'intern', 'bus']);
});

test('plWithoutKind: rows for a database that has no Art column yet', () => {
  const rows = [row({ kind: 'angebot' }), row({ id: 'r2' })];
  const out = plain(ctx.plWithoutKind(rows));
  assert.equal('kind' in out[0], false); assert.equal(out[0].title, 'Stand 06');
  assert.equal(rows[0].kind, 'angebot'); // the originals stay
});

test('plPdfTable: an Angebot is named in the Datum cell', () => {
  const t = plain(ctx.plPdfTable(WEEK, [row({ kind: 'angebot', location: 'Halle 1' })]));
  assert.deepEqual(t[1].cells[0], ['Estrel', 'Halle 1', 'ANGEBOT']);
});

test('open places that are not MA places survive a draft (a missing driver, agency staff)', () => {
  const rows = plain(ctx.plRowsFromPlan([{ id: 's1', date: '2026-11-21', venue: 'Erlebnis Plus', title: 'Stadtrundfahrt', color: '#00b050', wann: '10:30 - 13:30 Uhr',
    open_slots: [{ role: 'Fahrer', count: 1, note: 'Spreesegler' }, { role: 'MA', count: 2, note: null }, { role: 'Zenjob', count: 3, note: null }], plan_assignments: [] }], WEEK));
  assert.equal(rows[0].need, 2);
  assert.deepEqual(rows[0].open_other, [{ role: 'Fahrer', count: 1, note: 'Spreesegler' }, { role: 'Zenjob', count: 3, note: null }]);
  assert.deepEqual(plain(ctx.plOpenSlots(rows[0])), [{ role: 'MA', count: 2, note: null }, { role: 'Fahrer', count: 1, note: 'Spreesegler' }, { role: 'Zenjob', count: 3, note: null }]);
  // publishing an untouched draft of an uploaded week changes nothing
  const stored = ctx.planShiftFromDb({ id: 's1', key: '2026-11-21|erlebnis plus|stadtrundfahrt', date: '2026-11-21', venue: 'Erlebnis Plus', title: 'Stadtrundfahrt',
    wann: '10:30 - 13:30 Uhr', open_slots: [{ note: 'Spreesegler', role: 'Fahrer', count: 1 }], plan_assignments: [] });
  const again = ctx.plToParsed(WEEK, ctx.plRowsFromPlan([{ id: 's1', date: '2026-11-21', venue: 'Erlebnis Plus', title: 'Stadtrundfahrt', wann: '10:30 - 13:30 Uhr',
    open_slots: [{ note: 'Spreesegler', role: 'Fahrer', count: 1 }], plan_assignments: [] }], WEEK).map((r, i) => Object.assign({ id: 'r' + i }, r)), USERS);
  assert.deepEqual(plain(ctx.planDiff([stored], again.shifts).status), [null]);
});

test('plTakeOpen / plSetOpen: placing a driver fills the open driver place', () => {
  const r = row({ open_other: [{ role: 'Fahrer', count: 1, note: 'Spreesegler' }, { role: 'Zenjob', count: 2, note: null }] });
  assert.deepEqual(plain(ctx.plTakeOpen(r, 'Fahrer')), [{ role: 'Zenjob', count: 2, note: null }]);
  assert.deepEqual(plain(ctx.plTakeOpen(r, 'Zenjob')), [{ role: 'Fahrer', count: 1, note: 'Spreesegler' }, { role: 'Zenjob', count: 1, note: null }]);
  assert.equal(ctx.plTakeOpen(r, 'Deko'), null);
  assert.equal(ctx.plTakeOpen(row(), 'Fahrer'), null);
  assert.deepEqual(plain(ctx.plSetOpen(r, 'Fahrer', 2)), [{ role: 'Zenjob', count: 2, note: null }, { role: 'Fahrer', count: 2, note: null }]);
  assert.deepEqual(plain(ctx.plSetOpen(r, 'Fahrer', 0)), [{ role: 'Zenjob', count: 2, note: null }]);
  assert.deepEqual(plain(ctx.plSetOpen(row(), 'Fahrer', '1')), [{ role: 'Fahrer', count: 1, note: null }]);
  assert.deepEqual(plain(ctx.plOpenOther(row({ open_other: [{ role: 'Fahrer', count: 0 }, null, { count: 2 }] }))), []);
});

test('plWithout: leaves out columns the database does not have yet', () => {
  const out = plain(ctx.plWithout([row({ kind: 'bus', open_other: [] })], ['kind', 'open_other']));
  assert.equal('kind' in out[0], false); assert.equal('open_other' in out[0], false); assert.equal(out[0].venue, 'Estrel');
});

// ── Absagen ──
test('plCancelsOnRow: Absagen of the row by its plan key, with the place of the person on the row', () => {
  const row = { people: [{ user_id: 'k', name: 'Konrad', role: 'AL' }, { user_id: 'm', name: 'Mats', role: 'MA' }] };
  const users = [{ id: 'k', full_name: 'Konrad Nowak' }, { id: 'x', full_name: 'Xaver Eins' }];
  assert.deepEqual(plain(ctx.plCancelsOnRow(row, 'k1', { k1: ['k', 'x'], k2: ['m'] }, users)), [
    { user_id: 'k', index: 0, name: 'Konrad' }, { user_id: 'x', index: -1, name: 'Xaver Eins' }]);
  assert.deepEqual(plain(ctx.plCancelsOnRow(row, 'k9', { k1: ['k'] }, users)), []);
  assert.deepEqual(plain(ctx.plCancelsOnRow(row, null, { k1: ['k'] }, users)), []);
});

test('plReplacePerson: the new person takes the place and role, the old note goes', () => {
  const row = { people: [{ user_id: 'k', name: 'Konrad', role: 'AL', note: 'ab 14 Uhr' }, { user_id: 'm', name: 'Mats', role: 'MA', note: null }] };
  assert.deepEqual(plain(ctx.plReplacePerson(row, 0, { user_id: 'x', name: 'Xaver' })), [
    { user_id: 'x', name: 'Xaver', role: 'AL', note: null }, { user_id: 'm', name: 'Mats', role: 'MA', note: null }]);
  assert.equal(ctx.plReplacePerson(row, 0, { user_id: 'm', name: 'Mats' }), null, 'already on the row');
  assert.equal(ctx.plReplacePerson(row, 5, { user_id: 'x', name: 'Xaver' }), null);
});

test('plUnmatchedCancels: Absagen whose plan key belongs to no row of the draft', () => {
  assert.deepEqual(plain(ctx.plUnmatchedCancels({ r1: 'k1', r2: 'k2' }, { k1: ['a'], k3: ['b', 'c'] })), [
    { key: 'k3', user_id: 'b' }, { key: 'k3', user_id: 'c' }]);
});

test('plVorbehaltFor: the limit of the Auftrag Meldung first, then the one on the plan entry', () => {
  const vb = { 'o|26-0415.01|setup|u1': 'nur bis 16:00 Uhr', 's|k1|u1': 'erst ab 10:00 Uhr', 's|k1|u2': 'erst ab 10:00 Uhr' };
  const job = { job_no: '26-0415.01', phase: 'setup' };
  assert.equal(ctx.plVorbehaltFor(job, 'k1', vb, 'u1'), 'nur bis 16:00 Uhr');
  assert.equal(ctx.plVorbehaltFor(job, 'k1', vb, 'u2'), 'erst ab 10:00 Uhr');
  assert.equal(ctx.plVorbehaltFor({}, 'k1', vb, 'u3'), '');
  assert.equal(ctx.plVorbehaltFor(job, null, undefined, 'u1'), '');
});

test('plMergeSlots: time, room and name follow a revised Bestätigung and are reported', () => {
  const base = ctx.plRowFromSlot(slot(), WEEK, USERS);
  const have = Object.assign({}, base, { id: 'r1', manual: [], auftrag_changes: null });
  const m = plain(ctx.plMergeSlots([have], [slot({ start_at: '2026-11-11T08:00', end_at: '2026-11-11T16:00', room: 'Saal 2' })], WEEK, USERS, 'T1'));
  assert.equal(m.patch.length, 1);
  const ch = m.patch[0].changes;
  assert.equal(ch.wann, 'Aufbau: 08:00 - 16:00 Uhr');
  assert.equal(ch.location, 'Business of Apps\nSaal 2');
  assert.deepEqual(ch.auftrag_changes.map(c => [c.field, c.to, c.kept, c.at]),
    [['wann', 'Aufbau: 08:00 - 16:00 Uhr', false, 'T1'], ['location', 'Business of Apps\nSaal 2', false, 'T1']]);
});

test('plMergeSlots: a field changed by hand stays, the new Auftrag value is only reported; reported once', () => {
  const base = ctx.plRowFromSlot(slot(), WEEK, USERS);
  const have = Object.assign({}, base, { id: 'r1', wann: 'Aufbau: 7 Uhr', manual: ['wann'], auftrag_changes: null });
  const m = plain(ctx.plMergeSlots([have], [slot({ start_at: '2026-11-11T08:00' })], WEEK, USERS, 'T1'));
  assert.equal('wann' in m.patch[0].changes, false);
  assert.deepEqual(m.patch[0].changes.auftrag_changes.map(c => [c.field, c.from, c.to, c.kept]),
    [['wann', 'Aufbau: 7 Uhr', 'Aufbau: 08:00 - 16:00 Uhr', true]]);
  // already reported (even after „Gesehen“): nothing new
  const seen = Object.assign({}, have, { auftrag_changes: m.patch[0].changes.auftrag_changes.map(c => Object.assign({}, c, { seen: true })) });
  assert.deepEqual(plain(ctx.plMergeSlots([seen], [slot({ start_at: '2026-11-11T08:00' })], WEEK, USERS, 'T2')).patch, []);
});

test('plMergeSlots: rows from before the manual column only follow day and MA number (old hand edits stay)', () => {
  const have = row({ id: 'r9', job_no: '26-0447.01', phase: 'setup', title: 'von Hand', wann: 'Aufbau: 7 Uhr', need: 4 });
  assert.deepEqual(plain(ctx.plMergeSlots([have], [slot({ start_at: '2026-11-11T08:00' })], WEEK, USERS)).patch, []);
});

test('plManualAfter: fields saved with another value count as changed by hand, the rest stays', () => {
  assert.deepEqual(plain(ctx.plManualAfter(row({ wann: 'Aufbau: 7 Uhr', title: 'A', manual: ['venue'] }), { wann: 'Aufbau: 8 Uhr', title: 'A', notes: 'x' })), ['venue', 'wann']);
  assert.deepEqual(plain(ctx.plManualAfter(row({ title: 'A' }), { title: 'A' })), []);
});

test('plMergeSlots: a new Auftrag (here a Lieferschein) links to Daniel\'s hand-made row of that day instead of a row of its own', () => {
  const week = { year: 2026, kw: 48, weekStart: '2026-11-23', weekEnd: '2026-11-29' };
  const li = { job_no: '26-0361.01', phase: 'setup', name: '261127_Estrel_Championsgala', title: '261127_Estrel_Championsgala', room: '',
    start_at: '2026-11-27T12:00', end_at: '2026-11-27T20:00', needed: 6, accepted_ids: [],
    materials: [{ group: 'CH I', items: [{ name: 'Stuhlhusse Estrel, mit Armlehne, weiß' }, { name: 'Kerzenleuchter, silber' }, { name: 'Stumpenkerze' }] },
      { group: 'Raum II/III', items: [{ name: 'Flatsofa, weiß' }] }] };
  const daniel = { id: 'r1', date: '2026-11-27', job_no: null, phase: null, venue: 'Estrel', location: null, kind: 'angebot', manual: [],
    title: '1600 Estrelhusse weiß + Armlehne', details: '160 Kerzenleuchter + Stumpenkerze, Raum II/III',
    wann: 'Vorbau Leuchter unter Galerie: 12 Uhr\n@Fahrer: Hängerzug bleibt vor Ort!!', need: 5, people: [{ name: 'Kacper', role: 'Fahrer' }] };
  const other = { id: 'r2', date: '2026-11-27', job_no: null, venue: 'Estrel', title: '4 STB weiß + Kufenfuß', details: null, wann: 'Abbau: ganztägig', kind: 'auftrag' };
  const m = plain(ctx.plMergeSlots([daniel, other], [li], week, [], 'now'));
  assert.deepEqual(m.add, []);
  assert.deepEqual(m.patch, [{ id: 'r1', changes: { job_no: '26-0361.01', phase: 'setup', need: 6, manual: ['wann', 'location', 'title'], kind: 'auftrag' } }]);
  // nothing alike that day → a row of its own, as before
  const m2 = plain(ctx.plMergeSlots([other], [li], week, [], 'now'));
  assert.equal(m2.add.length, 1);
});

test('plMergeSlots: an untouched Auftrag row the app added moves onto Daniel\'s matching row; a touched one stays', () => {
  const week = { year: 2026, kw: 48, weekStart: '2026-11-23', weekEnd: '2026-11-29' };
  const li = { job_no: '26-0361.01', phase: 'teardown', name: '261127_Estrel_Championsgala', title: '261127_Estrel_Championsgala', room: '',
    start_at: '2026-11-29T02:30', end_at: '2026-11-29T12:00', needed: null, accepted_ids: [],
    materials: [{ group: 'CH I', items: [{ name: 'Stuhlhusse Estrel, mit Armlehne, weiß' }, { name: 'Kerzenleuchter, silber' }, { name: 'Stumpenkerze' }] }] };
  const auto = { id: 'a1', date: '2026-11-29', job_no: '26-0361.01', phase: 'teardown', venue: 'Estrel', title: '261127_Estrel_Championsgala', location: 'Championsgala',
    wann: 'Abbau: 02:30 - 12:00 Uhr', people: [], manual: [], auftrag_changes: [], kind: 'auftrag' };
  const daniel = { id: 'r3', date: '2026-11-29', job_no: null, venue: 'Estrel', title: '1600 Estrelhusse weiß + Armlehne',
    details: '160 Kerzenleuchter + Stumpenkerze\nRaum II/III', wann: 'Abbau: 2.30 Uhr\n@Team: Hussen zählen', people: [{ name: 'Peer' }], manual: [], kind: 'angebot' };
  const m = plain(ctx.plMergeSlots([auto, daniel], [li], week, [], 'now'));
  assert.deepEqual(m.remove, ['a1']);
  assert.deepEqual(m.add, []);
  assert.deepEqual(m.patch.map(p => [p.id, p.changes.job_no]), [['r3', '26-0361.01']]);
  const touched = Object.assign({}, auto, { people: [{ name: 'Edib' }] });
  const m2 = plain(ctx.plMergeSlots([touched, daniel], [li], week, [], 'now'));
  assert.deepEqual(m2.remove, []);
  assert.deepEqual(m2.patch, []);
});
