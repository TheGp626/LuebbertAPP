// Run from the repo root: node --test tests/
// The real-PDF checks need the local fixtures in _fixtures/ (never committed: they contain phone numbers).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const P = require('../js/plan-parser.js');

test('planStripPhones removes German and foreign numbers, keeps times', () => {
  assert.equal(P.planStripPhones('Max Muster, 0170 1234567'), 'Max Muster');
  assert.equal(P.planStripPhones('Erika Beispiel, +20 1000000000'), 'Erika Beispiel');
  assert.equal(P.planStripPhones('Otto Normal 0152/1234567'), 'Otto Normal');
  assert.equal(P.planStripPhones('2 x Zenjob (8.30 - 16.30 Uhr)'), '2 x Zenjob (8.30 - 16.30 Uhr)');
  assert.equal(P.planStripPhones('Aufbau: 9 - 14 Uhr'), 'Aufbau: 9 - 14 Uhr');
});

test('planDate and planIsoWeek', () => {
  assert.equal(P.planDate('Montag 12.10.26'), '2026-10-12');
  assert.equal(P.planDate('18.10.2026'), '2026-10-18');
  assert.deepEqual(P.planIsoWeek('2026-10-12'), { week: 42, year: 2026 });
  assert.deepEqual(P.planIsoWeek('2026-12-28'), { week: 53, year: 2026 });
  assert.deepEqual(P.planIsoWeek('2027-01-04'), { week: 1, year: 2027 });
});

test('planParseWer: agency group takes exactly N names, roles and vehicles', () => {
  const w = P.planParseWer([
    'Anna (AL)', 'Bert', '2 x ROCKiT (9 - 13 Uhr)', 'Carla Muster', 'Dino Beispiel', 'Emil',
    'BAR PL 50 | Fritz', 'LeihLkw | Gustav (AL)', 'Barnimer Land | Fahrer', '3 MA', '1 MA (AL)', 'Deko: Hanna & Ida', 'folgt'
  ]);
  const by = Object.fromEntries(w.people.map(p => [p.name, p]));
  assert.equal(by['Anna'].role, 'AL');
  assert.equal(by['Bert'].role, 'MA');
  assert.equal(by['Carla Muster'].role, 'ROCKiT');
  assert.equal(by['Carla Muster'].note, '9 - 13 Uhr');
  assert.equal(by['Dino Beispiel'].role, 'ROCKiT');
  assert.equal(by['Emil'].role, 'MA', 'group ends after 2 names');
  assert.equal(by['Fritz'].role, 'Fahrer');
  assert.equal(by['Fritz'].note, 'BAR PL 50');
  assert.equal(by['Gustav'].role, 'AL');
  assert.equal(by['Hanna'].role, 'Deko');
  assert.equal(by['Ida'].role, 'Deko');
  assert.deepEqual(w.open, [
    { role: 'Fahrer', count: 1, note: 'Barnimer Land' },
    { role: 'MA', count: 3, note: null },
    { role: 'AL', count: 1, note: null }
  ]);
  assert.ok(w.notes.includes('folgt'));
});

test('planParseWer: unfilled agency slots become open slots; notes on names', () => {
  const w = P.planParseWer(['4 x Zenjob (2.30 - 10 Uhr)', 'Xaver Eins', 'Milan (ab 14 Uhr)']);
  assert.equal(w.people.length, 2);
  assert.equal(w.people[1].name, 'Milan');
  assert.equal(w.people[1].note, 'ab 14 Uhr');
  assert.deepEqual(w.open, [{ role: 'Zenjob', count: 2, note: '2.30 - 10 Uhr' }]);
});

test('planMatchPerson: alias, full name, unique first name, initial; agency never', () => {
  const users = [
    { id: 'u1', full_name: 'Paul Fischer', role: 'AL' },
    { id: 'u2', full_name: 'Paul Beispiel', role: 'AL' },
    { id: 'u3', full_name: 'Kacper Nowak', role: 'AL' },
    { id: 'u4', full_name: 'Julian Hoffmann', role: 'MA' },
    { id: 'u5', full_name: 'Julian Tetzlaff', role: 'MA' },
    { id: 'u6', full_name: 'Old Kacper', role: 'MA', is_active: false },
  ];
  assert.equal(P.planMatchPerson({ name: 'Kacper', role: 'AL' }, users, {}).userId, 'u3');
  assert.equal(P.planMatchPerson({ name: 'Paul Fischer', role: 'MA' }, users, {}).userId, 'u1');
  const amb = P.planMatchPerson({ name: 'Paul', role: 'AL' }, users, {});
  assert.equal(amb.userId, null);
  assert.deepEqual(amb.candidates, ['u1', 'u2']);
  assert.equal(P.planMatchPerson({ name: 'Paul', role: 'AL' }, users, { paul: 'u2' }).userId, 'u2');
  assert.equal(P.planMatchPerson({ name: 'Julian T.', role: 'MA' }, users, {}).userId, 'u5');
  assert.equal(P.planMatchPerson({ name: 'Paul Fischer', role: 'ROCKiT' }, users, {}).userId, null);
});

test('planDiff: new, changed, unchanged, removed', () => {
  const mk = (key, wann, people) => ({ key, wann, people: people.map(n => ({ name: n, role: 'MA' })), open: [], ap: 'X', details: [] });
  const old = [mk('a', ['8 Uhr'], ['A']), mk('b', ['9 Uhr'], ['B']), mk('c', ['9 Uhr'], ['C'])];
  const neu = [mk('a', ['8 Uhr'], ['A']), mk('b', ['10 Uhr'], ['B']), mk('d', ['9 Uhr'], ['D'])];
  const d = P.planDiff(old, neu);
  assert.deepEqual(d.status, [null, 'geändert', 'neu']);
  assert.deepEqual(d.removed.map(s => s.key), ['c']);
});

test('planWhen: start time and label for the time column', () => {
  assert.deepEqual(P.planWhen(['Aufbau: 8 - 9 Uhr', 'Abbau: 12 Uhr']), { time: '08:00', end: '09:00', prefix: null, label: 'Aufbau' });
  assert.deepEqual(P.planWhen(['Aufbau Team 1: 8 Uhr', '@Team: Material bereits vor Ort!!']), { time: '08:00', end: null, prefix: null, label: 'Aufbau' });
  assert.deepEqual(P.planWhen(['19.30 - 21 Uhr']), { time: '19:30', end: '21:00', prefix: null, label: null });
  assert.deepEqual(P.planWhen(['Abbau: 0.30 Uhr']), { time: '00:30', end: null, prefix: null, label: 'Abbau' });
  assert.deepEqual(P.planWhen(['Aufbau Deko: bis 11 Uhr']), { time: '11:00', end: null, prefix: 'bis', label: 'Aufbau' });
  assert.deepEqual(P.planWhen(['Abbau: ab 17 Uhr']), { time: '17:00', end: null, prefix: 'ab', label: 'Abbau' });
  assert.deepEqual(P.planWhen(['Umbau: 16 - 19 Uhr', 'Leergut hinter Vorhang']), { time: '16:00', end: '19:00', prefix: null, label: 'Umbau' });
  assert.deepEqual(P.planWhen(['Aufbau Barhocker & Deko : 10 Uhr']), { time: '10:00', end: null, prefix: null, label: 'Aufbau' });
  assert.deepEqual(P.planWhen(['KW 45-46']), { time: null, end: null, prefix: null, label: null });
  assert.deepEqual(P.planWhen(['Aufbau: nach Aufbau gedatec']), { time: null, end: null, prefix: null, label: 'Aufbau' });
  assert.deepEqual(P.planWhen([]), { time: null, end: null, prefix: null, label: null });
});

test('planGuessAction and planEventName', () => {
  assert.equal(P.planGuessAction(['Aufbau: 9 - 14 Uhr', 'Abbau: 0.30 Uhr']), 'Aufbau');
  assert.equal(P.planGuessAction(['Abbau: 8 - 11 Uhr']), 'Abbau');
  assert.equal(P.planGuessAction(['Umbau: 16 - 19 Uhr']), 'Umbau');
  assert.equal(P.planGuessAction([]), 'Aufbau');
  assert.equal(P.planEventName({ title: 'Networking', venue: 'Estrel' }), 'Networking');
  assert.equal(P.planEventName({ title: '4 Sitzhocker Hollis', venue: 'Messe Berlin' }), 'Messe Berlin');
});

test('planShiftRow → planShiftFromDb round trip keeps planDiff stable', () => {
  const s = { date: '2026-11-03', sort: 2, key: 'k', venue: 'Messe', location: ['Messedamm 22', '14055 Berlin'], title: 'Teambox',
    details: ['7 Barhocker'], wann: ['Aufbau: 8 Uhr', 'Abbau: 12 Uhr'], ap: 'Inge', notes: ['BAR PL XXX'], color: null,
    open: [{ role: 'AL', count: 1, note: null }], people: [{ name: 'Anna', role: 'AL', note: null }] };
  const row = P.planShiftRow(s, 'w1', 'neu');
  assert.equal(row.wann, 'Aufbau: 8 Uhr\nAbbau: 12 Uhr');
  assert.equal(row.change_status, 'neu');
  const back = P.planShiftFromDb(Object.assign({ id: 'x', plan_assignments: [{ name: 'Anna', role: 'AL', note: null, user_id: 'u1' }] }, row));
  assert.deepEqual(P.planDiff([back], [s]).status, [null]);
  // jsonb returns object keys in its own order ({count, note, role}) → must still count as unchanged
  back.open = [{ count: 1, note: null, role: 'AL' }];
  assert.deepEqual(P.planDiff([back], [s]).status, [null]);
});

test('planShiftRow stores the resolved PL (ap_user_id)', () => {
  const s = { date: '2026-11-03', sort: 0, key: 'k', venue: 'Messe', location: [], title: 'T', details: [], wann: [], ap: 'Inge', notes: [], color: null, open: [], people: [] };
  assert.equal(P.planShiftRow(Object.assign({ apUserId: 'u9' }, s), 'w', null).ap_user_id, 'u9');
  assert.equal(P.planShiftRow(s, 'w', null).ap_user_id, null);
});

const fixture = name => { const f = `${__dirname}/../_fixtures/${name}.json`; return fs.existsSync(f) ? require(f) : null; };

for (const [name, kw, start, end, minShifts] of [
  ['kw42', 42, '2026-10-12', '2026-10-18', 40], ['kw43', 43, '2026-10-19', '2026-10-25', 30],
  ['kw44', 44, '2026-10-26', '2026-11-01', 18], ['kw45', 45, '2026-11-02', '2026-11-08', 18],
]) {
  test(`real plan ${name}`, { skip: !fixture(name) && 'no local fixture' }, () => {
    const r = P.planParse(fixture(name));
    assert.equal(r.kw, kw);
    assert.equal(r.weekStart, start);
    assert.equal(r.weekEnd, end, 'week end comes from the day rows');
    assert.deepEqual(r.warnings, []);
    assert.ok(r.shifts.length >= minShifts, r.shifts.length + ' shifts');
    const keys = r.shifts.map(s => s.key);
    assert.equal(new Set(keys).size, keys.length, 'keys are unique');
    const all = JSON.stringify(r.shifts);
    assert.doesNotMatch(all, /\b01[5-7]\d[\s\/]?\d{6,}/, 'no mobile numbers');
    assert.doesNotMatch(all, /\+\d{2}\s?\d{6,}/, 'no international numbers');
    r.shifts.forEach(s => {
      assert.ok(s.date >= start && s.date <= end);
      assert.ok(s.venue, 'every shift has a location');
    });
  });
}

test('real plan kw42: Monday Estrel team', { skip: !fixture('kw42') && 'no local fixture' }, () => {
  const s = P.planParse(fixture('kw42')).shifts.find(x => x.date === '2026-10-12' && x.title === 'Networking');
  const roles = Object.fromEntries(s.people.map(p => [p.name, p.role]));
  assert.equal(roles['Kacper'], 'AL');
  assert.equal(roles['Edib'], 'MA');
  assert.equal(Object.values(roles).filter(r => r === 'ROCKiT').length, 4, '4 x ROCKiT');
  assert.equal(roles['Marcin'], 'Fahrer');
  assert.equal(s.ap, 'Jenni');
});

test('real plan kw45: open slots and colours', { skip: !fixture('kw45') && 'no local fixture' }, () => {
  const r = P.planParse(fixture('kw45'));
  const teambox = r.shifts.find(x => x.title === 'Teambox');
  assert.deepEqual(teambox.open.map(o => o.count + ' ' + o.role), ['1 AL', '1 MA']);
  assert.equal(r.shifts.find(x => x.title === 'Inventur Stoffe').color, '#fcd5b4');
});

test('planMatchPerson: the AP column (role PL) only matches PL, Admin or Buchhaltung', () => {
  const users = [
    { id: 'm1', full_name: 'Sabine Muster', role: 'MA' },
    { id: 'p1', full_name: 'Inge Beispiel', role: 'PL' },
    { id: 'a1', full_name: 'Sonja Chef', role: 'Admin' },
  ];
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'PL' }, users, {}).userId, null);
  assert.equal(P.planMatchPerson({ name: 'Inge', role: 'PL' }, users, {}).userId, 'p1');
  assert.equal(P.planMatchPerson({ name: 'Sonja', role: 'PL' }, users, {}).userId, 'a1');
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'MA' }, users, {}).userId, 'm1');
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'PL' }, users, { sabine: 'm1' }).userId, null, 'an alias to an MA never makes them the PL');
});

// ── Bug-fix round: duplicate keys, aliases, PL aliases, fingerprint, ISO week ──

const mkS = (key, extra) => Object.assign({ key, date: '2026-11-03', venue: 'Messe', title: 'Bar', wann: ['8 Uhr'], people: [],
  open: [], ap: null, details: [], location: [], notes: [] }, extra);
const ppl = (...names) => names.map(n => ({ name: n, role: 'MA' }));

test('planDiff: first of two same-key rows disappears → the second is matched, not "entfällt"', () => {
  const k = '2026-11-03|messe|bar';
  const old = [mkS(k, { wann: ['Aufbau: 8 Uhr'], people: ppl('Anna') }), mkS(k + '#2', { wann: ['Abbau: 22 Uhr'], people: ppl('Bert') })];
  // New upload: only the Abbau row is left and is now numbered k
  const neu = [mkS(k, { wann: ['Abbau: 22 Uhr'], people: ppl('Bert') })];
  const d = P.planDiff(old, neu);
  assert.deepEqual(d.status, [null]);
  assert.deepEqual(d.removed.map(s => s.people[0].name), ['Anna']);
  assert.equal(d.matched[0], old[1], 'matched old shift is returned per new shift');
});

test('planDiff: same-key rows changed → matched by first wann line, then by team', () => {
  const k = '2026-11-03|messe|bar';
  const old = [mkS(k, { wann: ['Aufbau: 8 Uhr'], people: ppl('Anna') }), mkS(k + '#2', { wann: ['Abbau: 22 Uhr'], people: ppl('Bert') })];
  const neu = [mkS(k, { wann: ['Abbau: 22 Uhr'], people: ppl('Bert', 'Carl') })];
  const d = P.planDiff(old, neu);
  assert.deepEqual(d.status, ['geändert']);
  assert.deepEqual(d.removed.map(s => s.people[0].name), ['Anna']);
  const neu2 = [mkS(k, { wann: ['Abbau: 23 Uhr'], people: ppl('Bert') })];
  const d2 = P.planDiff(old, neu2);
  assert.deepEqual(d2.status, ['geändert']);
  assert.deepEqual(d2.removed.map(s => s.people[0].name), ['Anna']);
});

test('planDiff: location and notes changes are flagged', () => {
  const a = mkS('k', { location: ['Halle 1'], notes: ['BAR PL 50'] });
  assert.deepEqual(P.planDiff([a], [mkS('k', { location: ['Halle 2'], notes: ['BAR PL 50'] })]).status, ['geändert']);
  assert.deepEqual(P.planDiff([a], [mkS('k', { location: ['Halle 1'], notes: ['LeihLkw'] })]).status, ['geändert']);
  assert.deepEqual(P.planDiff([a], [mkS('k', { location: ['Halle 1'], notes: ['BAR PL 50'] })]).status, [null]);
});

test('planAliasKey: one normalisation for saving and lookup; aliases with a trailing dot match', () => {
  assert.equal(P.planAliasKey('Julian H.'), 'julian h');
  assert.equal(P.planAliasKey('  Julian   H. '), 'julian h');
  assert.equal(P.planAliasKey('Inge', true), 'ap:inge');
  assert.equal(P.planAliasKey('ap:Julian H.'), 'ap:julian h', 'stored keys keep their prefix');
  const users = [{ id: 'u4', full_name: 'Julian Hoffmann', role: 'MA' }, { id: 'u7', full_name: 'Julian Hase', role: 'MA' }];
  const aliases = { [P.planAliasKey('Julian H.')]: 'u7' };
  assert.equal(P.planMatchPerson({ name: 'Julian H.', role: 'MA' }, users, aliases).userId, 'u7');
});

test('planMatchPerson: PL aliases only point to PL/Admin/Buchhaltung; ap: keys stay apart from team names', () => {
  const users = [
    { id: 'm1', full_name: 'Sabine Muster', role: 'MA' },
    { id: 'p1', full_name: 'Sabine Chef', role: 'PL' },
    { id: 'b1', full_name: 'Bea Konto', role: 'Buchhaltung' },
  ];
  // A team alias "sabine" → MA must not make the MA the PL
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'PL' }, users, { sabine: 'm1' }).userId, 'p1', 'MA alias ignored, the PL Sabine matches');
  // An AP alias → PL wins for the AP column, but never for a team member of the same name
  const al = { 'ap:sabine': 'p1', sabine: 'm1' };
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'PL' }, users, al).userId, 'p1');
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'MA' }, users, al).userId, 'm1');
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'MA' }, users, { 'ap:sabine': 'p1' }).userId, null, 'team name ignores ap: aliases');
  // An ap: alias pointing to an MA is ignored
  assert.equal(P.planMatchPerson({ name: 'Sabine', role: 'PL' }, users, { 'ap:sabine': 'm1' }).userId, 'p1');
  // Legacy plain alias that points to a PL still works for the AP column
  assert.equal(P.planMatchPerson({ name: 'Bea', role: 'PL' }, users, { bea: 'b1' }).userId, 'b1');
});

// Minimal synthetic page for planParse: header + one day row + one shift per day
function synthPage(days) {
  const items = [], hlines = [];
  const col = { Datum: 10, Was: 100, Wann: 200, Wer: 300, AP: 400 };
  Object.keys(col).forEach(k => items.push({ s: k, x: col[k], y: 10, h: 10 }));
  let y = 30;
  hlines.push({ x0: 10, x1: 450, y });
  days.forEach(([label, venue]) => {
    items.push({ s: label, x: 12, y: y + 3, h: 10 }); y += 20; hlines.push({ x0: 10, x1: 450, y });
    items.push({ s: venue, x: 12, y: y + 3, h: 10 }); items.push({ s: 'Event', x: 102, y: y + 3, h: 10 });
    y += 20; hlines.push({ x0: 10, x1: 450, y });
  });
  return [{ items, hlines, fills: [] }];
}

test('planParse: a plan starting on Sunday takes the ISO week most of its days fall in', () => {
  const r = P.planParse(synthPage([['Sonntag 01.11.26', 'A'], ['Montag 02.11.26', 'B'], ['Dienstag 03.11.26', 'C'], ['Mittwoch 04.11.26', 'D']]));
  assert.deepEqual(r.warnings, []);
  assert.equal(r.weekStart, '2026-11-01');
  assert.equal(r.kw, 45);
  assert.equal(r.year, 2026);
});

test('planUnassigned: users taken off a matched shift are listed; moved-in and new shifts are not', () => {
  const u = (n, id) => ({ name: n, role: 'MA', userId: id });
  const old = [mkS('a', { people: [u('Anna', 'ua'), u('Bert', 'ub')] }), mkS('b', { date: '2026-11-04', venue: 'Estrel', people: [u('Carl', 'uc')] })];
  const neu = [mkS('a', { people: [u('Anna', 'ua'), u('Dora', 'ud')] }), mkS('c', { people: [u('Bert', 'ub')] })];
  const d = P.planDiff(old, neu);
  assert.deepEqual(P.planUnassigned(neu, d), [{ date: '2026-11-03', venue: 'Messe', title: 'Bar', user_ids: ['ub'], kind: 'unassigned' }]);
});

test('planPickExistingWeek: same KW wins, otherwise the stored week the plan overlaps most', () => {
  const parsed = { year: 2026, kw: 45, weekStart: '2026-11-01', weekEnd: '2026-11-08' };
  const weeks = [
    { id: 'a', year: 2026, kw: 44, week_start: '2026-11-01', week_end: '2026-11-07' },
    { id: 'b', year: 2026, kw: 43, week_start: '2026-10-19', week_end: '2026-10-25' },
  ];
  assert.equal(P.planPickExistingWeek(weeks, parsed).id, 'a', 'stored under the old start-date KW');
  assert.equal(P.planPickExistingWeek(weeks.concat([{ id: 'c', year: 2026, kw: 45, week_start: '2026-11-02', week_end: '2026-11-08' }]), parsed).id, 'c');
  assert.equal(P.planPickExistingWeek([weeks[1]], parsed), null);
  assert.equal(P.planPickExistingWeek([], parsed), null);
  // the previous week touching only the plan's leading Sunday is a different week
  assert.equal(P.planPickExistingWeek([{ id: 'd', year: 2026, kw: 44, week_start: '2026-10-26', week_end: '2026-11-01' }], parsed), null);
});

test('planCellLines: pieces of one word (formatting change mid-word) are joined without a space', () => {
  const it = (s, x, w) => ({ s, x, y: 100, w, h: 8 });
  assert.deepEqual(P.planCellLines([it('3 Holz', 0, 20), it('hoch', 19.95, 12), it('tisch Rhodos', 31.97, 30)]), ['3 Holzhochtisch Rhodos']);
  assert.deepEqual(P.planCellLines([it('B', 0, 5), it('azaar', 4.95, 20)]), ['Bazaar']);
  // a real gap or an explicit space keeps the words apart
  assert.deepEqual(P.planCellLines([it('2 Bar', 0, 20), it('weiß', 23, 15)]), ['2 Bar weiß']);
  assert.deepEqual(P.planCellLines([it('10 Stehtisch ', 0, 40), it('Kris', 40, 12)]), ['10 Stehtisch Kris']);
});

test('real plans: no words torn apart in the material lists', { skip: !fixture('kw42') && 'no local fixture' }, () => {
  const all = ['kw42', 'kw43', 'kw45'].map(k => JSON.stringify(P.planParse(fixture(k)).shifts)).join(' ');
  assert.match(all, /3 Holzhochtisch Rhodos/);
  assert.match(all, /Brückenhochtisch/);
  assert.match(all, /Bazaar/);
  assert.doesNotMatch(all, /Holz hoch tisch|B azaar/);
});

test('planShiftHeading / planMaterialLines: a Was cell that starts with equipment has no heading', () => {
  const s = { title: '7 Loungesessel Cube dunkelblau', venue: 'Estrel', details: '3 Loungetisch Stockholm schwarz Duo',
    location: 'Sonnenallee 225\n12057 Berlin\nEstrel Saal\nKunde GmbH' };
  // the room/customer lines after the postcode replace the equipment line
  assert.equal(P.planShiftHeading(s), 'Estrel Saal · Kunde GmbH');
  // and the equipment line is the first material line again
  assert.deepEqual(P.planMaterialLines(s), ['7 Loungesessel Cube dunkelblau', '3 Loungetisch Stockholm schwarz Duo']);
  // parser shape (arrays) works the same, without a postcode there is no heading
  assert.equal(P.planShiftHeading({ title: '1 Bar weiß klein', location: ['WECC'], details: [] }), '');
  assert.deepEqual(P.planMaterialLines({ title: '1 Bar weiß klein', details: [] }), ['1 Bar weiß klein']);
  // real headings stay ("1. OG" is a floor, not a quantity)
  const h = { title: 'CH II', details: 'Barbereich\n3 Stehtisch Kris weiß', location: 'Sonnenallee 225\n12057 Berlin\nBVL' };
  assert.equal(P.planShiftHeading(h), 'CH II');
  assert.deepEqual(P.planMaterialLines(h), ['Barbereich', '3 Stehtisch Kris weiß']);
  assert.equal(P.planShiftHeading({ title: '1. OG', location: [] }), '1. OG');
});

test('planShiftOrder / nextOwnShift: date, then time, untimed last, today long past dropped', () => {
  const now = new Date(2026, 9, 29, 15, 0); // Wed 29.10. 15:00 local
  const s = (date, wann, sort) => ({ date, wann, sort });
  const past = s('2026-10-29', 'Aufbau: 12 Uhr', 1);       // 3 h ago → dropped
  const recent = s('2026-10-29', 'Abbau: 13.30 Uhr', 2);   // 1.5 h ago → stays
  const untimed = s('2026-10-29', 'Aufbau: im Zuge Abbau', 0);
  const later = s('2026-10-29', 'Abbau: 18 Uhr', 3);
  const tomorrow = s('2026-10-30', 'Aufbau: 8 Uhr', 0);
  assert.deepEqual(P.planShiftOrder([tomorrow, untimed, later, past, recent], now), [recent, later, untimed, tomorrow]);
  assert.equal(P.nextOwnShift([tomorrow, untimed], now), untimed);
  assert.equal(P.nextOwnShift([], now), null);
  // a shift without time is never dropped by the 2 h rule; yesterday's leftovers are not "next"
  assert.deepEqual(P.planShiftOrder([s('2026-10-28', 'Aufbau: 9 Uhr', 0), untimed], now), [untimed]);
});

test('planShiftOrder keepStarted: "Meine Schichten" keeps all of today, only the start-page card drops started ones', () => {
  const now = new Date(2026, 9, 29, 15, 0);
  const past = { date: '2026-10-29', wann: 'Aufbau: 8 Uhr', sort: 1 };
  const later = { date: '2026-10-29', wann: 'Abbau: 18 Uhr', sort: 2 };
  assert.deepEqual(P.planShiftOrder([later, past], now, true), [past, later]);
  assert.deepEqual(P.planShiftOrder([later, past], now), [later]);
});

test('planShiftOrder: times before 4:00 are the night after the listed day', () => {
  const s = (wann) => ({ date: '2026-10-29', wann, sort: 0 });
  const night = s('Abbau: 0.30 Uhr'), morning = s('Aufbau: 9 Uhr');
  // sorted after the day's shifts …
  assert.deepEqual(P.planShiftOrder([night, morning], new Date(2026, 9, 29, 7, 0)), [morning, night]);
  // … and still upcoming in the afternoon of the listed day
  assert.deepEqual(P.planShiftOrder([night], new Date(2026, 9, 29, 15, 0)), [night]);
});

test('planEventName: equipment title → event line after room in the location, never a hall', () => {
  const loc = (...tail) => ['Musterallee 1', '12345 Berlin', ...tail];
  assert.equal(P.planEventName({ title: '4 STB weiß', venue: 'Estrel', location: loc('Showtheater', 'Zahnärztetag XY') }), 'Zahnärztetag XY');
  assert.equal(P.planEventName({ title: '10 Stehtischdeko', venue: 'Estrel', location: loc('Bar', 'Verband | Abendempfang') }), 'Verband | Abendempfang');
  assert.equal(P.planEventName({ title: '2 Sitzelement Ecke', venue: 'Kunde GmbH', location: loc('Halle 1 | Sektor B') }), 'Kunde GmbH');
  assert.equal(P.planEventName({ title: '34 Stuhl weiß', venue: 'Hotel', location: loc() }), 'Hotel');
  assert.equal(P.planEventName({ title: '34 Stuhl weiß', venue: 'Hotel' }), 'Hotel');
  // DB shape: location as one string with line breaks
  assert.equal(P.planEventName({ title: '7 Sessel', venue: 'Estrel', location: 'Musterallee 1\n12345 Berlin\nSaal\nFirmenfeier' }), 'Firmenfeier');
});
