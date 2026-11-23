/* ══ Admin page (/admin, Admin role only): Übersicht with key figures, Einstellungen, Fehlerberichte ══
   The settings form lives in js/settings.js, the error list in js/fehler.js; this file owns the page,
   the #admin route and the statistics. Pure helpers first (tests/admin.test.js), DOM part below. */

var ADMIN_TABS = ['stats', 'settings', 'errors'];
var ADMIN_TAB_TITLES = { stats: 'Übersicht', settings: 'Einstellungen', errors: 'Fehlerberichte' };
var ADMIN_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
var ADMIN_MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

// '#admin' or '#admin/settings' → tab name, anything else → null
function adminTabFromHash(hash) {
  var m = /^#admin(?:\/(\w+))?$/.exec(String(hash || ''));
  if (!m) return null;
  return ADMIN_TABS.indexOf(m[1]) !== -1 ? m[1] : 'stats';
}

function adminHashFor(tab) { return tab && tab !== 'stats' ? '#admin/' + tab : '#admin'; }

// Day a shift belongs to: protocol date → shift_date → creation day (same rule as the dashboard)
function adminShiftDate(s) {
  return (s && s.protocols && s.protocols.date) || (s && s.shift_date) || String((s && s.created_at) || '').slice(0, 10);
}

function _adminMins(t) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Billed hours of one shift: end − start − pause, over midnight allowed, 3 h minimum (as in the Stundenzettel)
function adminShiftHours(s) {
  var v = _adminMins(s && s.start_time), b = _adminMins(s && s.end_time);
  if (v === null || b === null) return 0;
  if (b <= v) b += 1440;
  return Math.max(180, b - v - (parseInt(s.pause_mins, 10) || 0)) / 60;
}

function adminMonthKey(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); }

function adminMonthLabel(key, short) {
  var p = String(key).split('-');
  return (short ? ADMIN_MONTHS_SHORT : ADMIN_MONTHS)[parseInt(p[1], 10) - 1] + (short ? '' : ' ' + p[0]);
}

// Change in % (rounded), null when there is nothing to compare with
function adminDelta(now, before) {
  if (!before) return null;
  return Math.round((now - before) / before * 100);
}

// "MA Minijob" / "AL fest" → "MA" / "AL"; agencies and free text stay as they are
function adminRoleOf(s) {
  var r = String((s && s.position_role) || '').trim();
  if (!r) return 'Ohne Funktion';
  var first = r.split(/\s+/)[0];
  return ['MA', 'AL', 'Fahrer'].indexOf(first) !== -1 ? first : r;
}

// All numbers of the Übersicht. shifts: rows with user_id, temp_worker_name, position_role, times, status,
// shift_date, created_at, protocols{date}; protocols: rows with date; users: active app_users (id, full_name).
function adminStats(shifts, protocols, users, now) {
  shifts = shifts || []; protocols = protocols || []; users = users || [];
  var thisKey = adminMonthKey(now);
  var lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var lastKey = adminMonthKey(lastDate);
  var day = now.getDate();
  var names = {};
  users.forEach(function(u) { names[u.id] = u.full_name || 'Unbekannt'; });

  var months = [];
  for (var i = 11; i >= 0; i--) {
    var k = adminMonthKey(new Date(now.getFullYear(), now.getMonth() - i, 1));
    months.push({ key: k, label: adminMonthLabel(k, true), count: 0, hours: 0, current: k === thisKey });
  }
  var byMonth = {};
  months.forEach(function(m) { byMonth[m.key] = m; });

  var out = { total: shifts.length, thisMonth: 0, lastMonth: 0, lastMonthToDate: 0, hoursThis: 0, hoursLast: 0,
    hoursTotal: 0, open: 0, peopleThis: 0, peopleLast: 0, agencyThis: 0, protTotal: protocols.length, protThis: 0, protLast: 0,
    thisKey: thisKey, lastKey: lastKey, day: day, months: months, topPeople: [], byRole: [], weekdays: [0, 0, 0, 0, 0, 0, 0] };
  var peopleThis = {}, peopleLast = {}, perPerson = {}, perRole = {};

  shifts.forEach(function(s) {
    var d = adminShiftDate(s), key = d.slice(0, 7), h = adminShiftHours(s);
    out.hoursTotal += h;
    if (s.status === 'offen') out.open++;
    if (byMonth[key]) { byMonth[key].count++; byMonth[key].hours += h; }
    if (key === thisKey) {
      out.thisMonth++; out.hoursThis += h;
      if (s.user_id) {
        peopleThis[s.user_id] = true;
        var p = perPerson[s.user_id] || (perPerson[s.user_id] = { id: s.user_id, name: names[s.user_id] || 'Unbekannt', count: 0, hours: 0 });
        p.count++; p.hours += h;
      } else out.agencyThis++;
      var r = adminRoleOf(s);
      perRole[r] = (perRole[r] || 0) + 1;
      var wd = new Date(d + 'T12:00:00').getDay();
      if (!isNaN(wd)) out.weekdays[(wd + 6) % 7]++; // Mo = 0
    } else if (key === lastKey) {
      out.lastMonth++; out.hoursLast += h;
      if (parseInt(d.slice(8, 10), 10) <= day) out.lastMonthToDate++;
      if (s.user_id) peopleLast[s.user_id] = true;
    }
  });
  protocols.forEach(function(p) {
    var key = String(p.date || '').slice(0, 7);
    if (key === thisKey) out.protThis++;
    else if (key === lastKey) out.protLast++;
  });
  out.peopleThis = Object.keys(peopleThis).length;
  out.peopleLast = Object.keys(peopleLast).length;
  out.topPeople = Object.keys(perPerson).map(function(id) { return perPerson[id]; })
    .sort(function(a, b) { return b.count - a.count || b.hours - a.hours || a.name.localeCompare(b.name, 'de'); }).slice(0, 5);
  out.byRole = Object.keys(perRole).map(function(r) { return { role: r, count: perRole[r] }; })
    .sort(function(a, b) { return b.count - a.count || a.role.localeCompare(b.role, 'de'); });
  // Fold everything past the 5th role into "Sonstige" so the list stays short
  if (out.byRole.length > 6) {
    var rest = out.byRole.slice(5).reduce(function(n, r) { return n + r.count; }, 0);
    out.byRole = out.byRole.slice(0, 5).concat([{ role: 'Sonstige', count: rest }]);
  }
  out.deltaToDate = adminDelta(out.thisMonth, out.lastMonthToDate);
  return out;
}

function adminFmtNum(n, digits) {
  return Number(n || 0).toLocaleString('de-DE', { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
}

/* ── DOM part (browser only) ── */

var _admin = { tab: 'stats', data: null, st: null, loading: false, errorsNew: 0 };

function _adminIsAdmin() { return typeof userRole !== 'undefined' && userRole === 'Admin'; }

// Called by selectMode('admin'); the tab comes from the URL (#admin/settings) or stays as it was
function initAdmin(tab) {
  if (!_adminIsAdmin()) return;
  switchAdminTab(tab || adminTabFromHash(location.hash) || _admin.tab || 'stats');
  if (typeof loadErrorsBadge === 'function') loadErrorsBadge();
}

function switchAdminTab(tab) {
  if (ADMIN_TABS.indexOf(tab) === -1) tab = 'stats';
  if (typeof breadcrumb === 'function') breadcrumb('admin:' + tab);
  _admin.tab = tab;
  ADMIN_TABS.forEach(function(t) {
    var b = document.getElementById('admin-tab-' + t), v = document.getElementById('admin-view-' + t);
    if (b) { b.classList.toggle('active', t === tab); b.setAttribute('aria-selected', t === tab ? 'true' : 'false'); }
    if (v) v.hidden = t !== tab;
  });
  adminSetHash(tab);
  var sub = document.getElementById('top-bar-sub');
  if (sub && typeof activeModule !== 'undefined' && activeModule === 'admin') sub.textContent = ADMIN_TAB_TITLES[tab];
  if (tab === 'stats') renderAdminStats();
  if (tab === 'settings' && typeof renderSettingsTab === 'function') renderSettingsTab();
  if (tab === 'errors' && typeof renderErrorsTab === 'function') renderErrorsTab();
}

// Keeps the address bar on /#admin… while the page is open (bookmarkable), without a history entry per tab
function adminSetHash(tab) {
  if (typeof history === 'undefined' || !history.replaceState) return;
  var want = tab === null ? '' : adminHashFor(tab);
  if (location.hash === want || (!want && !location.hash)) return;
  history.replaceState(null, '', location.pathname + location.search + want);
}

// Fehler badge on the tab and the start tile (fehler.js reports the count)
function adminSetErrorsBadge(n) {
  _admin.errorsNew = n || 0;
  var tab = document.getElementById('admin-tab-errors');
  if (tab) tab.innerHTML = 'Fehler' + (n ? ' <span class="fehler-count">' + n + '</span>' : '');
  var tile = document.getElementById('btn-select-admin');
  if (tile) {
    var dot = tile.querySelector('.admin-tile-badge');
    if (n && !dot) tile.insertAdjacentHTML('beforeend', '<span class="admin-tile-badge" aria-label="' + n + ' neue Fehler">' + n + '</span>');
    else if (dot && n) dot.textContent = n;
    else if (dot) dot.remove();
  }
  var sys = document.getElementById('admin-sys-errors');
  if (sys) sys.textContent = n ? n + ' neu' : 'keine neuen';
}

async function loadAdminData(force) {
  if (_admin.loading) return;
  if (_admin.data && !force && Date.now() - _admin.data.at < 60000) return;
  _admin.loading = true;
  try {
    var res = await Promise.all([
      sbFetchAll(function() {
        return supabaseClient.from('shifts')
          .select('id, user_id, temp_worker_name, position_role, start_time, end_time, pause_mins, status, shift_date, created_at, protocols(date)')
          .order('id');
      }),
      sbFetchAll(function() { return supabaseClient.from('protocols').select('id, date').order('id'); }),
      supabaseClient.from('app_users').select('id, full_name, role, is_active').eq('is_active', true)
    ]);
    var err = res[0].error || res[1].error || res[2].error;
    if (err) throw err;
    _admin.data = { at: Date.now(), shifts: res[0].data, protocols: res[1].data, users: res[2].data || [] };
  } finally {
    _admin.loading = false;
  }
}

async function renderAdminStats(force) {
  var box = document.getElementById('admin-view-stats');
  if (!box) return;
  if (!_admin.data) box.innerHTML = adminSkeletonHtml();
  try {
    await loadAdminData(force);
  } catch (e) {
    console.error('Admin-Statistik laden:', e);
    if (!_admin.data) {
      box.innerHTML = '<div class="ui-card admin-fail"><b>Zahlen konnten nicht geladen werden.</b>' +
        '<div class="ui-sub">Prüf die Verbindung und versuch es erneut.</div>' +
        '<button type="button" class="ui-btn" onclick="renderAdminStats(true)">Erneut laden</button></div>';
      return;
    }
  }
  if (_admin.tab !== 'stats' || !_admin.data) return;
  var st = _admin.st = adminStats(_admin.data.shifts, _admin.data.protocols, _admin.data.users, new Date());
  box.innerHTML = adminStatsHtml(st, _admin.data);
  adminBindChart(box);
}

function adminSkeletonHtml() {
  return '<div class="admin-hero admin-skel"><div></div><div></div></div>' +
    '<div class="admin-kpis">' + [1, 2, 3, 4].map(function() { return '<div class="admin-kpi admin-skel"><div></div><div></div></div>'; }).join('') + '</div>' +
    '<div class="admin-card admin-skel" style="height:240px;"></div>';
}

function _adminDeltaHtml(delta, versus) {
  if (delta === null) return '<span class="admin-delta">' + escapeHtml(versus) + '</span>';
  var cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  var arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '●';
  return '<span class="admin-delta admin-delta-' + cls + '"><b>' + arrow + ' ' + (delta > 0 ? '+' : '') + delta + ' %</b> ' + escapeHtml(versus) + '</span>';
}

function adminStatsHtml(st, data) {
  var monthName = ADMIN_MONTHS[parseInt(st.thisKey.slice(5), 10) - 1];
  var lastName = ADMIN_MONTHS[parseInt(st.lastKey.slice(5), 10) - 1];
  var updated = new Date(data.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  var hero = '<section class="admin-hero">' +
    '<div class="admin-hero-main">' +
      '<div class="admin-eyebrow">Schichten im ' + monthName + '</div>' +
      '<div class="admin-big">' + adminFmtNum(st.thisMonth) + '</div>' +
      _adminDeltaHtml(st.deltaToDate, 'ggü. ' + lastName + ' bis zum ' + st.day + '.') +
    '</div>' +
    '<div class="admin-hero-side">' +
      '<div><span>Stunden</span><b>' + adminFmtNum(st.hoursThis) + '</b></div>' +
      '<div><span>Leute im Einsatz</span><b>' + st.peopleThis + '</b></div>' +
      '<div><span>Protokolle</span><b>' + st.protThis + '</b></div>' +
    '</div></section>';

  var kpi = function(label, value, sub, onclick) {
    return '<div class="admin-kpi"' + (onclick ? ' role="button" tabindex="0" onclick="' + onclick + '"' : '') + '><span>' + escapeHtml(label) + '</span><b>' + value + '</b>' +
      (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  };
  var kpis = '<div class="admin-kpis">' +
    kpi('Schichten gesamt', adminFmtNum(st.total), adminFmtNum(st.hoursTotal) + ' Stunden seit Start') +
    kpi('Letzter Monat', adminFmtNum(st.lastMonth), escapeHtml(lastName) + ' · ' + adminFmtNum(st.hoursLast) + ' h · ' + st.peopleLast + ' Leute') +
    kpi('Protokolle gesamt', adminFmtNum(st.protTotal), st.protLast + ' im ' + escapeHtml(lastName)) +
    kpi('Noch nicht verbucht', adminFmtNum(st.open), st.open ? 'Schichten mit Status „offen“' : 'alles verbucht') +
    '</div>';

  // ── Bars: shifts per month, last 12 months ──
  var max = Math.max.apply(null, st.months.map(function(m) { return m.count; }).concat([1]));
  var peak = st.months.reduce(function(a, m) { return m.count > a.count ? m : a; }, st.months[0]);
  var bars = st.months.map(function(m, i) {
    var h = m.count ? Math.max(3, Math.round(m.count / max * 100)) : 0;
    var showVal = m.current || (m === peak && m.count > 0);
    return '<div class="admin-col' + (m.current ? ' admin-col-now' : '') + '" tabindex="0" data-i="' + i + '" aria-label="' +
        escapeHtml(adminMonthLabel(m.key) + ': ' + m.count + ' Schichten, ' + adminFmtNum(m.hours) + ' Stunden') + '">' +
      '<div class="admin-col-track"><div class="admin-col-bar" style="height:' + h + '%">' +
        (showVal ? '<span class="admin-col-val">' + m.count + '</span>' : '') + '</div></div>' +
      '<div class="admin-col-lbl">' + escapeHtml(m.label) + '</div></div>';
  }).join('');
  var table = '<details class="admin-table"><summary>Als Tabelle</summary><table class="ui-table"><thead><tr><th>Monat</th><th>Schichten</th><th>Stunden</th></tr></thead><tbody>' +
    st.months.slice().reverse().map(function(m) {
      return '<tr><td>' + escapeHtml(adminMonthLabel(m.key)) + '</td><td>' + m.count + '</td><td>' + adminFmtNum(m.hours) + '</td></tr>';
    }).join('') + '</tbody></table></details>';
  var chart = '<section class="admin-card">' +
    '<div class="admin-card-head"><h3>Schichten pro Monat</h3><span class="ui-sub">letzte 12 Monate · ' + escapeHtml(monthName) + ' läuft noch</span></div>' +
    '<div class="admin-chart" id="admin-chart">' + bars + '<div class="admin-tip" id="admin-tip" hidden></div></div>' + table + '</section>';

  // ── Ranked lists ──
  var listHtml = function(rows, labelOf, valueOf, subOf) {
    var top = Math.max.apply(null, rows.map(valueOf).concat([1]));
    return rows.map(function(r, i) {
      return '<div class="admin-rank"><span class="admin-rank-n">' + (i + 1) + '</span>' +
        '<div class="admin-rank-body"><div class="admin-rank-row"><span class="admin-rank-name">' + escapeHtml(labelOf(r)) + '</span>' +
        '<span class="admin-rank-val">' + valueOf(r) + (subOf ? '<small> ' + subOf(r) + '</small>' : '') + '</span></div>' +
        '<div class="admin-rank-bar"><i style="width:' + Math.max(2, Math.round(valueOf(r) / top * 100)) + '%"></i></div></div></div>';
    }).join('');
  };
  var empty = '<div class="ui-sub admin-empty">Noch keine Schichten im ' + escapeHtml(monthName) + '.</div>';
  var people = '<section class="admin-card"><div class="admin-card-head"><h3>Meiste Schichten</h3><span class="ui-sub">' + escapeHtml(monthName) + '</span></div>' +
    (st.topPeople.length ? listHtml(st.topPeople, function(p) { return p.name; }, function(p) { return p.count; }, function(p) { return '· ' + adminFmtNum(p.hours) + ' h'; }) : empty) + '</section>';
  var roles = '<section class="admin-card"><div class="admin-card-head"><h3>Nach Funktion</h3><span class="ui-sub">' + escapeHtml(monthName) +
    (st.agencyThis ? ' · ' + st.agencyThis + ' ohne App-Konto' : '') + '</span></div>' +
    (st.byRole.length ? listHtml(st.byRole, function(r) { return r.role; }, function(r) { return r.count; }) : empty) + '</section>';

  // ── Weekdays (this month) ──
  var wdMax = Math.max.apply(null, st.weekdays.concat([1]));
  var wd = '<section class="admin-card"><div class="admin-card-head"><h3>Wochentage</h3><span class="ui-sub">' + escapeHtml(monthName) + '</span></div><div class="admin-week">' +
    ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(function(n, i) {
      var c = st.weekdays[i], a = c ? 0.15 + 0.85 * c / wdMax : 0;
      return '<div class="admin-wd" title="' + n + ': ' + c + ' Schichten"><div class="admin-wd-cell' + (a > 0.55 ? ' admin-wd-strong' : '') + '" style="--a:' + a.toFixed(2) + '"><b>' + c + '</b></div><span>' + n + '</span></div>';
    }).join('') + '</div></section>';

  // ── System ──
  var meta = (typeof _appSettingsMeta !== 'undefined' && _appSettingsMeta) ? _appSettingsMeta : null;
  var who = meta && meta.updated_by && typeof allUsers !== 'undefined' ? (allUsers.find(function(u) { return u.id === meta.updated_by; }) || {}).full_name : null;
  var version = typeof getAppVersion === 'function' ? getAppVersion() : '–';
  var sys = '<section class="admin-card admin-sys"><div class="admin-card-head"><h3>System</h3></div>' +
    '<button type="button" class="admin-sys-row" onclick="switchAdminTab(\'errors\')"><span>Fehlerberichte</span><b id="admin-sys-errors">' + (_admin.errorsNew ? _admin.errorsNew + ' neu' : 'keine neuen') + '</b>' + uiIcon('chevron-right') + '</button>' +
    '<button type="button" class="admin-sys-row" onclick="switchAdminTab(\'settings\')"><span>Einstellungen</span><b>' +
      (meta ? 'geändert ' + new Date(meta.updated_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + (who ? ' von ' + escapeHtml(firstName(who)) : '') : 'öffnen') + '</b>' + uiIcon('chevron-right') + '</button>' +
    '<div class="admin-sys-row"><span>Aktive Konten</span><b>' + data.users.length + '</b></div>' +
    (version && version !== '?' ? '<div class="admin-sys-row"><span>App-Version</span><b>' + escapeHtml(version) + '</b></div>' : '') + '</section>';

  return hero + kpis + chart +
    '<div class="admin-grid">' + people + roles + '</div>' +
    '<div class="admin-grid">' + wd + sys + '</div>' +
    '<div class="admin-foot ui-sub">Stand ' + updated + ' Uhr · <button type="button" class="ord-textbtn" onclick="renderAdminStats(true)">Aktualisieren</button></div>';
}

// Tooltip for the month bars: hover on desktop, tap or focus on the phone
function adminBindChart(box) {
  var chart = box.querySelector('#admin-chart'), tip = box.querySelector('#admin-tip');
  var st = _admin.st;
  if (!chart || !tip || !st) return;
  var show = function(col) {
    var m = st.months[+col.dataset.i];
    if (!m) return;
    chart.querySelectorAll('.admin-col').forEach(function(c) { c.classList.toggle('admin-col-hot', c === col); });
    tip.innerHTML = '<b>' + escapeHtml(adminMonthLabel(m.key)) + '</b><span>' + m.count + ' Schichten</span><span>' + adminFmtNum(m.hours) + ' Stunden</span>';
    tip.hidden = false;
    var cr = chart.getBoundingClientRect(), r = col.getBoundingClientRect();
    var x = r.left - cr.left + r.width / 2, w = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(x - w / 2, 0), cr.width - w) + 'px';
  };
  var hide = function() { tip.hidden = true; chart.querySelectorAll('.admin-col-hot').forEach(function(c) { c.classList.remove('admin-col-hot'); }); };
  chart.querySelectorAll('.admin-col').forEach(function(col) {
    col.addEventListener('pointerenter', function() { show(col); });
    col.addEventListener('focus', function() { show(col); });
    col.addEventListener('click', function() { show(col); });
    col.addEventListener('blur', hide);
  });
  chart.addEventListener('pointerleave', hide);
}

// Opened from a link to /admin/ or /#admin: once the role is known (handleSession), open the page
function handleAdminDeepLink() {
  var tab = adminTabFromHash(location.hash);
  if (!tab) return;
  if (!_adminIsAdmin()) {
    adminSetHash(null);
    if (typeof currentUser !== 'undefined' && currentUser && typeof showToast === 'function') showToast('Die Admin-Seite ist nur für Admins.', 'danger');
    return;
  }
  if (typeof activeModule !== 'undefined' && activeModule === 'admin') initAdmin(tab);
  else if (typeof selectMode === 'function') selectMode('admin', tab);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('hashchange', function() {
    var tab = adminTabFromHash(location.hash);
    if (tab && (typeof activeModule === 'undefined' || activeModule !== 'admin' || tab !== _admin.tab)) handleAdminDeepLink();
  });
}

if (typeof UI_TOPBAR_ITEMS !== 'undefined') {
  UI_TOPBAR_ITEMS.admin = function() {
    var items = [{ label: 'Zahlen aktualisieren', action: 'adminRefresh' }];
    if (typeof dashMayManageStaff === 'function') items.push({ label: 'Personal öffnen', action: 'selectMode', args: ['dashboard', 'work'] });
    return items;
  };
}

function adminRefresh() {
  _admin.data = null;
  switchAdminTab('stats');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { adminTabFromHash: adminTabFromHash, adminHashFor: adminHashFor, adminShiftDate: adminShiftDate, adminShiftHours: adminShiftHours,
    adminMonthKey: adminMonthKey, adminMonthLabel: adminMonthLabel, adminDelta: adminDelta, adminRoleOf: adminRoleOf, adminStats: adminStats };
}
