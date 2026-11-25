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

test('review: without errors.js (queueReport missing) the form says it failed, not Danke', () => {
  const toasts = [];
  const val = { 'problem-wanted': { value: 'x' }, 'problem-happened': { value: '' }, 'problem-tech': { checked: false } };
  const c = vm.createContext({ console, navigator: { onLine: true }, showToast: (m, t) => toasts.push([m, t]),
    document: { getElementById: id => val[id] || { classList: { remove() {} } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/problem.js'), 'utf8'), c);
  c.sendProblemForm();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][1], 'danger');
  assert.ok(!/Danke/.test(toasts[0][0]));
});

test('Jenni 25.11.: „angekommen“ only after the send, otherwise it says it goes out later', async () => {
  const run = async (ok) => {
    const toasts = [];
    const val = { 'problem-wanted': { value: 'x' }, 'problem-happened': { value: '' }, 'problem-tech': { checked: false } };
    const c = vm.createContext({ console, navigator: { onLine: true }, showToast: (m, t) => toasts.push([m, t]),
      queueReport: () => Promise.resolve(ok),
      document: { getElementById: id => val[id] || { classList: { remove() {} } } } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/problem.js'), 'utf8'), c);
    c.sendProblemForm();
    assert.ok(!/Danke/.test(toasts[0][0]));
    await new Promise(r => setTimeout(r, 0));
    return toasts[1];
  };
  assert.match((await run(true))[0], /Danke, ist angekommen/);
  const [msg, type] = await run(false);
  assert.ok(!/Danke/.test(msg) && type === 'danger');
});
