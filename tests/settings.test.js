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
  assert.equal(S.validateSettings({ inactive_months: 0 }), 'inactive_months');
  assert.equal(S.validateSettings({ inactive_months: 2.5 }), 'inactive_months');
  assert.equal(S.validateSettings({ income_limit_minijob: -1 }), 'income_limit_minijob');
  assert.equal(S.validateSettings({ income_limit_midijob: NaN }), 'income_limit_midijob');
  assert.equal(S.validateSettings({ income_limit_minijob: 603, income_limit_midijob: 2000, inactive_months: 3 }), null);
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
  // night rate: optional, blank = day rate, otherwise 0–100000
  assert.deepEqual(S.readVehicleRates([{ name: 'Solo', wk: '70', sa: '70', so: '70', na: '95' }, { name: 'PKW', wk: '20', sa: '20', so: '20', na: '' }]),
    { Solo: { wk: 70, sa: 70, so: 70, na: 95 }, PKW: { wk: 20, sa: 20, so: 20 } });
  assert.equal(S.validateSettings({ vehicle_rates: { Solo: { wk: 70, sa: 70, so: 70, na: 95 } } }), null);
  assert.equal(S.validateSettings({ vehicle_rates: { Solo: { wk: 70, sa: 70, so: 70, na: -1 } } }), 'vehicle_rates');
  assert.equal(S.validateSettings({ vehicle_rates: { Solo: { wk: 70, sa: 70, so: 70, xx: 1 } } }), 'vehicle_rates');
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
      querySelectorAll: sel => /set-personnel|set-dep|set-agency/.test(sel) ? [] : [{ querySelector: sel => ({ value: /name/.test(sel) ? 'PKW' : '20' }) }] },
    showToast() {},
    supabaseClient: { rpc: () => Promise.reject(new TypeError('Failed to fetch')) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/settings.js'), 'utf8'), sandbox, { filename: 'settings.js' });
  vm.runInContext("_settingsPin = 'x'; _settingsRendered = _readSettingsForm(); _settingsRendered.billing_cutoff = 20;", sandbox);
  await vm.runInContext('saveSettingsTab()', sandbox);
  assert.match(err.textContent, /fehlgeschlagen/);
  assert.equal(btn.disabled, false);
});

function saveSandbox(rpc, promptAnswer) {
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const err = { textContent: '' }, btn = { disabled: false, textContent: '' }, calls = [], toasts = [];
  let prompts = 0;
  const sandbox = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    localStorage: global.localStorage,
    document: { getElementById: id => id === 'set-error' ? err : id === 'set-save-btn' ? btn : id === 'set-evening_push_hour' ? { value: '18' } : id === 'set-billing_cutoff' ? { value: '21' } : { checked: false },
      querySelectorAll: sel => /set-personnel|set-dep|set-agency/.test(sel) ? [] : [{ querySelector: sel => ({ value: /name/.test(sel) ? 'PKW' : '20' }) }] },
    showToast: m => toasts.push(m),
    prompt: () => { prompts++; return promptAnswer; },
    currentUser: { id: 'me' },
    supabaseClient: { rpc: (name, args) => { calls.push([name, args]); return Promise.resolve(rpc(name, args)); } },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/settings.js'), 'utf8'), sandbox, { filename: 'settings.js' });
  vm.runInContext('_settingsRendered = _readSettingsForm(); _settingsRendered.billing_cutoff = 20; renderSettingsTab = async function() {};', sandbox);
  return { run: () => vm.runInContext('saveSettingsTab()', sandbox), err, calls, toasts, prompts: () => prompts };
}

test('saveSettingsTab: an Admin saves with save_app_settings, no password prompt', async () => {
  const t = saveSandbox(() => ({ data: {}, error: null }));
  await t.run();
  assert.equal(t.prompts(), 0);
  assert.deepEqual(t.calls.map(c => c[0]), ['save_app_settings']);
  assert.deepEqual(JSON.parse(JSON.stringify(t.calls[0][1])), { changes: { billing_cutoff: 21 } });
  assert.deepEqual(t.toasts, ['Gespeichert']);
});

test('saveSettingsTab: database without the new function → old RPC with the password (asked once)', async () => {
  const t = saveSandbox(name => name === 'save_app_settings'
    ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.save_app_settings(changes)' } }
    : { data: {}, error: null }, 'geheim');
  await t.run();
  assert.equal(t.prompts(), 1);
  assert.deepEqual(t.calls.map(c => c[0]), ['save_app_settings', 'set_app_settings']);
  assert.equal(t.calls[1][1].input_pin, 'geheim');
});

test('saveSettingsTab: forbidden (not Admin) gets a clear message, no prompt', async () => {
  const t = saveSandbox(() => ({ data: null, error: { code: 'P0001', message: 'forbidden' } }));
  await t.run();
  assert.equal(t.prompts(), 0);
  assert.match(t.err.textContent, /Nur Admins/);
});

test('settingsRpcMissing: only the "function not found" answers', () => {
  assert.equal(S.settingsRpcMissing({ code: 'PGRST202', message: 'x' }), true);
  assert.equal(S.settingsRpcMissing({ code: '42883', message: 'function public.save_app_settings(jsonb) does not exist' }), true);
  assert.equal(S.settingsRpcMissing({ code: 'P0001', message: 'forbidden' }), false);
  assert.equal(S.settingsRpcMissing({ code: 'P0001', message: 'invalid_setting: billing_cutoff' }), false);
});

test('validPersonnelRates: exactly the 4 types × MA/AL/Fahrer, numbers 0–1000; validateSettings uses it', () => {
  const ok = { Minijob: { MA: 21.5, AL: 25, Fahrer: 30 }, Midijob: { MA: 21.5, AL: 25, Fahrer: 30 },
    Rechnung: { MA: 30, AL: 35, Fahrer: 40 }, Fest: { MA: 0, AL: 0, Fahrer: 0 } };
  assert.equal(S.validPersonnelRates(ok), true);
  const { Fest, ...missing } = ok;
  assert.equal(S.validPersonnelRates(missing), false);
  assert.equal(S.validPersonnelRates({ ...ok, Fest: { MA: -1, AL: 0, Fahrer: 0 } }), false);
  assert.equal(S.validPersonnelRates({ ...ok, Fest: { MA: '0', AL: 0, Fahrer: 0 } }), false);
  assert.equal(S.validPersonnelRates({ ...ok, Fest: { MA: 0, AL: 0 } }), false);
  assert.equal(S.validateSettings({ personnel_rates: { ...ok, Fest: { MA: 2000, AL: 0, Fahrer: 0 } } }), 'personnel_rates');
  assert.equal(S.validateSettings({ personnel_rates: ok }), null);
});

test('availability_for_all: default off, listed as a switch', () => {
  assert.equal(S.APP_SETTINGS_DEFAULTS.availability_for_all, false);
  assert.ok(S.SETTINGS_SWITCHES.some(g => g.items.some(i => i.key === 'availability_for_all')));
});

test('department mail settings: defaults, validation, merge keeps unknown areas out', () => {
  assert.equal(S.appSetting('department_mail_enabled'), true);
  assert.equal(S.appSetting('department_mail_test_mode'), true);
  assert.equal(S.appSetting('department_routes').mobiliar, 'lager');
  assert.equal(S.appSetting('department_routes').tischlerei, '');
  assert.equal(S.validateSettings({ department_routes: { tischlerei: 'lager', mobiliar: '' } }), null);
  assert.equal(S.validateSettings({ department_routes: { mobiliar: 'x@evil.test' } }), 'department_routes');
  assert.equal(S.validateSettings({ department_routes: { kueche: 'lager' } }), 'department_routes');
  assert.equal(S.validateSettings({ department_mail_enabled: 'ja' }), 'department_mail_enabled');
  store.luebbert_app_settings = JSON.stringify({ department_routes: { tischlerei: 'lager' } });
  S.appSettingsFromCache();
  assert.equal(S.appSetting('department_routes').tischlerei, 'lager');
  assert.equal(S.appSetting('department_routes').stoffe, 'stoffe');
  store.luebbert_app_settings = JSON.stringify({ department_routes: { stoffe: 'evil' } });
  S.appSettingsFromCache();
  assert.equal(S.appSetting('department_routes').stoffe, 'stoffe');
});

test('department addresses: editable, only @peterluebbert.de, bad cached values fall back', () => {
  assert.equal(S.appSetting('department_emails').lager, 'lager@peterluebbert.de');
  assert.equal(S.validateSettings({ department_emails: { logistik: 'd.test@peterluebbert.de', tischlerei: '' } }), null);
  assert.equal(S.validateSettings({ department_routes: { logistik: 'logistik', tischlerei: 'tischlerei' } }), null);
  assert.equal(S.validateSettings({ department_emails: { lager: 'x@evil.test' } }), 'department_emails');
  assert.equal(S.validateSettings({ department_emails: { lager: 'a@peterluebbert.de.evil.test' } }), 'department_emails');
  assert.equal(S.validateSettings({ department_emails: { kueche: 'k@peterluebbert.de' } }), 'department_emails');
  store.luebbert_app_settings = JSON.stringify({ department_emails: { logistik: 'd@peterluebbert.de' } });
  S.appSettingsFromCache();
  assert.equal(S.appSetting('department_emails').logistik, 'd@peterluebbert.de');
  assert.equal(S.appSetting('department_emails').stoffe, 'Stoffe@peterluebbert.de');
  store.luebbert_app_settings = JSON.stringify({ department_emails: { lager: 'x@evil.test' } });
  S.appSettingsFromCache();
  assert.equal(S.appSetting('department_emails').lager, 'lager@peterluebbert.de');
});

test('routesWithoutAddress: a route to a department with an empty address is named', () => {
  assert.deepEqual(S.routesWithoutAddress({ logistik: 'logistik', mobiliar: 'lager', tischlerei: '' }, { logistik: '', lager: 'lager@peterluebbert.de' }), ['Lager / Logistik']);
  assert.deepEqual(S.routesWithoutAddress({ logistik: 'lager' }, { lager: 'lager@peterluebbert.de' }), []);
  assert.deepEqual(S.routesWithoutAddress(undefined, {}), []);
});
