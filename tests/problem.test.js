// Run from the repo root: node --test tests/problem.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/problem.js'), 'utf8'), ctx, { filename: 'problem.js' });
const plain = v => JSON.parse(JSON.stringify(v));
const snap = { version: 'v1', device: 'iOS 18 Safari, Tab', online: true, standalone: false, screen: 'page-home', breadcrumbs: [] };

test('buildProblemPayload: both texts blank gives null', () => {
  assert.equal(ctx.buildProblemPayload('', '  ', true, snap, []), null);
  assert.equal(ctx.buildProblemPayload(null, undefined, true, snap, []), null);
});

test('buildProblemPayload: without tech info no context, fingerprints stay', () => {
  assert.deepEqual(plain(ctx.buildProblemPayload(' Plan öffnen ', 'leer', false, snap, ['ab'])),
    { wanted: 'Plan öffnen', happened: 'leer', context: null, fingerprints: ['ab'] });
});

test('buildProblemPayload: with tech info the snapshot goes along; texts cut at 2000', () => {
  const p = plain(ctx.buildProblemPayload('w'.repeat(2500), 'x', true, snap, []));
  assert.deepEqual(p.context, snap);
  assert.equal(p.wanted.length, 2000);
});
