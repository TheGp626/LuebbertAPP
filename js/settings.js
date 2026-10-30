/**
 * Admin settings (table app_settings): switches for reminders, push, protocol mails and the billing cut-off.
 * Everyone reads them (cached for offline use); only the Admin tab in the Office Dashboard writes them,
 * through the RPC set_app_settings, which checks the admin password on the server.
 * Defaults mirror supabase/functions/_shared/settings-defaults.mjs.
 */

var APP_SETTINGS_DEFAULTS = {
  reminders_enabled: true,
  plan_reminders_enabled: false,
  evening_push_enabled: false,
  evening_push_hour: 18,
  plan_change_push_enabled: true,
  folder_push_enabled: true,
  folder_autodelete_enabled: true,
  protocol_mail_enabled: true,
  mail_test_mode: true,
  billing_cutoff: 20
};
var APP_SETTINGS_CACHE_KEY = 'luebbert_app_settings';
var _appSettings = Object.assign({}, APP_SETTINGS_DEFAULTS);
var _appSettingsMeta = null;   // { updated_at, updated_by } of the newest change
var _settingsPin = null;       // admin password, memory only, for this session
var _appSettingsFresh = false; // last load came from the server (not cache/defaults)
var _settingsRendered = null;  // values the settings form was rendered with

function _settingsMerge(obj) {
  var out = Object.assign({}, APP_SETTINGS_DEFAULTS);
  Object.keys(obj || {}).forEach(function(k) {
    if (k in APP_SETTINGS_DEFAULTS && typeof obj[k] === typeof APP_SETTINGS_DEFAULTS[k]) out[k] = obj[k];
  });
  return out;
}

function appSetting(key) {
  return key in _appSettings ? _appSettings[key] : APP_SETTINGS_DEFAULTS[key];
}

// Offline start / failed read: last known values, else defaults
function appSettingsFromCache() {
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(APP_SETTINGS_CACHE_KEY) || 'null'); } catch (e) { cached = null; }
  _appSettings = _settingsMerge(cached);
  return _appSettings;
}

// Only what the admin actually changed in the form, so stale or fallback values are never written back
function changedSettings(rendered, form) {
  var out = {};
  Object.keys(form).forEach(function(k) { if (form[k] !== rendered[k]) out[k] = form[k]; });
  return out;
}

// First invalid key (unknown key, wrong type or out of range) or null; mirrors the RPC's checks
function validateSettings(changes) {
  var keys = Object.keys(changes || {});
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i], v = changes[k];
    if (!(k in APP_SETTINGS_DEFAULTS)) return k;
    if (typeof v !== typeof APP_SETTINGS_DEFAULTS[k]) return k;
    if (k === 'evening_push_hour' && (v !== Math.floor(v) || v < 15 || v > 22)) return k;
    if (k === 'billing_cutoff' && (v !== Math.floor(v) || v < 1 || v > 31)) return k;
  }
  return null;
}

async function loadAppSettings() {
  appSettingsFromCache();
  if (typeof supabaseClient === 'undefined') return _appSettings;
  try {
    var { data, error } = await supabaseClient.from('app_settings').select('key, value, updated_at, updated_by');
    if (error) throw error;
    var obj = {};
    _appSettingsMeta = null;
    (data || []).forEach(function(r) {
      obj[r.key] = r.value;
      if (!_appSettingsMeta || r.updated_at > _appSettingsMeta.updated_at) _appSettingsMeta = { updated_at: r.updated_at, updated_by: r.updated_by };
    });
    _appSettings = _settingsMerge(obj);
    localStorage.setItem(APP_SETTINGS_CACHE_KEY, JSON.stringify(_appSettings));
    _appSettingsFresh = true;
  } catch (e) {
    _appSettingsFresh = false;
    console.warn('Einstellungen laden fehlgeschlagen, nutze gespeicherte Werte:', e);
  }
  if (typeof onAppSettingsLoaded === 'function') onAppSettingsLoaded();
  return _appSettings;
}

// ── ADMIN TAB (Office Dashboard → Einstellungen) ──

var SETTINGS_SWITCHES = [
  { group: 'Erinnerungen und Push', items: [
    { key: 'reminders_enabled', label: 'Protokoll-Erinnerungen', hint: 'Push an die AL an Tag 1–5, Mail an die PL ab Tag 6' },
    { key: 'plan_reminders_enabled', label: 'Wochenplan → Erinnerungen', hint: 'ALs aus dem hochgeladenen Wochenplan zählen als geplante Einsätze' },
    { key: 'evening_push_enabled', label: 'Abend-Push für ALs', hint: 'Am Vorabend: „Morgen 10:00 · Ort“', hour: true },
    { key: 'plan_change_push_enabled', label: 'Push bei Planänderungen', hint: 'Betroffene bekommen eine Nachricht, wenn ein neuer Plan-Stand hochgeladen wird' },
    { key: 'folder_push_enabled', label: 'Push an AL bei neuem Projektordner', hint: 'Jede AL eines Ordners wird einmal benachrichtigt, sobald sie dort eingeteilt ist' }
  ] },
  { group: 'Projektordner', items: [
    { key: 'folder_autodelete_enabled', label: 'Alte Projektordner automatisch löschen', hint: '7 Tage nach dem letzten Einsatz, samt Dateien' }
  ] },
  { group: 'Protokoll-Mails', items: [
    { key: 'protocol_mail_enabled', label: 'Mails an die PL', hint: 'Fertige und geänderte Protokolle gehen als PDF an die PL' },
    { key: 'mail_test_mode', label: 'Testmodus', hint: 'Alle Mails gehen an die Testadresse (Supabase-Secret TEST_RECIPIENT) statt an die PL' }
  ] }
];

function _settingsEsc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }

async function renderSettingsTab() {
  var box = document.getElementById('dash-view-settings');
  if (!box) return;
  box.innerHTML = '<div class="wp-empty">Lädt…</div>';
  await loadAppSettings();
  var html = SETTINGS_SWITCHES.map(function(g) {
    return '<div class="set-group"><div class="set-group-title">' + _settingsEsc(g.group) + '</div>' +
      g.items.map(function(it) {
        var hour = it.hour ? '<select id="set-evening_push_hour" class="meta-input set-hour" aria-label="Uhrzeit Abend-Push">' +
          [15, 16, 17, 18, 19, 20, 21, 22].map(function(h) { return '<option value="' + h + '"' + (appSetting('evening_push_hour') === h ? ' selected' : '') + '>' + h + ':00 Uhr</option>'; }).join('') +
          '</select>' : '';
        return '<label class="set-row"><span class="set-text"><b>' + _settingsEsc(it.label) + '</b><small>' + _settingsEsc(it.hint) + '</small></span>' + hour +
          '<input type="checkbox" class="set-switch" id="set-' + it.key + '"' + (appSetting(it.key) ? ' checked' : '') + '></label>';
      }).join('') + '</div>';
  }).join('');
  html += '<div class="set-group"><div class="set-group-title">Abrechnung</div>' +
    '<label class="set-row"><span class="set-text"><b>Abrechnungsstichtag</b><small>Tag im Monat, ab dem Stunden zum nächsten Abrechnungsmonat zählen (gilt auf allen Geräten)</small></span>' +
    '<input type="number" min="1" max="31" step="1" id="set-billing_cutoff" class="meta-input set-num" value="' + appSetting('billing_cutoff') + '"></label></div>';
  html += '<div class="set-group"><div class="set-group-title">Push testen</div>' +
    '<div class="set-row"><span class="set-text"><b>Test-Push an mich</b><small>Schickt eine Testnachricht an alle Geräte, auf denen du Benachrichtigungen erlaubt hast</small></span>' +
    '<button type="button" class="btn" id="set-testpush-btn" style="flex:none; width:auto; padding:8px 18px;" onclick="sendTestPush()">Senden</button></div></div>';
  var meta = '';
  if (_appSettingsMeta && _appSettingsMeta.updated_by) {
    var who = (typeof allUsers !== 'undefined' && allUsers.find(function(u) { return u.id === _appSettingsMeta.updated_by; })) || null;
    meta = 'Zuletzt geändert von ' + _settingsEsc(who ? who.full_name : 'Admin') + ' am ' + new Date(_appSettingsMeta.updated_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  // Without fresh values from the server, saving could write stale switches back → read-only until reload
  html += '<div id="set-error" class="set-error" role="alert">' +
      (_appSettingsFresh ? '' : 'Die Einstellungen konnten nicht vom Server geladen werden. Angezeigt werden die zuletzt bekannten Werte; Speichern ist erst nach erneutem Laden möglich.') + '</div>' +
    '<div class="set-actions">' + (_appSettingsFresh
      ? '<button type="button" class="btn primary" id="set-save-btn" onclick="saveSettingsTab()">Speichern</button>'
      : '<button type="button" class="btn" onclick="renderSettingsTab()">Erneut laden</button>') + '</div>' +
    (meta ? '<div class="set-meta">' + meta + '</div>' : '');
  box.innerHTML = html;
  _settingsRendered = _appSettingsFresh ? _readSettingsForm() : null;
}

function _readSettingsForm() {
  var changes = {};
  SETTINGS_SWITCHES.forEach(function(g) { g.items.forEach(function(it) { changes[it.key] = !!document.getElementById('set-' + it.key).checked; }); });
  changes.evening_push_hour = parseInt(document.getElementById('set-evening_push_hour').value, 10);
  var cut = document.getElementById('set-billing_cutoff').value;
  changes.billing_cutoff = cut === '' ? NaN : Number(cut);
  return changes;
}

var SETTINGS_LABELS = { evening_push_hour: 'Uhrzeit Abend-Push', billing_cutoff: 'Abrechnungsstichtag (1–31)' };

async function saveSettingsTab() {
  var err = document.getElementById('set-error'), btn = document.getElementById('set-save-btn');
  err.textContent = '';
  if (!_settingsRendered) return;
  var form = _readSettingsForm();
  var bad = validateSettings(form);
  if (bad) { err.textContent = 'Ungültiger Wert für ' + (SETTINGS_LABELS[bad] || bad) + '.'; return; }
  var changes = changedSettings(_settingsRendered, form);
  if (!Object.keys(changes).length) { showToast('Keine Änderungen'); return; }
  if (!_settingsPin) {
    var pin = prompt('Admin-Passwort zum Speichern der Einstellungen:');
    if (!pin) return;
    _settingsPin = pin;
  }
  btn.disabled = true; btn.textContent = 'Speichert…';
  try {
    var actor = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    var { error } = await supabaseClient.rpc('set_app_settings', { input_pin: _settingsPin, changes: changes, actor: actor });
    if (error) {
      var msg = String(error.message || '');
      if (/invalid_pin/.test(msg)) { _settingsPin = null; err.textContent = 'Passwort falsch.'; return; }
      var m = /invalid_setting: (\w+)/.exec(msg);
      err.textContent = m ? 'Ungültiger Wert für ' + (SETTINGS_LABELS[m[1]] || m[1]) + '.' : 'Speichern fehlgeschlagen. Prüf die Verbindung und versuch es erneut.';
      return;
    }
    showToast('Gespeichert');
    await renderSettingsTab();
  } finally {
    var b = document.getElementById('set-save-btn');
    if (b) { b.disabled = false; b.textContent = 'Speichern'; }
  }
}

// Answer of send-reminders {mode:'test'} → toast text
function testPushMessage(data) {
  if (!data) return 'Test-Push fehlgeschlagen.';
  if (data.status === 'sent') return 'Test-Push an ' + data.devices + (data.devices === 1 ? ' Gerät' : ' Geräte') + ' gesendet.';
  if (data.status === 'no_device') return 'Kein Gerät mit erlaubten Benachrichtigungen gefunden. Erlaube sie zuerst im Wochenplan („Bei Planänderungen benachrichtigen“).';
  return 'Test-Push fehlgeschlagen. Versuch es später erneut.';
}

async function sendTestPush() {
  var err = document.getElementById('set-error'), btn = document.getElementById('set-testpush-btn');
  var me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  if (!me || !btn) return;
  err.textContent = '';
  if (!_settingsPin) {
    var pin = prompt('Admin-Passwort für den Test-Push:');
    if (!pin) return;
    _settingsPin = pin;
  }
  btn.disabled = true; btn.textContent = 'Sendet…';
  try {
    var r = await supabaseClient.functions.invoke('send-reminders', { body: { mode: 'test', user_id: me, pin: _settingsPin } });
    if (r.error) {
      // non-2xx: the body holds the reason
      var body = null;
      try { body = r.error.context && await r.error.context.json(); } catch (e) { /* no JSON body */ }
      if (body && body.error === 'invalid_pin') { _settingsPin = null; err.textContent = 'Passwort falsch.'; return; }
      console.error('Test-Push:', r.error, body);
      err.textContent = testPushMessage(null);
      return;
    }
    showToast(testPushMessage(r.data));
  } finally {
    btn.disabled = false; btn.textContent = 'Senden';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APP_SETTINGS_DEFAULTS: APP_SETTINGS_DEFAULTS, appSetting: appSetting, appSettingsFromCache: appSettingsFromCache,
    validateSettings: validateSettings, changedSettings: changedSettings, testPushMessage: testPushMessage };
}
