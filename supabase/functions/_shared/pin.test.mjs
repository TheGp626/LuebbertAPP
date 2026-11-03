// Run: node --test supabase/functions/_shared/pin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPin, mayResetPin, mayResetAny, lockoutRemainingMin, pinEmail, pinPassword, isUuid, isWrongCredentials, firstPinNeedsAdminPin } from './pin.mjs';

test('isValidPin: exactly 4 digits', () => {
  for (const ok of ['0000', '1234', '9999']) assert.equal(isValidPin(ok), true);
  for (const bad of ['123', '12345', '12a4', ' 1234', '', null, 1234, undefined]) assert.equal(isValidPin(bad), false);
});
test('mayResetPin: role matrix, never upwards, never Gast', () => {
  const roles = ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung', 'Gast'];
  const allowed = { Admin: ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung'], PL: ['AL', 'MA'], AL: ['MA'], MA: [], Buchhaltung: [], Gast: [] };
  for (const c of roles) for (const t of roles) assert.equal(mayResetPin(c, t), allowed[c].includes(t), c + '→' + t);
});
test('lockoutRemainingMin: rounds up, 0 when expired or none', () => {
  const now = new Date('2026-11-04T08:03:30Z');
  assert.equal(lockoutRemainingMin({ locked_until: '2026-11-04T08:15:00.000Z' }, now), 12);
  assert.equal(lockoutRemainingMin({ locked_until: '2026-11-04T08:00:00.000Z' }, now), 0);
  assert.equal(lockoutRemainingMin({ locked_until: null }, now), 0);
  assert.equal(lockoutRemainingMin(null, now), 0);
});
test('pinEmail / pinPassword / isUuid', () => {
  assert.equal(pinEmail('2b1c'), '2b1c@nutzer.luebbert.invalid');
  assert.equal(pinPassword('0420'), 'lbt-pin:0420');
  assert.equal(isUuid('4e71084c-4942-4565-ade5-974a0c3480f4'), true);
  assert.equal(isUuid('x'), false);
  assert.equal(isUuid(null), false);
});

test('mayResetAny: only Admin, PL, AL', () => {
  const want = { Admin: true, PL: true, AL: true, MA: false, Buchhaltung: false, Gast: false };
  for (const [r, v] of Object.entries(want)) assert.equal(mayResetAny(r), v, r);
});
test('mayResetPin/mayResetAny: prototype keys are no roles', () => {
  for (const r of ['constructor', '__proto__', 'toString']) {
    assert.equal(mayResetPin(r, 'MA'), false);
    assert.equal(mayResetAny(r), false);
  }
});

test('isWrongCredentials: only status 400', () => {
  assert.equal(isWrongCredentials({ status: 400, code: 'invalid_credentials' }), true);
  for (const e of [null, undefined, { status: 429 }, { status: 500 }, { status: 0 }, new Error('fetch failed')]) assert.equal(isWrongCredentials(e), false);
});

test('firstPinNeedsAdminPin: leader roles only', () => {
  for (const r of ['Admin', 'PL', 'AL', 'Buchhaltung']) assert.equal(firstPinNeedsAdminPin(r), true, r);
  for (const r of ['MA', 'Gast', '', undefined, 'constructor']) assert.equal(firstPinNeedsAdminPin(r), false, String(r));
});
