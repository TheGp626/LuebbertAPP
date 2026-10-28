// Run: node --test supabase/functions/notify-plan-change/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPushText, buildPlanPushes } from './notify.mjs';

test('planPushText', () => {
  assert.deepEqual(planPushText(45, true, [{ date: '2026-11-03', venue: 'Messe Berlin', kind: 'neu' }]),
    { title: 'Wochenplan KW 45', body: 'Du bist am 03.11. eingeplant (Messe Berlin).' });
  assert.equal(planPushText(45, false, [{ date: '2026-11-04', venue: 'Estrel', kind: 'entfallen' }]).body,
    'Dein Einsatz am 04.11. (Estrel) entfällt.');
  assert.match(planPushText(45, false, [{ date: '2026-11-04', venue: 'Estrel', kind: 'geändert' }, { date: '2026-11-05', venue: 'X', kind: 'neu' }]).body,
    /^2 deiner Einsätze/);
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
