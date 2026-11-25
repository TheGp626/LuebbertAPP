// Run from the repo root: node --test tests/frage.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/frage.js'), 'utf8'), ctx, { filename: 'frage.js' });
const plain = v => JSON.parse(JSON.stringify(v));

test('frageMeldung: Ja writes the same Meldung as „Ich kann“ for a plan shift or an Auftrag phase', () => {
  assert.deepEqual(plain(ctx.frageMeldung('shift:11111111-2222-3333-4444-555555555555|Fr|Estrel|7', 'u1')),
    { table: 'plan_shift_interest', row: { week_id: '11111111-2222-3333-4444-555555555555', shift_key: 'Fr|Estrel|7', user_id: 'u1' } });
  assert.deepEqual(plain(ctx.frageMeldung('order:25-1234.01|teardown', 'u1')),
    { table: 'order_applications', row: { job_no: '25-1234.01', phase: 'teardown', user_id: 'u1' } });
  assert.equal(ctx.frageMeldung('order:25-1234.01|lunch', 'u1'), null);
  assert.equal(ctx.frageMeldung('', 'u1'), null);
});
