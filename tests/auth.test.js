// Run from the repo root: node --test tests/auth.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const src = require('fs').readFileSync(require('path').join(__dirname, '../js/auth.js'), 'utf8');
const grab = name => { const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\r?\\n}\\r?\\n')); if (!m) throw new Error(name + ' missing'); return m[0]; };
const load = name => new Function("var GAST_MODULES = ['produkte', 'ordner'];" + grab(name) + '; return ' + name + ';')();

test('moduleAllowedForRole: same guards as selectMode', () => {
  const ok = load('moduleAllowedForRole');
  assert.equal(ok('dashboard', 'MA'), false);
  assert.equal(ok('dashboard', 'PL'), true);
  assert.equal(ok('dashboard', 'Buchhaltung'), true);
  assert.equal(ok('protokoll', 'MA'), false);
  assert.equal(ok('protokoll', 'AL'), true);
  assert.equal(ok('stunden', 'MA'), true);
  assert.equal(ok('wochenplan', 'MA'), true);
  assert.equal(ok('stunden', 'Gast'), false);
  assert.equal(ok('ordner', 'Gast'), true);
  assert.equal(ok('produkte', 'Gast'), true);
});

test('parseCachedUsers: offline user list from localStorage, junk → []', () => {
  const parse = load('parseCachedUsers');
  assert.deepEqual(parse(null), []);
  assert.deepEqual(parse('{not json'), []);
  assert.deepEqual(parse('{"id":"x"}'), []);
  assert.deepEqual(parse('[{"id":"a","full_name":"A","role":"MA"},null,{"full_name":"no id"}]'), [{ id: 'a', full_name: 'A', role: 'MA' }]);
});

test('pinCheckOutcome: only a definite "false" from the server is a failed attempt', () => {
  const outcome = load('pinCheckOutcome');
  assert.equal(outcome(true, null), 'ok');
  assert.equal(outcome(false, null), 'wrong');
  assert.equal(outcome(null, null), 'wrong');
  assert.equal(outcome(null, { message: 'TypeError: Failed to fetch' }), 'error');
  assert.equal(outcome(true, { message: 'x' }), 'error');
});
