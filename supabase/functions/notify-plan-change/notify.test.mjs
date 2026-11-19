// Run: node --test supabase/functions/notify-plan-change/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPushText, buildPlanPushes } from './notify.mjs';

test('planPushText', () => {
  assert.deepEqual(planPushText(45, true, [{ date: '2026-11-03', venue: 'Messe Berlin', kind: 'neu' }]),
    { title: 'Wochenplan KW 45', body: 'Du bist am 03.11. eingeplant (Messe Berlin).' });
  assert.equal(planPushText(45, false, [{ date: '2026-11-04', venue: 'Estrel', kind: 'entfallen' }]).body,
    'Dein Einsatz am 04.11. (Estrel) entfällt.');
  assert.equal(planPushText(45, false, [{ date: '2026-11-04', venue: 'Estrel', kind: 'geändert' }, { date: '2026-11-05', venue: 'X', kind: 'neu' }]).body,
    '2 deiner Einsätze: 1 neu, 1 mit neuer Zeit. Der erste am 04.11. (Estrel).');
  assert.equal(planPushText(45, false, [{ date: '2026-11-04', venue: 'Estrel', kind: 'neu' }]).body, 'Du bist am 04.11. neu eingeplant (Estrel).');
  assert.equal(planPushText(45, false, [{ date: '2026-11-04', venue: 'Estrel', kind: 'zeit' }]).body, 'Dein Einsatz am 04.11. (Estrel) hat eine neue Zeit.');
});

const shifts = [
  { date: '2026-11-03', venue: 'Messe', change_status: null, plan_assignments: [{ user_id: 'a' }, { user_id: null }] },
  { date: '2026-11-04', venue: 'Estrel', change_status: 'geändert', plan_assignments: [{ user_id: 'a' }, { user_id: 'b' }] },
  { date: '2026-11-01', venue: 'Alt', change_status: 'neu', plan_assignments: [{ user_id: 'c' }] },
];

test('first upload: everyone planned from today on', () => {
  const p = buildPlanPushes({ kw: 45, version: 1, removed: [] }, shifts, '2026-11-02');
  assert.deepEqual(p.map(x => x.user_id).sort(), ['a', 'b']);
  assert.match(p.find(x => x.user_id === 'a').body, /an 2 Einsätzen/);
});

test('update: only changed and removed shifts, past days skipped', () => {
  const p = buildPlanPushes({ kw: 45, version: 2, removed: [{ date: '2026-11-05', venue: 'VBKI', user_ids: ['d'] }] }, shifts, '2026-11-02');
  const by = Object.fromEntries(p.map(x => [x.user_id, x.body]));
  assert.deepEqual(Object.keys(by).sort(), ['a', 'b', 'd']);
  assert.equal(by.a, 'Dein Einsatz am 04.11. (Estrel) wurde geändert.');
  assert.equal(by.d, 'Dein Einsatz am 05.11. (VBKI) entfällt.');
});

test('nothing changed → nobody', () => {
  assert.deepEqual(buildPlanPushes({ kw: 45, version: 3, removed: [] }, [shifts[0]], '2026-11-02'), []);
});

test('update: people taken off a shift get "nicht mehr eingeteilt"', () => {
  const removed = [
    { date: '2026-11-04', venue: 'Estrel', title: 'Gala', user_ids: ['e'], kind: 'unassigned' },
    { date: '2026-11-01', venue: 'Alt', user_ids: ['f'], kind: 'unassigned' },
  ];
  const p = buildPlanPushes({ kw: 45, version: 2, removed }, [shifts[0]], '2026-11-02');
  assert.deepEqual(p, [{ user_id: 'e', title: 'Wochenplan KW 45 geändert', body: 'Du bist am 04.11. (Estrel) nicht mehr eingeteilt.' }]);
});

test('first upload ignores leftover unassigned entries', () => {
  const p = buildPlanPushes({ kw: 45, version: 1, removed: [{ date: '2026-11-04', venue: 'Estrel', user_ids: ['e'], kind: 'unassigned' }] }, [], '2026-11-02');
  assert.deepEqual(p, []);
});

// ── Only a new time, a gained or a lost shift is worth a push; and never more than one push per person ──
const upd = (shifts, removed) => buildPlanPushes({ kw: 46, version: 4, removed: removed || [] }, shifts, '2026-11-09');
const on = (...ids) => ids.map(user_id => ({ user_id }));

test('update: a note, vehicle, material, room or colleague change notifies nobody', () => {
  for (const f of [['Hinweis'], ['Was'], ['Ort'], ['PL'], ['Offene Plätze'], ['Hinweis', 'Was', 'Ort'], []]) {
    assert.deepEqual(upd([{ date: '2026-11-12', venue: 'Estrel', change_status: 'geändert', change_fields: f, plan_assignments: on('a', 'b') }]), [], f.join());
  }
});

test('update: a new time notifies everyone on the shift', () => {
  const p = upd([{ date: '2026-11-12', venue: 'Estrel', change_status: 'geändert', change_fields: ['Wann', 'Hinweis'], plan_assignments: on('a', 'b') }]);
  assert.deepEqual(p.map(x => x.user_id).sort(), ['a', 'b']);
  assert.equal(p[0].body, 'Dein Einsatz am 12.11. (Estrel) hat eine neue Zeit.');
});

test('update: someone added to an existing shift is told, the colleagues are not', () => {
  const p = upd([{ date: '2026-11-12', venue: 'Estrel', change_status: 'geändert', change_fields: ['Wer'], added_user_ids: ['b', 'gone'], plan_assignments: on('a', 'b') }]);
  assert.deepEqual(p, [{ user_id: 'b', title: 'Wochenplan KW 46 geändert', body: 'Du bist am 12.11. neu eingeplant (Estrel).' }]);
});

test('update: added and a new time on the same shift is one line, "neu"', () => {
  const p = upd([{ date: '2026-11-12', venue: 'Estrel', change_status: 'geändert', change_fields: ['Wann', 'Wer'], added_user_ids: ['b'], plan_assignments: on('a', 'b') }]);
  const by = Object.fromEntries(p.map(x => [x.user_id, x.body]));
  assert.equal(by.b, 'Du bist am 12.11. neu eingeplant (Estrel).');
  assert.equal(by.a, 'Dein Einsatz am 12.11. (Estrel) hat eine neue Zeit.');
});

test('update: eight affected shifts are still one push per person', () => {
  const shifts = [];
  for (let d = 10; d <= 13; d++) {
    shifts.push({ date: `2026-11-${d}`, venue: 'Estrel', change_status: 'neu', plan_assignments: on('a') });
    shifts.push({ date: `2026-11-${d}`, venue: 'Messe', change_status: 'geändert', change_fields: ['Wann'], plan_assignments: on('a') });
  }
  const p = upd(shifts, [{ date: '2026-11-14', venue: 'VBKI', user_ids: ['a'] }, { date: '2026-11-15', venue: 'Lager', user_ids: ['a'], kind: 'unassigned' }]);
  assert.equal(p.length, 1);
  assert.equal(p[0].body, '10 deiner Einsätze: 4 neu, 4 mit neuer Zeit, 2 entfallen. Der erste am 10.11. (Estrel).');
});

test('update: a changed shift saved without the detail (upload from the live app) still notifies everyone on it', () => {
  const p = upd([{ date: '2026-11-12', venue: 'Estrel', change_status: 'geändert', plan_assignments: on('a', 'b') },
    { date: '2026-11-12', venue: 'Messe', change_status: 'geändert', change_fields: null, plan_assignments: on('c') }]);
  assert.deepEqual(p.map(x => x.user_id).sort(), ['a', 'b', 'c']);
  assert.equal(p[0].body, 'Dein Einsatz am 12.11. (Estrel) wurde geändert.');
});
