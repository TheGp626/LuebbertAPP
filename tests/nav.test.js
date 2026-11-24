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

const ids = r => N.navTabs(r, allowed).tabs.map(t => t.id);
const sections = (r, tab) => (N.navTabs(r, allowed).tabs.find(t => t.id === tab) || {}).sections.map(s => s.id);

test('tabs by task: crew 4, office 5, Gast only Unterlagen, no Mehr', () => {
  assert.deepEqual(ids('MA'), ['heute', 'plan', 'unterlagen', 'ich']);
  assert.deepEqual(ids('AL'), ['heute', 'plan', 'unterlagen', 'ich']);
  assert.deepEqual(ids('PL'), ['heute', 'plan', 'unterlagen', 'buero', 'ich']);
  assert.deepEqual(ids('Admin'), ['heute', 'plan', 'unterlagen', 'buero', 'ich']);
  assert.deepEqual(ids('Buchhaltung'), ['heute', 'plan', 'unterlagen', 'buero', 'ich']);
  assert.deepEqual(ids('Gast'), ['unterlagen']);
  for (const r of ['MA', 'AL', 'PL', 'Admin', 'Buchhaltung', 'Gast']) assert.deepEqual(N.navTabs(r, allowed).more, [], r);
});

test('sections: Unterlagen for everyone, Admin only in the Admin Büro', () => {
  assert.deepEqual(sections('MA', 'unterlagen'), ['plaene', 'ordner', 'produkte']);
  assert.deepEqual(sections('Gast', 'unterlagen'), ['plaene', 'ordner', 'produkte']);
  assert.deepEqual(sections('Admin', 'buero'), ['protokolle', 'personal', 'admin']);
  assert.deepEqual(sections('PL', 'buero'), ['protokolle', 'personal']);
  assert.deepEqual(sections('Buchhaltung', 'buero'), ['protokolle', 'personal']);
});

test('active tab follows the module', () => {
  const t = N.navTabs('Admin', allowed).tabs, crew = N.navTabs('AL', allowed).tabs;
  assert.equal(N.navActiveTab(t, null), 'heute');
  assert.equal(N.navActiveTab(t, 'protokoll'), 'heute');   // the protocol is started from Heute
  assert.equal(N.navActiveTab(t, 'wochenplan'), 'plan');
  assert.equal(N.navActiveTab(t, 'ordner'), 'unterlagen');
  assert.equal(N.navActiveTab(t, 'produkte'), 'unterlagen');
  assert.equal(N.navActiveTab(t, 'dashboard'), 'buero');
  assert.equal(N.navActiveTab(t, 'admin'), 'buero');
  assert.equal(N.navActiveTab(t, 'stunden'), 'ich');
  assert.equal(N.navActiveTab(crew, 'dashboard'), 'ich'); // AL: "Meine Protokolle" from Ich
});

test('active section', () => {
  const s = N.navTabs('Admin', allowed).tabs.find(t => t.id === 'unterlagen').sections;
  assert.equal(N.navActiveSection(s, 'ordner', 'plaene'), 'plaene');
  assert.equal(N.navActiveSection(s, 'ordner', 'ordner'), 'ordner');
  assert.equal(N.navActiveSection(s, 'produkte', null), 'produkte');
  const b = N.navTabs('Admin', allowed).tabs.find(t => t.id === 'buero').sections;
  assert.equal(N.navActiveSection(b, 'dashboard', 'work'), 'personal');
  assert.equal(N.navActiveSection(b, 'admin', null), 'admin');
});

test('every tab has a label and an icon', () => {
  for (const r of ['MA', 'AL', 'PL', 'Admin', 'Buchhaltung', 'Gast'])
    for (const t of N.navTabs(r, allowed).tabs) { assert.ok(t.label, r + ' ' + t.id); assert.ok(t.icon, r + ' ' + t.id); }
});
