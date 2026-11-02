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
  assert.equal(S.appSetting('folder_push_enabled'), true);
  assert.equal(S.appSetting('folder_autodelete_enabled'), true);
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

test('changedSettings: vehicle_rates compared by value, not by object identity', () => {
  const r = () => ({ vehicle_rates: { PKW: { wk: 20, sa: 20, so: 20 } } });
  assert.deepEqual(S.changedSettings(r(), r()), {});
  const f = r(); f.vehicle_rates.PKW.so = 25;
  assert.deepEqual(S.changedSettings(r(), f), f);
});

test('readVehicleRates / validVehicleRates: blank rows skipped, duplicates and bad amounts rejected', () => {
  const row = (name, wk, sa, so) => ({ name, wk, sa, so });
  assert.deepEqual(S.readVehicleRates([row(' Leih LKW ', '120', '130', '140.5'), row('', '', '', '')]),
    { 'Leih LKW': { wk: 120, sa: 130, so: 140.5 } });
  assert.equal(S.readVehicleRates([row('PKW', '1', '1', '1'), row('PKW', '2', '2', '2')]), null);
  assert.equal(S.validateSettings({ vehicle_rates: S.readVehicleRates([row('PKW', '', '1', '1')]) }), 'vehicle_rates');
  assert.equal(S.validateSettings({ vehicle_rates: S.readVehicleRates([row('PKW', '-1', '1', '1')]) }), 'vehicle_rates');
  assert.equal(S.validateSettings({ vehicle_rates: {} }), 'vehicle_rates');
  assert.equal(S.validateSettings({ vehicle_rates: null }), 'vehicle_rates');
  assert.equal(S.validateSettings({ vehicle_rates: { PKW: { wk: 20, sa: 20, so: 20 } } }), null);
});

test('a broken vehicle_rates value from the server keeps the default rates', () => {
  store.luebbert_app_settings = JSON.stringify({ vehicle_rates: { PKW: { wk: 'x' } } });
  S.appSettingsFromCache();
  assert.deepEqual(S.appSetting('vehicle_rates'), S.APP_SETTINGS_DEFAULTS.vehicle_rates);
});

test('testPushMessage: device count, no device, failure', () => {
  assert.equal(S.testPushMessage({ status: 'sent', devices: 1 }), 'Test-Push an 1 Gerät gesendet.');
  assert.equal(S.testPushMessage({ status: 'sent', devices: 3, failed: 1 }), 'Test-Push an 3 Geräte gesendet.');
  assert.match(S.testPushMessage({ status: 'no_device', devices: 0 }), /Kein Gerät/);
  assert.match(S.testPushMessage({ status: 'failed', devices: 0 }), /fehlgeschlagen/);
  assert.match(S.testPushMessage(null), /fehlgeschlagen/);
});

test('saveSettingsTab: a network exception from the rpc shows an error instead of throwing', async () => {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const err = { textContent: '' }, btn = { disabled: false, textContent: '' };
  const sandbox = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    localStorage: global.localStorage,
    document: { getElementById: id => id === 'set-error' ? err : id === 'set-save-btn' ? btn : id === 'set-evening_push_hour' ? { value: '18' } : id === 'set-billing_cutoff' ? { value: '21' } : { checked: false },
      querySelectorAll: () => [{ querySelector: sel => ({ value: /name/.test(sel) ? 'PKW' : '20' }) }] },
    showToast() {},
    supabaseClient: { rpc: () => Promise.reject(new TypeError('Failed to fetch')) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/settings.js'), 'utf8'), sandbox, { filename: 'settings.js' });
  vm.runInContext("_settingsPin = 'x'; _settingsRendered = _readSettingsForm(); _settingsRendered.billing_cutoff = 20;", sandbox);
  await vm.runInContext('saveSettingsTab()', sandbox);
  assert.match(err.textContent, /fehlgeschlagen/);
  assert.equal(btn.disabled, false);
});
