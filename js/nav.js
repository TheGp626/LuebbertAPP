/* ══ Werkstatt app frame: bottom tab bar + "Mehr" sheet ══
   Pure part first (role → tabs, testable with node --test); the DOM part follows below.
   Every module entry still goes through selectMode() and moduleAllowedForRole() (auth.js). */

// All destinations. mode null = Heute (start page). action = a global function instead of a module.
var NAV_ITEMS = {
  heute: { id: 'heute', label: 'Heute', icon: 'home', mode: null },
  plan: { id: 'plan', label: 'Plan', icon: 'calendar', mode: 'wochenplan' },
  zettel: { id: 'zettel', label: 'Zettel', icon: 'clock', mode: 'stunden' },
  protokoll: { id: 'protokoll', label: 'Protokoll', icon: 'clipboard', mode: 'protokoll' },
  protokolle: { id: 'protokolle', label: 'Protokolle', icon: 'clipboard', mode: 'dashboard', view: 'prot' },
  uebersicht: { id: 'uebersicht', label: 'Übersicht', icon: 'clipboard', mode: 'dashboard', view: 'prot' },
  personal: { id: 'personal', label: 'Personal', icon: 'chart', mode: 'dashboard', view: 'work' },
  auftraege: { id: 'auftraege', label: 'Aufträge', icon: 'file', mode: 'auftraege' },
  produkte: { id: 'produkte', label: 'Produkte', icon: 'box', mode: 'produkte' },
  ordner: { id: 'ordner', label: 'Ordner', icon: 'folder', mode: 'ordner' },
  // Admin page (js/admin.js): Übersicht, Einstellungen, Fehlerberichte
  admin: { id: 'admin', label: 'Admin', icon: 'shield', mode: 'admin' },
  // Floor plan PDF → material list (js/planlesen.js)
  planlesen: { id: 'planlesen', label: 'Plan einlesen', icon: 'layout', mode: 'planlesen' },
  optionen: { id: 'optionen', label: 'Optionen', icon: 'user', mode: null, action: 'openSettingsModal' },
  problem: { id: 'problem', label: 'Problem melden', icon: 'help', mode: null, action: 'openProblemForm' },
  mehr: { id: 'mehr', label: 'Mehr', icon: 'menu', mode: null, action: 'openMoreSheet' }
};

// Approved table (design 2026-11-22): bottom tabs and "Mehr" per role
var NAV_ROLES = {
  MA: { tabs: ['heute', 'plan', 'zettel'], more: ['auftraege', 'produkte', 'ordner'] },
  AL: { tabs: ['heute', 'plan', 'protokoll', 'zettel'], more: ['auftraege', 'uebersicht', 'personal', 'produkte', 'ordner', 'planlesen'] },
  PL: { tabs: ['heute', 'plan', 'auftraege', 'protokolle'], more: ['personal', 'zettel', 'produkte', 'ordner', 'planlesen'] },
  Admin: { tabs: ['heute', 'plan', 'auftraege', 'protokolle'], more: ['admin', 'personal', 'zettel', 'produkte', 'ordner', 'planlesen'] },
  Buchhaltung: { tabs: ['heute', 'protokolle', 'personal'], more: ['auftraege', 'plan', 'zettel', 'produkte', 'ordner'] },
  Gast: { tabs: ['produkte', 'ordner'], more: [] }
};

// allowed = moduleAllowedForRole; seesInterest stands in for window.currentUserSeesInterest (Aufträge for planners)
function navTabs(role, allowed, seesInterest) {
  var cfg = NAV_ROLES[role] || NAV_ROLES.MA;
  var ok = function(id) {
    var it = NAV_ITEMS[id];
    if (!it.mode) return true;
    if (it.mode === 'auftraege') return allowed('auftraege', role) || !!seesInterest;
    return allowed(it.mode, role);
  };
  var pick = function(list) { return list.filter(ok).map(function(id) { return Object.assign({}, NAV_ITEMS[id]); }); };
  if (role === 'Gast') return { tabs: pick(cfg.tabs), more: [] };
  return {
    tabs: pick(cfg.tabs).concat([Object.assign({}, NAV_ITEMS.mehr)]),
    more: pick(cfg.more).concat([Object.assign({}, NAV_ITEMS.optionen), Object.assign({}, NAV_ITEMS.problem)])
  };
}

// Which entry is the current screen (first match wins: bottom tabs come before "Mehr" entries)
function navActiveTab(items, activeModule, dashView) {
  for (var i = 0; i < items.length; i++) {
    var t = items[i];
    if (t.action) continue;
    if (!activeModule && t.id === 'heute') return 'heute';
    if (activeModule && t.mode === activeModule && (!t.view || t.view === dashView)) return t.id;
  }
  return null;
}

/* ── DOM ── */

var _navCurrent = { tabs: [], more: [] };

function navIcon(name) {
  return typeof uiIcon === 'function' ? uiIcon(name) : '';
}

function navPaint() {
  var bar = document.getElementById('w-tabbar');
  if (!bar) return;
  var user = typeof currentUser !== 'undefined' ? currentUser : null;
  if (!user) { bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('w-has-tabbar'); return; }
  _navCurrent = navTabs(userRole, moduleAllowedForRole, !!window.currentUserSeesInterest);
  var mod = typeof activeModule !== 'undefined' ? activeModule : null;
  var view = typeof dashView !== 'undefined' ? dashView : null;
  var active = navActiveTab(_navCurrent.tabs.concat(_navCurrent.more), mod, view);
  var inMore = active && !_navCurrent.tabs.some(function(t) { return t.id === active; });
  bar.innerHTML = _navCurrent.tabs.map(function(t) {
    var on = t.id === active || (inMore && t.id === 'mehr');
    return '<button type="button" class="w-tab' + (on ? ' on' : '') + '"' + (on ? ' aria-current="page"' : '') +
      ' onclick="navGo(\'' + t.id + '\')">' + navIcon(t.icon) + '<span>' + t.label + '</span></button>';
  }).join('');
  bar.hidden = false;
  document.body.classList.add('w-has-tabbar');
}

function navFind(id) {
  return _navCurrent.tabs.concat(_navCurrent.more).filter(function(t) { return t.id === id; })[0] || null;
}

function navGo(id) {
  var t = navFind(id);
  if (!t) return;
  closeMoreSheet();
  if (t.action) { if (typeof window[t.action] === 'function') window[t.action](); return; }
  if (!t.mode) { exitToMenu(); return; }
  if (activeModule === 'dashboard' && t.mode === 'dashboard' && typeof switchDashTab === 'function') switchDashTab(t.view);
  else selectMode(t.mode, t.view);
  navPaint();
}

var _navReturnFocus = null;

function openMoreSheet() {
  var m = document.getElementById('w-more');
  if (!m) return;
  var mod = typeof activeModule !== 'undefined' ? activeModule : null;
  var active = navActiveTab(_navCurrent.more, mod, typeof dashView !== 'undefined' ? dashView : null);
  m.querySelector('.w-more-list').innerHTML = _navCurrent.more.map(function(t) {
    return '<button type="button" class="w-more-item' + (t.id === active ? ' on' : '') + '" onclick="navGo(\'' + t.id + '\')">' +
      navIcon(t.icon) + '<span>' + t.label + '</span></button>';
  }).join('');
  _navReturnFocus = document.activeElement;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  var first = m.querySelector('button');
  if (first) first.focus();
}

function closeMoreSheet() {
  var m = document.getElementById('w-more');
  if (!m || !m.classList.contains('open')) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  if (_navReturnFocus && _navReturnFocus.focus) _navReturnFocus.focus();
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', function(e) {
    var m = document.getElementById('w-more');
    if (!m || !m.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeMoreSheet(); return; }
    if (e.key !== 'Tab') return;
    // keep focus inside the sheet
    var b = m.querySelectorAll('button');
    if (!b.length) return;
    var first = b[0], last = b[b.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NAV_ITEMS: NAV_ITEMS, NAV_ROLES: NAV_ROLES, navTabs: navTabs, navActiveTab: navActiveTab };
}
