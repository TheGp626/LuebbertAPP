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
  assert.equal(H.firstName('Piotr Sienkowski'), 'Piotr');
  assert.equal(H.firstName('  Erika  '), 'Erika');
  assert.equal(H.firstName(''), '');
  assert.equal(H.firstName(undefined), '');
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

test('homeIsToday: today, and last night\'s shift that is still running', () => {
  assert.equal(H.homeIsToday('2026-11-11', '2026-11-11'), true);
  assert.equal(H.homeIsToday('2026-11-10', '2026-11-11'), true);
  assert.equal(H.homeIsToday('2026-11-12', '2026-11-11'), false);
  assert.equal(H.homeIsToday('2026-10-31', '2026-11-01'), true);
});

test('homeAddress / homeMapsUrl: room, street and town from the location lines', () => {
  const s = { venue: 'Estrel', location: 'Saal Europa\nSonnenallee 225\n12057 Berlin' };
  assert.equal(H.homeAddress(s), 'Saal Europa, Sonnenallee 225');
  assert.equal(H.homeMapsUrl(s), 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Estrel, Sonnenallee 225, 12057 Berlin'));
  assert.equal(H.homeMapsUrl({ venue: 'Tempodrom', location: 'Arena' }), 'https://www.google.com/maps/search/?api=1&query=Tempodrom');
  assert.equal(H.homeMapsUrl({ venue: '', location: '' }), null);
  assert.equal(H.homeAddress({ venue: 'X', location: null }), '');
});
