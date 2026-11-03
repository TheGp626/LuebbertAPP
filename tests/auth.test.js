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

test('authPinMode: Gast none, no PIN set, else enter', () => {
  const m = load('authPinMode');
  assert.equal(m({ role: 'Gast', has_pin: false }), 'none');
  assert.equal(m({ role: 'Gast', has_pin: true }), 'none');
  assert.equal(m({ role: 'MA', has_pin: false }), 'set');
  assert.equal(m({ role: 'Admin', has_pin: true }), 'enter');
});
test('pinFormError: format and repeat', () => {
  const f = load('pinFormError');
  assert.equal(f('enter', '1234', ''), '');
  assert.equal(f('enter', '123', ''), 'Bitte eine 4-stellige PIN eingeben.');
  assert.equal(f('set', '1234', '1235'), 'Die PINs stimmen nicht überein.');
  assert.equal(f('set', '1234', '1234'), '');
  assert.equal(f('none', '', ''), '');
});
test('loginOutcome: server answers become the spec texts', () => {
  const o = load('loginOutcome');
  assert.deepEqual(o({ data: { session: { access_token: 'a', refresh_token: 'r' } }, error: null }), { session: { access_token: 'a', refresh_token: 'r' } });
  assert.equal(o({ data: { error: 'wrong_pin', remaining: 3 }, error: null }).message, 'Falsche PIN. Noch 3 Versuche.');
  assert.equal(o({ data: { error: 'wrong_pin', remaining: 1 }, error: null }).message, 'Falsche PIN. Noch 1 Versuch.');
  for (const c of ['pin_not_set', 'pin_already_set']) assert.deepEqual(o({ data: { error: c }, error: null }), { message: 'Bitte noch einmal versuchen – die Anzeige wurde aktualisiert.', refresh: true });
  assert.equal(o({ data: { error: 'locked', minutes: 12 }, error: null }).message, 'Zu viele Fehlversuche – in 12 Min. erneut versuchen oder AL/PL um Zurücksetzen bitten.');
  assert.equal(o({ data: null, error: new Error('Failed to fetch') }).message, 'PIN konnte nicht geprüft werden (keine Verbindung). Bitte später erneut versuchen.');
  assert.equal(o({ data: { error: 'not_found' }, error: null }).message, 'Benutzer nicht gefunden oder deaktiviert.');
  assert.equal(o({ data: { error: 'server_error' }, error: null }).message, 'PIN konnte nicht geprüft werden (keine Verbindung). Bitte später erneut versuchen.');
  assert.equal(o({ data: { error: 'invalid_pin' }, error: null }).message, 'Bitte eine 4-stellige PIN eingeben.');
});
test('authStartState: restore only with a session younger than 30 days', () => {
  const s = new Function('var PIN_SESSION_MS = 2592000000;' + grab('authStartState') + '; return authStartState;')();
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(s(null, now - 1000, now), 'login');
  assert.equal(s({ user: { id: 'x' } }, now - 29 * 864e5, now), 'restore');
  assert.equal(s({ user: { id: 'x' } }, now - 30 * 864e5, now), 'login');
  assert.equal(s({ user: { id: 'x' } }, 0, now), 'login');
});
test('authStartState: refresh/network error keeps a recent login, clean null session or old login does not', () => {
  const s = new Function('var PIN_SESSION_MS = 2592000000;' + grab('authStartState') + '; return authStartState;')();
  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(s(null, now - 864e5, now, new Error('Failed to fetch')), 'restore');
  assert.equal(s(null, now - 864e5, now, null), 'login');
  assert.equal(s(null, now - 31 * 864e5, now, new Error('x')), 'login');
  assert.equal(s({ user: { id: 'x' } }, now - 31 * 864e5, now, null), 'login');
});

test('authSessionChanged: re-login only when the fresh user differs from the cached one', () => {
  const changed = load('authSessionChanged');
  const u = { id: 'a', full_name: 'Anna', role: 'MA', default_dept: 'Lager', hourly_rate_conni: 15, hourly_rate_internal: 14 };
  assert.equal(changed(u, Object.assign({}, u)), false);
  assert.equal(changed(u, Object.assign({}, u, { role: 'AL' })), true);
  assert.equal(changed(u, Object.assign({}, u, { full_name: 'Anna B' })), true);
  assert.equal(changed(u, Object.assign({}, u, { hourly_rate_internal: 16 })), true);
  assert.equal(changed(u, null), true, 'deactivated or removed → log out');
  assert.equal(changed(null, u), true, 'nothing shown yet → log in');
  assert.equal(changed(null, null), true, 'no session → show the login');
});

test('initAuth restores the login from the cached profile before waiting for the network', () => {
  const body = grab('initAuth');
  const early = body.indexOf('handleSession(shown)'), fetch = body.indexOf('await fetchOwnProfile');
  assert.ok(early !== -1 && fetch !== -1 && early < fetch);
  assert.ok(early < body.indexOf('auth.getSession()'), 'cached profile shown before getSession');
  assert.ok(body.indexOf('authStartState(') !== -1 && body.indexOf('signOutLocal()') !== -1);
});

test('sessionUserChanged: the Stundenzettel editor is reset when another user (or nobody) takes over', () => {
  const changed = load('sessionUserChanged');
  assert.equal(changed(undefined, 'a'), true);  // first login after start
  assert.equal(changed('a', 'a'), false);       // same user again (cached list, then fresh list)
  assert.equal(changed('a', 'b'), true);        // shared device: B after A
  assert.equal(changed('a', null), true);       // logout
  assert.equal(changed(null, null), false);
});

test('mayResetPinClient matches the server matrix', async () => {
  const client = load('mayResetPinClient');
  const { mayResetPin } = await import('../supabase/functions/_shared/pin.mjs');
  const roles = ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung', 'Gast'];
  for (const c of roles) for (const t of roles) assert.equal(client(c, t), mayResetPin(c, t), c + '→' + t);
});

test('resetTargets: AL sees only MA, never Gast or self', () => {
  const r = new Function(grab('mayResetPinClient') + grab('resetTargets') + '; return resetTargets;')();
  const users = [{ id: '1', role: 'MA' }, { id: '2', role: 'Gast' }, { id: '3', role: 'AL' }, { id: '4', role: 'Admin' }];
  assert.deepEqual(r('AL', '3', users).map(u => u.id), ['1']);
  assert.deepEqual(r('Admin', '4', users).map(u => u.id), ['1', '3']);
});
