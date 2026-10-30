// Run: node --test supabase/functions/_shared/settings-defaults.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_DEFAULTS, withDefaults } from './settings-defaults.mjs';

test('defaults match the spec', () => {
  assert.deepEqual(SETTINGS_DEFAULTS, {
    reminders_enabled: true, plan_reminders_enabled: false, evening_push_enabled: false, evening_push_hour: 18,
    plan_change_push_enabled: true, folder_push_enabled: true, folder_autodelete_enabled: true, protocol_mail_enabled: true, mail_test_mode: true, billing_cutoff: 20,
  });
});

test('no rows (read failed) → defaults', () => {
  assert.deepEqual(withDefaults(null), SETTINGS_DEFAULTS);
});

test('stored values win, missing keys keep their default', () => {
  const s = withDefaults([{ key: 'mail_test_mode', value: false }]);
  assert.equal(s.mail_test_mode, false);
  assert.equal(s.billing_cutoff, 20);
});

test('unknown keys are dropped', () => {
  assert.equal('foo' in withDefaults([{ key: 'foo', value: 1 }]), false);
});

test('a value of the wrong type falls back to the default', () => {
  assert.equal(withDefaults([{ key: 'evening_push_hour', value: 'x' }]).evening_push_hour, 18);
  assert.equal(withDefaults([{ key: 'reminders_enabled', value: 1 }]).reminders_enabled, true);
});

test('a failed read is flagged (not enumerable, so the settings object itself is unchanged)', () => {
  assert.equal(withDefaults(null)._read_failed, true);
  assert.equal(withDefaults([])._read_failed, false);
  assert.equal(Object.keys(withDefaults(null)).includes('_read_failed'), false);
});
