// Run from the repo root: node --test tests/ordner.test.js
// Loads utils.js, ui.js and ordner.js into one sandbox (as in index.html); only pure helpers are tested.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let ctx;
beforeEach(() => {
  ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    navigator: { onLine: true },
    setTimeout: () => 0,
  });
  ctx.window = ctx;
  for (const f of ['utils.js', 'ui.js', 'ordner.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  }
});
const plain = v => JSON.parse(JSON.stringify(v));

test('ordnerMenuItems: folder actions only with the right to manage', () => {
  assert.deepEqual(plain(ctx.ordnerMenuItems(false, 'f1')), []);
  const items = plain(ctx.ordnerMenuItems(true, 'f1'));
  assert.deepEqual(items.map(i => i.label), ['Unterordner anlegen', 'PL & Einsätze', 'Ordner löschen']);
  assert.deepEqual(items[1], { label: 'PL & Einsätze', action: 'openOrdnerForm', args: ['f1'] });
  assert.equal(items[2].danger, true);
});

test('ordnerFileKind: image / video / file for the row icon', () => {
  assert.equal(ctx.ordnerFileKind('image/png', 'a.png'), 'image');
  assert.equal(ctx.ordnerFileKind('', 'Plan.JPG'), 'image');
  assert.equal(ctx.ordnerFileKind('video/mp4', 'x'), 'video');
  assert.equal(ctx.ordnerFileKind('application/pdf', 'Hallenplan.pdf'), 'file');
  assert.equal(ctx.ordnerFileKind('', ''), 'file');
});

test('ordnerFolderMenu: "Bearbeiten" opens the full folder form', () => {
  let items = null;
  ctx.openUiMenu = i => { items = i; };
  ctx.ordnerFolderMenu('f1');
  assert.deepEqual(plain(items), [{ label: 'Bearbeiten', action: 'openOrdnerForm', args: ['f1'] }]);
});
