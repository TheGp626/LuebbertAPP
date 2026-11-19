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
test('CHANGELOG: newest entry is the November release, the PIN entry stays behind it', () => {
  assert.equal(CHANGELOG[0].version, '2026-11-release');
  assert.ok(CHANGELOG[0].items[CHANGELOG[0].items.length - 1].includes('AL oder PL'));
  assert.equal(CHANGELOG[1].title, 'Neu: deine eigene PIN');
  assert.ok(CHANGELOG[1].items.some(t => t.includes('AL oder PL')));
});
