// Run from the repo root: node --test tests/nav.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const N = require('../js/nav.js');

// The role rules live in auth.js (browser globals) → load them from the source
const auth = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
const gast = auth.match(/var GAST_MODULES = [^;]+;/)[0];
const fn = auth.match(/function moduleAllowedForRole\([\s\S]*?\r?\n}\r?\n/)[0];
const allowed = new Function(gast + '\n' + fn + '; return moduleAllowedForRole;')();

const ids = (r, s = false) => N.navTabs(r, allowed, s).tabs.map(t => t.id);
const more = (r, s = false) => N.navTabs(r, allowed, s).more.map(t => t.id);

test('tabs per role (spec table)', () => {
  assert.deepEqual(ids('MA'), ['heute', 'plan', 'zettel', 'mehr']);
  assert.deepEqual(ids('AL'), ['heute', 'plan', 'protokoll', 'zettel', 'uebersicht', 'mehr']);
  assert.deepEqual(ids('PL'), ['heute', 'plan', 'auftraege', 'protokolle', 'personal', 'mehr']);
  assert.deepEqual(ids('Admin'), ['heute', 'plan', 'auftraege', 'protokolle', 'personal', 'mehr']);
  assert.deepEqual(ids('Buchhaltung'), ['heute', 'protokolle', 'personal', 'mehr']);
  assert.deepEqual(ids('Gast'), ['produkte', 'ordner', 'plaene']);
});

test('Mehr per role', () => {
  assert.deepEqual(more('MA'), ['produkte', 'ordner', 'plaene', 'optionen', 'problem']);
  assert.deepEqual(more('AL'), ['personal', 'produkte', 'ordner', 'plaene', 'optionen', 'problem']);
  assert.deepEqual(more('PL'), ['zettel', 'produkte', 'ordner', 'plaene', 'optionen', 'problem']);
  assert.deepEqual(more('Admin'), ['admin', 'zettel', 'produkte', 'ordner', 'plaene', 'optionen', 'problem']);
  assert.deepEqual(more('Buchhaltung'), ['plan', 'zettel', 'produkte', 'ordner', 'plaene', 'optionen', 'problem']);
  assert.deepEqual(more('MA', true).slice(0, 1), ['auftraege']); // sees plan interest → Aufträge under Mehr
  assert.deepEqual(more('Gast'), []);
});

test('tab targets', () => {
  const pl = N.navTabs('PL', allowed);
  const t = Object.fromEntries(pl.tabs.concat(pl.more).map(x => [x.id, x]));
  assert.equal(t.heute.mode, null);
  assert.equal(t.plan.mode, 'wochenplan');
  assert.equal(t.protokolle.mode, 'dashboard'); assert.equal(t.protokolle.view, 'prot');
  assert.equal(t.personal.mode, 'dashboard'); assert.equal(t.personal.view, 'work');
  assert.equal(t.zettel.mode, 'stunden');
  assert.equal(t.auftraege.mode, 'auftraege');
  assert.equal(t.optionen.action, 'openSettingsModal');
  assert.equal(t.problem.action, 'openProblemForm');
  const ad = N.navTabs('Admin', allowed).more;
  assert.equal(ad.find(x => x.id === 'admin').mode, 'admin');
  assert.ok(!ad.some(x => x.id === 'einstellungen' || x.id === 'fehler'));
  for (const r of ['MA', 'AL', 'PL', 'Buchhaltung', 'Gast']) assert.ok(!N.navTabs(r, allowed).more.some(x => x.id === 'admin'), r);
  assert.equal(N.navTabs('AL', allowed).tabs.find(x => x.id === 'uebersicht').view, 'prot');
  assert.equal(N.navTabs('AL', allowed).tabs.find(x => x.id === 'protokoll').mode, 'protokoll');
});

test('every tab has a label and an icon', () => {
  for (const r of ['MA', 'AL', 'PL', 'Admin', 'Buchhaltung', 'Gast']) {
    const n = N.navTabs(r, allowed, true);
    for (const t of n.tabs.concat(n.more)) { assert.ok(t.label, r + ' ' + t.id); assert.ok(t.icon, r + ' ' + t.id); }
  }
});

test('active tab, also after a restore', () => {
  const pl = N.navTabs('PL', allowed); const all = pl.tabs.concat(pl.more);
  assert.equal(N.navActiveTab(all, null, 'prot'), 'heute');
  assert.equal(N.navActiveTab(all, 'dashboard', 'work'), 'personal');
  assert.equal(N.navActiveTab(all, 'dashboard', 'prot'), 'protokolle');
  assert.equal(N.navActiveTab(all, 'produkte', 'prot'), 'produkte');
  assert.equal(N.navActiveTab(all, 'wochenplan', 'prot'), 'plan');
  const g = N.navTabs('Gast', allowed);
  assert.equal(N.navActiveTab(g.tabs, null, 'prot'), null); // Gast has no Heute
});

test('own tab choice (pinned)', () => {
  const n = N.navTabs('MA', allowed, false, ['heute', 'ordner', 'zettel']);
  assert.deepEqual(n.tabs.map(t => t.id), ['heute', 'ordner', 'zettel', 'mehr']);
  assert.deepEqual(n.more.map(t => t.id), ['plan', 'produkte', 'plaene', 'optionen', 'problem']);
  // not allowed / unknown / duplicate / action ids are dropped; max 5
  const m = N.navTabs('MA', allowed, false, ['admin', 'personal', 'nope', 'optionen', 'plan', 'plan']);
  assert.deepEqual(m.tabs.map(t => t.id), ['plan', 'mehr']);
  const big = N.navTabs('Admin', allowed, false, ['admin', 'zettel', 'produkte', 'ordner', 'heute', 'plan']);
  assert.equal(big.tabs.length, N.NAV_MAX_TABS + 1);
  // nothing valid left → role default
  assert.deepEqual(N.navTabs('MA', allowed, false, ['admin']).tabs.map(t => t.id), ids('MA'));
  assert.deepEqual(N.navTabs('MA', allowed, false, []).tabs.map(t => t.id), ids('MA'));
  // Gast ignores pins
  assert.deepEqual(N.navTabs('Gast', allowed, false, ['produkte']).tabs.map(t => t.id), ['produkte', 'ordner', 'plaene']);
});

test('navTogglePin', () => {
  assert.deepEqual(N.navTogglePin(['heute', 'plan', 'mehr'], 'ordner'), ['heute', 'plan', 'ordner']);
  assert.deepEqual(N.navTogglePin(['heute', 'plan', 'mehr'], 'plan'), ['heute']);
  assert.equal(N.navTogglePin(['heute', 'mehr'], 'heute'), null); // keep at least one
  assert.equal(N.navTogglePin(['a', 'b', 'c', 'd', 'e', 'mehr'], 'f'), null); // full
});

test('Pläne entry opens the Ordner page in the plans view', () => {
  const t = N.navTabs('MA', allowed).more.find(x => x.id === 'plaene');
  assert.equal(t.mode, 'ordner'); assert.equal(t.view, 'plaene');
  const items = N.navTabs('MA', allowed).tabs.concat(N.navTabs('MA', allowed).more);
  assert.equal(N.navActiveTab(items, 'ordner', 'plaene'), 'plaene');
  assert.equal(N.navActiveTab(items, 'ordner', 'ordner'), 'ordner');
});
