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
  const modes = r => H.homeTiles(r, allowed).map(t => t.mode);
  assert.deepEqual(modes('MA'), ['stunden', 'wochenplan', 'produkte', 'ordner']);
  assert.deepEqual(modes('Gast'), ['produkte', 'ordner']);
  assert.deepEqual(modes('AL'), ['stunden', 'protokoll', 'wochenplan', 'produkte', 'ordner', 'dashboard']);
  assert.deepEqual(modes('Admin'), modes('AL'));
  assert.deepEqual(modes('Buchhaltung'), modes('AL').filter(m => m !== 'protokoll' || allowed('protokoll', 'Buchhaltung')));
});

test('next-shift cache is per user and survives garbage', () => {
  const raw = H.nextShiftCacheValue('u1', { date: '2026-10-30' });
  assert.deepEqual(H.readNextShiftCache(raw, 'u1'), { date: '2026-10-30' });
  assert.equal(H.readNextShiftCache(raw, 'u2'), null);
  assert.equal(H.readNextShiftCache('kaputt{', 'u1'), null);
  assert.equal(H.readNextShiftCache(null, 'u1'), null);
  assert.equal(H.readNextShiftCache(H.nextShiftCacheValue('u1', null), 'u1'), null);
});
