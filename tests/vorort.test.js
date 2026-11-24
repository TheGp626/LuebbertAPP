// Run from the repo root: node --test tests/vorort.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/vorort.js');

test('voFolderTree: root and every folder below it', () => {
  const f = [{ id: 'a' }, { id: 'a1', parent_id: 'a' }, { id: 'a11', parent_id: 'a1' }, { id: 'b' }, { id: 'b1', parent_id: 'b' }];
  assert.deepEqual(V.voFolderTree(f, 'a').sort(), ['a', 'a1', 'a11']);
  assert.deepEqual(V.voFolderTree([], 'x'), ['x']);
});

test('voSortPlans: setup/plan names first, then by name', () => {
  const s = V.voSortPlans([{ name: 'Overview.pdf' }, { name: 'IPM_Setup_Foyer.pdf' }, { name: 'Anfahrt.jpg' }, { name: 'Aufbauplan.pdf' }]);
  assert.deepEqual(s.map(x => x.name), ['Aufbauplan.pdf', 'IPM_Setup_Foyer.pdf', 'Anfahrt.jpg', 'Overview.pdf']);
});
