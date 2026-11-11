/**
 * Office Dashboard Module Logic
 */

let dashboardProtocols = [];
let dashboardWorkers = [];
let dashboardCurrentWorker = null;
let dashboardCurrentShifts = [];
let _dashboardRealtimeChannel = null;
let _dashboardPollInterval = null;
let _dashboardRefreshing = false;
let _dashboardRefreshPending = false; // a refresh was requested while one was running → run once more afterwards
let _dashboardRefreshPromise = null;

function initDashboardRealtime() {
  if (typeof supabaseClient === 'undefined') return;

  // ── WebSocket real-time (requires Replication enabled in Supabase project) ──
  if (!_dashboardRealtimeChannel) {
    _dashboardRealtimeChannel = supabaseClient
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'protocols' }, function () {
        if (typeof refreshDashboard === 'function') refreshDashboard();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, function () {
        if (typeof refreshDashboard === 'function') refreshDashboard();
      })
      .subscribe(function(status) {
        console.log('[Realtime]', status);
        if (status === 'SUBSCRIBED') {
          // Realtime is live — cancel the polling fallback to save egress
          if (_dashboardPollInterval) { clearInterval(_dashboardPollInterval); _dashboardPollInterval = null; }
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !_dashboardPollInterval) {
          // Realtime unavailable — fall back to polling every 5 minutes (not 30 s)
          _dashboardPollInterval = setInterval(function() {
            if (typeof refreshDashboard === 'function') refreshDashboard();
          }, 300000);
        }
      });
  }
}

function stopDashboardRealtime() {
  if (_dashboardPollInterval) { clearInterval(_dashboardPollInterval); _dashboardPollInterval = null; }
  if (_dashboardRealtimeChannel) { supabaseClient.removeChannel(_dashboardRealtimeChannel); _dashboardRealtimeChannel = null; }
}

// ── BUCHHALTUNG CONFIG ──
const BUCHHALTUNG_MIN_HOURS = 3;         // Minimum booking floor in hours
const BUCHHALTUNG_MIN_HOURS_ENABLED = true; // Set to false to show raw hours

function switchDashTab(tab) {
  document.getElementById('dash-tab-prot').classList.toggle('active', tab === 'prot');
  document.getElementById('dash-tab-work').classList.toggle('active', tab === 'work');
  document.getElementById('dash-tab-settings').classList.toggle('active', tab === 'settings');

  document.getElementById('dash-view-prot').style.display = tab === 'prot' ? 'block' : 'none';
  document.getElementById('dash-view-work').style.display = tab === 'work' ? 'block' : 'none';
  document.getElementById('dash-view-settings').style.display = tab === 'settings' ? 'block' : 'none';

  if (typeof setDashView === 'function') setDashView(tab);

  if (tab === 'settings' && typeof renderSettingsTab === 'function') renderSettingsTab();

  // Reload on every entry: the "neue Stunden" badges must not show a stale snapshot
  if (tab === 'work') loadDashboardWorkers();
}

// Adding and editing people: PL, Buchhaltung, Admin (as the database allows). An AL only looks.
function dashMayManageStaff(role) { return ['PL', 'Buchhaltung', 'Admin'].indexOf(role) !== -1; }
// Marking shifts as "eingetragen": Buchhaltung and Admin
function dashMayBook(role) { return role === 'Buchhaltung' || role === 'Admin'; }

// Opens/closes the "Mitarbeiter hinzufügen" sheet (name kept: addDashboardUser closes it after saving)
function toggleAddUserForm() {
  const m = document.getElementById('add-user-modal');
  if (!m) return;
  if (!m.classList.contains('open') && !dashMayManageStaff(typeof userRole !== 'undefined' ? userRole : null)) return;
  m.classList.toggle('open');
}

// Employee list: people with new hours first, then by name; filtered by a name search
function dashWorkerList(workers, pendingMap, query) {
  var q = String(query || '').trim().toLowerCase();
  return (workers || [])
    .filter(function(w) { return !q || String(w.full_name || '').toLowerCase().indexOf(q) !== -1; }) // real names only, not the placeholder
    .map(function(w) { return { id: w.id, name: w.full_name || 'Unbekannt', role: w.role || '', pending: (pendingMap || {})[w.id] || 0 }; })
    .sort(function(a, b) { return (b.pending > 0) - (a.pending > 0) || a.name.localeCompare(b.name, 'de'); });
}

var dashPendingMap = {};

function dashWorkerRowHtml(w, selectedId) {
  return '<button type="button" class="ui-row dash-worker-row' + (w.id === selectedId ? ' ui-row-me' : '') + '" onclick="selectDashWorker(\'' + jsAttrArg(w.id) + '\')">' +
    '<span class="ui-row-main"><span class="ui-row-title">' + escapeHtml(w.name) + '</span><span class="ui-sub">' + escapeHtml(w.role) + '</span></span>' +
    (w.pending ? '<span class="ui-pill ui-pill-info" title="Neue Stunden">' + w.pending + '</span>' : '') +
  '</button>';
}

function renderDashWorkerList() {
  const addBtn = document.getElementById('dash-add-user-btn');
  if (addBtn) addBtn.style.display = dashMayManageStaff(typeof userRole !== 'undefined' ? userRole : null) ? '' : 'none';
  var listEl = document.getElementById('dash-worker-list');
  if (!listEl) return;
  var selected = (document.getElementById('dash-worker-select') || {}).value || '';
  var query = (document.getElementById('dash-worker-search') || {}).value || '';
  var rows = dashWorkerList(dashboardWorkers, dashPendingMap, query);
  listEl.innerHTML = rows.length ? rows.map(function(w) { return dashWorkerRowHtml(w, selected); }).join('') : uiEmptyHtml('Niemand gefunden', '');
}

// Selecting a person: the hidden select stays the source the rest of the dashboard reads
function selectDashWorker(id) {
  var sel = document.getElementById('dash-worker-select');
  if (!sel) return;
  sel.value = id;
  renderWorkerShifts();
  updateEditWorkerBtn();
  renderDashWorkerList();
  var work = document.getElementById('dash-work');
  if (work) work.classList.add('dash-work-detail-open');
}

function closeDashWorker() {
  var work = document.getElementById('dash-work');
  if (work) work.classList.remove('dash-work-detail-open');
}

// Share of the income limit: {pct 0–100, over}; null without pay or without a limit
function incomeLimitShare(earned, limit) {
  if (earned === null || earned === undefined || !limit || limit <= 0) return null;
  return { pct: Math.min(100, Math.round(earned / limit * 100)), over: earned > limit };
}

// Net minutes of one booked shift, same rules as the table (overnight, minimum booking floor)
function dashShiftNetMins(s) {
  var st = s.start_time ? s.start_time.substring(0, 5) : null, en = s.end_time ? s.end_time.substring(0, 5) : null;
  if (!st || !en) return 0;
  var a = st.split(':').map(Number), b = en.split(':').map(Number);
  if (isNaN(a[0]) || isNaN(b[0])) return 0;
  var startMins = a[0] * 60 + a[1], endMins = b[0] * 60 + b[1];
  if (endMins < startMins) endMins += 1440;
  var net = endMins - startMins - (s.pause_mins || 0);
  if (BUCHHALTUNG_MIN_HOURS_ENABLED) net = Math.max(BUCHHALTUNG_MIN_HOURS * 60, net);
  return net > 0 ? net : 0;
}

// Minutes of a shift between 22:00 and 6:00 (gross, pause not subtracted), over midnight
function dashShiftNightMins(s) {
  var st = timeToMins(s.start_time ? s.start_time.substring(0, 5) : null), en = timeToMins(s.end_time ? s.end_time.substring(0, 5) : null);
  if (st === null || en === null || isNaN(st) || isNaN(en)) return 0;
  if (en <= st) en += 1440;
  var n = 0;
  for (var m = st; m < en; m++) { var d = m % 1440; if (d >= 1320 || d < 360) n++; }
  return n;
}
// Night shift = more than 2 h between 22 and 6 (Nachtarbeit as in §2 ArbZG)
function dashIsNightShift(s) { return dashShiftNightMins(s) > 120; }

// Who takes night shifts most: active workers with ≥1 night shift, most nights first, then the higher share
function dashNightRanking(shifts, workers) {
  var by = {};
  (shifts || []).forEach(function(s) {
    if (!s.user_id) return;
    var r = by[s.user_id] || (by[s.user_id] = { nights: 0, total: 0 });
    r.total++;
    if (dashIsNightShift(s)) r.nights++;
  });
  return (workers || []).filter(function(w) { return by[w.id] && by[w.id].nights > 0; }).map(function(w) {
    var r = by[w.id];
    return { id: w.id, name: w.full_name || 'Unbekannt', nights: r.nights, total: r.total, share: Math.round(r.nights / r.total * 100) };
  }).sort(function(a, b) { return b.nights - a.nights || b.share - a.share || a.name.localeCompare(b.name, 'de'); });
}

// ── Auswertung (Jenni): night shifts per year, people without work for 4+ weeks, busiest bees of the month ──
var DASH_PAGE = 1000;          // PostgREST answers at most 1000 rows per request
var DASH_INACTIVE_DAYS = 28;   // "seit vier Wochen nicht im Einsatz"
var DASH_INACTIVE_ALERT = 56;  // from 8 weeks: Minijob deregistration may be due
var dashInsights = { year: null, nights: [], noNight: [], inactive: [], bees: [], beesLabel: '' };

// People the evaluations are about: active, never Gast; MA/AL always, other roles only once they worked a shift
function dashEligible(workers, shifts) {
  var worked = {};
  (shifts || []).forEach(function(s) { if (s.user_id) worked[s.user_id] = true; });
  return (workers || []).filter(function(w) {
    return w.is_active !== false && w.role !== 'Gast' && (w.role === 'MA' || w.role === 'AL' || worked[w.id]);
  });
}

// Eligible people with no night shift among the given shifts, by name
function dashNoNight(shifts, workers) {
  var night = {};
  (shifts || []).forEach(function(s) { if (s.user_id && dashIsNightShift(s)) night[s.user_id] = true; });
  return dashEligible(workers, shifts).filter(function(w) { return !night[w.id]; })
    .map(function(w) { return { id: w.id, name: w.full_name || 'Unbekannt' }; })
    .sort(function(a, b) { return a.name.localeCompare(b.name, 'de'); });
}

// Eligible people whose last shift is minDays+ before today (or who never worked): never first, then longest ago
function dashInactive(shifts, workers, today, minDays) {
  var last = {};
  (shifts || []).forEach(function(s) {
    var d = dashShiftDate(s);
    if (s.user_id && d && d <= today && (!last[s.user_id] || d > last[s.user_id])) last[s.user_id] = d;
  });
  var dayNo = function(iso) { var p = iso.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; };
  return dashEligible(workers, shifts).map(function(w) {
    var l = last[w.id] || null;
    return { id: w.id, name: w.full_name || 'Unbekannt', last: l, days: l ? dayNo(today) - dayNo(l) : null };
  }).filter(function(r) { return r.days === null || r.days >= minDays; })
    .sort(function(a, b) { return (b.days === null) - (a.days === null) || b.days - a.days || a.name.localeCompare(b.name, 'de'); });
}

// Top 3 by net hours in one billing month
function dashBees(shifts, workers, key, cutoff) {
  var mins = {};
  dashShiftsInMonth(shifts, key, cutoff).forEach(function(s) { if (s.user_id) mins[s.user_id] = (mins[s.user_id] || 0) + dashShiftNetMins(s); });
  return dashEligible(workers, shifts).filter(function(w) { return mins[w.id] > 0; })
    .map(function(w) { return { id: w.id, name: w.full_name || 'Unbekannt', mins: mins[w.id] }; })
    .sort(function(a, b) { return b.mins - a.mins || a.name.localeCompare(b.name, 'de'); }).slice(0, 3);
}

// All shifts, page by page; a failure only leaves the evaluations empty, never the worker list
// shortcut: loads every shift ever (≈1000/year), add a date filter if the dashboard gets slow
async function loadDashInsights() {
  var all = [], today = localDateStr(), year = today.slice(0, 4), cutoff = dashBillingCutoff();
  var month = getBillingKeyForDate(new Date(), cutoff);
  try {
    for (var from = 0; ; from += DASH_PAGE) {
      const { data, error } = await supabaseClient
        .from('shifts')
        .select('id, user_id, start_time, end_time, pause_mins, shift_date, created_at, protocols(date)')
        .not('user_id', 'is', null)
        .order('id')
        .range(from, from + DASH_PAGE - 1);
      if (error) throw error;
      all = all.concat(data || []);
      if (!data || data.length < DASH_PAGE) break;
    }
    var yearShifts = all.filter(function(s) { return dashShiftDate(s).slice(0, 4) === year; });
    dashInsights = {
      year: year,
      nights: dashNightRanking(yearShifts, dashboardWorkers),
      noNight: dashNoNight(yearShifts, dashEligible(dashboardWorkers, all)),
      inactive: dashInactive(all, dashboardWorkers, today, DASH_INACTIVE_DAYS),
      bees: dashBees(all, dashboardWorkers, month.key, cutoff),
      beesLabel: month.label
    };
  } catch (err) {
    console.error('Auswertung laden:', err);
    dashInsights = { year: year, nights: [], noNight: [], inactive: [], bees: [], beesLabel: month.label };
  }
  renderDashInsights();
}

function dashPersonBtn(id, title, sub, end) {
  return '<button type="button" class="ui-row dash-worker-row" onclick="selectDashWorker(\'' + jsAttrArg(id) + '\')">' +
    '<span class="ui-row-main"><span class="ui-row-title">' + title + '</span>' + (sub ? '<span class="ui-sub">' + sub + '</span>' : '') + '</span>' + (end || '') + '</button>';
}

function renderDashInsights() {
  var I = dashInsights, el;
  if ((el = document.getElementById('dash-bees'))) {
    var medals = ['🥇', '🥈', '🥉'];
    el.innerHTML = I.bees.length ? '<div class="dash-bees"><div class="dash-bees-title">🐝 Fleißigste Bienen · ' + escapeHtml(I.beesLabel) + '</div>' +
      I.bees.map(function(b, i) {
        return '<button type="button" class="dash-bee" onclick="selectDashWorker(\'' + jsAttrArg(b.id) + '\')">' +
          '<span class="dash-bee-medal" aria-label="Platz ' + (i + 1) + '">' + medals[i] + '</span><span class="dash-bee-name">' + escapeHtml(b.name) + '</span>' +
          '<span class="dash-bee-h">' + (b.mins / 60).toFixed(1).replace('.', ',') + ' h</span></button>';
      }).join('') + '</div>' : '';
  }
  if ((el = document.getElementById('dash-night-title'))) el.textContent = 'Nachtschichten · ' + I.year;
  if ((el = document.getElementById('dash-night-ranking'))) {
    el.innerHTML = (I.nights.length ? I.nights.map(function(r, i) {
      return dashPersonBtn(r.id, (i + 1) + '. ' + escapeHtml(r.name), r.share + ' % der Schichten (' + r.nights + ' von ' + r.total + ')',
        '<span class="ui-pill ui-pill-info" title="Nachtschichten">' + r.nights + '</span>');
    }).join('') : '<div class="ui-sub" style="padding:6px 2px;">Keine Nachtschichten in ' + I.year + '.</div>') +
      (I.noNight.length ? '<div class="dash-insight-note"><b>Noch keine Nachtschicht (' + I.noNight.length + '):</b> ' +
        I.noNight.map(function(w) { return escapeHtml(w.name); }).join(', ') + '</div>' : '');
  }
  if ((el = document.getElementById('dash-inactive-title'))) el.textContent = 'Seit 4 Wochen kein Einsatz (' + I.inactive.length + ')';
  if ((el = document.getElementById('dash-inactive-list'))) {
    el.innerHTML = I.inactive.length ? I.inactive.map(function(r) {
      var alert = r.days === null || r.days >= DASH_INACTIVE_ALERT;
      var when = r.last ? 'letzter Einsatz ' + r.last.slice(8, 10) + '.' + r.last.slice(5, 7) + '.' + r.last.slice(0, 4) : 'noch nie im Einsatz';
      var pill = r.days === null ? 'nie' : 'vor ' + Math.floor(r.days / 7) + ' Wo.';
      return dashPersonBtn(r.id, escapeHtml(r.name), when + (alert ? ' · Abmeldung prüfen' : ''),
        '<span class="ui-pill ' + (alert ? 'ui-pill-danger' : 'ui-pill-warn') + '">' + pill + '</span>');
    }).join('') : '<div class="ui-sub" style="padding:6px 2px;">Alle waren in den letzten 4 Wochen im Einsatz.</div>';
  }
}

function dashWorkerHeadHtml(w) {
  if (!w) return '';
  var rates = [w.hourly_rate_conni ? 'Lohn ' + parseFloat(w.hourly_rate_conni).toFixed(2).replace('.', ',') + ' €/h' : '',
    w.hourly_rate_internal ? 'intern ' + parseFloat(w.hourly_rate_internal).toFixed(2).replace('.', ',') + ' €/h' : ''].filter(Boolean).join(' · ');
  return '<div class="ui-title" style="font-size:20px;">' + escapeHtml(w.full_name || 'Unbekannt') + '</div>' +
    '<div class="ui-sub">' + escapeHtml([w.role, w.default_dept].filter(Boolean).join(' · ')) + (rates ? '<span class="cost-only"> · ' + escapeHtml(rates) + '</span>' : '') + '</div>';
}

function updateEditWorkerBtn() {
  const btn = document.getElementById('edit-worker-btn');
  if (!btn) return;
  const selected = document.getElementById('dash-worker-select').value;
  const role = typeof userRole !== 'undefined' ? userRole : null;
  btn.style.display = selected && dashMayManageStaff(role) ? 'inline-flex' : 'none';
  const add = document.getElementById('dash-add-user-btn');
  if (add) add.style.display = dashMayManageStaff(role) ? '' : 'none';
  // PIN reset sits with the person it is for; shown only where the reset rules allow it (auth.js, same matrix as the server)
  const reset = document.getElementById('reset-worker-pin-btn'), w = dashSelectedWorker();
  if (reset) reset.style.display = selected && dashMayResetPin(typeof userRole !== 'undefined' ? userRole : null, currentUser && currentUser.id, w) ? 'inline-flex' : 'none';
}

// Admin resets everyone, PL resets AL and MA, AL resets MA; never one's own, never a deactivated account
function dashMayResetPin(callerRole, callerId, worker) {
  return !!worker && !!worker.id && worker.id !== callerId && worker.is_active !== false &&
    typeof mayResetPinClient === 'function' && mayResetPinClient(callerRole, worker.role);
}

// The person picked in the list (the hidden select is the source, see selectDashWorker)
function dashSelectedWorker() {
  const sel = document.getElementById('dash-worker-select'), id = sel ? sel.value : '';
  return (id && (dashboardWorkers || []).find(function(w) { return w.id === id; })) || null;
}

function dashResetWorkerPin() {
  const w = dashSelectedWorker();
  if (!dashMayResetPin(userRole, currentUser && currentUser.id, w)) return;
  pinResetUsers = [{ id: w.id, full_name: w.full_name, role: w.role }]; // confirmPinReset looks the person up here
  confirmPinReset(w.id);
}

var _editWorkerRoleRates = [];
var _editWorkerPlansWeek = null; // "Plant den Wochenplan" as loaded; null = not shown (no Admin, or the column does not exist yet)

// What to save for the switch: true/false when an Admin changed it, null when there is nothing to save
function dashPlansWeekChange(loaded, checked) {
  return loaded === null || loaded === undefined || !!loaded === !!checked ? null : !!checked;
}

// Own query instead of a column in the worker list: the list keeps loading before the migration is applied
async function loadEditWorkerPlansWeek(workerId) {
  var field = document.getElementById('edit-worker-plans-week-field'), box = document.getElementById('edit-worker-plans-week');
  _editWorkerPlansWeek = null;
  if (!field || !box) return;
  field.style.display = 'none';
  if (typeof userRole === 'undefined' || userRole !== 'Admin') return;
  var r;
  try { r = await supabaseClient.from('app_users').select('plans_week').eq('id', workerId).maybeSingle(); } catch (e) { r = { error: e }; }
  if (r.error || !r.data || !dashboardCurrentWorker || dashboardCurrentWorker.id !== workerId) return;
  _editWorkerPlansWeek = !!r.data.plans_week;
  box.checked = _editWorkerPlansWeek;
  field.style.display = '';
}

function openEditWorker() {
  const worker = dashboardCurrentWorker;
  if (!worker || !dashMayManageStaff(typeof userRole !== 'undefined' ? userRole : null)) return;
  const nameParts = (worker.full_name || '').trim().split(' ');
  const lastName  = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
  const firstName = nameParts[0] || '';
  document.getElementById('edit-worker-firstname').value     = firstName;
  document.getElementById('edit-worker-lastname').value      = lastName;
  document.getElementById('edit-worker-role').value          = worker.role || 'MA';
  document.getElementById('edit-worker-dept').value          = worker.default_dept || '';
  document.getElementById('edit-worker-rate-conni').value    = worker.hourly_rate_conni || '';
  document.getElementById('edit-worker-rate-internal').value = worker.hourly_rate_internal || '';
  document.getElementById('edit-worker-income-limit').value  = worker.income_limit || '';
  document.getElementById('edit-worker-email').value         = worker.email || '';
  _editWorkerRoleRates = Array.isArray(worker.role_rates) ? JSON.parse(JSON.stringify(worker.role_rates)) : [];
  renderRoleRatesList();
  document.getElementById('edit-worker-type').value = worker.employment_type || (worker.is_fest ? 'Fest' : 'Minijob');
  document.getElementById('edit-worker-sees-interest').checked = !!worker.plan_interest_viewer;
  document.getElementById('edit-worker-can-drive').checked = !!worker.can_drive;
  document.getElementById('edit-worker-avail').checked = !!worker.availability_enabled;
  loadEditWorkerPlansWeek(worker.id);
  document.getElementById('edit-worker-modal').classList.add('open');
}

// Position keys for personal rates and the shift editor: "<Funktion> <Typ>" + plain departments;
// a legacy role in use ("MA frei") is appended so it stays selectable
function dashRoleOptions(current) {
  var out = [];
  ['MA', 'AL', 'Fahrer'].forEach(function(f) { EMPLOYMENT_TYPES.forEach(function(t) { out.push(positionKey(f, t)); }); });
  out = out.concat(['Floristik', 'Lager', 'Stoffe', 'Tischlerei']);
  if (current && out.indexOf(current) === -1) out.push(current);
  return out;
}

// Shift editor role → stored position_role: same function as before keeps the stored key (type of that day),
// otherwise the worker's current employment type
function dashShiftSaveRole(selected, original, workerType) {
  if (original && splitPosition(original).func === selected) return original;
  return positionKey(selected, workerType);
}

function renderRoleRatesList() {
  var c = document.getElementById('edit-worker-role-rates');
  if (!c) return;
  c.innerHTML = _editWorkerRoleRates.map(function(r, i) {
    var opts = dashRoleOptions(r.role).map(function(o) {
      return '<option value="' + o + '"' + (r.role === o ? ' selected' : '') + '>' + o + '</option>';
    }).join('');
    return '<div style="display:flex;gap:5px;align-items:center;margin-bottom:4px;">' +
      '<select onchange="updateRoleRateRow(' + i + ',\'role\',this.value)" class="meta-input" style="flex:2;padding:5px 6px;font-size:12px;">' + opts + '</select>' +
      '<input type="number" step="0.5" min="0" placeholder="Conni €/h" value="' + (r.rate_conni || '') + '" oninput="updateRoleRateRow(' + i + ',\'rate_conni\',this.value)" class="meta-input" style="flex:1;padding:5px 6px;font-size:12px;">' +
      '<input type="number" step="0.5" min="0" placeholder="Intern €/h" value="' + (r.rate_internal || '') + '" oninput="updateRoleRateRow(' + i + ',\'rate_internal\',this.value)" class="meta-input" style="flex:1;padding:5px 6px;font-size:12px;">' +
      '<button onclick="removeRoleRateRow(' + i + ')" style="color:var(--danger);background:none;border:none;cursor:pointer;font-size:16px;padding:0 4px;">✕</button>' +
    '</div>';
  }).join('');
}

function addRoleRateRow() {
  _editWorkerRoleRates.push({ role: 'MA Minijob', rate_conni: null, rate_internal: null });
  renderRoleRatesList();
}

function removeRoleRateRow(i) {
  _editWorkerRoleRates.splice(i, 1);
  renderRoleRatesList();
}

function updateRoleRateRow(i, field, val) {
  if (!_editWorkerRoleRates[i]) return;
  _editWorkerRoleRates[i][field] = (field === 'role') ? val : (parseFloat(val) || null);
}

async function deactivateWorker() {
  const worker = dashboardCurrentWorker;
  if (!worker) return;
  if (!confirm('Mitarbeiter "' + (worker.full_name || '') + '" wirklich deaktivieren?\nDie Person verschwindet aus allen Dropdowns.')) return;
  try {
    const { data: rows, error } = await supabaseClient.from('app_users').update({ is_active: false }).eq('id', worker.id).select('id');
    if (error) throw error;
    // RLS answers with 0 rows instead of an error
    if (!rows || rows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung');
    closeEditWorker();
    showToast('Mitarbeiter deaktiviert.');
    // The person is gone from the list: close the detail and refresh the rate source (their old shifts keep their rate)
    const sel = document.getElementById('dash-worker-select');
    if (sel) sel.value = '';
    dashboardCurrentWorker = null;
    await loadDashboardWorkers();
    await dashRefreshRateUsers();
    renderWorkerShifts();
    updateEditWorkerBtn();
    closeDashWorker();
  } catch (err) {
    showToast('Fehler: ' + (err.message || 'Deaktivierung fehlgeschlagen'), 'danger');
  }
}

function closeEditWorker() {
  document.getElementById('edit-worker-modal').classList.remove('open');
}

async function saveEditWorker() {
  const worker = dashboardCurrentWorker;
  if (!worker) return;

  const firstName = (document.getElementById('edit-worker-firstname').value || '').trim();
  const lastName  = (document.getElementById('edit-worker-lastname').value  || '').trim();
  const fullName  = (firstName + ' ' + lastName).trim();
  if (!fullName) { showToast('Bitte Namen eingeben.', 'danger'); return; }
  const email = document.getElementById('edit-worker-email').value.trim();
  // Gmail rejects malformed recipients → the protocol mail would be retried forever
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Bitte eine gültige E-Mail-Adresse eingeben.', 'danger'); return; }

  const payload = {
    full_name:          fullName,
    role:               document.getElementById('edit-worker-role').value,
    default_dept:       document.getElementById('edit-worker-dept').value.trim() || null,
    hourly_rate_internal: parseFloat(document.getElementById('edit-worker-rate-internal').value) || null,
    role_rates:           _editWorkerRoleRates.filter(function(r) { return r.role; }),
    employment_type:      document.getElementById('edit-worker-type').value,
    is_fest:              document.getElementById('edit-worker-type').value === 'Fest', // old cached clients still read it
    plan_interest_viewer: document.getElementById('edit-worker-sees-interest').checked,
    can_drive:            document.getElementById('edit-worker-can-drive').checked,
    availability_enabled: document.getElementById('edit-worker-avail').checked,
  };

  try {
    const { data: rows, error } = await supabaseClient.from('app_users').update(payload).eq('id', worker.id).select('id');
    if (error) throw error;
    // RLS answers with 0 rows instead of an error
    if (!rows || rows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung');
    await saveWorkerPrivate(worker.id, {
      hourly_rate_conni: parseFloat(document.getElementById('edit-worker-rate-conni').value) || null,
      income_limit:      parseFloat(document.getElementById('edit-worker-income-limit').value) || null,
      email:             email || null,
    });
    var plansBox = document.getElementById('edit-worker-plans-week');
    var plans = dashPlansWeekChange(_editWorkerPlansWeek, plansBox && plansBox.checked);
    if (plans !== null) {
      var pw = await supabaseClient.from('app_users').update({ plans_week: plans }).eq('id', worker.id).select('id');
      if (pw.error) throw pw.error;
      if (!pw.data || !pw.data.length) throw new Error('„Plant den Wochenplan“ nicht gespeichert – keine Berechtigung');
    }
    showToast('Mitarbeiter gespeichert!');
    closeEditWorker();
    await loadDashboardWorkers();
    await dashRefreshRateUsers(); // new rates count for the next cost calculation
    // Re-select the same worker after reload
    const sel = document.getElementById('dash-worker-select');
    if (sel) { sel.value = worker.id; renderWorkerShifts(); }
    if (typeof fetchEmployees === 'function') fetchEmployees();
  } catch (err) {
    console.error('saveEditWorker error:', err);
    showToast('Fehler beim Speichern: ' + (err.message || err.code || JSON.stringify(err)), 'danger');
  }
}

// Pay, limit and email live in app_user_private (admin-only RLS)
async function saveWorkerPrivate(userId, priv) {
  const { data, error } = await supabaseClient.from('app_user_private')
    .upsert(Object.assign({ user_id: userId }, priv), { onConflict: 'user_id' }).select('user_id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Speichern abgelehnt – keine Berechtigung');
}

var _addingUser = false; // a second tap while the insert runs would create the employee twice
async function addDashboardUser() {
  if (_addingUser) return;
  const firstName = (document.getElementById('new-user-firstname') || {}).value?.trim() || '';
  const lastName  = (document.getElementById('new-user-lastname')  || {}).value?.trim() || '';
  const fullName  = (firstName + ' ' + lastName).trim();
  const role = document.getElementById('new-user-role').value;
  const dept = document.getElementById('new-user-dept').value.trim();

  if (!fullName || !dept) {
    if (typeof showToast === 'function') showToast('Bitte Vor- und Nachname sowie Abteilung ausfüllen.', 'danger');
    return;
  }

  _addingUser = true;
  try {
    const rateConni    = parseFloat(document.getElementById('new-user-rate-conni')?.value)    || null;
    const rateInternal = parseFloat(document.getElementById('new-user-rate-internal')?.value) || null;
    const incomeLimit  = parseFloat(document.getElementById('new-user-income-limit')?.value)  || null;

    const { data: created, error } = await supabaseClient
      .from('app_users')
      .insert({ full_name: fullName, role: role, default_dept: dept, hourly_rate_internal: rateInternal })
      .select('id');

    if (error) throw error;
    if (!created || created.length === 0) throw new Error('Anlegen abgelehnt – keine Berechtigung');
    if (rateConni || incomeLimit) await saveWorkerPrivate(created[0].id, { hourly_rate_conni: rateConni, income_limit: incomeLimit, email: null });

    if (typeof showToast === 'function') showToast('Mitarbeiter erfolgreich hinzugefügt!');

    // Clear form and reload
    if (document.getElementById('new-user-firstname')) document.getElementById('new-user-firstname').value = '';
    if (document.getElementById('new-user-lastname'))  document.getElementById('new-user-lastname').value  = '';
    document.getElementById('new-user-dept').value = '';
    if (document.getElementById('new-user-rate-conni'))    document.getElementById('new-user-rate-conni').value    = '';
    if (document.getElementById('new-user-rate-internal')) document.getElementById('new-user-rate-internal').value = '';
    if (document.getElementById('new-user-income-limit'))  document.getElementById('new-user-income-limit').value  = '';
    toggleAddUserForm();
    loadDashboardWorkers();
    
    // Also trigger a fetch for the login dropdown if it's visible (unlikely here but good for consistency)
    if (typeof fetchEmployees === 'function') fetchEmployees();

  } catch (err) {
    console.error('Add user error:', err);
    if (typeof showToast === 'function') showToast('Fehler: ' + (err.message || 'Speichern fehlgeschlagen'), 'danger');
  } finally {
    _addingUser = false;
  }
}

// Delegate clicks for PDF/Details buttons in protocol table (avoids inline onclick with IDs)
(function() {
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    if (btn.dataset.action === 'pdf') exportDashProtPDF(id);
    if (btn.dataset.action === 'detail') openDashDetail(id);
  });
})();

// Realtime events arrive while a refresh (or the save that triggered them) is still running: remember the request
// and load once more afterwards, so the list never keeps the snapshot from the middle of a save.
// Returns a promise that resolves after the last needed load.
function refreshDashboard() {
  if (typeof supabaseClient === 'undefined') return Promise.resolve();
  if (_dashboardRefreshing) { _dashboardRefreshPending = true; return _dashboardRefreshPromise; }
  _dashboardRefreshing = true;
  _dashboardRefreshPromise = (async function() {
    try {
      do {
        _dashboardRefreshPending = false;
        await refreshDashboardOnce();
      } while (_dashboardRefreshPending);
    } finally {
      _dashboardRefreshing = false;
      _dashboardRefreshPromise = null;
    }
  })();
  return _dashboardRefreshPromise;
}

async function refreshDashboardOnce() {
  try {
    await ensureRateUsers();
    const protSelect = (withCreator) => `
        id, date, action, is_holiday, total_cost, al_id, pl_id, job_no,${withCreator ? ' created_by,' : ''}
        notes_damages, notes_incidents, notes_feedback,
        al_name_fallback, pl_name_fallback, created_at, mailed_at,
        projects(name, location),
        al:app_users!protocols_al_id_fkey(full_name),
        pl:app_users!protocols_pl_id_fkey(full_name),
        shifts(id, user_id, temp_worker_name, position_role, start_time, end_time, pause_mins, status, shift_date, ort,
               app_users(full_name)),
        protocol_transports(*),
        protocol_equipments(*),
        worker_ratings(temp_worker_name, rating, is_star)
      `;
    const load = (withCreator) => supabaseClient.from('protocols').select(protSelect(withCreator)).order('date', { ascending: false });
    let { data: protocols, error: protError } = await load(true);
    // created_by not migrated yet: load without it (everything then counts via AL/PL)
    if (protError && /created_by/.test(protError.message || '')) ({ data: protocols, error: protError } = await load(false));
    if (protError) throw protError;

    dashboardProtocols = protocols;
    // MA geplant per Auftrag for the Nachkalkulation; only Admin/PL may read it, for everyone else it just stays empty
    try {
      const st = await supabaseClient.from('order_staffing').select('job_no, staff_setup, staff_teardown');
      _dashStaffing = {};
      (st.data || []).forEach(function(r) { _dashStaffing[r.job_no] = r; });
    } catch (stErr) { _dashStaffing = {}; }
    renderDashboardTable();
    loadDashMissing();
  } catch (err) {
    console.error('Dash Load Error:', err);
    if (typeof showToast === 'function') showToast('Fehler beim Laden der Dashboard-Daten', 'danger');
  }
}

// ── Einsätze ohne Protokoll: plan shifts of the last 14 days that no protocol covers yet ──
var _dashPlanRows = [];      // plan_shifts rows (with plan_assignments) of the window
var _dashMissingAll = false; // list collapsed to 5 entries by default
var DASH_MISSING_DAYS = 14, DASH_MISSING_COLLAPSED = 5;

async function loadDashMissing() {
  if (typeof supabaseClient === 'undefined' || typeof planWithoutProtocol !== 'function') return;
  var today = localDateStr();
  var { data, error } = await supabaseClient.from('plan_shifts').select('*, plan_assignments(*)')
    .gte('date', wpAddDays(today, -DASH_MISSING_DAYS)).lte('date', today);
  if (error) { console.error('Einsätze ohne Protokoll:', error); return; }
  _dashPlanRows = data || [];
  renderDashMissing();
}

function renderDashMissing() {
  var box = document.getElementById('dash-missing');
  if (!box) return;
  var today = localDateStr();
  var rowsById = {};
  var shifts = _dashPlanRows.map(function(r) { var s = planShiftFromDb(r); rowsById[s.id] = r; return s; });
  var protocols = dashboardProtocols.map(function(p) { return { date: p.date, event: p.projects && p.projects.name }; });
  var open = planWithoutProtocol(shifts, protocols, wpAddDays(today, -DASH_MISSING_DAYS), today);
  if (!open.length) { box.innerHTML = ''; return; }
  var canWrite = typeof moduleAllowedForRole === 'function' && moduleAllowedForRole('protokoll', userRole);
  var shown = (_dashMissingAll || open.length <= DASH_MISSING_COLLAPSED) ? open : open.slice(0, DASH_MISSING_COLLAPSED);
  box.innerHTML = '<div class="ui-label">Einsätze ohne Protokoll</div><div class="ui-list" style="margin-bottom:14px;">' +
    shown.map(function(s) {
      var ev = planEventName(s);
      return '<div class="ui-row"><div class="ui-row-main"><div class="ui-row-title">' + escapeHtml(shortDateDE(s.date)) + ' ' + escapeHtml(s.venue || '—') +
        (ev && ev !== s.venue ? ' · ' + escapeHtml(ev) : '') + '</div>' +
        (s.count > 1 ? '<div class="ui-sub">' + s.count + ' Aufträge</div>' : '') + '</div>' +
        (canWrite ? '<div class="ui-row-end"><button type="button" class="ui-btn dash-small-btn" onclick="dashStartProtokollFromPlan(' + uiArg(s.id) + ')">Protokoll anlegen</button></div>' : '') +
        '</div>';
    }).join('') + '</div>' +
    (open.length > DASH_MISSING_COLLAPSED
      ? '<button type="button" class="stunden-link" style="margin:-6px 0 14px;" onclick="toggleDashMissing()">' + (_dashMissingAll ? 'Weniger zeigen' : 'Alle zeigen (' + open.length + ')') + '</button>'
      : '');
}

function toggleDashMissing() {
  _dashMissingAll = !_dashMissingAll;
  renderDashMissing();
}

// Same prefill as "Protokoll starten" in the Wochenplan; the AL is the shift's registered AL (if any).
// Several plan rows of the same event and day (one per room) become one protocol with everyone from all of them.
function dashStartProtokollFromPlan(shiftId) {
  var row = _dashPlanRows.find(function(r) { return r.id === shiftId; });
  if (!row) return;
  var p = planShiftFromDb(row);
  var event = planEventName(p);
  var group = _dashPlanRows.filter(function(r) {
    return r.date === row.date && planEventName(planShiftFromDb(r)).trim().toLowerCase() === event.trim().toLowerCase();
  });
  p.people = dashMergePlanPeople(group.map(planShiftFromDb), p);
  openProtokollPrefilled({
    event: event, date: p.date, action: planGuessAction(p.wann),
    alId: planAlUserId(row) || group.map(planAlUserId).filter(Boolean)[0] || null,
    location: [p.venue].concat(p.location.slice(0, 1)).filter(Boolean).join(', '), shift: p
  });
}

// People of several plan rows, each person once (by user id, else name). Someone from a row that starts at a
// different time than the main row keeps that start as a personal note ("ab 14:00 Uhr"), unless they have one.
function dashMergePlanPeople(shifts, main) {
  var mainTime = planWhen(main.wann || []).time, seen = {}, out = [];
  shifts.forEach(function(s) {
    var t = planWhen(s.wann || []).time;
    (s.people || []).forEach(function(person) {
      var k = person.userId || String(person.name || '').trim().toLowerCase();
      if (!k || seen[k]) return;
      seen[k] = true;
      var copy = Object.assign({}, person);
      if (!copy.note && t && t !== mainTime) copy.note = 'ab ' + t + ' Uhr';
      out.push(copy);
    });
  });
  return out;
}

// Search hit on project, AL, location or date – the date also as shown in the table (dd.mm.yyyy), not only ISO
function dashProtMatches(p, term) {
  const iso = (p.date || '').toLowerCase();
  const shown = iso.length === 10 ? iso.slice(8) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '';
  return [(p.projects?.name || ''), (p.al?.full_name || p.al_name_fallback || ''), (p.location || p.projects?.location || ''), (p.job_no || '')]
    .some(s => s.toLowerCase().includes(term)) || iso.includes(term) || shown.includes(term);
}

function renderDashboardTable() {
  const body = document.getElementById('protocol-body');
  if (!body) return;
  body.innerHTML = '';

  const searchTerm = (document.getElementById('dash-search')?.value || '').trim().toLowerCase();

  // "Meine" by default; the search works within the current scope
  const scoped = dashScopedProtocols();
  renderDashNachkalk();
  const scopeBox = document.getElementById('dash-scope');
  if (scopeBox) scopeBox.innerHTML = protScopeSegHtml(protScopeGet(DASH_SCOPE_KEY), 'setDashProtScope');

  const filtered = scoped.filter(p => dashProtMatches(p, searchTerm));

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    const projName = p.projects ? p.projects.name : 'Unbekannt';
    const alName = p.al ? p.al.full_name : (p.al_name_fallback || '—');
    const plName = p.pl ? p.pl.full_name : (p.pl_name_fallback || '');
    const costStr = (p.total_cost || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €';
    const holidayTag = p.is_holiday ? ' <span class="ui-pill ui-pill-warn">Feiertag</span>' : '';
    const plLine = plName ? `<div class="ui-sub">PL ${escapeHtml(plName)}</div>` : '';

    tr.innerHTML = `
      <td data-label="Datum" class="dash-num">${new Date(p.date).toLocaleDateString('de-DE')}</td>
      <td data-label="Projekt"><span class="ui-row-title">${escapeHtml(projName)}</span></td>
      <td data-label="Aktion"><span class="ui-pill ui-pill-info">${escapeHtml(p.action)}</span>${holidayTag}</td>
      <td data-label="AL / PL"><div>${escapeHtml(alName)}</div>${plLine}</td>
      <td data-label="Kosten" class="dash-num cost-only"><b>${escapeHtml(costStr)}</b></td>
      <td data-label="" class="dash-actions">
        <button type="button" class="ui-btn dash-small-btn" data-action="pdf" data-id="${escapeHtml(p.id)}">PDF</button>
        <button type="button" class="ui-btn dash-small-btn" data-action="detail" data-id="${escapeHtml(p.id)}">Details</button>
      </td>
    `;
    body.appendChild(tr);
  });
  if (!filtered.length) {
    const own = !searchTerm && protScopeGet(DASH_SCOPE_KEY) === 'mine' && dashboardProtocols.length;
    body.innerHTML = '<tr><td colspan="6" data-label="">' + (own
      ? uiEmptyHtml('Noch keine eigenen Protokolle', '', '<button type="button" class="ui-btn" style="margin-top:10px;" onclick="setDashProtScope(\'all\')">Alle anzeigen</button>')
      : uiEmptyHtml(searchTerm ? 'Nichts gefunden' : 'Noch keine Protokolle', searchTerm ? 'Andere Suche versuchen.' : '')) + '</td></tr>';
  }
  renderDashStats();
}

const DASH_SCOPE_KEY = 'luebbert_dash_prot_scope';

function dashScopedProtocols() {
  return protFilterScope(dashboardProtocols, protScopeGet(DASH_SCOPE_KEY), typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
}

function setDashProtScope(scope) {
  protScopeSet(DASH_SCOPE_KEY, scope);
  renderDashboardTable();
}

// ── Nachkalkulation: what the protocols of one Auftrag add up to, against the MA the PL planned ──
var _dashStaffing = {}; // job_no → order_staffing row
var DASH_NK_PHASES = [['setup', 'Aufbau'], ['teardown', 'Abbau'], ['other', 'Sonstiges']];

// protocols = dashboard rows (with shifts and protocol_transports), staffing = { job_no: { staff_setup, staff_teardown } },
// transportCost(p) = € of the protocol's vehicles and drivers. → one entry per Auftrag, newest first:
// { jobNo, name, from, to, phases: { setup|teardown|other: agg }, total: agg, protocols: [{ id, date, action }] }
// agg = { count, people, mins, cost, transport, planned }; people are counted once per phase and once in the total
function dashNachkalk(protocols, staffing, transportCost) {
  var jobs = {};
  var blank = function() { return { count: 0, people: 0, mins: 0, cost: 0, transport: 0, planned: null, _who: {} }; };
  (protocols || []).forEach(function(p) {
    if (!p.job_no) return;
    var j = jobs[p.job_no] = jobs[p.job_no] || { jobNo: p.job_no, name: '', from: p.date, to: p.date,
      phases: { setup: blank(), teardown: blank(), other: blank() }, total: blank(), protocols: [] };
    if (!j.name && p.projects && p.projects.name) j.name = p.projects.name;
    if (p.date < j.from) j.from = p.date;
    if (p.date > j.to) j.to = p.date;
    j.protocols.push({ id: p.id, date: p.date, action: p.action || '' });
    var ph = j.phases[protPhaseOfAction(p.action) || 'other'];
    var cost = Number(p.total_cost) || 0, tr = Math.min(cost, Math.max(0, Number(transportCost ? transportCost(p) : 0) || 0));
    [ph, j.total].forEach(function(a) {
      a.count++; a.cost += cost; a.transport += tr;
      (p.shifts || []).forEach(function(s) {
        a.mins += dashShiftNetMins(s);
        var who = s.user_id || ('n:' + String(s.temp_worker_name || '').trim().toLowerCase());
        if (who !== 'n:' && !a._who[who]) { a._who[who] = true; a.people++; }
      });
    });
  });
  return Object.keys(jobs).map(function(k) {
    var j = jobs[k], st = (staffing || {})[k] || {};
    j.phases.setup.planned = st.staff_setup == null ? null : Number(st.staff_setup);
    j.phases.teardown.planned = st.staff_teardown == null ? null : Number(st.staff_teardown);
    [j.phases.setup, j.phases.teardown, j.phases.other, j.total].forEach(function(a) { delete a._who; });
    j.protocols.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return j;
  }).sort(function(a, b) { return a.to < b.to ? 1 : a.to > b.to ? -1 : a.jobNo.localeCompare(b.jobNo); });
}

function dashNkTransportCost(p) {
  return calcDashProtTotal(p.date, !!p.is_holiday, dashTransportsFromRows(p.protocol_transports), []);
}

function dashNkEuro(n) { return (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
function dashNkHours(mins) { return (Math.round((mins || 0) / 6) / 10).toLocaleString('de-DE') + ' h'; }

// One phase as a labelled grid (a table would collapse into unlabelled cards on a phone)
function dashNkRowHtml(label, a, strong) {
  var over = a.planned != null && a.people > a.planned;
  var people = a.people + (a.planned != null ? ' <span class="' + (over ? 'dash-nk-over' : 'ui-sub') + '">/ ' + a.planned + ' geplant</span>' : '');
  var cell = function(name, value, cost) { return '<div' + (cost ? ' class="cost-only"' : '') + '><dt>' + name + '</dt><dd>' + value + '</dd></div>'; };
  return '<div class="dash-nk-ph' + (strong ? ' dash-nk-sum' : '') + '"><div class="dash-nk-ph-title">' + label + '</div><dl class="dash-nk-grid">' +
    cell('Protokolle', a.count) + cell('Leute', people) + cell('Stunden', dashNkHours(a.mins)) +
    cell('Personal', dashNkEuro(a.cost - a.transport), true) + cell('Transport', dashNkEuro(a.transport), true) +
    cell('Gesamt', '<b>' + dashNkEuro(a.cost) + '</b>', true) + '</dl></div>';
}

// links: buttons that open the protocol (dashboard); without them the days are listed as text (Aufträge tab)
function dashNkJobHtml(j, links) {
  var day = function(iso) { return iso.slice(8) + '.' + iso.slice(5, 7) + '.'; };
  var range = j.from === j.to ? day(j.from) : day(j.from) + ' – ' + day(j.to);
  return '<details class="dash-nk-job"><summary><span><b>' + escapeHtml(j.jobNo) + '</b> · ' + escapeHtml(j.name || 'Ohne Projekt') + '</span>' +
    '<span class="ui-sub">' + range + ' · ' + j.total.people + (j.total.people === 1 ? ' Person' : ' Personen') + ' · ' + dashNkHours(j.total.mins) +
    '<span class="cost-only"> · ' + dashNkEuro(j.total.cost) + '</span></span></summary>' +
    DASH_NK_PHASES.filter(function(ph) { return ph[0] !== 'other' || j.phases.other.count; })
      .map(function(ph) { return dashNkRowHtml(ph[1], j.phases[ph[0]], false); }).join('') +
    dashNkRowHtml('Gesamt', j.total, true) +
    (links === false
      ? '<div class="dash-nk-prots ui-sub">Protokolle: ' + j.protocols.map(function(p) { return day(p.date) + ' ' + escapeHtml(p.action || 'Protokoll'); }).join(' · ') + '</div>'
      : '<div class="dash-nk-prots">' + j.protocols.map(function(p) {
          return '<button type="button" class="ui-btn dash-small-btn" onclick="openDashDetail(\'' + jsAttrArg(p.id) + '\')">' + day(p.date) + ' ' + escapeHtml(p.action || 'Protokoll') + '</button>';
        }).join('') + '</div>') + '</details>';
}

function renderDashNachkalk() {
  var box = document.getElementById('dash-nachkalk');
  if (!box) return;
  // Its home is the Aufträge tab, where Admin and PL see it; here it only shows for the others (Buchhaltung, AL)
  if (typeof userRole !== 'undefined' && (userRole === 'Admin' || userRole === 'PL')) { box.innerHTML = ''; return; }
  var wasOpen = !!(box.querySelector('details.dash-nk') || {}).open, openJobs = {};
  box.querySelectorAll('details.dash-nk-job[open] summary b').forEach(function(b) { openJobs[b.textContent] = true; });
  var jobs = dashNachkalk(dashboardProtocols, _dashStaffing, dashNkTransportCost);
  box.innerHTML = '<details class="dash-nk"' + (wasOpen ? ' open' : '') + '><summary>Nachkalkulation pro Auftrag<span class="ui-sub"> · ' +
    jobs.length + (jobs.length === 1 ? ' Auftrag' : ' Aufträge') + '</span></summary>' +
    (jobs.length ? jobs.map(function(j) { return dashNkJobHtml(j); }).join('')
      : '<p class="ui-sub dash-nk-empty">Noch kein Protokoll mit Auftragsnummer. Die Nummer kommt von selbst mit, wenn ein Protokoll aus dem Wochenplan oder der Erinnerung gestartet wird, oder du trägst sie beim Bearbeiten ein.</p>') +
    '</details>';
  box.querySelectorAll('details.dash-nk-job').forEach(function(d) { if (openJobs[(d.querySelector('summary b') || {}).textContent]) d.open = true; });
}

// Protocols and costs of the calendar month of `now`
function dashMonthStats(protocols, now) {
  var ym = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  var count = 0, cost = 0;
  (protocols || []).forEach(function(p) {
    if (String(p.date || '').slice(0, 7) !== ym) return;
    count++;
    cost += Number(p.total_cost) || 0;
  });
  return { count: count, cost: cost };
}

function renderDashStats() {
  var box = document.getElementById('dash-stats');
  if (!box) return;
  var now = new Date(), s = dashMonthStats(dashScopedProtocols(), now);
  var month = now.toLocaleDateString('de-DE', { month: 'long' });
  box.innerHTML =
    '<div class="ui-stat"><span>Protokolle im ' + month + '</span><b>' + s.count + '</b></div>' +
    '<div class="ui-stat cost-only"><span>Kosten im ' + month + '</span><b>' + s.cost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €</b></div>';
}

if (typeof UI_TOPBAR_ITEMS !== 'undefined') {
  UI_TOPBAR_ITEMS.dashboard = function() {
    var view = typeof dashView !== 'undefined' ? dashView : 'prot';
    var items = [];
    if (view === 'prot' && canSeeCosts(currentUser)) items.push({ label: 'Kosten aller Protokolle neu berechnen', action: 'recalcAllProtocolCosts' });
    if (view === 'work' && typeof dashboardCurrentWorker !== 'undefined' && dashboardCurrentWorker) items.push({ label: 'Monat als PDF (' + (dashboardCurrentWorker.full_name || 'Mitarbeiter') + ')', action: 'exportDashboardMonthlyPDF' });
    // The tab bar is hidden (tiles open one view each): settings and the way back are reachable from here
    if (typeof dashView !== 'undefined' && dashView === 'settings') {
      items.push({ label: 'Einstellungen schließen', action: 'switchDashTab', args: [dashViewFromStored(localStorage.getItem(DASH_VIEW_KEY))] });
    } else if (typeof userRole !== 'undefined' && userRole === 'Admin') {
      items.push({ label: 'Einstellungen', action: 'switchDashTab', args: ['settings'] });
    }
    return items;
  };
}

// ── BUCHHALTUNG SHIFTS LOGIC ──

async function loadDashboardWorkers() {
  try {
    const { data: users, error: uErr } = await supabaseClient
      .from('app_users')
      .select('id, full_name, role, default_dept, hourly_rate_internal, role_rates, is_active, is_fest, employment_type, plan_interest_viewer, can_drive, availability_enabled, app_user_private(hourly_rate_conni, income_limit, email)')
      .eq('is_active', true)
      .order('full_name');
    if (uErr) throw uErr;
    
    // Fetch all open shifts to highlight workers
    const { data: pendingShifts } = await supabaseClient
      .from('shifts')
      .select('user_id')
      .eq('status', 'offen');

    const pendingMap = {};
    (pendingShifts || []).forEach(s => {
      if (s.user_id) pendingMap[s.user_id] = (pendingMap[s.user_id] || 0) + 1;
    });
    dashboardWorkers = (users || []).map(flattenPrivate);
    dashPendingMap = pendingMap;
    loadDashInsights();

    const sel = document.getElementById('dash-worker-select');
    const prevSelected = sel.value; // the rebuild below would drop the open employee
    sel.innerHTML = '<option value="">-- Mitarbeiter wählen --</option>';
    dashboardWorkers.forEach(w => {
      const indicator = pendingMap[w.id] ? ' 🔴' : '';
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = (w.full_name || 'Unbekannt') + ' (' + (w.role || '') + ')' + indicator;
      sel.appendChild(opt);
    });
    if (prevSelected) sel.value = prevSelected;
    renderDashWorkerList();
  } catch (err) {
    console.error("Worker fetch err:", err);
  }
}

async function renderWorkerShifts() {
  const userId = document.getElementById('dash-worker-select').value;
  const cont = document.getElementById('worker-shifts-container');

  const head = document.getElementById('dash-worker-head');
  if (!userId) {
    if (head) head.innerHTML = '';
    cont.innerHTML = uiEmptyHtml('Mitarbeiter wählen', 'Wähle links eine Person, um ihre Schichten zu sehen.');
    populateDashboardMonthFilter([]);
    return;
  }

  dashboardCurrentWorker = dashboardWorkers.find(w => w.id === userId);
  if (head) head.innerHTML = dashWorkerHeadHtml(dashboardCurrentWorker);
  cont.innerHTML = '<div class="ui-sub" style="padding:20px 2px;">Schichten werden geladen…</div>';

  try {
    const { data: shifts, error } = await supabaseClient
      .from('shifts')
      .select(`
        *, shift_date,
        protocols(date, projects(name))
      `)
      .eq('user_id', userId);

    // Another person was selected while this one loaded: drop the late answer
    if (document.getElementById('dash-worker-select').value !== userId) return;
    if (error) throw error;

    // Newest first (protocol date → shift_date → created_at), same day by start time
    dashboardCurrentShifts = (shifts || []).slice().sort((a, b) =>
      dashShiftDate(b).localeCompare(dashShiftDate(a)) || String(a.start_time || '').localeCompare(String(b.start_time || '')));
    populateDashboardMonthFilter(dashboardCurrentShifts);
    dashRenderWorkerMonth();
  } catch (err) {
    console.error("Shift load err:", err);
    cont.innerHTML = `<div class="empty-state" style="color:var(--danger)">Fehler beim Laden der Schichten.</div>`;
  }
}

// Day a shift belongs to: protocol date → shift_date → creation day
function dashShiftDate(s) {
  return (s.protocols && s.protocols.date) || s.shift_date || (s.created_at || '').slice(0, 10);
}

function dashBillingCutoff() { return (typeof billingCutoff !== 'undefined') ? billingCutoff : 20; }

// Shifts of one billing month (key from getBillingKeyForDate); shifts without any date never match
function dashShiftsInMonth(shifts, key, cutoff) {
  return (shifts || []).filter(function(s) {
    var d = dashShiftDate(s);
    return !!d && getBillingKeyForDate(new Date(d + 'T12:00:00'), cutoff).key === key;
  });
}

// "Do 5.11." for the shift rows
function dashShortDay(iso) {
  if (!iso) return 'Ohne Datum';
  var p = iso.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
  return ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()] + ' ' + p[2] + '.' + p[1] + '.';
}

function dashShiftRowHtml(s, canEdit) {
  const booked = s.status === 'eingetragen';
  const st = s.start_time ? s.start_time.substring(0, 5) : '';
  const en = s.end_time ? s.end_time.substring(0, 5) : '';
  const netMins = dashShiftNetMins(s);
  const place = s.protocols ? ((s.protocols.projects && s.protocols.projects.name) || 'Protokoll') : (s.ort || 'Manuell erfasst');
  const meta = [st ? st + '–' + (en || '?') : 'ohne Zeiten', s.pause_mins ? s.pause_mins + ' min Pause' : '',
    netMins > 0 ? (netMins / 60).toFixed(2).replace('.', ',') + ' h' : '', s.position_role || ''].filter(Boolean).join(' · ');
  const night = dashIsNightShift(s) ? ' <span class="ui-pill ui-pill-info" title="Mehr als 2 h zwischen 22 und 6 Uhr">Nacht</span>' : '';
  const body = `<span class="dash-shift-top"><b>${escapeHtml(dashShortDay(dashShiftDate(s)))}</b> · ${escapeHtml(place)}</span>` +
    `<span class="ui-sub">${escapeHtml(meta)}${night}</span>`;
  const main = canEdit
    ? `<button type="button" class="dash-shift-main" onclick="openShiftEdit('${escapeHtml(s.id)}')" aria-label="Schicht ${escapeHtml(dashShortDay(dashShiftDate(s)))} bearbeiten">${body}</button>`
    : `<div class="dash-shift-main">${body}</div>`;
  return `<div class="dash-shift${s.status === 'eingetragen' ? ' dash-shift-booked' : ''}">${main}` +
    (canEdit
      ? `<input type="checkbox" ${booked ? 'checked' : ''} data-shift-id="${escapeHtml(s.id)}" class="shift-booked-cb ui-switch" aria-label="Verbucht">`
      : `<span class="ui-pill${booked ? ' ui-pill-ok' : ''}">${booked ? 'verbucht' : 'offen'}</span>`) + '</div>';
}

// Stats, actions and shift rows of the month picked in #dash-month-filter (re-rendered from cache, no reload)
function dashRenderWorkerMonth() {
  const cont = document.getElementById('worker-shifts-container');
  const worker = dashboardCurrentWorker;
  if (!cont || !worker) return;
  const canEdit = dashMayBook(typeof userRole !== 'undefined' ? userRole : null);
  const cutoff = dashBillingCutoff();
  const sel = document.getElementById('dash-month-filter');
  const key = (sel && sel.value) || getBillingKeyForDate(new Date(), cutoff).key;
  const label = sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
  const list = dashShiftsInMonth(dashboardCurrentShifts, key, cutoff);
  const open = list.filter(s => s.status !== 'eingetragen').length;

  const mins = list.reduce((n, s) => n + dashShiftNetMins(s), 0);
  const hrs = mins / 60;
  const eur = n => n.toFixed(2).replace('.', ',') + ' €';
  const rateConni = worker.hourly_rate_conni ? parseFloat(worker.hourly_rate_conni) : null;
  const rateInternal = worker.hourly_rate_internal ? parseFloat(worker.hourly_rate_internal) : null;
  const share = incomeLimitShare(rateConni ? hrs * rateConni : null, worker.income_limit ? parseFloat(worker.income_limit) : null);
  let html = '<div class="ui-stats">' +
    `<div class="ui-stat"><span>Netto-Stunden</span><b>${mins > 0 ? hrs.toFixed(2).replace('.', ',') + ' h' : '—'}</b></div>` +
    `<div class="ui-stat"><span>Schichten</span><b>${list.length}</b><div class="ui-sub">${open ? open + ' offen' : list.length ? 'alle verbucht' : ''}</div></div>` +
    (rateConni ? `<div class="ui-stat cost-only"><span>Lohn (${rateConni.toFixed(2).replace('.', ',')} €/h)</span><b>${hrs > 0 ? eur(hrs * rateConni) : '—'}</b></div>` : '') +
    (rateInternal ? `<div class="ui-stat cost-only"><span>Intern (${rateInternal.toFixed(2).replace('.', ',')} €/h)</span><b>${hrs > 0 ? eur(hrs * rateInternal) : '—'}</b></div>` : '') +
    (share ? `<div class="ui-stat cost-only"><span>Grenze ${eur(parseFloat(worker.income_limit))}</span><b>${share.pct} %</b>` +
      `<div class="ui-bar${share.over ? ' ui-bar-over' : share.pct >= 80 ? ' ui-bar-warn' : ''}"><i style="width:${share.pct}%"></i></div></div>` : '') +
    '</div>';

  const actions = (canEdit ? `<button type="button" class="ui-btn dash-small-btn" onclick="openAddShift()">+ Schicht</button>` : '') +
    (open && canEdit ? `<button type="button" class="ui-btn ui-btn-primary dash-small-btn" onclick="markAllShiftsBooked('${escapeHtml(worker.id)}')">${open} offene verbuchen</button>` : '');
  if (actions) html += `<div class="dash-shift-actions">${actions}</div>`;

  html += list.length
    ? `<div class="dash-shift-list">${list.map(s => dashShiftRowHtml(s, canEdit)).join('')}</div>`
    : uiEmptyHtml('Keine Schichten', label ? 'Im Abrechnungsmonat ' + label + ' ist nichts erfasst.' : 'Für diese Person sind noch keine Schichten erfasst.');
  cont.innerHTML = html;

  cont.querySelectorAll('.shift-booked-cb').forEach(function(cb) {
    cb.addEventListener('change', function() { toggleShiftBooked(this.dataset.shiftId, this.checked); });
  });
}

async function toggleShiftBooked(shiftId, checked) {
  const newStat = checked ? 'eingetragen' : 'offen';
  try {
    const { data: rows, error } = await supabaseClient
      .from('shifts')
      .update({ status: newStat })
      .eq('id', shiftId)
      .select('id');
      
    if (error) throw error;
    // RLS answers with 0 rows instead of an error
    if (!rows || rows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung');
    if (typeof showToast === 'function') showToast(checked ? "Schicht verbucht!" : "Verbuchung aufgehoben");
    
    // Update local state without full rerender to avoid jumpiness
    const st = dashboardCurrentShifts.find(x => x.id === shiftId);
    if (st) st.status = newStat;
    dashRenderWorkerMonth(); // counts and "offene verbuchen" follow
    loadDashboardWorkers(); // Update dropdown highlights silently
  } catch (err) {
    console.error("Update shift err", err);
    if (typeof showToast === 'function') showToast("Fehler: " + (err.message || "Speichern fehlgeschlagen"), "danger");
    renderWorkerShifts(); // Revert on failure
  }
}

async function markAllShiftsBooked(userId) {
  const sel = document.getElementById('dash-month-filter');
  const key = (sel && sel.value) || getBillingKeyForDate(new Date(), dashBillingCutoff()).key;
  const ids = dashShiftsInMonth(dashboardCurrentShifts, key, dashBillingCutoff())
    .filter(function(s) { return s.user_id === userId && s.status !== 'eingetragen'; }).map(function(s) { return s.id; });
  if (!ids.length) { if (typeof showToast === 'function') showToast('Keine offenen Schichten zum Verbuchen.', 'info'); return; }
  const label = sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : 'diesem Monat';
  if (!confirm(ids.length + ' offene Schicht' + (ids.length === 1 ? '' : 'en') + ' im Abrechnungsmonat ' + label + ' als eingetragen markieren?')) return;
  try {
    const { data: rows, error } = await supabaseClient
      .from('shifts')
      .update({ status: 'eingetragen' })
      .in('id', ids)
      .eq('user_id', userId)
      .neq('status', 'eingetragen')
      .select('id');
      
    if (error) throw error;
    // RLS answers with 0 rows instead of an error
    // 0 rows: nothing was open, or RLS refused – both mean nothing changed, which is not a failure the user caused
    if (!rows || rows.length === 0) { if (typeof showToast === 'function') showToast('Keine offenen Schichten zum Verbuchen.', 'info'); return; }
    if (typeof showToast === 'function') showToast("Alle Schichten erfolgreich gebucht!");
    renderWorkerShifts();
  } catch(e) {
    console.error("Update All Err:", e);
    if (typeof showToast === 'function') showToast("Fehler: " + (e.message || "Speichern fehlgeschlagen"), "danger");
  }
}

// ── SCHICHT BEARBEITEN / HINZUFÜGEN ──

let _shiftEditId = null; // null = neuer Eintrag, sonst Supabase-ID
function openShiftEdit(shiftId) {
  const shift = dashboardCurrentShifts.find(s => s.id === shiftId);
  if (!shift) return;
  _shiftEditId = shiftId;
  document.getElementById('shift-edit-title').textContent = 'Schicht bearbeiten';
  const dateVal = shift.protocols?.date || shift.shift_date || '';
  document.getElementById('shift-edit-date').value  = dateVal;
  document.getElementById('shift-edit-ort').value   = shift.ort || '';
  var sp = splitPosition(shift.position_role || 'MA');
  var selRole = (sp.type || sp.legacy) ? sp.func : (shift.position_role || 'MA');
  dashShiftRoleOption(selRole);
  document.getElementById('shift-edit-role').value  = selRole;
  document.getElementById('shift-edit-start').value = (shift.start_time || '').substring(0, 5);
  document.getElementById('shift-edit-end').value   = (shift.end_time   || '').substring(0, 5);
  document.getElementById('shift-edit-note').value  = shift.note || '';
  document.getElementById('shift-edit-delete-row').style.display = 'block';
  document.getElementById('shift-edit-modal').classList.add('open');
}

// A stored role the select does not offer (legacy "MA" without fest/frei) gets a temporary option,
// otherwise saving would blank it. Options added earlier are removed first.
function dashShiftRoleOption(role) {
  var sel = document.getElementById('shift-edit-role');
  if (!sel || !sel.options) return;
  for (var i = sel.options.length - 1; i >= 0; i--) if (sel.options[i].dataset && sel.options[i].dataset.extra) sel.removeChild(sel.options[i]);
  if (!role) return;
  for (var j = 0; j < sel.options.length; j++) if (sel.options[j].value === role) return;
  var opt = document.createElement('option');
  opt.value = role; opt.textContent = role; opt.dataset.extra = '1';
  sel.appendChild(opt);
}

// Break for a saved shift: the stored one stays unless start/end changed (then the automatic break applies again)
function dashEditPause(old, startVal, endVal, autoVal) {
  if (!old || old.pause_mins === null || old.pause_mins === undefined) return autoVal;
  var timesChanged = (old.start_time || '').substring(0, 5) !== startVal || (old.end_time || '').substring(0, 5) !== endVal;
  return timesChanged ? autoVal : (parseInt(old.pause_mins, 10) || 0);
}

function openAddShift() {
  _shiftEditId = null;
  document.getElementById('shift-edit-title').textContent = 'Schicht hinzufügen';
  document.getElementById('shift-edit-date').value  = localDateStr();
  document.getElementById('shift-edit-ort').value   = '';
  dashShiftRoleOption(null);
  document.getElementById('shift-edit-role').value  = 'MA';
  document.getElementById('shift-edit-start').value = '';
  document.getElementById('shift-edit-end').value   = '';
  document.getElementById('shift-edit-note').value  = '';
  document.getElementById('shift-edit-delete-row').style.display = 'none';
  document.getElementById('shift-edit-modal').classList.add('open');
}

function closeShiftEditModal() {
  document.getElementById('shift-edit-modal').classList.remove('open');
  _shiftEditId = null;
}

async function saveShiftEdit() {
  const dateVal  = document.getElementById('shift-edit-date').value;
  const editedShift = _shiftEditId ? dashboardCurrentShifts.find(function(x) { return x.id === _shiftEditId; }) : null;
  const role     = dashShiftSaveRole(document.getElementById('shift-edit-role').value, editedShift ? editedShift.position_role : null,
    dashboardCurrentWorker && dashboardCurrentWorker.employment_type);
  const startVal = document.getElementById('shift-edit-start').value;
  const endVal   = document.getElementById('shift-edit-end').value;
  const ortVal   = (document.getElementById('shift-edit-ort') || {}).value || '';
  const rawMins  = (timeToMins(endVal) || 0) - (timeToMins(startVal) || 0);
  let pause      = autoPause(rawMins < 0 ? rawMins + 1440 : rawMins);

  if (!dateVal || !startVal || !endVal) {
    if (typeof showToast === 'function') showToast('Bitte Datum, Von und Bis ausfüllen.', 'danger');
    return;
  }

  try {
    if (_shiftEditId) {
      // Edit existing shift (a manually set break stays unless the times changed)
      pause = dashEditPause(dashboardCurrentShifts.find(function(x) { return x.id === _shiftEditId; }), startVal, endVal, pause);
      const { data: uRows, error } = await supabaseClient.from('shifts').update({
        shift_date:    dateVal,
        position_role: role,
        start_time:    startVal,
        end_time:      endVal,
        pause_mins:    pause,
        ort:           ortVal || null,
      }).eq('id', _shiftEditId).select('id');
      if (error) throw error;
      // RLS answers with 0 rows instead of an error
      if (!uRows || uRows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung');
      if (typeof showToast === 'function') showToast('Schicht gespeichert!');
    } else {
      // New shift linked to a worker (existing worker-dashboard flow)
      const userId = document.getElementById('dash-worker-select').value;
      if (!userId) { if (typeof showToast === 'function') showToast('Kein Mitarbeiter ausgewählt.', 'danger'); return; }
      const { data: iRows, error } = await supabaseClient.from('shifts').insert({
        user_id:       userId,
        shift_date:    dateVal,
        position_role: role,
        start_time:    startVal,
        end_time:      endVal,
        pause_mins:    pause,
        ort:           ortVal || null,
        status:        'offen',
      }).select('id');
      if (error) throw error;
      if (!iRows || iRows.length === 0) throw new Error('Einfügen abgelehnt – keine Berechtigung');
      if (typeof showToast === 'function') showToast('Schicht hinzugefügt!');
    }

    closeShiftEditModal();
    renderWorkerShifts();
  } catch (err) {
    console.error('saveShiftEdit error:', err);
    if (typeof showToast === 'function') showToast('Fehler: ' + (err.message || 'Speichern fehlgeschlagen'), 'danger');
  }
}

async function deleteShiftFromModal() {
  if (!_shiftEditId) return;
  if (!confirm('Schicht wirklich löschen?')) return;
  try {
    const { data: rows, error } = await supabaseClient.from('shifts').delete().eq('id', _shiftEditId).select('id');
    if (error) throw error;
    // RLS answers with 0 rows instead of an error
    if (!rows || rows.length === 0) throw new Error('Löschen abgelehnt – keine Berechtigung');
    if (typeof showToast === 'function') showToast('Schicht gelöscht.');
    closeShiftEditModal();
    renderWorkerShifts();
  } catch (err) {
    console.error('deleteShift error:', err);
    if (typeof showToast === 'function') showToast('Fehler beim Löschen: ' + (err.message || 'unbekannt'), 'danger');
  }
}

// ── PROTOCOL COST RECALCULATION ──

// All employees incl. deactivated ones by id – appUsers (protokoll.js) only holds the active ones
var _dashRateUsers = {};
var _dashRateUsersLoaded = false;

// Same lookup as getEffectivePersonnelRate (role rate, then base rate) on a user object; undefined = none
function dashUserRate(user, basePos) {
  if (!user) return undefined;
  if (Array.isArray(user.role_rates)) {
    var match = user.role_rates.find(function(r) { return r.role === basePos; }) ||
      user.role_rates.find(function(r) { return roleRateMatches(r.role, basePos); });
    if (match && parseFloat(match.rate_internal) > 0) return parseFloat(match.rate_internal);
  }
  if (parseFloat(user.hourly_rate_internal) > 0) return parseFloat(user.hourly_rate_internal);
  return undefined;
}

async function dashRefreshRateUsers() {
  if (typeof supabaseClient === 'undefined') return;
  try {
    // appUsers drives the pickers and the rates of new work: reload it as well (rates may just have changed)
    if (typeof fetchAppUsers === 'function') await fetchAppUsers();
    var { data, error } = await supabaseClient.from('app_users').select('id, role, role_rates, hourly_rate_internal, is_active');
    if (error) throw error;
    var map = {};
    (data || []).forEach(function(u) { map[u.id] = u; });
    _dashRateUsers = map;
    _dashRateUsersLoaded = true;
  } catch (e) { console.warn('Stundensätze nicht geladen:', e); }
}

// Cost lines of one stored shift, with the employee's own rate like the app (getEffectivePersonnelRate)
function dashShiftCosts(date, isHoliday, s) {
  var von = (s.start_time || '').substring(0, 5);
  var bis = (s.end_time || '').substring(0, 5);
  if (!von || !bis || typeof calcSplitShiftCosts !== 'function') return [];
  var sp = von.split(':').map(Number), ep = bis.split(':').map(Number);
  if (sp.length !== 2 || ep.length !== 2 || isNaN(sp[0]) || isNaN(ep[0])) return [];
  var v = sp[0] * 60 + (sp[1] || 0);
  var b = ep[0] * 60 + (ep[1] || 0);
  if (b < v) b += 1440;
  if (b <= v) return [];
  var basePos = s.position_role || 'MA frei';
  var customRate = (s.user_id && typeof getEffectivePersonnelRate === 'function')
    ? getEffectivePersonnelRate(basePos, s.user_id) : undefined;
  // Not among the active app users (deactivated, or not loaded yet): the dashboard's own copy has the rates
  if (customRate === undefined && s.user_id) customRate = dashUserRate(_dashRateUsers[s.user_id], basePos);
  return calcSplitShiftCosts(basePos, date, !!isHoliday, v, b, parseInt(s.pause_mins) || 0, customRate);
}

// protocol_transports rows → { type, hours, driverUserId, driver } (the shape of the app's transports)
function dashTransportsFromRows(rows) {
  return (rows || []).map(function(t) {
    return { type: t.vehicle_type, driver: t.driver_name || '', hours: t.driver_hours == null ? null : Number(t.driver_hours),
      driverUserId: t.driver_user_id || '', cost: t.cost == null ? null : Number(t.cost) };
  });
}

// Protocol total with the same formula as calcProtCosts in the app; transports = [{ type, hours, driverUserId, driver }]
// (rows without hours cost no driver, so totals of old protocols stay as they were)
function calcDashProtTotal(date, isHoliday, transports, shifts) {
  var total = 0;
  (transports || []).forEach(function(t) {
    total += (typeof calcTransportCost === 'function') ? calcTransportCost(t.type, date, t.cost) : 0;
    var drv = (typeof protDriverCost === 'function') ? protDriverCost(t, typeof appUsers !== 'undefined' ? appUsers : []) : null;
    if (drv) total += drv.amount;
  });
  (shifts || []).forEach(function(s) {
    dashShiftCosts(date, isHoliday, s).forEach(function(c) { total += c.hrs * c.rate; });
  });
  return isNaN(total) ? 0 : Math.round(total * 100) / 100;
}

// AL/PL typed in the edit modal → { id, fallback }. Unchanged name keeps the id; a changed name
// gets an id only on a unique exact (case-insensitive) match, else it stays free text.
function dashResolvePerson(typed, currentName, currentId, users) {
  var name = (typed || '').trim();
  if (!name) return { id: null, fallback: null };
  if (name === (currentName || '').trim()) return { id: currentId || null, fallback: name };
  var lower = name.toLowerCase();
  var hits = (users || []).filter(function(u) { return (u.full_name || '').trim().toLowerCase() === lower; });
  return { id: hits.length === 1 ? hits[0].id : null, fallback: name };
}

// ── Protokoll bearbeiten: personnel rows ──
// Editor row: { id?, userId, name, pos (AL/MA/Fahrer/Zenjob/…), fest, start, end, pause }

function dashShiftToRow(s) {
  var role = s.position_role || '';
  return {
    id: s.id,
    userId: s.user_id || '',
    name: (s.app_users && s.app_users.full_name) || s.temp_worker_name || ((typeof appUsers !== 'undefined' ? appUsers : []).find(function(u) { return u.id === s.user_id; }) || {}).full_name || '',
    pos: splitPosition(role).func,
    fest: / fest$/.test(role),
    type: splitPosition(role).type,
    legacy: splitPosition(role).legacy,
    start: (s.start_time || '').substring(0, 5),
    end: (s.end_time || '').substring(0, 5),
    pause: s.pause_mins || 0
  };
}

// Editor row → the writable shift fields (fest/frei via protBasePos like the Protokoll form)
function dashShiftRowToDb(row, users) {
  var userId = row.userId || null;
  var name = (row.name || '').trim();
  return {
    user_id: userId,
    temp_worker_name: userId ? null : (name || null),
    position_role: protBasePos({ pos: row.pos, isTemp: !userId, userId: userId, fest: row.fest, type: row.type, legacy: row.legacy }, users),
    start_time: row.start || null,
    end_time: row.end || null,
    pause_mins: parseInt(row.pause, 10) || 0
  };
}

// Diff of the stored shifts against the edited rows. Existing shifts are only ever updated in place
// (patch = changed fields), so status ('verbucht') and ids survive; ids missing from the rows are deleted.
function dashShiftChanges(oldShifts, editedRows, users) {
  var kept = {}, updates = [], inserts = [], deletes = [];
  (editedRows || []).forEach(function(row) {
    var old = row.id ? (oldShifts || []).find(function(s) { return s.id === row.id; }) : null;
    var next = dashShiftRowToDb(row, users);
    if (!old) { inserts.push(Object.assign(next, { status: 'offen' })); return; }
    kept[old.id] = true;
    var patch = {};
    var oldBase = splitPosition(old.position_role).func;
    if ((old.user_id || null) !== next.user_id || (old.temp_worker_name || null) !== next.temp_worker_name) {
      patch.user_id = next.user_id;
      patch.temp_worker_name = next.temp_worker_name;
    }
    // Same base position and person: keep the stored role as it is (fest/frei, legacy values)
    if (!(row.pos === oldBase && (old.user_id || null) === next.user_id) && old.position_role !== next.position_role) patch.position_role = next.position_role;
    if ((old.start_time || '').substring(0, 5) !== (next.start_time || '')) patch.start_time = next.start_time;
    if ((old.end_time || '').substring(0, 5) !== (next.end_time || '')) patch.end_time = next.end_time;
    if ((parseInt(old.pause_mins, 10) || 0) !== next.pause_mins) patch.pause_mins = next.pause_mins;
    // Hours that were already booked for someone else / for other times are open again for the accounting
    if (old.status && old.status !== 'offen' && ('user_id' in patch || 'start_time' in patch || 'end_time' in patch || 'pause_mins' in patch)) patch.status = 'offen';
    if (Object.keys(patch).length) updates.push({ id: old.id, patch: patch });
  });
  (oldShifts || []).forEach(function(s) { if (!kept[s.id]) deletes.push(s.id); });
  return { updates: updates, inserts: inserts, deletes: deletes };
}

// Dashboard protocol row → archive entry for buildProtPdfDoc (one PDF builder for app and dashboard)
function dashProtToEntry(p, signature) {
  var entry = protRowToEntry(p);
  entry.signature = signature || null;
  return entry;
}

// Employee rates live in appUsers (protokoll.js); load them when the dashboard opens first
async function ensureRateUsers() {
  if (typeof appUsers !== 'undefined' && appUsers.length === 0 && typeof fetchAppUsers === 'function') {
    try { await fetchAppUsers(); } catch (e) { console.warn('app_users für Stundensätze nicht geladen:', e); }
  }
  if (!_dashRateUsersLoaded && typeof supabaseClient !== 'undefined') await dashRefreshRateUsers();
}

var _recalcRunning = false; // the menu item has no button to disable → guard against a second tap
async function recalcAllProtocolCosts() {
  if (_recalcRunning) return;
  _recalcRunning = true;
  try { await recalcAllProtocolCostsRun(); } finally { _recalcRunning = false; }
}

async function recalcAllProtocolCostsRun() {
  if (!dashboardProtocols || dashboardProtocols.length === 0) {
    if (typeof showToast === 'function') showToast('Keine Protokolle geladen.', 'danger');
    return;
  }
  const btn = document.getElementById('btn-recalc-costs');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Berechne...'; }

  let updated = 0, errors = 0;

  await ensureRateUsers();
  for (const p of dashboardProtocols) {
    const rounded = calcDashProtTotal(p.date, p.is_holiday,
      dashTransportsFromRows(p.protocol_transports), p.shifts || []);

    try {
      const { data: upd, error } = await supabaseClient
        .from('protocols')
        .update({ total_cost: rounded })
        .eq('id', p.id)
        .select('id');
      if (error) throw error;
      // RLS answers with 0 rows instead of an error
      if (!upd || upd.length === 0) throw new Error('Update abgelehnt (keine Berechtigung)');
      p.total_cost = rounded;
      updated++;
    } catch (e) {
      console.error('recalc error for', p.id, e);
      errors++;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = '↻ Kosten neu berechnen'; }
  const msg = `${updated} Protokoll${updated !== 1 ? 'e' : ''} aktualisiert` + (errors ? `, ${errors} Fehler` : '');
  if (typeof showToast === 'function') showToast(msg, errors ? 'danger' : 'success');
  _dashboardRefreshing = false;
  await refreshDashboard();
}

// ── PROTOCOL DETAILS & EXPORT ──

// Zenjob/Rockit ratings are stored per protocol by worker name (shift_id is never set)
function ratingForShift(p, s) {
  const key = ratingKeyForShift(s);
  if (!key) return null;
  return (p.worker_ratings || []).find(r => (r.temp_worker_name || '').trim().toLowerCase() === key) || null;
}

function isAgencyShift(s) {
  return /^(Zenjob|Rockit)/.test(s.position_role || '');
}

function openDashDetail(id) {
  const p = dashboardProtocols.find(x => x.id === id);
  if (!p) return;
  _editProtId = id;

  const modal = document.getElementById('dash-detail-modal');
  if (!modal) return;

  // ── Header ──
  document.getElementById('det-title').textContent = p.projects ? p.projects.name : 'Protokoll';
  const holidayBadge = p.is_holiday
    ? ' <span style="display:inline-block;font-size:11px;background:#f59e0b;color:#fff;padding:2px 7px;border-radius:10px;vertical-align:middle;margin-left:6px;">Feiertag</span>'
    : '';
  document.getElementById('det-subtitle').innerHTML =
    escapeHtml(new Date(p.date).toLocaleDateString('de-DE')) + ' · ' + escapeHtml(p.action) + holidayBadge;

  // ── Meta grid ──
  const alName = p.al ? p.al.full_name : (p.al_name_fallback || '—');
  const plName = p.pl ? p.pl.full_name : (p.pl_name_fallback || '—');
  document.getElementById('det-meta').innerHTML = `
    <div>
      <div class="stat-label">Ort</div>
      <div style="font-weight:600;">${escapeHtml(p.location || p.projects?.location || '—')}</div>
    </div>
    <div>
      <div class="stat-label">Leitung (AL)</div>
      <div style="font-weight:600;">${escapeHtml(alName)}</div>
    </div>
    <div>
      <div class="stat-label">Projektleiter (PL)</div>
      <div style="font-weight:600;">${escapeHtml(plName)}</div>
    </div>${p.job_no ? `
    <div>
      <div class="stat-label">Auftrag</div>
      <div style="font-weight:600;">${escapeHtml(p.job_no)}</div>
    </div>` : ''}
    <div class="cost-only">
      <div class="stat-label">Gesamtkosten (Schätzung)</div>
      <div style="font-weight:600; color:var(--accent);">${escapeHtml((p.total_cost || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 }))} €</div>
    </div>
    <div>
      <div class="stat-label">Mail an PL</div>
      ${p.mailed_at
        ? `<div style="font-weight:600;">📧 ${escapeHtml(new Date(p.mailed_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</div>`
        : '<div style="color:var(--text3);">noch nicht gemailt</div>'}
    </div>
    <div>
      <div class="stat-label">Interne ID</div>
      <div style="font-family:monospace; font-size:11px; opacity:0.6;">${escapeHtml(p.id.substring(0,8))}</div>
    </div>
  `;

  // ── Transports ──
  const transports = p.protocol_transports || [];
  let transHtml = '';
  if (transports.length === 0) {
    transHtml = '<div style="font-size:13px; color:var(--text3); padding:8px 0;">Keine Transportdaten erfasst</div>';
  } else {
    transHtml = '<table class="compact-table"><thead><tr><th>Fahrzeug</th><th>Fahrer</th><th>Pünktlichkeit</th><th>Verspätung</th></tr></thead><tbody>';
    transports.forEach(t => {
      const delay = t.delay_mins ? `${escapeHtml(String(t.delay_mins))} Min` : '—';
      const punctStyle = t.punctuality === 'verspätet'
        ? 'color:#ef4444;font-weight:600;'
        : 'color:#22c55e;font-weight:600;';
      transHtml += `<tr>
        <td>${escapeHtml(t.vehicle_type || '—')}</td>
        <td>${escapeHtml(t.driver_name || '—')}${t.driver_hours > 0 ? ' · ' + escapeHtml(String(Number(t.driver_hours)).replace('.', ',')) + ' h' : ''}</td>
        <td style="${punctStyle}">${escapeHtml(t.punctuality || '—')}</td>
        <td>${delay}</td>
      </tr>`;
    });
    transHtml += '</tbody></table>';
  }
  document.getElementById('det-transports').innerHTML = transHtml;

  // ── Equipment / Gewerke ──
  const GEWERKE_LABELS = { mobiliar: 'Mobiliar', stoffe: 'Stoffe & Hussen', floristik: 'Floristik', tischlerei: 'Tischlerei', logistik: 'Logistik' };
  const STATUS_COLORS = { okay: '#22c55e', unsauber: '#f59e0b', beschädigt: '#ef4444', unvollständig: '#f97316' };
  const equipments = p.protocol_equipments || [];
  let equipHtml = '';
  if (equipments.length === 0) {
    equipHtml = '<div style="font-size:13px; color:var(--text3); padding:8px 0;">Keine Gewerke-Daten erfasst</div>';
  } else {
    equipHtml = '<div style="display:flex; flex-direction:column; gap:8px;">';
    equipments.forEach(eq => {
      const label = GEWERKE_LABELS[eq.category_id] || eq.category_id;
      const color = STATUS_COLORS[eq.status] || '#888'; // color comes from safe lookup dict
      let extra = '';
      if (eq.category_id === 'stoffe' && (eq.hussen_delivered != null || eq.hussen_returned != null)) {
        extra = `<div style="font-size:11px; color:var(--text3); margin-top:3px;">Estrel-Hussen: geliefert ${escapeHtml(String(eq.hussen_delivered ?? '—'))} / zurück ${escapeHtml(String(eq.hussen_returned ?? '—'))}</div>`;
      }
      const note = eq.note ? `<div style="font-size:12px; color:var(--text2); margin-top:2px;">${escapeHtml(eq.note)}</div>` : '';
      equipHtml += `<div style="display:flex; align-items:flex-start; gap:12px; padding:10px 12px; background:var(--bg2); border-radius:10px;">
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13px;">${escapeHtml(label)}</div>
          ${note}${extra}
        </div>
        <span style="display:inline-block; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700; background:${color}20; color:${color}; border:1px solid ${color}40; white-space:nowrap;">${escapeHtml(eq.status || 'okay')}</span>
      </div>`;
    });
    equipHtml += '</div>';
  }
  document.getElementById('det-equipment').innerHTML = equipHtml;

  // ── Shifts / Personnel (fixed Netto) ──
  let shiftsHtml = '<table class="compact-table"><thead><tr><th>Person / Rolle</th><th>Zeit</th><th>Netto</th></tr></thead><tbody>';
  if (p.shifts && p.shifts.length > 0) {
    p.shifts.forEach(s => {
      const name = s.temp_worker_name || (s.app_users ? s.app_users.full_name : 'Mitarbeiter');
      const role = s.position_role || 'Personal';
      const von = (s.start_time || '').substring(0, 5);
      const bis = (s.end_time || '').substring(0, 5);

      let netStr = '—';
      if (von && bis) {
        const [sh, sm] = von.split(':').map(Number);
        const [eh, em] = bis.split(':').map(Number);
        if (!isNaN(sh) && !isNaN(eh)) {
          let startMins = sh * 60 + sm;
          let endMins = eh * 60 + em;
          if (endMins < startMins) endMins += 1440;
          const netMins = endMins - startMins - (s.pause_mins || 0);
          if (netMins > 0) {
            const effectiveMins = Math.max(180, netMins);
            const h = Math.floor(effectiveMins / 60);
            const m = effectiveMins % 60;
            netStr = m > 0 ? `${h}h ${m}m` : `${h}h`;
          }
        }
      }

      let ratingHtml = '';
      if (isAgencyShift(s)) {
        const r = ratingForShift(p, s);
        ratingHtml = !r
          ? '<div style="font-size:11px; color:var(--text3);">keine Bewertung</div>'
          : '<div style="font-size:11px; font-weight:600; color:' + (r.rating === 'up' ? '#22c55e' : '#ef4444') + ';">'
            + (r.rating === 'up' ? '👍 gut' : '👎 schlecht') + (r.is_star ? ' ⭐' : '') + '</div>';
      }

      shiftsHtml += `<tr>
        <td><div style="font-weight:600;">${escapeHtml(name)}</div><div style="font-size:10px; opacity:0.6;">${escapeHtml(role)}</div>${ratingHtml}</td>
        <td>${escapeHtml(von)} – ${escapeHtml(bis)}</td>
        <td style="font-weight:600; color:var(--accent);">${escapeHtml(netStr)}</td>
      </tr>`;
    });
  } else {
    shiftsHtml += '<tr><td colspan="3">Keine Personal-Daten vorhanden</td></tr>';
  }
  shiftsHtml += '</tbody></table>';
  document.getElementById('det-shifts').innerHTML = shiftsHtml;

  // ── Nebenkalkulation (itemisiert) ──
  (function() {
    var rows = [];
    var logTotal = 0, persTotal = 0;

    // Transport costs
    (p.protocol_transports || []).forEach(function(t) {
      var r = (typeof calcTransportCost !== 'undefined') ? calcTransportCost(t.vehicle_type, p.date, t.cost) : 0;
      var label = escapeHtml(t.vehicle_type || '—');
      if (t.vehicle_type === 'Spedition' && t.cost == null) {
        rows.push({ section: 'transport', label: label, detail: escapeHtml(t.driver_name || '') + ' (siehe Rechnung)', cost: 0 });
      } else if (r > 0) {
        logTotal += r;
        rows.push({ section: 'transport', label: label, detail: escapeHtml(t.driver_name || ''), cost: r });
      }
      var drv = (typeof protDriverCost === 'function') ? protDriverCost(dashTransportsFromRows([t])[0], typeof appUsers !== 'undefined' ? appUsers : []) : null;
      if (drv) {
        logTotal += drv.amount;
        rows.push({ section: 'transport', label: 'Fahrer ' + escapeHtml(t.driver_name || ''), detail: drv.hrs.toFixed(2) + 'h × ' + drv.rate.toFixed(2) + ' €', cost: drv.amount });
      }
    });

    // Personnel costs
    (p.shifts || []).forEach(function(s) {
      var name = s.temp_worker_name || (s.app_users ? s.app_users.full_name : 'Mitarbeiter');
      dashShiftCosts(p.date, p.is_holiday, s).forEach(function(c) {
        var sub = c.hrs * c.rate;
        persTotal += sub;
        rows.push({ section: 'personal', label: escapeHtml(name), detail: escapeHtml(c.desc), hrs: c.hrs, rate: c.rate, cost: sub });
      });
    });

    var grandTotal = logTotal + persTotal;

    if (rows.length === 0) {
      document.getElementById('det-nebenkalkulation').innerHTML =
        '<div style="font-size:13px; color:var(--text3); padding:8px 0;">Keine Kostendaten verfügbar</div>';
      return;
    }

    var html = '<table class="compact-table"><thead><tr><th>Position</th><th>Detail</th><th style="text-align:right;">Kosten</th></tr></thead><tbody>';

    var lastSection = null;
    rows.forEach(function(row) {
      if (row.section !== lastSection) {
        var sectionLabel = row.section === 'transport' ? '🚚 Logistik / Transport' : '👤 Personal';
        html += '<tr><td colspan="3" style="padding:6px 8px; font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text3); background:var(--bg2);">' + sectionLabel + '</td></tr>';
        lastSection = row.section;
      }
      if (row.section === 'transport') {
        html += '<tr><td style="font-weight:600;">' + row.label + '</td><td style="color:var(--text2); font-size:12px;">' + row.detail + '</td><td style="text-align:right; font-weight:600; color:var(--accent);">' + row.cost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €</td></tr>';
      } else {
        html += '<tr><td style="font-weight:600;">' + row.label + '<div style="font-size:10px; opacity:0.6;">' + row.detail + '</div></td>'
          + '<td style="font-size:12px; color:var(--text2);">' + row.hrs.toFixed(2) + 'h × ' + row.rate.toFixed(2) + ' €</td>'
          + '<td style="text-align:right; font-weight:600; color:var(--accent);">' + row.cost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €</td></tr>';
      }
    });

    // Subtotals + grand total
    html += '<tr><td colspan="3" style="padding:0;"></td></tr>';
    if (logTotal > 0) {
      html += '<tr style="background:var(--bg2);"><td colspan="2" style="font-size:12px; color:var(--text2);">Logistik gesamt</td><td style="text-align:right; font-size:12px; color:var(--text2);">' + logTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €</td></tr>';
    }
    if (persTotal > 0) {
      html += '<tr style="background:var(--bg2);"><td colspan="2" style="font-size:12px; color:var(--text2);">Personal gesamt</td><td style="text-align:right; font-size:12px; color:var(--text2);">' + persTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €</td></tr>';
    }
    html += '<tr style="border-top:2px solid var(--accent);"><td colspan="2" style="font-weight:700;">Gesamtkosten (geschätzt)</td><td style="text-align:right; font-weight:700; font-size:15px; color:var(--accent);">' + grandTotal.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €</td></tr>';
    html += '</tbody></table>';

    document.getElementById('det-nebenkalkulation').innerHTML = html;
  })();

  // ── Notes ──
  document.getElementById('det-notes').innerHTML = `
    <div style="margin-bottom:12px;"><strong>Mängel / Schäden:</strong><br/>${safeNote(p.notes_damages)}</div>
    <div style="margin-bottom:12px;"><strong>Besondere Vorkommnisse:</strong><br/>${safeNote(p.notes_incidents)}</div>
    <div><strong>Feedback Location:</strong><br/>${safeNote(p.notes_feedback)}</div>
  `;

  modal.classList.add('open');
}

function closeDashDetail() {
  const modal = document.getElementById('dash-detail-modal');
  if (modal) modal.classList.remove('open');
}

// ── PROTOCOL EDIT ──

var _editProtId = null;
var _editProtTransports = [];
var _editProtShifts = []; // editor rows, see dashShiftToRow

var _PE_CATEGORIES = [
  { id: 'mobiliar',  label: 'Mobiliar' },
  { id: 'stoffe',    label: 'Stoffe & Hussen' },
  { id: 'floristik', label: 'Floristik' },
  { id: 'tischlerei',label: 'Tischlerei' },
  { id: 'logistik',  label: 'Lager / Logistik' }
];

var _PE_ACTIONS = ['Aufbau', 'Teilaufbau', 'Umbau', 'Teilabbau', 'Abbau'];
var _PE_POSITIONS = ['AL', 'MA', 'Fahrer', 'Zenjob', 'Rockit'];

// Aktion as a segmented control (like the Protokoll form); the hidden #pe-action is the data source.
// A stored action outside the list (older protocols) stays selectable.
function renderDashPeActionSeg() {
  var inp = document.getElementById('pe-action'), seg = document.getElementById('pe-action-seg');
  if (!inp || !seg) return;
  var cur = inp.value;
  var acts = (cur && _PE_ACTIONS.indexOf(cur) === -1) ? _PE_ACTIONS.concat([cur]) : _PE_ACTIONS;
  seg.innerHTML = acts.map(function(a) {
    return '<button type="button" class="' + (a === cur ? 'active' : '') + '" onclick="setDashPeAction(' + uiArg(a) + ')">' + escapeHtml(a) + '</button>';
  }).join('');
}

function setDashPeAction(v) {
  document.getElementById('pe-action').value = v;
  renderDashPeActionSeg();
}

function openDashProtEdit() {
  const p = dashboardProtocols.find(x => x.id === _editProtId);
  if (!p) return;

  document.getElementById('pe-date').value    = p.date || '';
  document.getElementById('pe-action').value  = p.action || 'Aufbau';
  renderDashPeActionSeg();
  document.getElementById('pe-holiday').checked = !!p.is_holiday;
  // AL/PL: picking a name from the list resolves to the user id on save (dashResolvePerson); free text stays a name
  document.getElementById('pe-al-wrap').innerHTML = uiComboHtml('pe-al', p.al ? p.al.full_name : (p.al_name_fallback || ''), 'Name wählen oder eingeben', '', '');
  document.getElementById('pe-pl-wrap').innerHTML = uiComboHtml('pe-pl', p.pl ? p.pl.full_name : (p.pl_name_fallback || ''), 'Name wählen oder eingeben', '', '');
  if (document.getElementById('pe-job')) document.getElementById('pe-job').value = p.job_no || '';
  document.getElementById('pe-damages').value  = p.notes_damages || '';
  document.getElementById('pe-incidents').value = p.notes_incidents || '';
  document.getElementById('pe-feedback').value  = p.notes_feedback || '';

  _editProtTransports = (p.protocol_transports || []).map(t => ({
    type: t.vehicle_type || 'Sprinter',
    driver: t.driver_name || '',
    driverUserId: t.driver_user_id || '',
    hours: t.driver_hours == null ? null : Number(t.driver_hours),
    punctuality: t.punctuality || 'pünktlich',
    delay: t.delay_mins || '',
    cost: t.cost == null ? null : Number(t.cost)
  }));
  _editProtShifts = (p.shifts || []).map(dashShiftToRow);

  ensureRateUsers(); // the name comboboxes list appUsers
  renderDashProtTransports();
  renderDashProtEquipment(p.protocol_equipments || []);
  renderDashPeShifts();

  document.getElementById('dash-prot-edit-modal').classList.add('open');
}

function closeDashProtEdit() {
  document.getElementById('dash-prot-edit-modal').classList.remove('open');
}

function renderDashProtTransports() {
  var c = document.getElementById('pe-transports');
  if (!c) return;
  if (!_editProtTransports.length) {
    c.innerHTML = '<div class="ui-sub" style="margin-bottom:8px;">Kein Transport erfasst.</div>';
    return;
  }
  c.innerHTML = _editProtTransports.map(function(t, i) {
    var vehicles = protVehicleTypes();
    if (t.type && vehicles.indexOf(t.type) === -1) vehicles.push(t.type);
    var selOpts = vehicles.map(function(v) {
      return '<option value="' + escapeHtml(v) + '"' + (t.type === v ? ' selected' : '') + '>' + escapeHtml(v) + '</option>';
    }).join('');
    var delayField = t.punctuality === 'verspätet'
      ? '<label class="ui-field"><span>Verspätung (Min)</span><input type="number" inputmode="numeric" placeholder="Min" value="' + escapeHtml(t.delay || '') + '" oninput="_editProtTransports[' + i + '].delay=this.value"></label>'
      : '';
    return '<div class="ui-card">' +
      '<div class="stunden-grid">' +
        '<label class="ui-field"><span>Fahrzeug</span><select onchange="_editProtTransports[' + i + '].type=this.value;renderDashProtTransports()">' + selOpts + '</select></label>' +
        '<div class="ui-field"><span>Fahrer</span>' + uiComboHtml('pe-drv-' + i, t.driver || '', 'Name', 'onDashDriverName', i) + '</div>' +
      '</div>' +
      '<div class="stunden-grid">' +
        '<label class="ui-field"><span>Fahrerstunden</span><input type="number" step="0.5" min="0" inputmode="decimal" placeholder="Std" value="' + escapeHtml(t.hours == null ? '' : t.hours) + '" oninput="_editProtTransports[' + i + '].hours=this.value"></label>' +
        '<label class="ui-field"><span>Pünktlichkeit</span><select onchange="_editProtTransports[' + i + '].punctuality=this.value;renderDashProtTransports()">' +
          '<option value="pünktlich"' + (t.punctuality === 'pünktlich' ? ' selected' : '') + '>Pünktlich</option>' +
          '<option value="verspätet"' + (t.punctuality === 'verspätet' ? ' selected' : '') + '>Verspätet</option>' +
        '</select></label>' +
      '</div>' +
      delayField +
      (t.type === 'Spedition' ? '<label class="ui-field"><span>Kosten Spedition (€)</span><input type="number" step="0.01" min="0" inputmode="decimal" placeholder="laut Rechnung" value="' + escapeHtml(t.cost == null ? '' : t.cost) + '" oninput="_editProtTransports[' + i + '].cost=this.value"></label>' : '') +
      '<button type="button" class="ui-btn ui-btn-danger prot-remove" onclick="_editProtTransports.splice(' + i + ',1);renderDashProtTransports()">Transport entfernen</button>' +
    '</div>';
  }).join('');
}

// Driver picked from the combobox or typed: a registered user sets the user id (rate lookup), free text clears it
function onDashDriverName(idx, val) {
  var t = _editProtTransports[idx];
  if (!t) return;
  var typed = (val || '').trim();
  if (typed === (t.driver || '') && (t.driverUserId || !typed)) return; // untouched (keeps the id of duplicate names)
  var hits = (typeof appUsers !== 'undefined' ? appUsers : []).filter(function(u) { return (u.full_name || '').trim().toLowerCase() === typed.toLowerCase(); });
  t.driver = typed;
  t.driverUserId = hits.length === 1 ? hits[0].id : '';
}

function addDashProtTransport() {
  _editProtTransports.push({ type: 'Hängerzug', driver: '', driverUserId: '', hours: 5, punctuality: 'pünktlich', delay: '' });
  renderDashProtTransports();
}

// ── Personnel rows (edited in place, see dashShiftChanges) ──

function renderDashPeShifts() {
  var c = document.getElementById('pe-shifts');
  if (!c) return;
  if (!_editProtShifts.length) {
    c.innerHTML = '<div class="ui-sub" style="margin-bottom:8px;">Keine Personen erfasst.</div>';
    return;
  }
  c.innerHTML = _editProtShifts.map(function(r, i) {
    var positions = _PE_POSITIONS.indexOf(r.pos) === -1 && r.pos ? _PE_POSITIONS.concat([r.pos]) : _PE_POSITIONS;
    var opts = positions.map(function(o) {
      return '<option value="' + escapeHtml(o) + '"' + (r.pos === o ? ' selected' : '') + '>' + escapeHtml(o) + '</option>';
    }).join('');
    return '<div class="ui-card">' +
      '<div class="stunden-grid">' +
        '<div class="ui-field"><span>Name</span>' + uiComboHtml('pe-sh-' + i, r.name || '', 'Name wählen oder eingeben', 'onDashShiftName', i) + '</div>' +
        '<label class="ui-field"><span>Position</span><select onchange="updateDashPeShift(' + i + ',\'pos\',this.value)">' + opts + '</select></label>' +
      '</div>' +
      '<div class="prot-time-grid">' +
        '<label class="ui-field"><span>Start</span><input type="time" id="pe-sh-start-' + i + '" value="' + escapeHtml(r.start || '') + '" oninput="updateDashPeShift(' + i + ',\'start\',this.value)"></label>' +
        '<label class="ui-field"><span>Ende</span><input type="time" id="pe-sh-end-' + i + '" value="' + escapeHtml(r.end || '') + '" oninput="updateDashPeShift(' + i + ',\'end\',this.value)"></label>' +
        '<label class="ui-field"><span>Pause</span><input type="number" inputmode="numeric" id="pe-sh-pause-' + i + '" placeholder="Min" value="' + escapeHtml(r.pause || 0) + '" oninput="updateDashPeShift(' + i + ',\'pause\',this.value)"></label>' +
      '</div>' +
      '<button type="button" class="ui-btn ui-btn-danger prot-remove" onclick="removeDashPeShift(' + i + ')">Person entfernen</button>' +
    '</div>';
  }).join('');
}

// Name picked from the combobox or typed: a registered user sets the id (and fest/frei), free text becomes an Externe(r)
function onDashShiftName(idx, val) {
  var r = _editProtShifts[idx];
  if (!r) return;
  var typed = (val || '').trim();
  if (typed === (r.name || '')) return; // untouched (keeps the id of duplicate names)
  var hits = (typeof appUsers !== 'undefined' ? appUsers : []).filter(function(u) { return (u.full_name || '').trim().toLowerCase() === typed.toLowerCase(); });
  r.name = typed;
  if (hits.length === 1) { r.userId = hits[0].id; r.fest = !!hits[0].is_fest; r.type = hits[0].employment_type || null; }
  else { r.userId = ''; r.fest = false; r.type = null; }
  r.legacy = false; // another person: their own type applies
}

function updateDashPeShift(idx, field, val) {
  var r = _editProtShifts[idx];
  if (!r) return;
  r[field] = val;
  if (field === 'pos') { r.legacy = false; r.type = null; } // another function: the person's current type applies
  if (field === 'pause') r.pauseTouched = true;
  // A new row suggests the break from its length until the break was typed by hand
  if ((field === 'start' || field === 'end') && !r.id && !r.pauseTouched && r.start && r.end) {
    var raw = (timeToMins(r.end) || 0) - (timeToMins(r.start) || 0);
    r.pause = autoPause(raw < 0 ? raw + 1440 : raw);
    var el = document.getElementById('pe-sh-pause-' + idx);
    if (el) el.value = r.pause;
  }
}

function addDashPeShift() {
  _editProtShifts.push({ userId: '', name: '', pos: 'MA', fest: false, start: '', end: '', pause: 0 });
  renderDashPeShifts();
}

function removeDashPeShift(idx) {
  var r = _editProtShifts[idx];
  if (!r) return;
  if (!confirm('Person' + (r.name ? ' „' + r.name + '“' : '') + ' aus dem Protokoll entfernen?')) return;
  _editProtShifts.splice(idx, 1);
  renderDashPeShifts();
}

function renderDashProtEquipment(existing) {
  var c = document.getElementById('pe-equipment');
  if (!c) return;
  var existMap = {};
  existing.forEach(function(e) { existMap[e.category_id] = e; });

  c.innerHTML = _PE_CATEGORIES.map(function(cat) {
    var e = existMap[cat.id] || {};
    // Categories not stored with the protocol were switched off by the AL → keep them off
    var status = existMap[cat.id] ? (e.status || 'okay') : '';
    var note   = e.note   || '';
    var hDel   = e.hussen_delivered || '';
    var hRet   = e.hussen_returned  || '';
    var hussenHtml = cat.id === 'stoffe'
      ? '<div class="stunden-grid">' +
          '<label class="ui-field"><span>Hussen geliefert</span><input type="number" inputmode="numeric" id="pe-hd-' + cat.id + '" value="' + hDel + '"></label>' +
          '<label class="ui-field"><span>Hussen zurück</span><input type="number" inputmode="numeric" id="pe-hr-' + cat.id + '" value="' + hRet + '"></label>' +
        '</div>'
      : '';
    return '<div class="ui-card">' +
      '<label class="ui-field"><span>' + escapeHtml(cat.label) + '</span>' +
        '<select id="pe-st-' + cat.id + '">' +
          '<option value=""' + (status === '' ? ' selected' : '') + '>Ausgeblendet</option>' +
          ['okay','unsauber','beschädigt','unvollständig'].map(function(s) {
            return '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
          }).join('') +
        '</select></label>' +
      '<label class="ui-field"><span>Notiz</span><input type="text" id="pe-nt-' + cat.id + '" value="' + escapeHtml(note) + '" placeholder="Notiz (optional)"></label>' +
      hussenHtml +
    '</div>';
  }).join('');
}

// Replace the child rows of a protocol: insert the new rows first, then delete the old ones by id.
// Every write must touch the expected number of rows (RLS answers with 0 rows instead of an error).
// prot[prop] follows what is really stored, so a retry after a failure deletes exactly what exists.
async function dashReplaceRows(table, prot, prop, newRows) {
  const oldRows = prot[prop] || [];
  let inserted = [];
  if (newRows.length) {
    const { data, error } = await supabaseClient.from(table).insert(newRows).select('id');
    if (error) throw error;
    if (!data || data.length !== newRows.length) throw new Error('Einfügen abgelehnt – keine Berechtigung (' + table + ')');
    inserted = newRows.map(function(r, k) { return Object.assign({}, r, { id: data[k].id }); });
    prot[prop] = oldRows.concat(inserted);
  }
  const ids = oldRows.map(function(r) { return r.id; }).filter(Boolean);
  if (ids.length) {
    const { data, error } = await supabaseClient.from(table).delete().in('id', ids).select('id');
    if (error) throw error;
    if (!data || data.length !== ids.length) throw new Error('Löschen abgelehnt – keine Berechtigung (' + table + ')');
  }
  prot[prop] = inserted;
}

// Editor transport → protocol_transports row. The delay field only exists for "verspätet": a value left there
// after switching back to "pünktlich" must not be stored.
function dashTransportToDb(protocolId, t) {
  return { protocol_id: protocolId, vehicle_type: t.type, driver_name: t.driver || null,
           punctuality: t.punctuality, delay_mins: t.punctuality === 'verspätet' && t.delay ? (parseInt(t.delay, 10) || 0) : 0,
           driver_hours: parseFloat(t.hours) >= 0 ? parseFloat(t.hours) : null, driver_user_id: t.driverUserId || null,
           cost: t.type === 'Spedition' && parseFloat(t.cost) >= 0 ? parseFloat(t.cost) : null };
}

// Did the transports (type, driver, driver hours – the cost-relevant parts) change against the stored rows?
function dashTransportsChanged(storedRows, edited) {
  const key = function(t) {
    const h = parseFloat(t.hours);
    const c = t.type === 'Spedition' ? parseFloat(t.cost) : NaN;
    return [t.type || '', (t.driver || '').trim(), t.driverUserId || '', h >= 0 ? h : '', c >= 0 ? c : ''].join('|');
  };
  const a = dashTransportsFromRows(storedRows).map(key), b = (edited || []).map(key);
  return a.length !== b.length || a.some(function(k, i) { return k !== b[i]; });
}

async function saveDashProtEdit() {
  const p = dashboardProtocols.find(x => x.id === _editProtId);
  if (!p) return;
  const saveBtn = document.getElementById('pe-save-btn');
  if (saveBtn && saveBtn.disabled) return;

  // A name typed but not yet committed (no blur before the tap) still counts
  _editProtShifts.forEach(function(r, i) { const el = document.getElementById('pe-sh-' + i); if (el) onDashShiftName(i, el.value); });
  _editProtTransports.forEach(function(t, i) { const el = document.getElementById('pe-drv-' + i); if (el) onDashDriverName(i, el.value); });
  if (_editProtShifts.some(function(r) { return !r.userId && !(r.name || '').trim(); })) {
    showToast('Bitte bei jeder Person einen Namen angeben.', 'danger');
    return;
  }

  const alVal = document.getElementById('pe-al').value.trim();
  const plVal = document.getElementById('pe-pl').value.trim();
  const newDate = document.getElementById('pe-date').value || p.date;
  const isHoliday = document.getElementById('pe-holiday').checked;

  // A changed AL/PL name must not be hidden behind the old al_id/pl_id (the join wins in the display)
  await ensureRateUsers();
  const users = (typeof dashboardWorkers !== 'undefined' && dashboardWorkers.length) ? dashboardWorkers
    : (typeof appUsers !== 'undefined' ? appUsers : []);
  const al = dashResolvePerson(alVal, p.al ? p.al.full_name : (p.al_name_fallback || ''), p.al_id, users);
  const pl = dashResolvePerson(plVal, p.pl ? p.pl.full_name : (p.pl_name_fallback || ''), p.pl_id, users);
  const rateUsers = typeof appUsers !== 'undefined' ? appUsers : [];
  // p.shifts is kept in step with what is already written (see below), so a second Speichern after a partial failure continues cleanly
  const ch = dashShiftChanges(p.shifts || [], _editProtShifts, rateUsers);
  // Old totals must not drift with today's rates: recompute only if something that costs money changed
  const costChanged = newDate !== p.date || isHoliday !== !!p.is_holiday
    || dashTransportsChanged(p.protocol_transports, _editProtTransports)
    || ch.updates.length > 0 || ch.inserts.length > 0 || ch.deletes.length > 0;

  const protPayload = {
    date:            newDate,
    action:          document.getElementById('pe-action').value,
    is_holiday:      isHoliday,
    al_id:           al.id,
    pl_id:           pl.id,
    al_name_fallback: al.fallback,
    pl_name_fallback: pl.fallback,
    notes_damages:   document.getElementById('pe-damages').value.trim()   || null,
    notes_incidents: document.getElementById('pe-incidents').value.trim() || null,
    notes_feedback:  document.getElementById('pe-feedback').value.trim()  || null,
  };
  const jobEl = document.getElementById('pe-job');
  if (jobEl) {
    if (!protJobNoValid(jobEl.value)) { showToast('Die Auftragsnummer sieht so aus: 26-0447.01. Bitte korrigieren oder leer lassen.', 'danger'); return; }
    protPayload.job_no = protJobNo(jobEl.value) || null;
  }
  // Same formula as the app, from the edited transports and the edited personnel (not the stored ones)
  if (costChanged) protPayload.total_cost = calcDashProtTotal(newDate, isHoliday, _editProtTransports,
    _editProtShifts.map(function(r) { return dashShiftRowToDb(r, rateUsers); }));

  if (saveBtn) saveBtn.disabled = true;
  try {
    const { data: pRows, error: pErr } = await supabaseClient.from('protocols').update(protPayload).eq('id', _editProtId).select('id');
    if (pErr) throw pErr;
    // RLS answers with 0 rows instead of an error
    if (!pRows || pRows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung (protocols)');

    // Shifts carry their own date (Buchhaltung) → follow a date change
    if (newDate && newDate !== p.date && (p.shifts || []).length) {
      const { data: sdRows, error: sdErr } = await supabaseClient.from('shifts').update({ shift_date: newDate }).eq('protocol_id', _editProtId).select('id');
      if (sdErr) throw sdErr;
      if (!sdRows || sdRows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung (shifts)');
    }

    // Personnel: update existing shifts in place (status and ids survive), insert new rows, delete removed ones
    const stored = p.shifts || (p.shifts = []);
    for (const u of ch.updates) {
      const { data: uRows, error: uErr } = await supabaseClient.from('shifts').update(u.patch).eq('id', u.id).select('id');
      if (uErr) throw uErr;
      if (!uRows || uRows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung (shifts)');
      Object.assign(stored.find(function(s) { return s.id === u.id; }) || {}, u.patch);
    }
    if (ch.inserts.length) {
      const ort = (p.projects && p.projects.location) || null;
      const rows = ch.inserts.map(function(r) { return Object.assign({ protocol_id: _editProtId, shift_date: newDate, ort: ort }, r); });
      const { data: iRows, error: iErr } = await supabaseClient.from('shifts').insert(rows).select('id');
      if (iErr) throw iErr;
      if (!iRows || iRows.length !== rows.length) throw new Error('Einfügen abgelehnt – keine Berechtigung (shifts)');
      // Remember the new ids right away: a second Speichern after a later failure must not insert (and pay) them again
      const fresh = _editProtShifts.filter(function(r) { return !(r.id && stored.some(function(s) { return s.id === r.id; })); });
      rows.forEach(function(row, k) {
        if (fresh[k]) fresh[k].id = iRows[k].id;
        stored.push(Object.assign({}, row, { id: iRows[k].id }));
      });
    }
    if (ch.deletes.length) {
      const { data: dRows, error: dErr } = await supabaseClient.from('shifts').delete().in('id', ch.deletes).select('id');
      if (dErr) throw dErr;
      if (!dRows || dRows.length !== ch.deletes.length) throw new Error('Löschen abgelehnt – keine Berechtigung (shifts)');
      p.shifts = stored.filter(function(s) { return ch.deletes.indexOf(s.id) === -1; });
    }

    // Transports: write the new rows first, then remove the old ones by id (a failure never leaves the protocol without them)
    const tInserts = _editProtTransports.map(function(t) { return dashTransportToDb(_editProtId, t); });
    await dashReplaceRows('protocol_transports', p, 'protocol_transports', tInserts);

    // Equipment: same order
    const eInserts = _PE_CATEGORIES.filter(function(cat) {
      return (document.getElementById('pe-st-' + cat.id) || {}).value !== '';
    }).map(function(cat) {
      return {
        protocol_id:      _editProtId,
        category_id:      cat.id,
        status:           (document.getElementById('pe-st-' + cat.id) || {}).value || 'okay',
        note:             (document.getElementById('pe-nt-' + cat.id) || {}).value.trim() || null,
        hussen_delivered: cat.id === 'stoffe' ? (parseInt((document.getElementById('pe-hd-stoffe') || {}).value) || null) : null,
        hussen_returned:  cat.id === 'stoffe' ? (parseInt((document.getElementById('pe-hr-stoffe') || {}).value) || null) : null,
      };
    });
    // Unique (protocol_id, category_id) forbids insert-before-delete: upsert per category, then drop removed ones
    let eRows = [];
    if (eInserts.length) {
      const { data, error } = await supabaseClient.from('protocol_equipments').upsert(eInserts, { onConflict: 'protocol_id,category_id' }).select('*');
      if (error) throw error;
      if (!data || data.length !== eInserts.length) throw new Error('Speichern abgelehnt – keine Berechtigung (protocol_equipments)');
      eRows = data;
    }
    const keepCats = eInserts.map(function(r) { return r.category_id; });
    const dropIds = (p.protocol_equipments || []).filter(function(r) { return keepCats.indexOf(r.category_id) === -1; })
      .map(function(r) { return r.id; }).filter(Boolean);
    if (dropIds.length) {
      const { data, error } = await supabaseClient.from('protocol_equipments').delete().in('id', dropIds).select('id');
      if (error) throw error;
      if (!data || data.length !== dropIds.length) throw new Error('Löschen abgelehnt – keine Berechtigung (protocol_equipments)');
    }
    p.protocol_equipments = eRows;

    showToast('✅ Protokoll gespeichert!');
    closeDashProtEdit();
    await refreshDashboard();
    // Re-open detail with updated data
    openDashDetail(_editProtId);
  } catch (err) {
    console.error('saveDashProtEdit error:', err);
    showToast('Fehler: ' + (err.message || 'Speichern fehlgeschlagen'), 'danger');
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

// PDF EXPORT FROM DASHBOARD
// Same builder as the app (buildProtPdfDoc): holiday, date-based transport rates, employee rates,
// category labels and minimum hours all match the PDF the AL mails.
async function exportDashProtPDF(pId) {
  const p = dashboardProtocols.find(x => x.id === pId);
  if (!p) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("PDF Engine nicht geladen!"); return;
  }

  if (typeof showToast === 'function') showToast('Generiere Protokoll-PDF...');
  try {
    await ensureRateUsers();
    // The signature is only fetched here, so the dashboard list doesn't load every base64 image
    let signature = null;
    const { data: sigRow, error: sigErr } = await supabaseClient
      .from('protocols').select('signature_text').eq('id', pId).maybeSingle();
    if (sigErr) console.warn('Unterschrift nicht geladen:', sigErr);
    else if (sigRow) signature = sigRow.signature_text || null;

    const entry = dashProtToEntry(p, signature);
    buildProtPdfDoc(entry, { costs: canSeeCosts(currentUser) }).save(protPdfFileName(entry));
  } catch (err) {
    console.error('exportDashProtPDF error:', err);
    if (typeof showToast === 'function') showToast('PDF konnte nicht erstellt werden', 'danger');
  }
}

// Expose shift-edit functions globally (belt-and-suspenders for inline onclick handlers)
window.openShiftEdit = openShiftEdit;
window.openAddShift  = openAddShift;
window.closeShiftEditModal = closeShiftEditModal;
window.saveShiftEdit = saveShiftEdit;
window.deleteShiftFromModal = deleteShiftFromModal;

// ── PERSONAL MONTHLY PDF EXPORT ──

function populateDashboardMonthFilter(shifts) {
  const sel = document.getElementById('dash-month-filter');
  const btn = document.getElementById('dash-export-month-btn');
  if (!sel || !btn) return;

  const months = {};
  const cur = getBillingKeyForDate(new Date(), billingCutoff);
  if ((shifts || []).length) months[cur.key] = cur.label;
  (shifts || []).forEach(function(s) {
    const dStr = (s.protocols && s.protocols.date) || s.shift_date;
    if (!dStr) return;
    const dObj = new Date(dStr + 'T12:00:00');
    const m = getBillingKeyForDate(dObj, billingCutoff);
    months[m.key] = m.label;
  });

  const sortedKeys = Object.keys(months).sort().reverse();
  const keep = sel.value;
  sel.innerHTML = sortedKeys.map(function(k) { return '<option value="' + k + '">' + months[k] + '</option>'; }).join('');

  if (sortedKeys.length > 0) {
    sel.value = sortedKeys.indexOf(keep) !== -1 ? keep : cur.key;
    sel.style.display = '';
    btn.style.display = '';
  } else {
    sel.style.display = 'none';
    btn.style.display = 'none';
  }
}

async function exportDashboardMonthlyPDF() {
  try {
    await exportDashboardMonthlyPDFRun();
  } catch (err) {
    console.error('exportDashboardMonthlyPDF error:', err);
    showToast('PDF konnte nicht erstellt werden', 'danger');
  }
}

async function exportDashboardMonthlyPDFRun() {
  const mKey = (document.getElementById('dash-month-filter') || {}).value;
  if (!mKey || !dashboardCurrentWorker) return;

  const workerName = dashboardCurrentWorker.full_name || 'Mitarbeiter';
  showToast('PDF wird erstellt…');

  const { data: shifts, error } = await supabaseClient
    .from('shifts')
    .select(`
      id, start_time, end_time, pause_mins, position_role, status, shift_date, ort,
      protocols(date, al_name_fallback, pl_name_fallback, signature_text, projects(name, location))
    `)
    .eq('user_id', dashboardCurrentWorker.id);

  if (error || !shifts || !shifts.length) { showToast('Keine Daten gefunden.'); return; }

  // Group shifts into week buckets, keeping only the selected month
  const userWeeks = {};
  shifts.forEach(function(s) {
    const dStr = (s.protocols && s.protocols.date) || s.shift_date;
    if (!dStr) return;
    const dObj = new Date(dStr + 'T12:00:00');
    // Day-precise cutoff assignment: the shift's own date decides the billing
    // period, not the week it happens to sit in
    if (getBillingKeyForDate(dObj, billingCutoff).key !== mKey) return;
    const wStr = getWeekString(dObj);

    if (!userWeeks[wStr]) {
      userWeeks[wStr] = {
        name: workerName,
        abt: s.position_role || 'MA',
        weekStart: wStr,
        weekLabel: weekLabelFromVal(wStr),
        days: [],
        total: '0'
      };
      const mon = getMondayFromWeekVal(wStr);
      for (var i = 0; i < 7; i++) {
        const iterD = new Date(mon.getTime() + i * 86400000);
        userWeeks[wStr].days.push({
          day: DAYS[i],
          date: fmtDateFull(iterD),
          isoDate: iterD.getFullYear() + '-' + pad(iterD.getMonth() + 1) + '-' + pad(iterD.getDate()),
          shifts: []
        });
      }
    }

    const dayMatch = userWeeks[wStr].days.find(function(d) { return d.isoDate === dStr; });
    if (dayMatch) {
      const prot = s.protocols || {};
      const ortParts = prot.projects ? [prot.projects.location, prot.projects.name].filter(Boolean) : [];
      dayMatch.shifts.push({
        von: (s.start_time || '').substring(0, 5),
        bis: (s.end_time || '').substring(0, 5),
        pause: s.pause_mins ? String(s.pause_mins) : '0',
        ort: ortParts.length ? ortParts.join(', ') : (s.ort || ''),
        al: prot.al_name_fallback || prot.pl_name_fallback || '',
        dept: s.position_role || 'MA',
        sig: prot.signature_text || null,
        isProtocol: !!s.protocols
      });
    }
  });
  // Same rule as the worker's Stundenzettel: a protocol shift replaces an overlapping self-entered one
  Object.keys(userWeeks).forEach(function(wStr) {
    userWeeks[wStr].days.forEach(function(dd) { dd.shifts = dropOverriddenShifts(dd.shifts); });
  });

  // Calculate weekly and monthly totals
  var mTot = 0, mLab = '';
  const monthW = Object.keys(userWeeks).sort().map(function(wStr) {
    const w = userWeeks[wStr];
    var wMins = 0;
    w.days.forEach(function(dd) {
      dd.shifts.forEach(function(sh) {
        const v = timeToMins(sh.von), b = timeToMins(sh.bis), p = parseInt(sh.pause) || 0;
        if (v !== null && b !== null) {
          const effB = b < v ? b + 1440 : b;
          if (effB > v) wMins += (BUCHHALTUNG_MIN_HOURS_ENABLED ? Math.max(BUCHHALTUNG_MIN_HOURS * 60, effB - v - p) : effB - v - p);
        }
      });
    });
    const wTot = wMins / 60;
    w.total = wTot % 1 === 0 ? wTot.toFixed(0) : wTot.toFixed(2);
    mTot += wTot;
    if (!mLab) mLab = monthLabelFromKey(mKey);
    return w;
  });

  if (!monthW.length) { showToast('Keine Schichten in diesem Monat.'); return; }

  // Compress signatures before embedding
  const sigComprP = [];
  monthW.forEach(function(w) {
    w.days.forEach(function(dd) {
      (dd.shifts || []).forEach(function(sh) {
        if (sh.sig) sigComprP.push(new Promise(function(res) {
          compressSignature(sh.sig, function(c) { sh.sig = c; res(); });
        }));
      });
    });
  });
  await Promise.all(sigComprP);

  // Build PDF — same layout as exportMonthlyPDF
  const doc = pdfPatch(new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }));
  const ml = 20, cw = 170;

  if (typeof LOGO_BASE64 !== 'undefined') {
    try { const lw = 30, lh = Math.round(lw * (LOGO_H / LOGO_W) * 100) / 100; doc.addImage(LOGO_BASE64, 'PNG', 160, 10, lw, lh); } catch(e) {}
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Monatsübersicht', ml, 25);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120); doc.text('Lübbert Event Interiors', ml, 32); doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text('Monat:', ml, 48); doc.setFont('helvetica', 'bold'); doc.text(mLab, ml + 25, 48);
  doc.setFont('helvetica', 'normal'); doc.text('Zeitraum:', ml, 56); doc.setFont('helvetica', 'bold'); doc.text(getBillingPeriodLabel(mKey, billingCutoff), ml + 25, 56);
  doc.setFont('helvetica', 'normal'); doc.text('Name:', ml, 64); doc.setFont('helvetica', 'bold'); doc.text(workerName, ml + 25, 64);

  const colKW = ml, colZR = ml + 37, colAbt = ml + 105, colSt = ml + 155;
  var y = 80;
  doc.setFillColor(30, 30, 28); doc.rect(ml, y, cw, 10, 'F'); doc.setTextColor(255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('Kalenderwoche', colKW + 3, y + 6.5);
  doc.text('Zeitraum', colZR, y + 6.5);
  doc.text('Abteilung', colAbt, y + 6.5);
  doc.text('Stunden', colSt, y + 6.5);
  doc.setTextColor(0); y += 10;

  var rowIdx = 0;
  monthW.forEach(function(w) {
    var pages = splitWeekByDepts(w);
    pages.forEach(function(pw, pi) {
      if (rowIdx % 2 === 0) { doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 10, 'F'); }
      doc.setFont('helvetica', 'bold');
      doc.text(pi === 0 ? 'KW ' + parseInt(pw.weekStart.split('-W')[1]) : '', colKW + 3, y + 6.5);
      doc.setFont('helvetica', 'normal');
      const rangeLabel = (pw.weekLabel || '').split('·');
      doc.text(pi === 0 ? (rangeLabel[1] || rangeLabel[0] || '').trim() : '', colZR, y + 6.5);
      doc.text(pw.abt || '—', colAbt, y + 6.5);
      doc.setFont('helvetica', 'bold'); doc.text(pw.total + ' h', colSt, y + 6.5);
      doc.setDrawColor(220); doc.line(ml, y + 10, ml + cw, y + 10);
      y += 10; rowIdx++;
    });
  });

  y += 10; doc.setFontSize(14); doc.text('Gesamtstunden:', ml, y);
  doc.setTextColor(24, 95, 165); doc.text((mTot % 1 === 0 ? mTot.toFixed(0) : mTot.toFixed(2)) + ' h', ml + 50, y); doc.setTextColor(0);

  // Set rate for drawPDFContent earnings line, then restore
  const prevRate = window.currentUserRateConni;
  window.currentUserRateConni = dashboardCurrentWorker.hourly_rate_conni ? parseFloat(dashboardCurrentWorker.hourly_rate_conni) : 0;
  monthW.forEach(function(w) {
    splitWeekByDepts(w).forEach(function(pageData) { doc.addPage(); drawPDFContent(doc, pageData, ml, cw); });
  });
  window.currentUserRateConni = prevRate;

  const fN = 'stundennachweis_' + mKey.replace('-', '_') + '_' + workerName.replace(/\s+/g, '_') + '.pdf';
  doc.save(fN); showToast('📄 Monats-PDF gespeichert!');
}
