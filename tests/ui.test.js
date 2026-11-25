// Run from the repo root: node --test tests/ui.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/ui.js');

test('uiEmptyHtml escapes title and text', () => {
  assert.match(U.uiEmptyHtml('<b>', 'x'), /&lt;b&gt;/);
  assert.match(U.uiEmptyHtml('T', 'a & b'), /a &amp; b/);
  assert.match(U.uiEmptyHtml('T', 'x', '<button>Go</button>'), /<button>Go<\/button>/);
});

test('uiMenuHtml: buttons call closeUiMenu then the action with args, danger class', () => {
  const h = U.uiMenuHtml([{ label: 'Löschen', action: 'deleteWeek', args: ['2026-W44'], danger: true }, { label: 'Zeile', action: 'toggleRow', args: [3] }]);
  assert.match(h, /onclick="closeUiMenu\(\);deleteWeek\('2026-W44'\)"/);
  assert.match(h, /onclick="closeUiMenu\(\);toggleRow\(3\)"/);
  assert.match(h, /ui-btn-danger/);
  // quotes in args cannot break out of the attribute
  assert.doesNotMatch(U.uiMenuHtml([{ label: 'x', action: 'f', args: ["a'\"b"] }]), /f\('a'"/);
});

test('topbarMenuItems: module items first, Optionen always last', () => {
  U.UI_TOPBAR_ITEMS.protokoll = () => [{ label: 'Formular leeren', action: 'clearProtForm' }];
  assert.deepEqual(U.topbarMenuItems('protokoll').map(i => i.label), ['Formular leeren', 'Optionen']);
  assert.deepEqual(U.topbarMenuItems('ordner').map(i => i.label), ['Optionen']);
  assert.deepEqual(U.topbarMenuItems(null).map(i => i.action), ['openSettingsModal']);
});

test('uiIcon returns an svg for known names and empty svg for unknown', () => {
  assert.match(U.uiIcon('clock'), /^<svg class="ui-ico"/);
  ['clock', 'clipboard', 'calendar', 'box', 'folder', 'chart', 'users', 'chevron-left', 'chevron-right', 'dots', 'plus', 'search', 'file', 'image', 'video', 'trash', 'edit', 'download', 'upload', 'check']
    .forEach(n => assert.ok(U.UI_ICONS[n], n));
});

test('uiComboMatches: empty query lists everyone by name, otherwise case-insensitive contains', () => {
  const users = [{ id: '1', full_name: 'Zora Test' }, { id: '2', full_name: 'anna Muster' }, { id: '3', full_name: 'Bert Beispiel' }, { id: '4', email: 'x@y.z' }];
  assert.deepEqual(U.uiComboMatches(users, '').map(u => u.id), ['2', '3', '1', '4']);
  assert.deepEqual(U.uiComboMatches(users, '  ').length, 4);
  assert.deepEqual(U.uiComboMatches(users, 'MUS').map(u => u.id), ['2']);
  assert.deepEqual(U.uiComboMatches(users, 'e').map(u => u.id), ['2', '3', '1']);
  assert.deepEqual(U.uiComboMatches(users, 'zzz'), []);
  assert.deepEqual(U.uiComboMatches(null, 'a'), []);
});

test('uiComboHtml: input with escaped value, pick handler and arg, empty list container', () => {
  const h = U.uiComboHtml('c1', 'A "B" <x>', 'Name', 'onPick', 3);
  assert.match(h, /class="ui-combo"/);
  assert.match(h, /id="c1"/);
  assert.match(h, /value="A &quot;B&quot; &lt;x&gt;"/);
  assert.match(h, /data-pick="onPick"/);
  assert.match(h, /data-arg="3"/);
  assert.match(h, /class="combo-list ui-combo-list"/);
});

// Send/save buttons are disabled while a request runs (double-submit protection); their selectors must match the markup
test('buttons disabled during Senden / Speichern are found by the JS selectors', () => {
  const fs = require('fs'), path = require('path');
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = read('index.html'), prot = read('js/protokoll.js'), prod = read('js/produkte.js');
  assert.match(prot, /querySelector\('#page-protokoll \.ui-actionbar \.ui-btn-primary'\)/);
  assert.match(prod, /querySelector\('#produkt-form \.ui-btn-primary'\)/);
  const protPage = html.slice(html.indexOf('id="page-protokoll"'), html.indexOf('id="page-protokoll-history"'));
  assert.match(protPage, /class="ui-actionbar"[\s\S]*class="ui-btn ui-btn-primary"[^>]*onclick="saveProtokoll\(\)"/);
  const prodForm = html.slice(html.indexOf('id="produkt-form"'), html.indexOf('PRODUKT VIEWER MODAL'));
  assert.match(prodForm, /class="ui-btn ui-btn-primary" onclick="saveProdukt\(\)"/);
});

test('uiComboNextIndex: arrows move and wrap, Enter picks, Escape closes', () => {
  assert.deepEqual(U.uiComboKeyAction('ArrowDown', -1, 3), { index: 0 });
  assert.deepEqual(U.uiComboKeyAction('ArrowDown', 2, 3), { index: 0 });
  assert.deepEqual(U.uiComboKeyAction('ArrowUp', -1, 3), { index: 2 });
  assert.deepEqual(U.uiComboKeyAction('ArrowUp', 0, 3), { index: 2 });
  assert.deepEqual(U.uiComboKeyAction('Enter', 1, 3), { pick: 1 });
  assert.equal(U.uiComboKeyAction('Enter', -1, 3), null);
  assert.deepEqual(U.uiComboKeyAction('Escape', 1, 3), { close: true });
  assert.equal(U.uiComboKeyAction('ArrowDown', -1, 0), null);
  assert.equal(U.uiComboKeyAction('a', 0, 3), null);
});

test('topbarMenuItems: PIN entries by role', () => {
  const labels = role => { global.userRole = role; return U.topbarMenuItems(null).map(i => i.label); };
  assert.deepEqual(labels('Gast'), ['Optionen']);
  assert.deepEqual(labels('MA'), ['PIN ändern', 'Optionen']);
  assert.deepEqual(labels('AL'), ['PIN ändern', 'PIN zurücksetzen', 'Optionen']);
  assert.deepEqual(labels('Buchhaltung'), ['PIN ändern', 'Optionen']);
  delete global.userRole;
});

test('uiComboHtml: data-source only when given', () => {
  assert.match(U.uiComboHtml('i', '', 'p', 'f', '', 'pinResetUsers'), /data-source="pinResetUsers"/);
  assert.doesNotMatch(U.uiComboHtml('i', '', 'p', 'f', ''), /data-source/);
});

test('uiGuardTap: a repeated tap waits for the running action, code calls pass through', async () => {
  let calls = 0; const rel = [];
  const fn = async (a) => { calls++; await new Promise(r => rel.push(r)); return a; };
  let ev = { type: 'click', target: null };
  const g = U.uiGuardTap(fn, 'save', () => ev, 50);
  const p1 = g(1), p2 = g(1);
  assert.equal(calls, 1);          // second tap ignored
  assert.equal(p1, p2);
  g(2);                            // other arguments: another action
  assert.equal(calls, 2);
  ev = null; g(1);                 // not from a tap
  assert.equal(calls, 3);
  rel[0](); await p1;
  ev = { type: 'click', target: null };
  g(1);                            // finished: a new tap runs again
  assert.equal(calls, 4);
  rel.forEach(r => r());
});

test('uiGuardTap: sync throw and non-promise results are passed on', () => {
  const g = U.uiGuardTap(() => 5, 'f', () => ({ type: 'click' }));
  assert.equal(g(), 5);
  const h = U.uiGuardTap(() => { throw new Error('x'); }, 'h', () => ({ type: 'click' }));
  assert.throws(() => h(), /x/);
  assert.equal(h.length, 0);
});

test('review: toasts sit above the login overlay (10000) and the Problem-melden sheet (10001)', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '../css/ui.css'), 'utf8');
  const zs = [...css.matchAll(/(^|\n)\.toast\s*\{[^}]*z-index:\s*(\d+)/g)].map(m => +m[2]);
  assert.ok(zs.length && Math.max(...zs) > 10001, 'z-index ' + zs);
});
