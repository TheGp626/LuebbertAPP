// Run from the repo root: node --test tests/material.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/material.js');

const job = { jobNo: '26-1234.01', name: 'Gala', materials: [
  { group: 'Mobiliar', items: [{ qty: 10, name: 'Stuhl Clara' }, { qty: 4, name: 'Stehtisch' }] },
  { group: 'Stoffe', items: [{ qty: 120, name: 'Husse weiß' }] }] };

test('phase, keys and job numbers', () => {
  assert.equal(M.mcPhaseOf('Abbau'), 'abbau');
  assert.equal(M.mcPhaseOf('Teilabbau'), 'abbau');
  assert.equal(M.mcPhaseOf('teardown'), 'abbau');
  assert.equal(M.mcPhaseOf('Umbau'), 'aufbau');
  assert.equal(M.mcPhaseOf(''), 'aufbau');
  assert.equal(M.mcJobKey('26-1234.01'), 'job:26-1234.01');
  assert.equal(M.mcPlanKey('2026-11-18', ' Breko '), 'plan:2026-11-18|breko');
  assert.ok(M.mcIsJobNo('26-1234.01'));
  assert.ok(!M.mcIsJobNo('26-1234'));
});

test('job items: group.item keys, soll from qty', () => {
  const it = M.mcJobItems(job);
  assert.deepEqual(it.map(i => [i.key, i.group, i.name, i.soll]),
    [['0.0', 'Mobiliar', 'Stuhl Clara', 10], ['0.1', 'Mobiliar', 'Stehtisch', 4], ['1.0', 'Stoffe', 'Husse weiß', 120]]);
  assert.deepEqual(M.mcJobItems(null), []);
});

test('plan items: quantity lines, headings as groups, repeated lines numbered', () => {
  const it = M.mcPlanItems(['6 Flatsofa Eiche + Kissen schwarz', 'Barbereich', '3 Stehtisch Kris weiß', '3 Stehtisch Kris weiß', '']);
  assert.deepEqual(it.map(i => [i.key, i.group, i.soll]), [
    ['p:flatsofa eiche + kissen schwarz', '', 6], ['p:stehtisch kris weiß', 'Barbereich', 3], ['p:stehtisch kris weiß#2', 'Barbereich', 3]]);
  assert.deepEqual(M.mcPlanItems(['Barbereich']), []);
});

test('lines and summary: Aufbau against Soll, Abbau against what was set up', () => {
  const items = M.mcJobItems(job);
  const rows = [
    { phase: 'aufbau', item_key: '0.0', qty: 8, note: '2 mit Kratzern', updated_by: 'u1' },
    { phase: 'aufbau', item_key: '0.1', qty: 4, note: '' },
    { phase: 'abbau', item_key: '0.0', qty: 7, note: '' },
  ];
  const by = M.mcIndexRows(rows);
  const up = M.mcLines(items, by, 'aufbau');
  assert.deepEqual(up.map(l => [l.base, l.ist, l.fehlt]), [[10, 8, 2], [4, 4, 0], [120, null, 0]]);
  assert.equal(M.mcSummary(up).text, '2 von 3 abgehakt, 1 mit Fehlmenge');
  const down = M.mcLines(items, by, 'abbau');
  assert.deepEqual(down.map(l => [l.base, l.ist, l.fehlt]), [[8, 7, 1], [4, null, 0], [120, null, 0]]);
  assert.equal(M.mcSummary(down).text, '1 von 3 abgehakt, 1 mit Fehlmenge');
});

test('shortages for the protocol: missing quantities and notes of ticked positions', () => {
  const items = M.mcJobItems(job);
  const rows = [
    { phase: 'aufbau', item_key: '0.0', qty: 8, note: '2 mit Kratzern' },
    { phase: 'aufbau', item_key: '0.1', qty: 4, note: 'einer wackelt' },
    { phase: 'aufbau', item_key: '1.0', qty: 120, note: '' },
  ];
  const s = M.mcShortages(items, rows, 'aufbau');
  assert.deepEqual(s, [
    { name: 'Stuhl Clara', soll: 10, ist: 8, fehlt: 2, note: '2 mit Kratzern' },
    { name: 'Stehtisch', soll: 4, ist: 4, fehlt: 0, note: 'einer wackelt' }]);
  assert.equal(M.mcShortageText(s[0]), 'Stuhl Clara: 10 → 8, fehlt 2 (2 mit Kratzern)');
  assert.equal(M.mcShortageText(s[1]), 'Stehtisch: 4 → 4 (einer wackelt)');
  assert.deepEqual(M.mcShortages(items, [], 'abbau'), []);
});

test('offline queue: newest change per position, pending wins over older server rows', () => {
  let q = M.mcQueuePut([], { list_key: 'job:1', phase: 'aufbau', item_key: 'a', qty: 1, changed_at: '2026-11-18T10:00:00Z' });
  q = M.mcQueuePut(q, { list_key: 'job:1', phase: 'aufbau', item_key: 'a', qty: 2, changed_at: '2026-11-18T10:01:00Z' });
  q = M.mcQueuePut(q, { list_key: 'job:1', phase: 'abbau', item_key: 'a', qty: 3, changed_at: '2026-11-18T10:02:00Z' });
  assert.equal(q.length, 2);
  const server = [{ list_key: 'job:1', phase: 'aufbau', item_key: 'a', qty: 9, changed_at: '2026-11-18T09:00:00Z' },
    { list_key: 'job:1', phase: 'aufbau', item_key: 'b', qty: 5, changed_at: '2026-11-18T09:00:00Z' }];
  const merged = M.mcIndexRows(M.mcWithPending(server, q, 'job:1'));
  assert.equal(merged['aufbau|a'].qty, 2);
  assert.equal(merged['aufbau|a']._pending, true);
  assert.equal(merged['aufbau|b'].qty, 5);
  assert.equal(merged['abbau|a'].qty, 3);
  // a newer change from someone else beats an older pending one
  const newer = [{ list_key: 'job:1', phase: 'aufbau', item_key: 'a', qty: 7, changed_at: '2026-11-18T11:00:00Z' }];
  assert.equal(M.mcIndexRows(M.mcWithPending(newer, q, 'job:1'))['aufbau|a'].qty, 7);
  // other lists are untouched
  assert.equal(M.mcWithPending([], q, 'job:2').length, 0);
});

test('pick source: Bestätigung first, a started plan list stays when the Bestätigung comes later', () => {
  const j = [{ key: '0.0' }], p = [{ key: 'p:x' }];
  assert.deepEqual(M.mcPickSource(j, p, [], []), { use: 'job', switchToJob: false });
  assert.deepEqual(M.mcPickSource(j, p, [], [{}]), { use: 'plan', switchToJob: true });
  assert.deepEqual(M.mcPickSource(j, p, [{}], [{}]), { use: 'job', switchToJob: false });
  assert.deepEqual(M.mcPickSource([], p, [], []), { use: 'plan', switchToJob: false });
  assert.deepEqual(M.mcPickSource([], [], [], []), { use: null, switchToJob: false });
});
