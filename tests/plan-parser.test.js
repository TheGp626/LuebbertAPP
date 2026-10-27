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
    { id: 'u2', full_name: 'Paul Mittendorf', role: 'AL' },
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
