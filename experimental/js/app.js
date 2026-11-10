/**
 * Main Application Logic & Mode Management
 */

// ── GLOBAL STATE ──
var activeModule = localStorage.getItem('luebbert_mode') || null;
var THEMES = ['auto', 'light', 'dark'];
var ICONS = { 'auto': 'Auto', 'light': 'Hell', 'dark': 'Dunkel' };
var currentTheme = localStorage.getItem('theme') || 'auto';
var sigModalState = { key: null, drawing: false, last: null, hasInk: false };
var hourlyWage = parseFloat(localStorage.getItem('stundenzettel_wage')) || 0;
// Central admin setting (js/settings.js), cached for offline starts; the old per-device value no longer counts
var billingCutoff = (typeof appSettingsFromCache === 'function') ? appSettingsFromCache().billing_cutoff : 20;

// Called by loadAppSettings() once fresh settings arrived
function onAppSettingsLoaded() {
  var c = appSetting('billing_cutoff');
  if (c === billingCutoff) return;
  billingCutoff = c;
  if (typeof renderHistory === 'function' && document.getElementById('history-list')) renderHistory(true);
}
var DEPT_DEFAULTS = ["AL", "MA", "Fahrer", "Floristik", "Lager", "Stoffe", "Tischlerei"];
var DEPT_OLD_STYLE = ["AL (Aufbauleitung)", "MA für Auf-/ Abbau"];
var DEPT_LABELS = {
  "AL": "Aufbauleitung",
  "MA": "Mitarbeiter für Auf-/ Abbau",
  "Fahrer": "Fahrer",
  "AL fest": "Aufbauleitung",
  "AL frei": "Aufbauleitung",
  "MA fest": "Mitarbeiter für Auf-/ Abbau",
  "MA frei": "Mitarbeiter für Auf-/ Abbau",
  "Fahrer fest": "Fahrer",
  "Fahrer frei": "Fahrer",
  "Floristik": "Floristik",
  "Lager": "Lager",
  "Stoffe": "Stoffe",
  "Tischlerei": "Tischlerei"
};
function deptLabel(d) {
  if (DEPT_LABELS[d]) return DEPT_LABELS[d];
  var p = typeof splitPosition === 'function' ? splitPosition(d) : null; // "MA Minijob" → label of "MA"
  return (p && p.type && DEPT_LABELS[p.func]) || d;
}
var departments;
try {
  departments = JSON.parse(localStorage.getItem('stundenzettel_depts') || 'null') || DEPT_DEFAULTS;
} catch(e) {
  departments = DEPT_DEFAULTS;
}
// Migrate old verbose department names → protocol-style roles
if (departments.some(function(d) { return DEPT_OLD_STYLE.indexOf(d) !== -1; })) {
  departments = DEPT_DEFAULTS;
  localStorage.setItem('stundenzettel_depts', JSON.stringify(DEPT_DEFAULTS));
}
// 2026-11-05: "MA frei"/"AL fest" → "MA"/"AL" (the employment type comes from the person); custom entries stay
if (departments.some(function(d) { return /^(AL|MA|Fahrer) (frei|fest)$/.test(d); })) {
  departments = departments.map(function(d) { return d.replace(/^(AL|MA|Fahrer) (frei|fest)$/, '$1'); })
    .filter(function(d, i, all) { return all.indexOf(d) === i; });
  localStorage.setItem('stundenzettel_depts', JSON.stringify(departments));
}
// Default dept of a new shift (no picker any more; each shift has its own dept select)
var selectedAbt = departments.indexOf('MA') !== -1 ? 'MA' : departments[0];
var monsterMode = localStorage.getItem('stundenzettel_monster') === 'true';
var deptWages;
try {
  deptWages = JSON.parse(localStorage.getItem('stundenzettel_dept_wages') || 'null') || Object.assign({}, STUNDEN_DEPT_WAGES_DEFAULT);
} catch(e) {
  deptWages = Object.assign({}, STUNDEN_DEPT_WAGES_DEFAULT);
}
// 2026-11-05: wages saved under "MA frei"/"MA fest" move to "MA" (frei wins); the old keys stay as fallback
['AL', 'MA', 'Fahrer'].forEach(function(f) {
  if (!(deptWages[f] > 0) && (deptWages[f + ' frei'] > 0 || deptWages[f + ' fest'] > 0)) {
    deptWages[f] = deptWages[f + ' frei'] > 0 ? deptWages[f + ' frei'] : deptWages[f + ' fest'];
  }
});

// ── MODE SELECTION & NAVIGATION ──
var MODULE_TITLES = { stunden: 'Stundenzettel', protokoll: 'Protokoll', dashboard: 'Office Dashboard',
  produkte: 'Produktdatenbank', ordner: 'Projektordner', wochenplan: 'Wochenplan', auftraege: 'Aufträge' };

// The office dashboard is opened from two tiles; each shows one view ('prot' | 'work'), Admin settings come via "…"
var DASH_VIEW_TITLES = { prot: 'Protokoll-Übersicht', work: 'Buchhaltung', settings: 'Einstellungen' };
var DASH_VIEW_KEY = 'luebbert_dash_view';
var dashView = dashViewFromStored(localStorage.getItem(DASH_VIEW_KEY));

function moduleTitle(m) {
  return m === 'dashboard' ? DASH_VIEW_TITLES[dashView] : (MODULE_TITLES[m] || '');
}

// Called by switchDashTab: remembers the view (settings are never restored) and retitles the top bar
function setDashView(view) {
  dashView = view;
  if (view !== 'settings') localStorage.setItem(DASH_VIEW_KEY, view);
  var topTitle = document.getElementById('topbar-title');
  if (topTitle && activeModule === 'dashboard') topTitle.textContent = moduleTitle('dashboard');
}

function selectMode(m, view) {
  // Role-based guards (only once a user is logged in — during module restore
  // on page load the role is not resolved yet and the auth overlay blocks input)
  var loggedIn = typeof currentUser !== 'undefined' && currentUser;
  // (moduleAllowedForRole in auth.js — enforceUI uses the same check after a login)
  if (loggedIn && !moduleAllowedForRole(m, userRole)) {
    showToast(userRole === 'Gast' ? 'Zugriff verweigert: Gastzugang nur für Produktdatenbank und Projektordner.'
      : m === 'protokoll' ? 'Zugriff verweigert: Nur für AL/PL.'
      : m === 'auftraege' ? 'Zugriff verweigert: Nur für PL/Admin.'
      : 'Zugriff verweigert: Nur für AL/PL/Buchhaltung.');
    return;
  }

  activeModule = m;
  if (m === 'dashboard') dashView = view || dashViewFromStored(localStorage.getItem(DASH_VIEW_KEY));
  // The test build at /experimental/ shares localStorage with the live app, which doesn't know
  // the Wochenplan module → never hand it over as the module to restore
  if (window.IS_TEST_BUILD && (m === 'wochenplan' || m === 'auftraege')) localStorage.removeItem('luebbert_mode');
  else localStorage.setItem('luebbert_mode', m);
  
  // Hide startup
  var startup = document.getElementById('page-startup');
  if (startup) startup.classList.remove('active');
  
  // Module top bar (Back to Menu, title, Optionen)
  var topbar = document.getElementById('topbar'), topTitle = document.getElementById('topbar-title');
  if (topTitle) topTitle.textContent = moduleTitle(m);
  if (topbar) topbar.style.display = 'flex';
  updateTopBarSub();

  if (m === 'stunden') {
    document.getElementById('main-nav').style.display = 'flex';
    document.getElementById('prot-nav').style.display = 'none';
    navigate('home');
  } else if (m === 'protokoll') {
    document.getElementById('main-nav').style.display = 'none';
    document.getElementById('prot-nav').style.display = 'flex';
    navigateProt('protokoll');
    if (typeof initProtokoll === 'function') initProtokoll();
  } else if (m === 'dashboard') {
    document.getElementById('main-nav').style.display = 'none';
    var pn = document.getElementById('prot-nav');
    if (pn) pn.style.display = 'none';
    navigate('dashboard');
    if (typeof switchDashTab === 'function') switchDashTab(dashView);
    if (typeof initDashboardRealtime === 'function') initDashboardRealtime();
    if (typeof refreshDashboard === 'function') refreshDashboard();
  } else if (m === 'produkte') {
    document.getElementById('main-nav').style.display = 'none';
    var pn2 = document.getElementById('prot-nav');
    if (pn2) pn2.style.display = 'none';
    navigate('produkte');
    if (typeof initProdukte === 'function') initProdukte();
  } else if (m === 'ordner') {
    document.getElementById('main-nav').style.display = 'none';
    var pn3 = document.getElementById('prot-nav');
    if (pn3) pn3.style.display = 'none';
    navigate('ordner');
    if (typeof initOrdner === 'function') initOrdner();
  } else if (m === 'wochenplan') {
    document.getElementById('main-nav').style.display = 'none';
    var pn4 = document.getElementById('prot-nav');
    if (pn4) pn4.style.display = 'none';
    navigate('wochenplan');
    // The plan needs the logged-in user; a module restored before login is initialised from handleSession
    if (typeof initWochenplan === 'function' && typeof currentUser !== 'undefined' && currentUser) initWochenplan();
  } else if (m === 'auftraege') {
    document.getElementById('main-nav').style.display = 'none';
    var pn5 = document.getElementById('prot-nav');
    if (pn5) pn5.style.display = 'none';
    navigate('auftraege');
    // Needs the session for the queries; a module restored before login is initialised from handleSession
    if (typeof initAuftraege === 'function' && typeof currentUser !== 'undefined' && currentUser) initAuftraege();
  }
}

function exitToMenu() {
  activeModule = null;
  localStorage.removeItem('luebbert_mode');
  if (typeof stopDashboardRealtime === 'function') stopDashboardRealtime();
  
  // Reset UI
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.getElementById('page-startup').classList.add('active');
  document.getElementById('main-nav').style.display = 'none';
  var pn = document.getElementById('prot-nav');
  if (pn) pn.style.display = 'none';
  
  var topbar = document.getElementById('topbar');
  if (topbar) topbar.style.display = 'none';

  updateTopBarSub();
  if (typeof renderHome === 'function') renderHome();
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('.top-tab').forEach(function (b) { b.classList.remove('active'); });
  
  var targetPage = document.getElementById('page-' + page);
  var targetNav = document.getElementById('nav-' + page);
  
  if (targetPage) targetPage.classList.add('active');
  if (targetNav) targetNav.classList.add('active');
  
  if (page === 'history' && typeof renderHistory === 'function') {
    renderHistory();
    renderHistoryChart();
  }
}

function navigateProt(page) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.getElementById('prot-nav').querySelectorAll('.top-tab').forEach(function (b) { b.classList.remove('active'); });

  var targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');

  var navId = page === 'protokoll' ? 'nav-protokoll' : 'nav-protokoll-history';
  var navBtn = document.getElementById(navId);
  if (navBtn) navBtn.classList.add('active');

  if (page === 'protokoll-history' && typeof renderProtHistory === 'function') {
    renderProtHistory();
  }
}

// ── BRANDING & UI ──
function updateTopBarSub() {
  var sub = document.getElementById('top-bar-sub');
  if (!sub) return;

  if (activeModule === 'stunden') {
    var name = (document.getElementById('inp-name') || {}).value || '';
    var val = (document.getElementById('inp-week') || {}).value || currentWeekVal();
    var parts = val.split('-W');
    sub.textContent = name ? name + ' · KW ' + parseInt(parts[1]) : 'Stundennachweis';
  } else if (activeModule === 'protokoll') {
    sub.textContent = 'Auf- & Abbauprotokoll';
  } else {
    sub.textContent = '';
  }
}

// ── THEME ──
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('.theme-btn-icon').forEach(function (b) { b.textContent = ICONS[t]; });
}

// Chosen in Optionen (the top bar button still cycles)
function setTheme(t) {
  if (THEMES.indexOf(t) === -1) return;
  currentTheme = t;
  localStorage.setItem('theme', t);
  applyTheme(t);
  optPaintTheme();
}

function optPaintTheme() {
  document.querySelectorAll('#opt-theme [data-theme-opt]').forEach(function(b) {
    var on = b.getAttribute('data-theme-opt') === currentTheme;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function cycleTheme() {
  var idx = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
  currentTheme = THEMES[idx];
  localStorage.setItem('theme', currentTheme);
  applyTheme(currentTheme);
  optPaintTheme();
}

// ── EASTER EGG: MONSTER MODE ──
var titleTapCount = 0;
var titleTapTimer = null;
function titleTap() {
  titleTapCount++;
  clearTimeout(titleTapTimer);
  titleTapTimer = setTimeout(function () { titleTapCount = 0; }, 800);
  if (titleTapCount >= 7) {
    titleTapCount = 0;
    monsterMode = !monsterMode;
    localStorage.setItem('stundenzettel_monster', monsterMode);
    if (monsterMode) {
      showToast('MONSTER MODE AKTIVIERT!');
    } else {
      showToast('Monster Mode deaktiviert');
    }
    if (typeof calcTotal === 'function') calcTotal();
    if (document.getElementById('page-history') && document.getElementById('page-history').classList.contains('active')) {
      renderHistory();
    }
  }
}

function getDeptWage(dept) {
  if (dept && deptWages[dept] > 0) return deptWages[dept];
  // "MA Minijob" / "MA": wages saved under the old names ("MA frei") still count
  var f = dept && typeof splitPosition === 'function' ? splitPosition(dept).func : null;
  if (f && f !== dept && deptWages[f] > 0) return deptWages[f];
  if (f && deptWages[f + ' frei'] > 0) return deptWages[f + ' frei'];
  return hourlyWage > 0 ? hourlyWage : 0;
}

function formatEarnings(totalHours, dept) {
  var wage = getDeptWage(dept);
  if (wage <= 0 || totalHours <= 0) return null;
  return formatEuros(totalHours * wage);
}

// "≈ 123,45 €" (or Monster cans); null for nothing
function formatEuros(euros) {
  if (!(euros > 0)) return null;
  if (monsterMode) {
    var cans = Math.floor(euros / (STUNDEN_MONSTER_PRICE || 1.84));
    return '≈ ' + cans + ' <img src="icons/monsta_can.png" class="monster-icon" alt="Monster Can">';
  }
  return '≈ ' + euros.toFixed(2).replace('.', ',') + ' €';
}

// ── INIT ──
window.addEventListener('DOMContentLoaded', function() {
  applyTheme(currentTheme);
  
  var weekInp = document.getElementById('inp-week');
  if (weekInp) {
    weekInp.value = currentWeekVal();
    weekInp.addEventListener('change', buildDays);
  }

  var nameInp = document.getElementById('inp-name');
  if (nameInp) {
    var sn = localStorage.getItem('stundenzettel_name');
    if (sn) nameInp.value = sn;
    nameInp.addEventListener('blur', function (e) {
      localStorage.setItem('stundenzettel_name', e.target.value);
      updateTopBarSub();
    });
  }

  if (typeof buildDays === 'function') buildDays();
  if (typeof initProtokoll === 'function') initProtokoll();

  // Restore module
  if (activeModule) {
    selectMode(activeModule);
  }

  // PWAs & Service Workers
  if ('serviceWorker' in navigator) {
    // Track whether a controller already existed when the page loaded.
    // controllerchange fires on first install too (null → new SW), so we
    // only want to reload if an *existing* controller was replaced.
    var _swHadController = !!navigator.serviceWorker.controller;
    var _swReloadPending  = false;

    function _onSwUpdate() {
      if (_swReloadPending) return;
      _swReloadPending = true;
      if (typeof showToast === 'function') showToast('🔄 App wird aktualisiert…');
      setTimeout(function() { window.location.reload(); }, 1200);
    }

    // Fires when a new SW takes control of this page
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (_swHadController) _onSwUpdate();
      _swHadController = true;
    });

    // Belt-and-suspenders: SW also broadcasts SW_UPDATED after activating
    navigator.serviceWorker.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'SW_UPDATED') _onSwUpdate();
    });

    navigator.serviceWorker.register('sw.js').then(function(reg) {
      reg.update(); // proactively check for a new sw.js on every page load
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }).catch(function() {});
  }
});

// ── SHARED SIGNATURE MODAL LOGIC ──
function initSigModalCanvas() {
  var c = document.getElementById('sig-modal-canvas'), dpr = window.devicePixelRatio || 1;
  var rect = c.parentElement.getBoundingClientRect(), w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
  c.width = w * dpr; c.height = h * dpr; c.style.width = '100%'; c.style.height = '100%';
  var ctx = c.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  return { canvas: c, ctx: ctx, w: w, h: h };
}

function sigModalPos(e, c) { var r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

// Re-size the modal canvas after rotation/fullscreen changes. Without this the
// backing store keeps its pre-rotation dimensions and strokes appear skewed.
function resizeSigModalCanvas() {
  var c = document.getElementById('sig-modal-canvas');
  if (!c) return;
  var snapshot = sigModalState.hasInk ? c.toDataURL('image/png') : null;
  var pad = initSigModalCanvas();
  var key = sigModalState.key;
  var stored = (key === 'prot')
    ? (typeof protState !== 'undefined' ? protState.signature : null)
    : (typeof shiftSigData !== 'undefined' && key ? shiftSigData[key] : null);
  var src = snapshot || stored;
  if (src) {
    var img = new Image();
    img.onload = function () { pad.ctx.drawImage(img, 0, 0, pad.w, pad.h); sigModalState.hasInk = true; };
    img.src = src;
  }
}

var _sigLayoutTimer = null;
function _onSigLayoutChange() {
  clearTimeout(_sigLayoutTimer);
  _sigLayoutTimer = setTimeout(function () {
    var m = document.getElementById('sig-modal');
    if (m && m.classList.contains('open')) resizeSigModalCanvas();
    // Inline signature previews stretch on rotation — re-init and redraw from stored data
    if (typeof shiftSigCanvases !== 'undefined' && typeof activeDayIdx !== 'undefined' && activeDayIdx !== null) {
      shiftSigCanvases = {};
      for (var s = 0; s < (shiftCounts[activeDayIdx] || 1); s++) initShiftSig(activeDayIdx, s);
    }
    if (typeof initProtSig === 'function' && document.getElementById('sigc-prot')) { initProtSig(); redrawProtSig(); }
  }, 180);
}
window.addEventListener('resize', _onSigLayoutChange);
window.addEventListener('orientationchange', _onSigLayoutChange);
document.addEventListener('fullscreenchange', _onSigLayoutChange);

function clearSigModal() { var c = document.getElementById('sig-modal-canvas'), ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); sigModalState.hasInk = false; }

function closeSigModal() {
  var m = document.getElementById('sig-modal'); m.classList.remove('open');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){});
  if (screen.orientation && screen.orientation.unlock) try { screen.orientation.unlock(); } catch(_){}
  sigModalState.key = null;
}

function saveSigModal() {
  var key = sigModalState.key; if (!key) return closeSigModal();
  var c = document.getElementById('sig-modal-canvas');
  if (sigModalState.hasInk) {
    var scale = Math.min(1, 400 / c.width), tempC = document.createElement('canvas');
    tempC.width = c.width * scale; tempC.height = c.height * scale;
    var tCtx = tempC.getContext('2d'); tCtx.fillStyle = "#FFFFFF"; tCtx.fillRect(0, 0, tempC.width, tempC.height);
    tCtx.scale(scale, scale); tCtx.drawImage(c, 0, 0);
    var data = tempC.toDataURL('image/jpeg', 0.6);
    
    if (key === 'prot') {
      if (typeof protState !== 'undefined') {
        protState.signature = data;
        if (typeof redrawProtSig === 'function') redrawProtSig();
        // Into the draft right away: re-entering the form reloads the draft and would drop the signature
        if (typeof saveProtDraft === 'function') saveProtDraft();
      }
    } else {
      if (typeof shiftSigData !== 'undefined') {
        shiftSigData[key] = data;
        if (typeof redrawShiftSig === 'function') redrawShiftSig(key);
      }
    }
  } else {
    if (key === 'prot') {
      if (typeof protState !== 'undefined') {
        protState.signature = null;
        if (typeof redrawProtSig === 'function') redrawProtSig();
        if (typeof saveProtDraft === 'function') saveProtDraft();
      }
    } else {
      if (typeof shiftSigData !== 'undefined') {
        shiftSigData[key] = null;
        if (typeof redrawShiftSig === 'function') redrawShiftSig(key);
      }
    }
  }
  closeSigModal();
}

// ── SETTINGS (Optionen: one menu for everything personal) ──
var OPT_ROLE_NAMES = { MA: 'Mitarbeiter', AL: 'Aufbauleitung', PL: 'Projektleitung', Buchhaltung: 'Buchhaltung', Admin: 'Admin', Gast: 'Gast (nur ansehen)' };

// "Patryk Stańczyk" → "PS"
function optInitials(name) {
  var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0].charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
}

// Which blocks of the menu a role sees: a guest only looks, so nothing personal to set
function optSections(role) {
  var member = !!role && role !== 'Gast';
  return { push: member, account: member, pinReset: ['Admin', 'PL', 'AL'].indexOf(role) !== -1, pay: member, data: member };
}

function openSettingsModal() {
  var m = document.getElementById('settings-modal'), w = document.getElementById('inp-wage'), c = document.getElementById('inp-cutoff-info');
  var role = typeof userRole !== 'undefined' ? userRole : null;
  var name = (typeof currentUser !== 'undefined' && currentUser && currentUser.full_name) || '';
  var set = function(id, text) { var el = document.getElementById(id); if (el) el.textContent = text; };
  set('opt-avatar', optInitials(name));
  set('opt-name', name || 'Nicht angemeldet');
  set('opt-role', OPT_ROLE_NAMES[role] || role || '');
  var sec = optSections(role), show = function(id, on) { var el = document.getElementById(id); if (el) el.hidden = !on; };
  show('opt-sec-push', sec.push); show('opt-sec-account', sec.account); show('opt-pin-reset', sec.pinReset);
  show('opt-calendar', sec.account && typeof wpCalendarSheet === 'function');
  show('opt-sec-pay', sec.pay); show('opt-sec-data', sec.data);
  optPaintTheme();
  if (sec.push) optPaintPush();
  if (w) w.value = hourlyWage > 0 ? hourlyWage : '';
  if (c) c.textContent = billingCutoff + '. des Monats';
  renderSettingsDepts(); 
  if (m) m.classList.add('open');
}

function closeSettingsModal() { 
  var m = document.getElementById('settings-modal');
  if (m) m.classList.remove('open'); 
}

// Row that leaves the menu for another sheet (PIN, calendar): close first, two sheets on top of each other read badly
function optGo(fn) {
  closeSettingsModal();
  if (typeof window[fn] === 'function') window[fn]();
}

// State of push on THIS device, with the one step that is open (if any)
async function optPaintPush() {
  var box = document.getElementById('opt-push');
  if (!box) return;
  var row = function(title, sub, btn) {
    box.innerHTML = '<span class="opt-row-label">' + escapeHtml(title) + (sub ? '<small>' + escapeHtml(sub) + '</small>' : '') + '</span>' + (btn || '');
  };
  var known = typeof pushSupported === 'function' && typeof isIosWithoutHomescreen === 'function' && typeof hasPushSubscription === 'function';
  if (!known) return row('Auf diesem Gerät nicht verfügbar');
  if (isIosWithoutHomescreen()) return row('Erst zum Home-Bildschirm hinzufügen', 'Teilen, dann „Zum Home-Bildschirm“, und die App von dort öffnen');
  if (!pushSupported()) return row('Dieser Browser kann keine Benachrichtigungen');
  if (Notification.permission === 'denied') return row('Für diese App blockiert', 'In den Einstellungen des Handys oder Browsers erlauben');
  row('Wird geprüft…');
  var on = false;
  try { on = await hasPushSubscription(); } catch (e) { on = false; }
  if (on) return row('An auf diesem Gerät', 'Planänderungen und Erinnerungen kommen als Mitteilung', '<span class="ui-pill ui-pill-ok">An</span>');
  row('Aus auf diesem Gerät', 'Planänderungen und Erinnerungen als Mitteilung bekommen',
    '<button type="button" class="ui-btn ui-btn-primary" id="opt-push-btn" onclick="optEnablePush()">Einschalten</button>');
}

async function optEnablePush() {
  var btn = document.getElementById('opt-push-btn');
  if (btn) btn.disabled = true;
  var res = typeof enablePushReminders === 'function' ? await enablePushReminders() : 'unsupported';
  if (res === 'granted') showToast('Benachrichtigungen sind an');
  else if (res === 'denied') showToast('Benachrichtigungen wurden abgelehnt (in den Browser-Einstellungen änderbar).', 'danger');
  else if (res !== 'ios_needs_install') showToast('Benachrichtigungen konnten nicht eingeschaltet werden.', 'danger');
  optPaintPush();
}

// Wages apply as soon as a field is left: an options menu has no "save" step to forget
function settingsApply() {
  var wEl = document.getElementById('inp-wage');
  var w = wEl ? parseFloat(String(wEl.value).replace(',', '.')) : NaN;

  if (!isNaN(w) && w > 0) { hourlyWage = w; localStorage.setItem('stundenzettel_wage', w); }
  else { hourlyWage = 0; localStorage.removeItem('stundenzettel_wage'); }
  // The billing cut-off is set centrally (Office Dashboard → Einstellungen)

  // Save per-dept wages
  departments.forEach(function(d) {
    var el = document.getElementById('inp-dept-wage-' + d.replace(/[^a-zA-Z0-9]/g, '_'));
    if (el) {
      var val = parseFloat(String(el.value).replace(',', '.'));
      if (!isNaN(val) && val > 0) deptWages[d] = val;
      else delete deptWages[d];
    }
  });
  localStorage.setItem('stundenzettel_dept_wages', JSON.stringify(deptWages));

  if (typeof calcTotal === 'function') calcTotal();
  if (document.getElementById('page-history') && document.getElementById('page-history').classList.contains('active')) { 
    if (typeof renderHistory === 'function') { renderHistory(); renderHistoryChart(); }
  }
}

// Kept for callers of the old "Schließen" button
function saveSettingsModal() {
  settingsApply();
  closeSettingsModal(); 
  showToast('Einstellungen gespeichert');
}

function renderSettingsDepts() {
  var l = document.getElementById('settings-dept-list'); if (!l) return;
  l.innerHTML = departments.map(function(d, i) {
    var safeId = 'inp-dept-wage-' + d.replace(/[^a-zA-Z0-9]/g, '_');
    var wage = deptWages[d] || '', label = escapeHtml(deptLabel(d));
    return '<div class="opt-row opt-row-static">' +
      '<label class="opt-row-label" for="' + safeId + '">' + label + '</label>' +
      '<span class="opt-money"><input type="number" id="' + safeId + '" step="0.50" min="0" inputmode="decimal" value="' + wage + '" placeholder="wie oben" ' +
        'aria-label="Stundenlohn ' + label + '" onchange="settingsApply()"><span>€/h</span></span>' +
      '<button type="button" class="ui-icon-btn opt-del" aria-label="' + label + ' entfernen" onclick="deleteDepartment(' + i + ')">' +
        '<svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
    '</div>';
  }).join('');
}

function addDepartment() {
  var i = document.getElementById('inp-new-dept'), v = i.value.trim(); if (!v || departments.indexOf(v) !== -1) return;
  settingsApply();
  departments.push(v); localStorage.setItem('stundenzettel_depts', JSON.stringify(departments)); 
  i.value = ''; renderSettingsDepts(); 
}

function deleteDepartment(i) {
  if (departments.length <= 1) { showToast('Mindestens eine Abteilung muss bleiben'); return; }
  settingsApply();
  var removed = departments.splice(i, 1)[0]; localStorage.setItem('stundenzettel_depts', JSON.stringify(departments));
  // The default for new shifts must stay one from the list
  if (removed === selectedAbt) selectedAbt = departments.indexOf('MA') !== -1 ? 'MA' : departments[0];
  renderSettingsDepts();
}

// ── BACKUP ──
function exportBackup() {
  var b = { meta: { date: new Date().toISOString(), version: '1.2' }, data: {} };
  for (var i = 0; i < localStorage.length; i++) { 
    var k = localStorage.key(i); 
    if (k.startsWith('stundenzettel') || k.startsWith('luebbert')) b.data[k] = localStorage.getItem(k); 
  }
  var blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'luebbert_app_backup_' + localDateStr() + '.json'; a.click();  
  showToast('Backup exportiert!');
}

function importBackup(e) {
  var f = e.target.files[0]; if (!f) return;
  var r = new FileReader(); r.onload = function(evt) {
    try {
      var b = JSON.parse(evt.target.result); if (!b.data) throw new Error();
      if (confirm('Daten überschreiben?')) { 
        Object.keys(b.data).forEach(function(k){ localStorage.setItem(k,b.data[k]); }); 
        window.location.reload(); 
      }
    } catch(err){ showToast('Fehler beim Import'); }
  }; r.readAsText(f);
}

// Global Event Binding
(function bindSigModal() {
  window.addEventListener('load', function() {
    var c = document.getElementById('sig-modal-canvas'); if (!c) return;
    c.addEventListener('pointerdown', function (e) {
      sigModalState.drawing = true; sigModalState.last = sigModalPos(e, c);
      if (c.setPointerCapture) c.setPointerCapture(e.pointerId); e.preventDefault();
    });
    c.addEventListener('pointermove', function (e) {
      if (!sigModalState.drawing) return;
      var ctx = c.getContext('2d'), p = sigModalPos(e, c), l = sigModalState.last;
      ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      sigModalState.last = p; sigModalState.hasInk = true; e.preventDefault();
    });
    c.addEventListener('pointerup', function (e) {
      sigModalState.drawing = false; if (c.releasePointerCapture) { try { c.releasePointerCapture(e.pointerId); } catch (_) { } }
    });
  });
})();
