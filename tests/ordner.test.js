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

test('ordnerExpired: only the folder\'s own PL (or Admin) sees expired top-level folders', () => {
  const folders = [
    { id: 'a', pl_id: 'pl1', ends_on: '2026-10-01' },
    { id: 'b', pl_id: 'pl2', ends_on: '2026-09-01' },
    { id: 'c', pl_id: 'pl1', ends_on: '2026-10-30' },               // ends today → not expired yet
    { id: 'd', pl_id: 'pl1', ends_on: null },
    { id: 'e', pl_id: 'pl1', ends_on: '2026-08-01', parent_id: 'a' }, // subfolders follow their parent
    { id: 'f', pl_id: 'pl1', ends_on: '2026-08-15' },
  ];
  const ids = (u, r) => plain(ctx.ordnerExpired(folders, '2026-10-30', u, r)).map(f => f.id);
  assert.deepEqual(ids('pl1', 'PL'), ['f', 'a']);       // oldest end date first
  assert.deepEqual(ids('pl2', 'PL'), ['b']);
  assert.deepEqual(ids('x', 'Admin'), ['f', 'b', 'a']);
  assert.deepEqual(ids('pl1', 'AL'), []);
  assert.deepEqual(ids('pl1', 'MA'), []);
  assert.deepEqual(ids('pl1', 'Gast'), []);
  assert.deepEqual(ids(null, 'PL'), []);
  assert.deepEqual(plain(ctx.ordnerExpired(null, '2026-10-30', 'pl1', 'PL')), []);
});

test('ordnerEndsLabel: German date or empty', () => {
  assert.equal(ctx.ordnerEndsLabel('2026-10-05'), 'Projektende: 05.10.2026');
  assert.equal(ctx.ordnerEndsLabel(null), '');
});
