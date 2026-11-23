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

test('autoResolveCandidates: not seen for 2 versions and 3 days → fixed; recent, ignored, test build or unversioned stay', () => {
  const now = new Date('2026-11-30T12:00:00Z');
  const old = '2026-11-20T10:00:00Z', fresh = '2026-11-29T10:00:00Z';
  const errs = [
    { fingerprint: 'old', status: 'neu', versions: ['stundenzettel-v235'], last_seen: old },
    { fingerprint: 'seen', status: 'gesehen', versions: ['stundenzettel-v236', 'stundenzettel-v237'], last_seen: old },
    { fingerprint: 'prev', status: 'neu', versions: ['stundenzettel-v238'], last_seen: old },       // previous version → stays
    { fingerprint: 'cur', status: 'neu', versions: ['stundenzettel-v239'], last_seen: old },
    { fingerprint: 'recent', status: 'neu', versions: ['stundenzettel-v230'], last_seen: fresh },  // seen yesterday → stays
    { fingerprint: 'ign', status: 'ignoriert', versions: ['stundenzettel-v200'], last_seen: old },
    { fingerprint: 'done', status: 'behoben', versions: ['stundenzettel-v200'], last_seen: old },
    { fingerprint: 'nover', status: 'neu', versions: [], last_seen: old },
    { fingerprint: 'exp', status: 'neu', versions: ['stundenzettel-exp-af6305a'], last_seen: old },
  ];
  assert.deepEqual([...ctx.autoResolveCandidates(errs, 'stundenzettel-v239', now)], ['old', 'seen']);
  assert.deepEqual([...ctx.autoResolveCandidates(errs, 'stundenzettel-exp-af6305a', now)], []);
  assert.deepEqual([...ctx.autoResolveCandidates(errs, '?', now)], []);
  assert.equal(ctx.fehlerVersionNum('stundenzettel-v239'), 239);
  assert.equal(ctx.fehlerVersionNum('stundenzettel-exp-af6305a'), null);
});
