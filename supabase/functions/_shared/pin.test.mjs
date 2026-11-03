// Run: node --test supabase/functions/_shared/pin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidPin, mayResetPin, mayResetAny, lockoutRemainingMin, pinEmail, pinPassword, isUuid } from './pin.mjs';

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
