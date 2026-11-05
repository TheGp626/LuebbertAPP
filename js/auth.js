let currentUser = null;
let userRole = 'MA'; // Default
let allUsers = [];

// ── SESSION & PIN LOGIN ──
const PIN_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, then the PIN is asked again
const LOGIN_TS_KEY = 'luebbert_login_ts';
const OWN_PROFILE_KEY = 'luebbert_own_profile';
const PIN_ERR_CONNECTION = 'PIN konnte nicht geprüft werden (keine Verbindung). Bitte später erneut versuchen.';

// Gast logs in by name only; everyone else has a PIN (set on first login)
function authPinMode(user) {
  if (user.role === 'Gast') return 'none';
  return user.has_pin ? 'enter' : 'set';
}

// Mirrors firstPinNeedsAdminPin in _shared/pin.mjs: a leader's first PIN needs the admin password once
function firstPinNeedsAdminPinClient(role) {
  return ['Admin', 'PL', 'AL', 'Buchhaltung'].indexOf(role) !== -1;
}

function pinFormError(mode, pin, repeat) {
  if (mode === 'none') return '';
  if (!/^\d{4}$/.test(pin || '')) return 'Bitte eine 4-stellige PIN eingeben.';
  if (mode === 'set' && pin !== repeat) return 'Die PINs stimmen nicht überein.';
  return '';
}

// Maps the pin-login answer to {session} or a UI {message}
function loginOutcome(res) {
  const d = res && res.data;
  if (d && d.session) return { session: d.session };
  if (d && d.error === 'wrong_pin') return { message: 'Falsche PIN. Noch ' + d.remaining + (d.remaining === 1 ? ' Versuch.' : ' Versuche.') };
  if (d && d.error === 'locked') return { message: 'Zu viele Fehlversuche – in ' + d.minutes + ' Min. erneut versuchen oder AL/PL um Zurücksetzen bitten.' };
  if (d && (d.error === 'pin_not_set' || d.error === 'pin_already_set')) return { message: 'Bitte noch einmal versuchen – die Anzeige wurde aktualisiert.', refresh: true };
  if (d && d.error === 'admin_pin_required') return { message: 'Bitte zusätzlich das Admin-Passwort eingeben (nur beim ersten Mal).' };
  if (d && d.error === 'admin_pin_wrong') return { message: 'Admin-Passwort falsch. Noch ' + d.remaining + (d.remaining === 1 ? ' Versuch.' : ' Versuche.') };
  if (d && d.error === 'not_found') return { message: 'Benutzer nicht gefunden oder deaktiviert.' };
  if (d && (d.error === 'invalid_pin' || d.error === 'pin_required')) return { message: 'Bitte eine 4-stellige PIN eingeben.' };
  return { message: 'PIN konnte nicht geprüft werden (keine Verbindung). Bitte später erneut versuchen.' }; // network error, server_error, invalid_input, unknown
}

// UI filter only (mirrors _shared/pin.mjs); the server decides
function mayResetPinClient(callerRole, targetRole) {
  const matrix = { Admin: ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung'], PL: ['AL', 'MA'], AL: ['MA'] };
  return Object.prototype.hasOwnProperty.call(matrix, callerRole) && matrix[callerRole].includes(targetRole);
}

function resetTargets(callerRole, callerId, users) {
  return (users || []).filter(u => u.id !== callerId && mayResetPinClient(callerRole, u.role));
}

// ── PIN ändern / zurücksetzen (top bar menu) ──
var pinResetBusy = false;
var pinResetUsers = []; // var: ui.js reads it via window[data-source]

function pinSheetOpen(html) {
  let m = document.getElementById('pin-sheet-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'pin-sheet-modal';
    m.className = 'sig-modal ui-sheet';
    m.style.setProperty('--sheet-w', '420px');
    m.innerHTML = '<div class="sig-modal-inner"></div>';
    m.addEventListener('click', e => { if (e.target === m) closePinSheet(); });
    document.body.appendChild(m);
  }
  m.firstChild.innerHTML = '<div class="ui-sheet-head"><h3 class="ui-title" style="font-size:18px;">' + html.title + '</h3>' +
    '<button type="button" class="ui-icon-btn" onclick="closePinSheet()" aria-label="Schließen"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' + html.body;
  m.classList.add('open');
}

function closePinSheet() {
  const m = document.getElementById('pin-sheet-modal');
  if (m) { m.classList.remove('open'); m.firstChild.innerHTML = ''; }
}

function openPinChange() {
  const f = (id, label) => '<label class="ui-field"><span>' + label + '</span><input type="password" id="' + id + '" inputmode="numeric" maxlength="4" autocomplete="off"></label>';
  pinSheetOpen({ title: 'PIN ändern', body: f('pin-old', 'Alte PIN') + f('pin-new', 'Neue PIN') + f('pin-new2', 'Neue PIN wiederholen') +
    '<div id="pin-sheet-err" class="ui-error" role="alert" style="color:#c0392b;min-height:1.2em;"></div>' +
    '<div class="ui-sheet-actions"><button type="button" class="ui-btn" onclick="closePinSheet()">Abbrechen</button>' +
    '<button type="button" class="ui-btn ui-btn-primary" id="pin-change-btn" onclick="submitPinChange()">Speichern</button></div>' });
}

async function submitPinChange() {
  const v = id => document.getElementById(id).value;
  const err = document.getElementById('pin-sheet-err');
  const oldPin = v('pin-old'), newPin = v('pin-new');
  err.textContent = pinFormError('enter', oldPin) || pinFormError('set', newPin, v('pin-new2'));
  if (err.textContent) return;
  const btn = document.getElementById('pin-change-btn');
  btn.disabled = true;
  let res;
  try { res = await supabaseClient.functions.invoke('pin-change', { body: { old_pin: oldPin, new_pin: newPin } }); } catch (e) { res = { error: e }; }
  btn.disabled = false;
  if (res && res.data && res.data.ok) {
    closePinSheet();
    // The password change ends the current session on the server: sign straight back in with the new PIN
    let relog = null;
    try { relog = await supabaseClient.functions.invoke('pin-login', { body: { user_id: currentUser.id, pin: newPin } }); } catch (e) { relog = null; }
    const out = relog ? loginOutcome(relog) : {};
    if (out.session) {
      try { await supabaseClient.auth.setSession(out.session); localStorage.setItem(LOGIN_TS_KEY, String(Date.now())); } catch (e) { /* next start asks for the PIN */ }
    }
    showToast('PIN geändert');
    return;
  }
  const http = res && res.error && res.error.name === 'FunctionsHttpError' && !(res.data && res.data.error);
  err.textContent = http ? 'PIN konnte nicht geändert werden.' : loginOutcome(res).message;
}

function openPinReset() {
  pinResetUsers = resetTargets(userRole, currentUser && currentUser.id, allUsers);
  pinSheetOpen({ title: 'PIN zurücksetzen', body: '<label class="ui-field"><span>Mitarbeiter</span>' +
    uiComboHtml('pin-reset-name', '', 'Name tippen…', 'pinResetPick', '', 'pinResetUsers') + '</label>' +
    '<div class="ui-sheet-actions"><button type="button" class="ui-btn" onclick="closePinSheet()">Abbrechen</button></div>' });
}

function pinResetPick(arg, name) {
  const u = pinResetUsers.find(x => x.full_name === name);
  if (u) confirmPinReset(u.id);
}

async function confirmPinReset(userId) {
  const u = pinResetUsers.find(x => x.id === userId);
  if (!u || pinResetBusy || !confirm('PIN von ' + u.full_name + ' wirklich zurücksetzen?')) return;
  let res;
  pinResetBusy = true;
  try { res = await supabaseClient.functions.invoke('pin-reset', { body: { target_user_id: userId } }); } catch (e) { res = { error: e }; }
  pinResetBusy = false;
  if (res && res.data && res.data.ok) {
    closePinSheet();
    showToast('PIN zurückgesetzt – ' + u.full_name + ' wählt beim nächsten Login eine neue.');
  } else {
    // FunctionsHttpError = server answered (401/403/404/400/500); anything else = no connection
    const http = res && res.error && res.error.name === 'FunctionsHttpError';
    showToast(http ? 'PIN konnte nicht zurückgesetzt werden.' : PIN_ERR_CONNECTION);
  }
}

// A refresh/network error while a recent login exists keeps the cached login; only a clean "no session" or an old login means login
// Auth answered 4xx (refresh token revoked/expired): the session is dead, not just unreachable
function isDeadSessionError(err) {
  return !!err && typeof err.status === 'number' && err.status >= 400 && err.status < 500;
}

function authStartState(session, loginTs, now, sessionError) {
  if (now - loginTs >= PIN_SESSION_MS) return 'login';
  if (isDeadSessionError(sessionError)) return 'login';
  return session || sessionError ? 'restore' : 'login';
}

// Last good employee list, so an offline start can still restore the session and show the login list
const USERS_CACHE_KEY = 'luebbert_app_users';
function parseCachedUsers(raw) {
  try {
    const list = JSON.parse(raw || 'null');
    return Array.isArray(list) ? list.filter(u => u && u.id) : [];
  } catch (e) { return []; }
}

// Name list for the picker (anon RPC: id, full_name, role, has_pin of active users)
async function fetchEmployees() {
  let data = null, error = null;
  try {
    ({ data, error } = await supabaseClient.rpc('login_names'));
  } catch (e) { error = e; }

  if (error) {
    console.error('Fehler beim Laden der Mitarbeiter:', error);
    allUsers = parseCachedUsers(localStorage.getItem(USERS_CACHE_KEY));
    populateDropdown();
    return;
  }

  allUsers = data || [];
  try { localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(allUsers)); } catch (e) { /* storage full */ }
  populateDropdown();
}

function cachedOwnProfile() {
  try { return JSON.parse(localStorage.getItem(OWN_PROFILE_KEY) || 'null'); } catch (e) { return null; }
}

// Own app_users row (the session is already set) → { profile, error }.
// error: the request failed (profile = cached copy of the same id, or null);
// no error + profile null: the server says the person is missing or deactivated.
// Without a valid session the database refuses (no anon access): that is "logged out", not "offline"
function isProfileDenied(error) {
  return !!error && ['42501', 'PGRST301', 'PGRST303'].indexOf(error.code) !== -1;
}

async function fetchOwnProfile(id) {
  let data = null, error = null;
  try {
    ({ data, error } = await supabaseClient.from('app_users')
      .select('id, full_name, role, role_rates, employment_type, default_dept, hourly_rate_internal, is_active, plan_interest_viewer, can_drive, app_user_private(hourly_rate_conni)')
      .eq('id', id).maybeSingle());
  } catch (e) { error = e; }
  if (isProfileDenied(error)) return { profile: null, error: false };
  if (error) {
    const cached = cachedOwnProfile();
    return { profile: cached && cached.id === id ? cached : null, error: true };
  }
  if (!data || data.is_active === false) { try { localStorage.removeItem(OWN_PROFILE_KEY); } catch (e) { /* ignore */ } return { profile: null, error: false }; }
  const profile = flattenPrivate(data);
  try { localStorage.setItem(OWN_PROFILE_KEY, JSON.stringify(profile)); } catch (e) { /* storage full */ }
  return { profile, error: false };
}

// signOut({scope:'local'}) reports network trouble as {error} and keeps the stored session → remove it ourselves
async function signOutLocal() {
  let err = null;
  try { ({ error: err } = await supabaseClient.auth.signOut({ scope: 'local' })); } catch (e) { err = e; }
  if (err) { try { localStorage.removeItem(supabaseClient.auth.storageKey); } catch (e) { /* ignore */ } }
}

// ── SEARCHABLE NAME PICKER (combobox) ──
let authSelectedUserId = null;

function populateDropdown() {
  // Refresh the filtered list if the picker is currently open
  const list = document.getElementById('auth-name-list');
  if (list && list.style.display !== 'none') renderAuthNameList();
}

function renderAuthNameList() {
  const inp = document.getElementById('auth-name-input');
  const list = document.getElementById('auth-name-list');
  if (!inp || !list) return;
  const q = (inp.value || '').toLowerCase().trim();
  const matches = allUsers.filter(u => !q || (u.full_name || '').toLowerCase().includes(q));
  list.innerHTML = matches.length
    ? matches.map(u => '<div class="combo-item" data-id="' + u.id + '">' + escapeHtml(u.full_name || '') + '</div>').join('')
    : '<div class="combo-empty">Kein Treffer</div>';
  list.style.display = 'block';
}

function selectAuthUser(id) {
  const user = allUsers.find(u => u.id === id);
  if (!user) return;
  authSelectedUserId = id;
  const inp = document.getElementById('auth-name-input');
  if (inp) inp.value = user.full_name || '';
  const list = document.getElementById('auth-name-list');
  if (list) list.style.display = 'none';
  const mode = authPinMode(user);
  const wrap = document.getElementById('auth-pin-wrapper');
  const pin = document.getElementById('auth-pin'), rep = document.getElementById('auth-pin-repeat');
  if (wrap) wrap.style.display = mode === 'none' ? 'none' : 'block';
  if (pin) pin.value = '';
  if (rep) { rep.value = ''; rep.style.display = mode === 'set' ? 'block' : 'none'; }
  const adm = document.getElementById('auth-admin-pin');
  if (adm) { adm.value = ''; adm.style.display = mode === 'set' && firstPinNeedsAdminPinClient(user.role) ? 'block' : 'none'; }
  const lbl = document.getElementById('auth-pin-label');
  if (lbl) lbl.textContent = mode === 'set' ? 'Wähle deine 4-stellige PIN' : 'PIN eingeben';
}

function initAuthNamePicker() {
  const inp = document.getElementById('auth-name-input');
  const list = document.getElementById('auth-name-list');
  if (!inp || !list) return;

  inp.addEventListener('focus', renderAuthNameList);
  inp.addEventListener('input', function () {
    authSelectedUserId = null;
    renderAuthNameList();
    // Exact name typed out fully → select it right away (shows/hides the PIN fields)
    const exact = allUsers.find(u => (u.full_name || '').toLowerCase() === inp.value.toLowerCase().trim());
    if (exact) selectAuthUser(exact.id);
  });
  ['auth-name-input', 'auth-pin', 'auth-pin-repeat', 'auth-admin-pin'].forEach(function (id) {
    document.getElementById(id).addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); handleAuthSubmit(); }
    });
  });
  // mousedown fires before the input's blur, so taps on entries always land
  list.addEventListener('mousedown', function (e) {
    const item = e.target.closest('.combo-item');
    if (item) { e.preventDefault(); selectAuthUser(item.dataset.id); }
  });
  inp.addEventListener('blur', function () {
    setTimeout(function () { list.style.display = 'none'; }, 150);
  });
}

// After the fresh employee list arrived: log in again only if the person changed (role, name, rates),
// was deactivated, or nothing was shown from the cache yet
function authSessionChanged(shown, fresh) {
  if (!shown || !fresh) return true;
  return ['full_name', 'role', 'default_dept', 'hourly_rate_conni', 'hourly_rate_internal', 'employment_type', 'can_drive']
    .some(function(k) { return String(shown[k] == null ? '' : shown[k]) !== String(fresh[k] == null ? '' : fresh[k]); })
    || JSON.stringify(shown.role_rates || []) !== JSON.stringify(fresh.role_rates || []);
}

async function initAuth() {
  initAuthNamePicker();
  // One-time cleanup of the old name-only login
  ['local_app_user_id', 'local_app_session_ts', 'local_app_remember_me'].forEach(function (k) { localStorage.removeItem(k); });

  // Weak network: show the cached profile at once (before any await; getSession may refresh over the network)
  const loginTs = +localStorage.getItem(LOGIN_TS_KEY) || 0;
  const cached = cachedOwnProfile();
  let shown = cached && Date.now() - loginTs < PIN_SESSION_MS ? cached : null;
  if (shown) handleSession(shown);

  let session = null, sessionError = null;
  try { ({ data: { session }, error: sessionError } = await supabaseClient.auth.getSession()); } catch (e) { sessionError = e; }
  const state = authStartState(session, loginTs, Date.now(), sessionError);

  if (state === 'login') {
    await signOutLocal();
    localStorage.removeItem(LOGIN_TS_KEY);
    allUsers = parseCachedUsers(localStorage.getItem(USERS_CACHE_KEY)); // picker not empty on a slow network
    handleSession(null);
    fetchEmployees();
    return;
  }

  if (session && shown && shown.id !== session.user.id) { shown = null; handleSession(null); } // cached profile of someone else
  const id = session ? session.user.id : shown && shown.id;
  if (!id) { // refresh failed and nothing cached: login needs the network anyway, keep the stored session
    handleSession(null);
    fetchEmployees();
    return;
  }

  const { profile: fresh, error: profErr } = await fetchOwnProfile(id);
  if (!fresh && !profErr) {
    await signOutLocal();
    localStorage.removeItem(LOGIN_TS_KEY);
    handleSession(null);
  } else if (!fresh) handleSession(null); // request failed, no cache: keep the session for the next start
  else if (authSessionChanged(shown, fresh)) handleSession(fresh);
  fetchEmployees(); // name list for the picker / settings.js
}

// True when the session now belongs to someone else than before (login, user switch, logout)
function sessionUserChanged(prevId, nextId) {
  return prevId === undefined || (prevId || null) !== (nextId || null);
}

var lastSessionUserId; // undefined until the first handleSession

function handleSession(user) {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;
  const userChanged = sessionUserChanged(lastSessionUserId, user ? user.id : null);
  lastSessionUserId = user ? user.id : null;
  if (userChanged) closePinSheet(); // no open PIN sheet or typed PINs across logout/user switch

  if (user) {
    currentUser = { id: user.id, email: '', full_name: user.full_name || '', role: user.role,
      role_rates: Array.isArray(user.role_rates) ? user.role_rates : [], employment_type: user.employment_type || 'Minijob' }; // Mock basic GoTrue object for backwards compatibility (+ name for the start page greeting)
    userRole = user.role;
    // Costs and rates only for PL/Buchhaltung/Admin: every '.cost-only' element is hidden otherwise (css/ui.css)
    document.body.classList.toggle('no-costs', !canSeeCosts(currentUser));
    
    // Auto-sync the user's name across the app (Stundenzettel tracking)
    const snInput = document.getElementById('inp-name');
    if (snInput) {
      snInput.value = user.full_name;
      if (typeof syncStundenName === 'function') syncStundenName(); // label above the week (shared device: no stale name)
    }
    localStorage.setItem('stundenzettel_name', user.full_name);
    window.currentUserSeesInterest = !!user.plan_interest_viewer; // Wochenplan: sees who said "Ich hätte Zeit"
    window.currentUserCanDrive     = !!user.can_drive;            // Wochenplan: may apply for Fahrer slots
    window.currentUserRateConni    = parseFloat(user.hourly_rate_conni)    || 0;
    window.currentUserRateInternal = parseFloat(user.hourly_rate_internal) || 0;

    // Shared device: the Stundenzettel editor (weeks, drawn signatures) belongs to the previous user — start clean,
    // buildDays loads this user's own stored week
    if (userChanged && typeof buildDays === 'function') {
      const weekInp = document.getElementById('inp-week');
      if (weekInp && typeof currentWeekVal === 'function') weekInp.value = currentWeekVal();
      buildDays(true);
    }

    overlay.style.display = 'none';

    console.log('User logged in locally:', user.full_name, 'Role:', userRole);
    enforceUI();
    // The reminder banner depends on the admin switches → load them first (cached values if offline)
    var settingsReady = (typeof loadAppSettings === 'function') ? loadAppSettings() : Promise.resolve();
    settingsReady.then(function() { if (typeof loadErinnerungen === 'function') loadErinnerungen(); });
    // Employee list for the Protokoll pickers and rates — only readable with a session (no anon access)
    if (userChanged && typeof fetchAppUsers === 'function') fetchAppUsers();
    // A ?open=wochenplan link goes through selectMode(), which already initialises the plan
    const wpDeepLink = new URLSearchParams(location.search).get('open') === 'wochenplan';
    if (typeof handleEinsatzDeepLink === 'function') handleEinsatzDeepLink();
    if (typeof handleWochenplanDeepLink === 'function') handleWochenplanDeepLink();
    if (typeof handleOrdnerDeepLink === 'function') handleOrdnerDeepLink();
    // Wochenplan restored from before the login needs the user to load "Meine Schichten"
    if (!wpDeepLink && typeof activeModule !== 'undefined' && activeModule === 'wochenplan' && typeof initWochenplan === 'function') initWochenplan();
    // If Projektordner is already rendered, re-render with correct permissions
    if (typeof activeModule !== 'undefined' && activeModule === 'ordner' &&
        typeof renderOrdner === 'function' && typeof alleOrdner !== 'undefined') {
      canManageOrdner = ['PL', 'Admin'].includes(userRole);
      var addBtn = document.getElementById('btn-add-ordner');
      if (addBtn) addBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';
      if (alleOrdner.length > 0) renderOrdner(alleOrdner);
    }
    // If Produktdatenbank is already shown, re-init with correct role
    if (typeof activeModule !== 'undefined' && activeModule === 'produkte' &&
        typeof initProdukte === 'function') {
      initProdukte();
    }
  } else {
    currentUser = null;
    userRole = 'MA';
    window.currentUserSeesInterest = false;
    window.currentUserCanDrive     = false;
    authSelectedUserId = null;
    if (userChanged && typeof buildDays === 'function') buildDays(true); // no editor content of the logged-out user stays in memory
    const nameInp = document.getElementById('auth-name-input');
    if (nameInp) nameInp.value = '';
    const pinWrap = document.getElementById('auth-pin-wrapper');
    if (pinWrap) pinWrap.style.display = 'none';
    ['auth-pin', 'auth-pin-repeat', 'auth-admin-pin'].forEach(function (id) { const el = document.getElementById(id); if (el) el.value = ''; });
    const banner = document.getElementById('erinnerung-banner');
    if (banner) { banner.style.display = 'none'; banner.innerHTML = ''; }
    overlay.style.display = 'flex';
  }
}

// Gast (Zenjob/Rockit guest login) may only open the Produktdatenbank and Projektordner
var GAST_MODULES = ['produkte', 'ordner'];

// Role guards for modules (used by selectMode and for a module still open from before the login)
function moduleAllowedForRole(m, role) {
  if (role === 'Gast') return GAST_MODULES.indexOf(m) !== -1;
  if (m === 'protokoll') return role !== 'MA';
  if (m === 'dashboard') return ['AL', 'PL', 'Buchhaltung', 'Admin'].indexOf(role) !== -1;
  return true;
}

function enforceUI() {
  // Start page: tiles per role, greeting and next shift (home.js)
  if (typeof renderHome === 'function') renderHome();
  // A module restored from before the login (or left open by the previous user) may be off-limits for this role
  if (typeof activeModule !== 'undefined' && activeModule && !moduleAllowedForRole(activeModule, userRole) &&
      typeof exitToMenu === 'function') {
    exitToMenu();
  }
  // Settings tab only for the Admin role (saving additionally needs the admin password)
  const setTab = document.getElementById('dash-tab-settings');
  if (setTab) {
    setTab.style.display = userRole === 'Admin' ? '' : 'none';
    if (userRole !== 'Admin' && setTab.classList.contains('active') && typeof switchDashTab === 'function') switchDashTab('prot');
  }
}

async function handleAuthSubmit() {
  const btn0 = document.getElementById('auth-submit-btn');
  if (btn0 && btn0.disabled) return; // login already running (double Enter)
  const nameInp = document.getElementById('auth-name-input');
  const errorEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');

  errorEl.style.display = 'none';

  // Resolve typed name if no explicit selection was made
  if (!authSelectedUserId && nameInp && nameInp.value.trim()) {
    const typed = nameInp.value.toLowerCase().trim();
    const exact = allUsers.filter(u => (u.full_name || '').toLowerCase() === typed);
    const partial = allUsers.filter(u => (u.full_name || '').toLowerCase().includes(typed));
    if (exact.length === 1) selectAuthUser(exact[0].id);
    else if (partial.length === 1) selectAuthUser(partial[0].id);
  }

  if (!authSelectedUserId) {
    errorEl.textContent = 'Bitte deinen Namen auswählen.';
    errorEl.style.display = 'block';
    return;
  }

  const user = allUsers.find(u => u.id === authSelectedUserId);
  if (!user) {
    errorEl.textContent = 'Benutzer nicht in Datenbank gefunden!';
    errorEl.style.display = 'block';
    return;
  }

  const mode = authPinMode(user);
  const pin = document.getElementById('auth-pin').value;
  const formErr = pinFormError(mode, pin, document.getElementById('auth-pin-repeat').value);
  if (formErr) {
    errorEl.textContent = formErr;
    errorEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Lädt...';
  btn.disabled = true;
  const fail = function (msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    btn.textContent = 'Anmelden';
    btn.disabled = false;
  };

  let res;
  try {
    const body = mode === 'none' ? { user_id: user.id } : { user_id: user.id, pin, set: mode === 'set' };
    if (mode === 'set' && firstPinNeedsAdminPinClient(user.role)) body.admin_pin = document.getElementById('auth-admin-pin').value;
    res = await supabaseClient.functions.invoke('pin-login', { body });
  } catch (e) { res = { data: null, error: e }; }
  const out = loginOutcome(res);
  if (!out.session) {
    if (res.error) console.error('pin-login:', res.error);
    if (out.refresh) { await fetchEmployees(); selectAuthUser(user.id); } // stale has_pin: re-render the right fields
    return fail(out.message);
  }

  let sessErr = null;
  try { ({ error: sessErr } = await supabaseClient.auth.setSession(out.session)); } catch (e) { sessErr = e; }
  if (sessErr) return fail(PIN_ERR_CONNECTION);
  localStorage.setItem(LOGIN_TS_KEY, String(Date.now()));
  const { profile, error: profErr } = await fetchOwnProfile(user.id);
  if (!profile) {
    await signOutLocal();
    localStorage.removeItem(LOGIN_TS_KEY);
    return fail(profErr ? PIN_ERR_CONNECTION : 'Benutzer nicht gefunden oder deaktiviert.');
  }
  document.getElementById('auth-pin').value = '';
  document.getElementById('auth-pin-repeat').value = '';
  document.getElementById('auth-admin-pin').value = '';
  user.has_pin = true; // the cached name list must not offer "Wähle deine PIN" to this person after a logout
  handleSession(profile);

  btn.textContent = 'Anmelden';
  btn.disabled = false;
}

async function handleLogout() {
  if (!confirm('Möchtest du dich wirklich abmelden?')) return;
  
  await signOutLocal();
  localStorage.removeItem(LOGIN_TS_KEY);
  localStorage.removeItem(OWN_PROFILE_KEY);
  // Close the open module so the next user doesn't land in e.g. the dashboard of the previous one
  if (typeof exitToMenu === 'function') exitToMenu();
  handleSession(null);
  fetchEmployees(); // fresh has_pin for the next person on this device

  if (typeof closeSettingsModal === 'function') {
    closeSettingsModal();
  }
}

document.addEventListener('DOMContentLoaded', initAuth);
