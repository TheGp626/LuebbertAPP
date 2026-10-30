// Run from the repo root: node --test tests/home.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const H = require('../js/home.js');

// The role rules live in auth.js (browser globals) → load them from the source
const auth = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
const gast = auth.match(/var GAST_MODULES = [^;]+;/)[0];
const fn = auth.match(/function moduleAllowedForRole\([\s\S]*?\r?\n}\r?\n/)[0];
const allowed = new Function(gast + '\n' + fn + '; return moduleAllowedForRole;')();

test('firstName', () => {
  assert.equal(H.firstName('Patryk Stanczyk'), 'Patryk');
  assert.equal(H.firstName('  Erika  '), 'Erika');
  assert.equal(H.firstName(''), '');
  assert.equal(H.firstName(undefined), '');
});

test('homeTiles follow the role rules of auth.js', () => {
  const labels = r => H.homeTiles(r, allowed).map(t => t.label);
  const office = ['Protokoll-Übersicht', 'Buchhaltung'];
  assert.deepEqual(labels('MA'), ['Stundenzettel', 'Wochenplan', 'Produktdatenbank', 'Projektordner']);
  assert.deepEqual(labels('Gast'), ['Produktdatenbank', 'Projektordner']);
  assert.deepEqual(labels('AL'), ['Stundenzettel', 'Protokoll schreiben', 'Wochenplan', 'Produktdatenbank', 'Projektordner'].concat(office));
  assert.deepEqual(labels('Admin'), labels('AL'));
  assert.deepEqual(labels('Buchhaltung'), labels('AL').filter(l => l !== 'Protokoll schreiben' || allowed('protokoll', 'Buchhaltung')));
});

test('homeTiles: the dashboard is split into two tiles with their own view and id', () => {
  const t = H.homeTiles('AL', allowed).filter(x => x.mode === 'dashboard');
  assert.deepEqual(t.map(x => x.view), ['prot', 'work']);
  assert.equal(new Set(H.homeTiles('AL', allowed).map(x => x.id || x.mode)).size, H.homeTiles('AL', allowed).length);
  assert.equal(H.homeTiles('MA', allowed).some(x => x.mode === 'dashboard'), false);
});

test('dashViewFromStored: a restored dashboard reopens its view; old/unknown values mean the protocols view', () => {
  assert.equal(H.dashViewFromStored('work'), 'work');
  assert.equal(H.dashViewFromStored('prot'), 'prot');
  assert.equal(H.dashViewFromStored(null), 'prot');
  assert.equal(H.dashViewFromStored('settings'), 'prot');
  assert.equal(H.dashViewFromStored('x'), 'prot');
});

test('next-shift cache is per user and survives garbage', () => {
  const raw = H.nextShiftCacheValue('u1', { date: '2026-10-30' });
  assert.deepEqual(H.readNextShiftCache(raw, 'u1'), { date: '2026-10-30' });
  assert.equal(H.readNextShiftCache(raw, 'u2'), null);
  assert.equal(H.readNextShiftCache('kaputt{', 'u1'), null);
  assert.equal(H.readNextShiftCache(null, 'u1'), null);
  assert.equal(H.readNextShiftCache(H.nextShiftCacheValue('u1', null), 'u1'), null);
});

test('homeNextAllowed: the "Nächster Einsatz" card only for roles that may open the Wochenplan', () => {
  assert.equal(H.homeNextAllowed('MA', allowed), true);
  assert.equal(H.homeNextAllowed('AL', allowed), true);
  assert.equal(H.homeNextAllowed('Gast', allowed), false);
});
