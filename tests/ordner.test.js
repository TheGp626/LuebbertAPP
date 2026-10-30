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

test('ordnerAutoDeleteDate: latest non-cancelled job + 7 days', () => {
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-10-01' }, { date: '2026-10-12' }, { date: '2026-10-05' }]), '2026-10-19');
  // cancelled jobs are ignored, even when they are the latest
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-10-01' }, { date: '2026-11-20', cancelled: true }]), '2026-10-08');
  // month and year rollover
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-10-28' }]), '2026-11-04');
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-12-28' }]), '2027-01-04');
  // leap day
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2028-02-25' }]), '2028-03-03');
});

test('ordnerAutoDeleteDate: null without dated, non-cancelled jobs', () => {
  assert.equal(ctx.ordnerAutoDeleteDate([]), null);
  assert.equal(ctx.ordnerAutoDeleteDate(null), null);
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '' }, { date: null }, { date: '2026-10-01', cancelled: true }]), null);
});

test('ordnerDeleteInfo: date and days until deletion', () => {
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: null }, '2026-10-30'), null);
  assert.equal(ctx.ordnerDeleteInfo(null, '2026-10-30'), null);
  assert.deepEqual(plain(ctx.ordnerDeleteInfo({ ends_on: '2026-11-06' }, '2026-10-30')), { date: '2026-11-06', days: 7 });
  assert.deepEqual(plain(ctx.ordnerDeleteInfo({ ends_on: '2026-10-31' }, '2026-10-30')), { date: '2026-10-31', days: 1 });
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: '2026-10-30' }, '2026-10-30').days, 0);   // today
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: '2026-10-20' }, '2026-10-30').days, 0);   // overdue
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: '2027-01-02' }, '2026-12-30').days, 3);   // year rollover
});

test('ordnerDeleteLabel / ordnerDeleteBadge: German texts', () => {
  assert.equal(ctx.ordnerDeleteLabel('2026-10-05'), 'Löschung am 05.10.2026');
  assert.equal(ctx.ordnerDeleteLabel(null), '');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 8 }), '');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 7 }), 'wird in 7 Tagen gelöscht');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 1 }), 'wird in 1 Tag gelöscht');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 0 }), 'wird heute gelöscht');
  assert.equal(ctx.ordnerDeleteBadge(null), '');
});

test('ordnerNextDeleteValue: the form follows the jobs unless the date was moved by hand', () => {
  // empty or still the old auto value → follows the new auto value
  assert.equal(ctx.ordnerNextDeleteValue('', '', '2026-10-19'), '2026-10-19');
  assert.equal(ctx.ordnerNextDeleteValue('2026-10-19', '2026-10-19', '2026-10-26'), '2026-10-26');
  // last job removed → field empties again
  assert.equal(ctx.ordnerNextDeleteValue('2026-10-19', '2026-10-19', ''), '');
  // moved by hand → kept
  assert.equal(ctx.ordnerNextDeleteValue('2026-12-01', '2026-10-19', '2026-10-26'), '2026-12-01');
  assert.equal(ctx.ordnerNextDeleteValue('2026-12-01', '', '2026-10-26'), '2026-12-01');
});
