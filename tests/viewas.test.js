// Run from the repo root: node --test tests/viewas.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/viewas.js');

test('viewAsEffective: only an Admin can look as another role', () => {
  assert.equal(V.viewAsEffective('Admin', 'MA'), 'MA');
  assert.equal(V.viewAsEffective('Admin', 'Gast'), 'Gast');
  assert.equal(V.viewAsEffective('Admin', ''), 'Admin');
  assert.equal(V.viewAsEffective('Admin', 'Chef'), 'Admin'); // unknown value
  assert.equal(V.viewAsEffective('PL', 'Admin'), 'PL');      // a PL can never switch up
  assert.equal(V.viewAsEffective('MA', 'PL'), 'MA');
});
