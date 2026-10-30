// Run: node --test supabase/functions/_shared/recipient.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseRecipient } from './recipient.mjs';

const base = { mailEnabled: true, testMode: false, testRecipient: '', plEmail: 'pl@x.de', plId: 'p1' };

test('mails switched off → disabled', () => {
  assert.deepEqual(chooseRecipient({ ...base, mailEnabled: false }), { to: null, reason: 'disabled', test: false });
});

test('test mode with test address → test address, even without a PL', () => {
  assert.deepEqual(chooseRecipient({ ...base, testMode: true, testRecipient: 't@x.de', plId: null, plEmail: '' }),
    { to: 't@x.de', reason: null, test: true });
});

test('test mode without test address → held back, never the PL', () => {
  assert.deepEqual(chooseRecipient({ ...base, testMode: true, testRecipient: '' }), { to: null, reason: 'not_configured', test: true });
});

test('test mode off → the PL even if a test address is still set', () => {
  assert.deepEqual(chooseRecipient({ ...base, testRecipient: 't@x.de' }), { to: 'pl@x.de', reason: null, test: false });
});

test('no PL / PL without email', () => {
  assert.equal(chooseRecipient({ ...base, plId: null, plEmail: '' }).reason, 'no_pl');
  assert.equal(chooseRecipient({ ...base, plEmail: '  ' }).reason, 'no_email');
});

test('disabledReason: older app versions get a reason they already treat as done', async () => {
  const { disabledReason } = await import('./recipient.mjs');
  assert.equal(disabledReason(2), 'disabled');
  assert.equal(disabledReason(undefined), 'not_found');
  assert.equal(disabledReason(1), 'not_found');
});
