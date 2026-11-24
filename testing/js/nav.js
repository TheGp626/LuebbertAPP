/* ══ App frame: tabs by task, not by data type (rework 2026-11-24) ══
   Heute      – everything for today and on site (job, Aufbauplan, Material, Protokoll, to-dos)
   Plan       – the week (Meine Schichten, Ganze Woche, Planen)
   Unterlagen – Pläne, Ordner, Produkte in one place, switched by a segment on top
   Büro       – Protokolle, Personal (with Monatsabschluss), Admin; only PL, Admin, Buchhaltung
   Ich        – own hours + PDF, own protocols, Optionen, PIN, role switch
   No "Mehr" drawer: a section that is not a tab is a segment inside its tab. On a wide screen the bar is a sidebar.
   Pure part first (node --test tests/nav.test.js); every module entry still goes through selectMode() and
   moduleAllowedForRole() (auth.js). */

// Tabs. modes = modules that count as "in this tab"; hub = it has sections (NAV_HUBS)
var NAV_ITEMS = {
  heute: { id: 'heute', label: 'Heute', icon: 'home', modes: [null, 'protokoll'] },
  plan: { id: 'plan', label: 'Plan', icon: 'calendar', modes: ['wochenplan'], need: ['wochenplan'] },
  unterlagen: { id: 'unterlagen', label: 'Unterlagen', icon: 'folder', modes: ['ordner', 'produkte'], hub: 'unterlagen' },
  buero: { id: 'buero', label: 'Büro', icon: 'chart', modes: ['dashboard', 'admin'], hub: 'buero' },
  ich: { id: 'ich', label: 'Ich', icon: 'user', modes: ['stunden'], need: ['stunden'] }
};

// Sections of a hub tab, in order; the first allowed one opens on a tap on the tab
var NAV_HUBS = {
  unterlagen: [
    { id: 'plaene', label: 'Pläne', mode: 'ordner', view: 'plaene' },
    { id: 'ordner', label: 'Ordner', mode: 'ordner', view: 'ordner' },
    { id: 'produkte', label: 'Produkte', mode: 'produkte' }
  ],
  buero: [
    { id: 'protokolle', label: 'Protokolle', mode: 'dashboard', view: 'prot' },
    { id: 'personal', label: 'Personal', mode: 'dashboard', view: 'work' },
    { id: 'admin', label: 'Admin', mode: 'admin' }
  ]
};

var NAV_ROLES = {
  MA: ['heute', 'plan', 'unterlagen', 'ich'],
  AL: ['heute', 'plan', 'unterlagen', 'ich'],
  PL: ['heute', 'plan', 'unterlagen', 'buero', 'ich'],
  Admin: ['heute', 'plan', 'unterlagen', 'buero', 'ich'],
  Buchhaltung: ['heute', 'plan', 'unterlagen', 'buero', 'ich'],
  Gast: ['unterlagen']
};

function navHubSections(hub, role, allowed) {
  return (NAV_HUBS[hub] || []).filter(function(s) { return allowed(s.mode, role); }).map(function(s) { return Object.assign({}, s); });
}

// allowed = moduleAllowedForRole → { tabs: [...], more: [] } (more stays for older callers, always empty)
function navTabs(role, allowed) {
  var ids = NAV_ROLES[role] || NAV_ROLES.MA;
  var tabs = ids.filter(function(id) {
    var it = NAV_ITEMS[id];
    if (it.hub) return navHubSections(it.hub, role, allowed).length > 0;
    return !it.need || it.need.every(function(m) { return allowed(m, role); });
  }).map(function(id) {
    var t = Object.assign({}, NAV_ITEMS[id]);
    if (t.hub) t.sections = navHubSections(t.hub, role, allowed);
    return t;
  });
  return { tabs: tabs, more: [] };
}

// Tab of the current screen. An AL opening own protocols (dashboard) has no Büro tab: that counts as Ich.
function navActiveTab(tabs, activeModule) {
  var mod = activeModule || null;
  var hit = (tabs || []).filter(function(t) { return (t.modes || []).indexOf(mod) !== -1; })[0];
  if (hit) return hit.id;
  if (mod === 'dashboard' && (tabs || []).some(function(t) { return t.id === 'ich'; })) return 'ich';
  return null;
}

// Section of a hub that is showing (ordner: ordnerView, dashboard: dashView)
function navActiveSection(sections, activeModule, view) {
  var s = (sections || []).filter(function(x) { return x.mode === activeModule && (!x.view || x.view === view); })[0];
  return s ? s.id : null;
}

/* ── DOM ── */

var _navCurrent = { tabs: [], more: [] };

function navIcon(name) { return typeof uiIcon === 'function' ? uiIcon(name) : ''; }

function navWide() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
}

function navCurrentView(mod) {
  if (mod === 'ordner') return typeof ordnerView !== 'undefined' ? ordnerView : 'ordner';
  if (mod === 'dashboard') return typeof dashView !== 'undefined' ? dashView : null;
  return null;
}

function navPaint() {
  var bar = document.getElementById('w-tabbar');
  if (!bar) return;
  var user = typeof currentUser !== 'undefined' ? currentUser : null;
  if (!user) { bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('w-has-tabbar'); navHubPaint(null); return; }
  _navCurrent = navTabs(userRole, moduleAllowedForRole);
  var mod = typeof activeModule !== 'undefined' ? activeModule : null;
  var active = navActiveTab(_navCurrent.tabs, mod);
  // One tab only (Gast): no bar, the section segment on top is enough
  if (_navCurrent.tabs.length < 2) { bar.hidden = true; bar.innerHTML = ''; document.body.classList.remove('w-has-tabbar'); }
  else {
    bar.innerHTML = _navCurrent.tabs.map(function(t) {
      var on = t.id === active;
      return '<button type="button" class="w-tab' + (on ? ' on' : '') + '"' + (on ? ' aria-current="page"' : '') +
        ' onclick="navGo(\'' + t.id + '\')">' + navIcon(t.icon) + '<span>' + t.label + '</span></button>';
    }).join('');
    bar.hidden = false;
    document.body.classList.add('w-has-tabbar');
  }
  navHubPaint(_navCurrent.tabs.filter(function(t) { return t.id === active; })[0] || null);
}

// The section segment of a hub tab (Pläne | Ordner | Produkte, Protokolle | Personal | Admin) and the tab's name on top
function navHubPaint(tab) {
  var box = document.getElementById('w-hub');
  if (!box) return;
  var mod = typeof activeModule !== 'undefined' ? activeModule : null;
  var title = document.getElementById('topbar-title');
  if (tab && tab.id === 'ich') {
    if (title) title.textContent = mod === 'dashboard' ? 'Meine Protokolle' : 'Ich';
    var sub = document.getElementById('top-bar-sub');
    if (sub && mod === 'stunden') sub.textContent = '';
  }
  if (!tab || !tab.sections || tab.sections.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  if (title) title.textContent = tab.label;
  var cur = navActiveSection(tab.sections, mod, navCurrentView(mod));
  box.innerHTML = '<div class="ui-seg" role="tablist" aria-label="' + tab.label + '">' + tab.sections.map(function(s) {
    var on = s.id === cur;
    return '<button type="button" role="tab" class="' + (on ? 'active' : '') + '" aria-selected="' + on + '" onclick="navSection(\'' + tab.id + '\', \'' + s.id + '\')">' + s.label + '</button>';
  }).join('') + '</div>';
  box.hidden = false;
}

// Opens one target {mode, view}; switching inside the open module keeps its state where it can
function navOpen(t) {
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

function navGo(id) {
  var t = _navCurrent.tabs.filter(function(x) { return x.id === id; })[0];
  if (!t) return;
  if (id === 'heute') { exitToMenu(); navPaint(); return; }
  if (t.sections) {
    // Tapping the tab you are in goes back to its first section; otherwise open the first one
    return navOpen(t.sections[0]);
  }
  navOpen({ mode: t.modes[0] });
}

function navSection(tabId, sectionId) {
  var t = _navCurrent.tabs.filter(function(x) { return x.id === tabId; })[0];
  var s = t && (t.sections || []).filter(function(x) { return x.id === sectionId; })[0];
  if (s) navOpen(s);
}

// Kept for older callers (the drawer is gone)
function openMoreSheet() { navGo('ich'); }
function closeMoreSheet() {}

if (typeof window !== 'undefined' && window.matchMedia) {
  var _navMq = window.matchMedia('(min-width: 1024px)');
  var _navMqFn = function() { if (typeof navPaint === 'function') navPaint(); };
  if (_navMq.addEventListener) _navMq.addEventListener('change', _navMqFn); else if (_navMq.addListener) _navMq.addListener(_navMqFn);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NAV_ITEMS: NAV_ITEMS, NAV_HUBS: NAV_HUBS, NAV_ROLES: NAV_ROLES, navTabs: navTabs, navActiveTab: navActiveTab,
    navActiveSection: navActiveSection, navHubSections: navHubSections };
}
