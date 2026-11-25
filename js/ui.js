/* ══ Shared UI helpers for the redesign: icons, empty states, action menus, top bar menu ══
   Pure string builders are testable with node --test; open/close touch the DOM. */

var UI_ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 12h6M9 16h4"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chart: '<path d="M5 20v-9M12 20V4M19 20v-6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.8 3.5 6"/>',
  'chevron-left': '<path d="M15 6l-6 6 6 6"/>',
  'chevron-right': '<path d="M9 6l6 6-6 6"/>',
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 7"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 10l5-5 5 5M5 20h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  home: '<path d="M4 11l8-7 8 7v9H4zM10 20v-6h4v6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  alert: '<path d="M12 3l10 18H2zM12 10v5M12 18v.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17v.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'
};

function uiIcon(name) {
  return '<svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true">' + (UI_ICONS[name] || '') + '</svg>';
}

function uiEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A JS argument inside an onclick="…" attribute: numbers as they are, strings quoted and escaped
function uiArg(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '\'' + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '\'';
}

function uiEmptyHtml(title, text, actionHtml) {
  return '<div class="ui-empty"><div class="ui-empty-title">' + uiEsc(title) + '</div>' +
    (text ? '<div class="ui-sub">' + uiEsc(text) + '</div>' : '') + (actionHtml || '') + '</div>';
}

// items: [{label, action: 'functionName', args?: [...], danger?: bool}]
function uiMenuHtml(items) {
  return '<div class="ui-menu">' + (items || []).map(function(it) {
    var call = it.action + '(' + (it.args || []).map(uiArg).join(',') + ')';
    return '<button type="button" class="ui-btn ui-btn-block' + (it.danger ? ' ui-btn-danger' : '') + '" onclick="closeUiMenu();' + call + '">' +
      uiEsc(it.label) + '</button>';
  }).join('') +
    '<button type="button" class="ui-btn ui-btn-block ui-menu-cancel" onclick="closeUiMenu()">Abbrechen</button></div>';
}

function openUiMenu(items) {
  var m = document.getElementById('ui-menu-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'ui-menu-modal';
    m.className = 'sig-modal ui-sheet';
    m.style.setProperty('--sheet-w', '420px');
    m.innerHTML = '<div class="sig-modal-inner"></div>';
    m.addEventListener('click', function(e) { if (e.target === m) closeUiMenu(); });
    document.body.appendChild(m);
  }
  m.firstChild.innerHTML = uiMenuHtml(items);
  m.classList.add('open');
}

function closeUiMenu() {
  var m = document.getElementById('ui-menu-modal');
  if (m) m.classList.remove('open');
}

// ── Name combobox (same behaviour as the login picker; iOS shows nothing for <datalist>) ──

// Users whose full_name contains the query (case-insensitive), sorted by name; empty query = everyone
function uiComboMatches(users, query) {
  var q = String(query || '').toLowerCase().trim();
  return (users || []).filter(function(u) { return !q || (u.full_name || '').toLowerCase().includes(q); })
    .sort(function(a, b) {
      if (!a.full_name !== !b.full_name) return a.full_name ? -1 : 1; // nameless entries last
      return (a.full_name || '').localeCompare(b.full_name || '', 'de', { sensitivity: 'base' });
    });
}

// pickFn(arg, name) is a global function; called on a pick from the list and on a typed free name (on blur)
function uiComboHtml(id, value, placeholder, pickFn, arg, source) {
  return '<div class="ui-combo"><input type="text" id="' + uiEsc(id) + '" placeholder="' + uiEsc(placeholder || '') + '" autocomplete="off" autocapitalize="words" value="' + uiEsc(value) + '"' +
    ' role="combobox" aria-autocomplete="list" aria-expanded="false" data-pick="' + uiEsc(pickFn) + '" data-arg="' + uiEsc(arg) + '"' + (source ? ' data-source="' + uiEsc(source) + '"' : '') + ' />' +
    '<div class="combo-list ui-combo-list" role="listbox" style="display:none;"></div></div>';
}

// Keyboard handling as a pure helper: returns { index } (new highlight), { pick }, { close } or null
function uiComboKeyAction(key, index, count) {
  if (key === 'Escape') return { close: true };
  if (!count) return null;
  if (key === 'ArrowDown') return { index: index >= count - 1 ? 0 : index + 1 };
  if (key === 'ArrowUp') return { index: index <= 0 ? count - 1 : index - 1 };
  if (key === 'Enter') return index >= 0 && index < count ? { pick: index } : null;
  return null;
}

function uiComboClose(inp) {
  var list = inp.parentNode && inp.parentNode.querySelector('.ui-combo-list');
  if (list) list.style.display = 'none';
  inp.setAttribute('aria-expanded', 'false');
}

function uiComboRender(inp) {
  var list = inp.parentNode.querySelector('.ui-combo-list');
  if (!list) return;
  var src = inp.dataset.source ? window[inp.dataset.source] : (typeof appUsers !== 'undefined' ? appUsers : []);
  var users = uiComboMatches(src, inp.value);
  list.innerHTML = users.length
    ? users.map(function(u) { return '<div class="combo-item" role="option" data-name="' + uiEsc(u.full_name || u.email || '') + '">' + uiEsc(u.full_name || u.email || '') + '</div>'; }).join('')
    : '<div class="combo-empty">Kein Treffer</div>';
  list.style.display = 'block';
  inp.setAttribute('aria-expanded', 'true');
  // Keep the list in view above the on-screen keyboard
  if (list.scrollIntoView) list.scrollIntoView({ block: 'nearest' });
}

function uiComboCommit(inp, name) {
  var fn = window[inp.dataset.pick];
  var arg = /^\d+$/.test(inp.dataset.arg) ? parseInt(inp.dataset.arg, 10) : inp.dataset.arg;
  if (typeof fn === 'function') fn(arg, name);
}

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', function(e) {
    if (e.target.closest && e.target.closest('.ui-combo') && e.target.tagName === 'INPUT') uiComboRender(e.target);
  });
  document.addEventListener('input', function(e) {
    if (e.target.closest && e.target.closest('.ui-combo') && e.target.tagName === 'INPUT') uiComboRender(e.target);
  });
  // Tapping the already focused input (e.g. after a pick) reopens the list
  document.addEventListener('click', function(e) {
    if (e.target.closest && e.target.closest('.ui-combo') && e.target.tagName === 'INPUT') uiComboRender(e.target);
  });
  document.addEventListener('keydown', function(e) {
    var inp = e.target;
    if (!(inp.closest && inp.closest('.ui-combo') && inp.tagName === 'INPUT')) return;
    var list = inp.parentNode.querySelector('.ui-combo-list');
    var items = list ? list.querySelectorAll('.combo-item') : [];
    var open = list && list.style.display !== 'none';
    var cur = -1;
    for (var i = 0; i < items.length; i++) if (items[i].classList.contains('combo-active')) cur = i;
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { uiComboRender(inp); return; }
    if (!open) return;
    var act = uiComboKeyAction(e.key, cur, items.length);
    if (!act) return;
    e.preventDefault();
    if (act.close) { uiComboClose(inp); return; }
    if (act.pick !== undefined) {
      inp.value = items[act.pick].dataset.name;
      uiComboClose(inp);
      uiComboCommit(inp, items[act.pick].dataset.name);
      return;
    }
    for (var j = 0; j < items.length; j++) items[j].classList.toggle('combo-active', j === act.index);
    if (items[act.index].scrollIntoView) items[act.index].scrollIntoView({ block: 'nearest' });
  });
  // mousedown fires before the input's blur, so taps on entries always land
  document.addEventListener('mousedown', function(e) {
    var item = e.target.closest && e.target.closest('.ui-combo .combo-item');
    if (!item) return;
    e.preventDefault();
    var inp = item.closest('.ui-combo').querySelector('input');
    inp.value = item.dataset.name;
    uiComboClose(inp);
    uiComboCommit(inp, item.dataset.name);
  });
  document.addEventListener('focusout', function(e) {
    if (!(e.target.closest && e.target.closest('.ui-combo') && e.target.tagName === 'INPUT')) return;
    var inp = e.target;
    setTimeout(function() {
      uiComboClose(inp);
    }, 150);
  });
  // A name typed out as free text is committed on blur (a pick commits itself and re-renders the row)
  document.addEventListener('change', function(e) {
    if (e.target.closest && e.target.closest('.ui-combo') && e.target.tagName === 'INPUT') uiComboCommit(e.target, e.target.value);
  });
}

// Modules add their own top bar "…" entries: UI_TOPBAR_ITEMS[mode] = function() { return [items] }
var UI_TOPBAR_ITEMS = {};

function topbarMenuItems(mode) {
  var own = (mode && typeof UI_TOPBAR_ITEMS[mode] === 'function') ? (UI_TOPBAR_ITEMS[mode]() || []) : [];
  var role = typeof userRole !== 'undefined' ? userRole : null;
  if (role && role !== 'Gast') own = own.concat([{ label: 'PIN ändern', action: 'openPinChange' }]);
  if (['Admin', 'PL', 'AL'].includes(role)) own = own.concat([{ label: 'PIN zurücksetzen', action: 'openPinReset' }]);
  if (typeof viewAsIsAdmin === 'function' && viewAsIsAdmin()) own = own.concat([{ label: 'Ansicht als Rolle …', action: 'openViewAsMenu' }]);
  return own.concat([{ label: 'Optionen', action: 'openSettingsModal' }]);
}

function openTopbarMenu() {
  openUiMenu(topbarMenuItems(typeof activeModule !== 'undefined' ? activeModule : null));
}

// ── Double-tap guard ──
// An async action started by a tap (onclick/onsubmit) ignores the same tap (same function, same arguments) until it has
// finished: a double tap on "Speichern" on a phone no longer saves twice or runs into its own conflict check.
// Calls from code (not from a tap) and calls nested in the tap's handler pass straight through.
var _uiTapDepth = 0;
function uiGuardTap(fn, name, getEvent, maxMs) {
  var running = {};
  return function() {
    var ev = getEvent && getEvent();
    if (_uiTapDepth || !ev || (ev.type !== 'click' && ev.type !== 'submit')) return fn.apply(this, arguments);
    var key = name, el = ev.target && ev.target.closest ? ev.target.closest('button, [onclick], form') : null;
    try { key += JSON.stringify([].slice.call(arguments)); } catch (e) {}
    if (running[key]) return running[key];
    var p;
    _uiTapDepth++;
    try { p = fn.apply(this, arguments); } finally { _uiTapDepth--; }
    if (!p || typeof p.then !== 'function') return p;
    if (el && el.setAttribute) el.setAttribute('aria-busy', 'true');
    // safety: a promise that never settles must not lock the button for good
    var timer = setTimeout(done, maxMs || 60000);
    function done() { clearTimeout(timer); if (running[key] === p) delete running[key]; if (el && el.removeAttribute) el.removeAttribute('aria-busy'); }
    running[key] = p;
    p.then(done, done);
    return p;
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // After every script has run: wrap each global async function (they are the ones that save, load or delete)
  document.addEventListener('DOMContentLoaded', function() {
    Object.keys(window).forEach(function(k) {
      var f;
      try { f = window[k]; } catch (e) { return; }
      if (typeof f === 'function' && f.constructor && f.constructor.name === 'AsyncFunction' && !f._uiGuarded) {
        var g = uiGuardTap(f, k, function() { return window.event; });
        g._uiGuarded = true;
        window[k] = g;
      }
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { uiGuardTap: uiGuardTap, UI_ICONS: UI_ICONS, uiIcon: uiIcon, uiEmptyHtml: uiEmptyHtml, uiMenuHtml: uiMenuHtml,
    UI_TOPBAR_ITEMS: UI_TOPBAR_ITEMS, topbarMenuItems: topbarMenuItems, uiComboMatches: uiComboMatches, uiComboHtml: uiComboHtml, uiComboKeyAction: uiComboKeyAction };
}
