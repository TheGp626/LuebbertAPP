// Run from the repo root: node --test tests/mitarbeiter.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/mitarbeiter.js');

const cfg = { income_limit_minijob: 603, income_limit_midijob: 2000 };

test('default limit by Art der Anstellung', () => {
  assert.equal(M.mitDefaultLimit({ employment_type: 'Minijob' }, cfg), 603);
  assert.equal(M.mitDefaultLimit({ employment_type: 'Midijob' }, cfg), 2000);
  assert.equal(M.mitDefaultLimit({ employment_type: 'Fest' }, cfg), null);
  assert.equal(M.mitDefaultLimit({ employment_type: null, is_fest: false }, cfg), 603);
  assert.equal(M.mitDefaultLimit({ id: 'x' }, cfg), null);
});

test('Lange kein Einsatz: Minijob only, keep_until, never worked counts from creation', () => {
  const w = [
    { id: 'a', full_name: 'Max Muster', role: 'MA', employment_type: 'Minijob', created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', full_name: 'Lena Beispiel', role: 'MA', employment_type: 'Minijob', created_at: '2026-01-01T00:00:00Z', keep_until: '2026-12-01' },
    { id: 'c', full_name: 'Tom Test', role: 'MA', employment_type: 'Fest', created_at: '2026-01-01T00:00:00Z' },
    { id: 'd', full_name: 'Neu Person', role: 'MA', employment_type: 'Minijob', created_at: '2026-10-01T00:00:00Z' },
  ];
  const last = M.mitLastActivity([{ user_id: 'a', shift_date: '2026-07-01' }], [{ user_id: 'a', date: '2026-07-10' }], '2026-11-18');
  assert.equal(last.a, '2026-07-10');
  const r = M.mitInactiveMinijobbers(w, last, '2026-11-18', 3);
  assert.deepEqual(r.map(x => x.id), ['a']);
  assert.equal(M.mitAddMonths('2026-05-31', 3), '2026-02-28');
});

test('Unbekannte Namen: grouped, agencies and Fremdkraft left out; suggestions', () => {
  const shifts = [
    { temp_worker_name: 'Maxx ', position_role: 'MA Minijob', start_time: '08:00', end_time: '12:00', status: 'offen', shift_date: '2026-11-01' },
    { temp_worker_name: 'maxx', position_role: 'MA Minijob', start_time: '08:00', end_time: '10:00', status: 'eingetragen', shift_date: '2026-11-02' },
    { temp_worker_name: 'Zeno', position_role: 'Zenjob', start_time: '08:00', end_time: '10:00' },
    { temp_worker_name: 'Fremd', position_role: 'MA Minijob', start_time: '08:00', end_time: '10:00' },
  ];
  const g = M.mitUnknownNames(shifts, [{ alias: 'fremd', user_id: null }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].shifts, 2);
  assert.equal(g[0].mins, 360);
  assert.equal(g[0].booked, 1);
  const s = M.mitSuggest('Maxx', [{ id: '1', full_name: 'Max Muster', role: 'MA' }, { id: '2', full_name: 'Lena Beispiel', role: 'MA' }]);
  assert.deepEqual(s.map(x => x.id), ['1']);
  assert.equal(M.mitNoSurname({ full_name: 'Lukas' }), true);
});

test('unter 18: night rule', () => {
  assert.equal(M.mitNightForMinor('08:00', '16:00', ''), false);
  assert.equal(M.mitNightForMinor('14:00', '21:00', ''), true);
  assert.equal(M.mitNightForMinor('05:30', '12:00', ''), true);
  assert.equal(M.mitNightForMinor('22:00', '02:00', ''), true);
  assert.equal(M.mitNightForMinor(null, null, 'Nachtabbau'), true);
  assert.equal(M.mitNightForMinor(null, null, 'Aufbau 7:00'), false);
  assert.equal(M.mitNightForMinor(null, null, 'ab 14 Uhr'), true);
  assert.equal(M.mitNightForMinor(null, null, ''), true);
  const i = M.mitMinorIssues([{ id: 's', user_id: 'm', shift_date: '2026-11-10', start_time: '12:00:00', end_time: '21:30:00', pause_mins: 15 }], ['m'], '2026-09-01');
  assert.deepEqual(i[0].issues, ['nach 20 Uhr', 'über 8 Std', 'Pause zu kurz']);
});

test('Verdienst-Balken: tone, text, sort', () => {
  assert.equal(M.mitShareTone(70), 'ok');
  assert.equal(M.mitShareTone(100), 'warn');
  assert.equal(M.mitShareTone(101), 'danger');
  assert.match(M.mitShareHtml({ pct: 42, hours: 18, ahead: 2, has_limit: true, has_rate: true }), /42 % · 18 Std.*\+2 Monate vorgearbeitet/);
  assert.match(M.mitShareHtml({ pct: null, hours: 5.5, ahead: 0, has_limit: false, has_rate: true }), /5,5 Std/);
  assert.ok(M.mitShareSort({ pct: 10 }) < M.mitShareSort({ pct: null, hours: 1 }));
});
