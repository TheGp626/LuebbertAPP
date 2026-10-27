// Run from the repo root: node --test tests/settings.test.js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
const S = require('../js/settings.js');

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); S.appSettingsFromCache(); });

test('validateSettings: first invalid key or null', () => {
  assert.equal(S.validateSettings({ billing_cutoff: 0 }), 'billing_cutoff');
  assert.equal(S.validateSettings({ billing_cutoff: 32 }), 'billing_cutoff');
  assert.equal(S.validateSettings({ evening_push_hour: 23 }), 'evening_push_hour');
  assert.equal(S.validateSettings({ evening_push_hour: 14 }), 'evening_push_hour');
  assert.equal(S.validateSettings({ evening_push_hour: 18.5 }), 'evening_push_hour');
  assert.equal(S.validateSettings({ foo: true }), 'foo');
  assert.equal(S.validateSettings({ mail_test_mode: 'yes' }), 'mail_test_mode');
  assert.equal(S.validateSettings({ billing_cutoff: 31, evening_push_hour: 15, mail_test_mode: false }), null);
});

test('defaults when nothing is cached', () => {
  assert.equal(S.appSetting('billing_cutoff'), 20);
  assert.equal(S.appSetting('mail_test_mode'), true);
  assert.equal(S.appSetting('plan_reminders_enabled'), false);
});

test('offline: cached values are used, missing keys keep their default', () => {
  store.luebbert_app_settings = JSON.stringify({ billing_cutoff: 25 });
  S.appSettingsFromCache();
  assert.equal(S.appSetting('billing_cutoff'), 25);
  assert.equal(S.appSetting('reminders_enabled'), true);
});

test('broken cache or wrong types fall back to defaults', () => {
  store.luebbert_app_settings = '{not json';
  S.appSettingsFromCache();
  assert.equal(S.appSetting('billing_cutoff'), 20);
  store.luebbert_app_settings = JSON.stringify({ billing_cutoff: 'x', evening_push_enabled: 1 });
  S.appSettingsFromCache();
  assert.equal(S.appSetting('billing_cutoff'), 20);
  assert.equal(S.appSetting('evening_push_enabled'), false);
});

test('the old per-device cut-off no longer counts', () => {
  store.stundenzettel_cutoff = '5';
  S.appSettingsFromCache();
  assert.equal(S.appSetting('billing_cutoff'), 20);
});

test('changedSettings: only keys that differ from what the form was rendered with', () => {
  const rendered = { reminders_enabled: true, mail_test_mode: false, billing_cutoff: 20 };
  assert.deepEqual(S.changedSettings(rendered, { reminders_enabled: true, mail_test_mode: false, billing_cutoff: 21 }), { billing_cutoff: 21 });
  assert.deepEqual(S.changedSettings(rendered, { reminders_enabled: true, mail_test_mode: false, billing_cutoff: 20 }), {});
});
