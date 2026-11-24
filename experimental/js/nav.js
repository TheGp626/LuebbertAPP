/* ══ Werkstatt app frame: bottom tab bar + "Mehr" sheet ══
   Pure part first (role → tabs, testable with node --test); the DOM part follows below.
   Every module entry still goes through selectMode() and moduleAllowedForRole() (auth.js). */

// All destinations. mode null = Heute (start page). action = a global function instead of a module.
var NAV_ITEMS = {
  heute: { id: 'heute', label: 'Heute', icon: 'home', mode: null },
  plan: { id: 'plan', label: 'Plan', icon: 'calendar', mode: 'wochenplan' },
  zettel: { id: 'zettel', label: 'Stunden', icon: 'clock', mode: 'stunden' },
  protokoll: { id: 'protokoll', label: 'Protokoll', icon: 'clipboard', mode: 'protokoll' },
  protokolle: { id: 'protokolle', label: 'Protokolle', icon: 'clipboard', mode: 'dashboard', view: 'prot' },
  uebersicht: { id: 'uebersicht', label: 'Übersicht', icon: 'clipboard', mode: 'dashboard', view: 'prot' },
  personal: { id: 'personal', label: 'Personal', icon: 'chart', mode: 'dashboard', view: 'work' },
  auftraege: { id: 'auftraege', label: 'Aufträge', icon: 'file', mode: 'auftraege' },
  produkte: { id: 'produkte', label: 'Produkte', icon: 'box', mode: 'produkte' },
  ordner: { id: 'ordner', label: 'Ordner', icon: 'folder', mode: 'ordner', view: 'ordner' },
  plaene: { id: 'plaene', label: 'Pläne', icon: 'file', mode: 'ordner', view: 'plaene' },
  // Admin page (js/admin.js): Übersicht, Einstellungen, Fehlerberichte
  admin: { id: 'admin', label: 'Admin', icon: 'shield', mode: 'admin' },
  optionen: { id: 'optionen', label: 'Optionen', icon: 'user', mode: null, action: 'openSettingsModal' },
  problem: { id: 'problem', label: 'Problem melden', icon: 'help', mode: null, action: 'openProblemForm' },
  mehr: { id: 'mehr', label: 'Mehr', icon: 'menu', mode: null, action: 'openMoreSheet' }
};

// Default bottom tabs and "Mehr" per role. Users can pin their own. No Aufträge tab since 2026-11-24: an Auftragsbestätigung
// goes straight into the Wochenplan (Hochladen → Auftragsbestätigung), staffing happens on the plan entry (Planen).
var NAV_ROLES = {
  MA: { tabs: ['heute', 'plan', 'zettel'], more: ['produkte', 'ordner', 'plaene'] },
  AL: { tabs: ['heute', 'plan', 'protokoll', 'zettel', 'uebersicht'], more: ['personal', 'produkte', 'ordner', 'plaene'] },
  PL: { tabs: ['heute', 'plan', 'protokolle', 'personal', 'ordner'], more: ['zettel', 'produkte', 'plaene'] },
  Admin: { tabs: ['heute', 'plan', 'protokolle', 'personal', 'ordner'], more: ['admin', 'zettel', 'produkte', 'plaene'] },
  Buchhaltung: { tabs: ['heute', 'protokolle', 'personal'], more: ['plan', 'zettel', 'produkte', 'ordner', 'plaene'] },
  Gast: { tabs: ['produkte', 'ordner', 'plaene'], more: [] }
};

var NAV_MAX_TABS = 5; // page tabs in the bar (plus "Mehr") — fits a 360px phone

// allowed = moduleAllowedForRole; seesInterest stands in for window.currentUserSeesInterest (Aufträge for planners)
// pinned = the user's own tab choice (ids, in order) or null for the role default
function navTabs(role, allowed, seesInterest, pinned) {
  var cfg = NAV_ROLES[role] || NAV_ROLES.MA;
  var ok = function(id) {
    var it = NAV_ITEMS[id];
    if (!it || it.action) return false;
    if (!it.mode) return true;
    if (it.mode === 'auftraege') return allowed('auftraege', role) || !!seesInterest;
    return allowed(it.mode, role);
  };
  var copy = function(id) { return Object.assign({}, NAV_ITEMS[id]); };
  if (role === 'Gast') return { tabs: cfg.tabs.filter(ok).map(copy), more: [] };
  var all = cfg.tabs.concat(cfg.more).filter(ok);
  var tabIds = all.filter(function(id) { return cfg.tabs.indexOf(id) >= 0; });
  if (Array.isArray(pinned)) {
    var mine = pinned.filter(function(id, i) { return all.indexOf(id) >= 0 && pinned.indexOf(id) === i; }).slice(0, NAV_MAX_TABS);
    if (mine.length) tabIds = mine;
  }
  return {
    tabs: tabIds.map(copy).concat([copy('mehr')]),
    more: all.filter(function(id) { return tabIds.indexOf(id) < 0; }).map(copy).concat([copy('optionen'), copy('problem')])
  };
}

// Pin (add to the bar) or unpin an entry. Returns the new id list, or null if not possible (bar full / last tab).
function navTogglePin(tabIds, id) {
  var ids = tabIds.filter(function(x) { return x !== 'mehr'; });
  var at = ids.indexOf(id);
  if (at >= 0) { if (ids.length <= 1) return null; ids.splice(at, 1); return ids; }
  if (ids.length >= NAV_MAX_TABS) return null;
  return ids.concat([id]);
}

// Sidebar (wide screens): all pages as entries, the action entries stay behind "Mehr"
function navWideTabs(cur) {
  var pages = cur.tabs.filter(function(t) { return t.id !== 'mehr'; }).concat(cur.more.filter(function(t) { return !t.action; }));
  var mehr = cur.tabs.filter(function(t) { return t.id === 'mehr'; });
  return { tabs: pages.concat(mehr), more: cur.more.filter(function(t) { return t.action; }) };
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

function navPinKey() {
  var u = typeof currentUser !== 'undefined' && currentUser ? (currentUser.id || currentUser.name || '') : '';
  return 'w_nav_tabs_' + userRole + '_' + u;
}
function navLoadPinned() {
  try { var v = JSON.parse(localStorage.getItem(navPinKey()) || 'null'); return Array.isArray(v) ? v : null; } catch (e) { return null; }
}
function navSavePinned(ids) {
  try { if (ids) localStorage.setItem(navPinKey(), JSON.stringify(ids)); else localStorage.removeItem(navPinKey()); } catch (e) { /* private mode: choice lasts this session */ }
  _navSessionPinned = ids;
}
var _navSessionPinned = null;

function navIcon(name) {
  return typeof uiIcon === 'function' ? uiIcon(name) : '';
}

function navPaint() {
  var bar = document.getElementById('w-tabbar');
  if (!bar) return;
  var user = typeof currentUser !== 'undefined' ? currentUser : null;
  if (!user) { bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('w-has-tabbar'); return; }
  _navCurrent = navTabs(userRole, moduleAllowedForRole, !!window.currentUserSeesInterest, navLoadPinned() || _navSessionPinned);
  // Wide screen: the bar is a sidebar with room for every page, "Mehr" keeps only Optionen and Problem melden
  if (navWide()) _navCurrent = navWideTabs(_navCurrent);
  var mod = typeof activeModule !== 'undefined' ? activeModule : null;
  var view = navCurrentView(mod);
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

function navWide() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
}

function navCurrentView(mod) {
  if (mod === 'ordner') return typeof ordnerView !== 'undefined' ? ordnerView : 'ordner';
  return typeof dashView !== 'undefined' ? dashView : null;
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
  else if (activeModule === 'ordner' && t.mode === 'ordner' && typeof setOrdnerView === 'function') {
    if (typeof closeOrdnerDetail === 'function' && typeof aktuellerOrdner !== 'undefined' && aktuellerOrdner) closeOrdnerDetail();
    setOrdnerView(t.view);
  }
  else if (t.mode === 'ordner') { window.ordnerStartView = t.view; selectMode(t.mode); }
  else selectMode(t.mode, t.view);
  navPaint();
}

var _navReturnFocus = null;

function navSheetHtml() {
  var mod = typeof activeModule !== 'undefined' ? activeModule : null;
  var active = navActiveTab(_navCurrent.tabs.concat(_navCurrent.more), mod, navCurrentView(mod));
  var inBar = _navCurrent.tabs.filter(function(t) { return t.id !== 'mehr'; });
  var full = inBar.length >= NAV_MAX_TABS;
  var row = function(t, pin) {
    var btn = '';
    if (pin === 'out') btn = '<button type="button" class="w-pin on" aria-label="' + t.label + ' aus der Leiste nehmen"' + (inBar.length <= 1 ? ' disabled' : '') +
      ' onclick="navPin(\'' + t.id + '\')">− Leiste</button>';
    else if (pin === 'in') btn = '<button type="button" class="w-pin" aria-label="' + t.label + ' in die Leiste legen"' + (full ? ' disabled title="Leiste voll – erst etwas rausnehmen"' : '') +
      ' onclick="navPin(\'' + t.id + '\')">+ Leiste</button>';
    return '<div class="w-more-row"><button type="button" class="w-more-item' + (t.id === active ? ' on' : '') + '" onclick="navGo(\'' + t.id + '\')">' +
      navIcon(t.icon) + '<span>' + t.label + '</span></button>' + btn + '</div>';
  };
  if (navWide()) return _navCurrent.more.map(function(t) { return row(t, null); }).join(''); // sidebar holds every page, nothing to pin
  var pages = _navCurrent.more.filter(function(t) { return !t.action; });
  var extras = _navCurrent.more.filter(function(t) { return t.action; });
  var h = pages.map(function(t) { return row(t, 'in'); }).join('');
  h += extras.map(function(t) { return row(t, null); }).join('');
  h += '<div class="w-label">Unten in der Leiste</div>';
  h += inBar.map(function(t) { return row(t, 'out'); }).join('');
  h += '<p class="w-more-hint">' + (full ? 'Leiste ist voll (' + NAV_MAX_TABS + '). Nimm erst etwas raus, um Platz zu machen.' :
    'Mit „+ Leiste“ liegt eine Seite direkt unten – ohne „Mehr“.') +
    ' <button type="button" class="w-more-reset" onclick="navResetPins()">Standard</button></p>';
  return h;
}

function navPin(id) {
  var ids = navTogglePin(_navCurrent.tabs.map(function(t) { return t.id; }), id);
  if (!ids) return;
  navSavePinned(ids);
  navPaint();
  navRefreshSheet();
}

function navResetPins() {
  navSavePinned(null);
  navPaint();
  navRefreshSheet();
}

function navRefreshSheet() {
  var m = document.getElementById('w-more');
  if (m && m.classList.contains('open')) m.querySelector('.w-more-list').innerHTML = navSheetHtml();
}

function openMoreSheet() {
  var m = document.getElementById('w-more');
  if (!m) return;
  m.querySelector('.w-more-list').innerHTML = navSheetHtml();
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

if (typeof window !== 'undefined' && window.matchMedia) {
  var _navMq = window.matchMedia('(min-width: 1024px)');
  var _navMqFn = function() { if (typeof navPaint === 'function') navPaint(); };
  if (_navMq.addEventListener) _navMq.addEventListener('change', _navMqFn); else if (_navMq.addListener) _navMq.addListener(_navMqFn);
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', function(e) {
    var m = document.getElementById('w-more');
    if (!m || !m.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeMoreSheet(); return; }
    if (e.key !== 'Tab') return;
    // keep focus inside the sheet
    var b = m.querySelectorAll('button:not([disabled])');
    if (!b.length) return;
    var first = b[0], last = b[b.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NAV_ITEMS: NAV_ITEMS, NAV_ROLES: NAV_ROLES, NAV_MAX_TABS: NAV_MAX_TABS, navTabs: navTabs, navActiveTab: navActiveTab, navTogglePin: navTogglePin, navWideTabs: navWideTabs };
}
