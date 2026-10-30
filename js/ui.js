/* ══ Shared UI helpers for the redesign: icons, empty states, action menus, top bar menu ══
   Pure string builders are testable with node --test; open/close touch the DOM. */

var UI_ICONS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 12h6M9 16h4"/>',
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chart: '<path d="M5 20v-9M12 20V4M19 20v-6"/>',
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
  check: '<path d="M5 12l5 5 9-10"/>'
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
function uiComboHtml(id, value, placeholder, pickFn, arg) {
  return '<div class="ui-combo"><input type="text" id="' + uiEsc(id) + '" placeholder="' + uiEsc(placeholder || '') + '" autocomplete="off" autocapitalize="words" value="' + uiEsc(value) + '"' +
    ' data-pick="' + uiEsc(pickFn) + '" data-arg="' + uiEsc(arg) + '" />' +
    '<div class="combo-list ui-combo-list" style="display:none;"></div></div>';
}

function uiComboRender(inp) {
  var list = inp.parentNode.querySelector('.ui-combo-list');
  if (!list) return;
  var users = uiComboMatches(typeof appUsers !== 'undefined' ? appUsers : [], inp.value);
  list.innerHTML = users.length
    ? users.map(function(u) { return '<div class="combo-item" data-name="' + uiEsc(u.full_name || u.email || '') + '">' + uiEsc(u.full_name || u.email || '') + '</div>'; }).join('')
    : '<div class="combo-empty">Kein Treffer</div>';
  list.style.display = 'block';
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
  // mousedown fires before the input's blur, so taps on entries always land
  document.addEventListener('mousedown', function(e) {
    var item = e.target.closest && e.target.closest('.ui-combo .combo-item');
    if (!item) return;
    e.preventDefault();
    var inp = item.closest('.ui-combo').querySelector('input');
    inp.value = item.dataset.name;
    item.parentNode.style.display = 'none';
    uiComboCommit(inp, item.dataset.name);
  });
  document.addEventListener('focusout', function(e) {
    if (!(e.target.closest && e.target.closest('.ui-combo') && e.target.tagName === 'INPUT')) return;
    var inp = e.target;
    setTimeout(function() {
      var list = inp.parentNode && inp.parentNode.querySelector('.ui-combo-list');
      if (list) list.style.display = 'none';
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
  return own.concat([{ label: 'Optionen', action: 'openSettingsModal' }]);
}

function openTopbarMenu() {
  openUiMenu(topbarMenuItems(typeof activeModule !== 'undefined' ? activeModule : null));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UI_ICONS: UI_ICONS, uiIcon: uiIcon, uiEmptyHtml: uiEmptyHtml, uiMenuHtml: uiMenuHtml,
    UI_TOPBAR_ITEMS: UI_TOPBAR_ITEMS, topbarMenuItems: topbarMenuItems, uiComboMatches: uiComboMatches, uiComboHtml: uiComboHtml };
}
