// Run from the repo root: node --test tests/fehler.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/fehler.js'), 'utf8'), ctx, { filename: 'fehler.js' });
const rows = [
  { fingerprint: 'a', status: 'neu', versions: ['v231', 'v232'] },
  { fingerprint: 'b', status: 'behoben', versions: ['v232'] },
  { fingerprint: 'c', status: 'neu', versions: ['v230'] },
];
const fps = r => r.map(x => x.fingerprint).join('');

test('filterErrors: no filter keeps all', () => {
  assert.equal(fps(ctx.filterErrors(rows, { onlyCurrent: false, onlyNew: false, version: 'v232' })), 'abc');
});
test('filterErrors: only current version', () => {
  assert.equal(fps(ctx.filterErrors(rows, { onlyCurrent: true, onlyNew: false, version: 'v232' })), 'ab');
});
test('filterErrors: only new', () => {
  assert.equal(fps(ctx.filterErrors(rows, { onlyCurrent: false, onlyNew: true, version: 'v232' })), 'ac');
});
test('filterErrors: both combine; missing versions safe', () => {
  assert.equal(fps(ctx.filterErrors(rows, { onlyCurrent: true, onlyNew: true, version: 'v232' })), 'a');
  assert.equal(ctx.filterErrors([{ fingerprint: 'x', status: 'neu' }], { onlyCurrent: true, onlyNew: false, version: 'v1' }).length, 0);
});
test('errorsBadgeCount counts neu in both lists', () => {
  assert.equal(ctx.errorsBadgeCount([{ status: 'neu' }, { status: 'behoben' }], [{ status: 'neu' }]), 2);
  assert.equal(ctx.errorsBadgeCount(null, undefined), 0);
});
