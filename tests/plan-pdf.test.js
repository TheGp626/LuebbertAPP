// Run from the repo root: node --test tests/plan-pdf.test.js
// readPlanPdf with a fake pdf.js: the document is always destroyed (phones keep every loaded PDF otherwise).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function load(failText) {
  const log = { destroyed: 0, opLists: 0 };
  const page = {
    getViewport: () => ({ width: 100, height: 100, convertToViewportPoint: (x, y) => [x, 100 - y] }),
    getTextContent: async () => { if (failText) throw new Error('kaputt'); return { items: [{ str: 'Aufbau:', transform: [8, 0, 0, 8, 10, 90], width: 30 }] }; },
    getOperatorList: async () => { log.opLists++; return { fnArray: [], argsArray: [] }; },
  };
  const pdf = { numPages: 1, getPage: async () => page, destroy: async () => { log.destroyed++; } };
  const ctx = vm.createContext({ pdfjsLib: { OPS: {}, getDocument: () => ({ promise: Promise.resolve(pdf) }) } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/plan-pdf.js'), 'utf8'), ctx);
  return { ctx, log };
}

test('readPlanPdf: destroys the document, textOnly skips the operator list', async () => {
  const { ctx, log } = load(false);
  const pages = await ctx.readPlanPdf(new ArrayBuffer(1), { textOnly: true });
  assert.equal(pages[0].items[0].s, 'Aufbau:');
  assert.equal(log.opLists, 0);
  assert.equal(log.destroyed, 1);
  await ctx.readPlanPdf(new ArrayBuffer(1));
  assert.equal(log.opLists, 1);
  assert.equal(log.destroyed, 2);
});

test('readPlanPdf: destroys the document when reading fails', async () => {
  const { ctx, log } = load(true);
  await assert.rejects(ctx.readPlanPdf(new ArrayBuffer(1)));
  assert.equal(log.destroyed, 1);
});
