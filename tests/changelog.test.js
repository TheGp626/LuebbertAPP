// Run from the repo root: node --test tests/changelog.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CHANGELOG, unseenChangelog } = require('../js/changelog.js');
test('unseenChangelog: only entries newer than the seen one', () => {
  const list = [{ version: 'c' }, { version: 'b' }, { version: 'a' }];
  assert.deepEqual(unseenChangelog(list, 'b').map(e => e.version), ['c']);
  assert.deepEqual(unseenChangelog(list, 'c'), []);
  assert.deepEqual(unseenChangelog(list, '').map(e => e.version), ['c', 'b', 'a']);
  assert.deepEqual(unseenChangelog(list, 'gone').map(e => e.version), ['c', 'b', 'a']);
});
test('CHANGELOG: first entry is the PIN release with the reset hint', () => {
  assert.equal(CHANGELOG[0].title, 'Neu: deine eigene PIN');
  assert.ok(CHANGELOG[0].items.some(t => t.includes('AL oder PL')));
});
