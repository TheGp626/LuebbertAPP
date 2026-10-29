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

  if (tab === 'settings' && typeof renderSettingsTab === 'function') renderSettingsTab();

  if (tab === 'work' && dashboardWorkers.length === 0) {
    loadDashboardWorkers();
  }
}

// Opens/closes the "Mitarbeiter hinzufügen" sheet (name kept: addDashboardUser closes it after saving)
function toggleAddUserForm() {
  const m = document.getElementById('add-user-modal');
  if (m) m.classList.toggle('open');
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
  var listEl = document.getElementById('dash-worker-list');
  if (!listEl) return;
  var selected = (document.getElementById('dash-worker-select') || {}).value || '';
  var query = (document.getElementById('dash-worker-search') || {}).value || '';
  var rows = dashWorkerList(dashboardWorkers, dashPendingMap, query);
  listEl.innerHTML = rows.length ? rows.map(function(w) { return dashWorkerRowHtml(w, selected); }).join('') : uiEmptyHtml('Niemand gefunden', '');
  var panel = document.getElementById('pending-workers-panel'), chips = document.getElementById('pending-workers-chips');
  var pending = rows.filter(function(w) { return w.pending > 0; });
  if (panel && chips) {
    panel.style.display = pending.length && !query.trim() ? 'block' : 'none';
    chips.innerHTML = pending.map(function(w) { return dashWorkerRowHtml(w, selected); }).join('');
  }
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

function dashWorkerHeadHtml(w) {
  if (!w) return '';
  var rates = [w.hourly_rate_conni ? 'Lohn ' + parseFloat(w.hourly_rate_conni).toFixed(2).replace('.', ',') + ' €/h' : '',
    w.hourly_rate_internal ? 'intern ' + parseFloat(w.hourly_rate_internal).toFixed(2).replace('.', ',') + ' €/h' : ''].filter(Boolean).join(' · ');
  return '<div class="ui-title" style="font-size:20px;">' + escapeHtml(w.full_name || 'Unbekannt') + '</div>' +
    '<div class="ui-sub">' + escapeHtml([w.role, w.default_dept].filter(Boolean).join(' · ')) + (rates ? ' · ' + escapeHtml(rates) : '') + '</div>';
}

function updateEditWorkerBtn() {
  const btn = document.getElementById('edit-worker-btn');
  if (!btn) return;
  const selected = document.getElementById('dash-worker-select').value;
  btn.style.display = selected ? 'inline-flex' : 'none';
}

var _editWorkerRoleRates = [];

function openEditWorker() {
  const worker = dashboardCurrentWorker;
  if (!worker) return;
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
  document.getElementById('edit-worker-fest').checked = !!worker.is_fest;
  document.getElementById('edit-worker-modal').classList.add('open');
}

var _ROLE_RATE_OPTIONS = ['AL frei', 'MA frei', 'Fahrer frei', 'Floristik', 'Lager', 'Stoffe', 'Tischlerei', 'AL fest', 'MA fest', 'Fahrer fest'];

function renderRoleRatesList() {
  var c = document.getElementById('edit-worker-role-rates');
  if (!c) return;
  c.innerHTML = _editWorkerRoleRates.map(function(r, i) {
    var opts = _ROLE_RATE_OPTIONS.map(function(o) {
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
  _editWorkerRoleRates.push({ role: 'MA frei', rate_conni: null, rate_internal: null });
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
    const { error } = await supabaseClient.from('app_users').update({ is_active: false }).eq('id', worker.id);
    if (error) throw error;
    closeEditWorker();
    showToast('Mitarbeiter deaktiviert.');
    await loadDashboardWorkers();
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
    hourly_rate_conni:    parseFloat(document.getElementById('edit-worker-rate-conni').value)    || null,
    hourly_rate_internal: parseFloat(document.getElementById('edit-worker-rate-internal').value) || null,
    income_limit:         parseFloat(document.getElementById('edit-worker-income-limit').value)  || null,
    email:                email || null,
    role_rates:           _editWorkerRoleRates.filter(function(r) { return r.role; }),
    is_fest:              document.getElementById('edit-worker-fest').checked,
  };

  try {
    const { error } = await supabaseClient.from('app_users').update(payload).eq('id', worker.id);
    if (error) throw error;
    showToast('Mitarbeiter gespeichert!');
    closeEditWorker();
    await loadDashboardWorkers();
    // Re-select the same worker after reload
    const sel = document.getElementById('dash-worker-select');
    if (sel) { sel.value = worker.id; renderWorkerShifts(); }
    if (typeof fetchEmployees === 'function') fetchEmployees();
  } catch (err) {
    console.error('saveEditWorker error:', err);
    showToast('Fehler beim Speichern: ' + (err.message || err.code || JSON.stringify(err)), 'danger');
  }
}

async function addDashboardUser() {
  const firstName = (document.getElementById('new-user-firstname') || {}).value?.trim() || '';
  const lastName  = (document.getElementById('new-user-lastname')  || {}).value?.trim() || '';
  const fullName  = (firstName + ' ' + lastName).trim();
  const role = document.getElementById('new-user-role').value;
  const dept = document.getElementById('new-user-dept').value.trim();

  if (!fullName || !dept) {
    if (typeof showToast === 'function') showToast('Bitte Vor- und Nachname sowie Abteilung ausfüllen.', 'danger');
    return;
  }

  try {
    const rateConni    = parseFloat(document.getElementById('new-user-rate-conni')?.value)    || null;
    const rateInternal = parseFloat(document.getElementById('new-user-rate-internal')?.value) || null;
    const incomeLimit  = parseFloat(document.getElementById('new-user-income-limit')?.value)  || null;

    const { error } = await supabaseClient
      .from('app_users')
      .insert({ full_name: fullName, role: role, default_dept: dept, hourly_rate_conni: rateConni, hourly_rate_internal: rateInternal, income_limit: incomeLimit });

    if (error) throw error;

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

async function refreshDashboard() {
  if (typeof supabaseClient === 'undefined') return;
  if (_dashboardRefreshing) return;
  _dashboardRefreshing = true;

  try {
    await ensureRateUsers();
    const { data: protocols, error: protError } = await supabaseClient
      .from('protocols')
      .select(`
        id, date, action, is_holiday, total_cost, al_id, pl_id,
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
      `)
      .order('date', { ascending: false });

    if (protError) throw protError;

    dashboardProtocols = protocols;
    renderDashboardTable();
  } catch (err) {
    console.error('Dash Load Error:', err);
    if (typeof showToast === 'function') showToast('Fehler beim Laden der Dashboard-Daten', 'danger');
  } finally {
    _dashboardRefreshing = false;
  }
}

function renderDashboardTable() {
  const body = document.getElementById('protocol-body');
  if (!body) return;
  body.innerHTML = '';

  const searchTerm = (document.getElementById('dash-search')?.value || '').toLowerCase();

  const filtered = dashboardProtocols.filter(p => {
    const projName = (p.projects?.name || '').toLowerCase();
    const alName = (p.al?.full_name || p.al_name_fallback || '').toLowerCase();
    const location = (p.location || p.projects?.location || '').toLowerCase();
    const date = (p.date || '').toLowerCase();
    return projName.includes(searchTerm) || alName.includes(searchTerm) || location.includes(searchTerm) || date.includes(searchTerm);
  });

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
      <td data-label="Kosten" class="dash-num"><b>${escapeHtml(costStr)}</b></td>
      <td data-label="" class="dash-actions">
        <button type="button" class="ui-btn dash-small-btn" data-action="pdf" data-id="${escapeHtml(p.id)}">PDF</button>
        <button type="button" class="ui-btn dash-small-btn" data-action="detail" data-id="${escapeHtml(p.id)}">Details</button>
      </td>
    `;
    body.appendChild(tr);
  });
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="6" data-label="">' + uiEmptyHtml(searchTerm ? 'Nichts gefunden' : 'Noch keine Protokolle', searchTerm ? 'Andere Suche versuchen.' : '') + '</td></tr>';
  }
  renderDashStats();
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
  var now = new Date(), s = dashMonthStats(dashboardProtocols, now);
  var month = now.toLocaleDateString('de-DE', { month: 'long' });
  box.innerHTML =
    '<div class="ui-stat"><span>Protokolle im ' + month + '</span><b>' + s.count + '</b></div>' +
    '<div class="ui-stat"><span>Kosten im ' + month + '</span><b>' + s.cost.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €</b></div>';
}

if (typeof UI_TOPBAR_ITEMS !== 'undefined') {
  UI_TOPBAR_ITEMS.dashboard = function() {
    var items = [{ label: 'Kosten aller Protokolle neu berechnen', action: 'recalcAllProtocolCosts' }];
    if (typeof dashboardCurrentWorker !== 'undefined' && dashboardCurrentWorker) items.push({ label: 'Monat als PDF (' + (dashboardCurrentWorker.full_name || 'Mitarbeiter') + ')', action: 'exportDashboardMonthlyPDF' });
    return items;
  };
}

// ── BUCHHALTUNG SHIFTS LOGIC ──

async function loadDashboardWorkers() {
  try {
    const { data: users, error: uErr } = await supabaseClient
      .from('app_users')
      .select('id, full_name, email, role, default_dept, hourly_rate_conni, hourly_rate_internal, income_limit, role_rates, is_active, is_fest')
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
    dashboardWorkers = users || [];
    dashPendingMap = pendingMap;

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

    // Sort by date descending (protocol date → shift_date → created_at)
    if (shifts) {
      shifts.sort((a, b) => {
        const da = a.protocols?.date || a.shift_date || a.created_at?.slice(0, 10) || '';
        const db = b.protocols?.date || b.shift_date || b.created_at?.slice(0, 10) || '';
        return db.localeCompare(da);
      });
    }
      
    if (error) throw error;
    dashboardCurrentShifts = shifts || [];
    
    const canEdit = (typeof userRole !== 'undefined') && (userRole === 'Buchhaltung' || userRole === 'Admin');

    if (dashboardCurrentShifts.length === 0) {
      cont.innerHTML = uiEmptyHtml('Keine Schichten', 'Für diese Person sind noch keine Schichten erfasst.',
        canEdit ? '<button type="button" class="ui-btn" onclick="openAddShift()">+ Schicht hinzufügen</button>' : '');
      populateDashboardMonthFilter([]);
      return;
    }
    let html = `<table class="ui-table dash-shift-table">
      <thead>
        <tr>
          <th>Datum / Projekt</th>
          <th>Rolle</th>
          <th>Zeiten</th>
          <th>Netto</th>
          <th>Verbucht</th>
          ${canEdit ? '<th></th>' : ''}
        </tr>
      </thead>
      <tbody>`;

    dashboardCurrentShifts.forEach(s => {
      let dateLabel = "Unbekannt";
      let projLabel = "Manuell erfasst";

      if (s.protocols) {
        dateLabel = s.protocols.date ? new Date(s.protocols.date).toLocaleDateString('de-DE') : '—';
        projLabel = s.protocols.projects ? s.protocols.projects.name : '—';
      } else if (s.shift_date) {
        dateLabel = new Date(s.shift_date).toLocaleDateString('de-DE');
      } else if (s.created_at) {
        dateLabel = new Date(s.created_at).toLocaleDateString('de-DE');
      }

      const st = s.start_time ? s.start_time.substring(0, 5) : '—';
      const en = s.end_time ? s.end_time.substring(0, 5) : '—';
      const timeStr = st !== '—' ? `${st}–${en}` + (s.pause_mins ? ` · ${s.pause_mins} min` : '') : '—';
      const netMins = dashShiftNetMins(s);
      const netStr = netMins > 0 ? (netMins / 60).toFixed(2).replace('.', ',') + ' h' : '—';

      const isBooked = s.status === 'eingetragen';
      const checkboxHtml = `<input type="checkbox" ${isBooked ? 'checked' : ''} data-shift-id="${escapeHtml(s.id)}" class="shift-booked-cb ui-switch" aria-label="Verbucht">`;

      html += `<tr>
        <td data-label="Datum / Projekt"><div class="dash-num"><b>${escapeHtml(dateLabel)}</b></div><div class="ui-sub">${escapeHtml(projLabel)}</div></td>
        <td data-label="Rolle">${escapeHtml(s.position_role || '—')}</td>
        <td data-label="Zeiten" class="dash-num">${escapeHtml(timeStr)}</td>
        <td data-label="Netto" class="dash-num"><b>${escapeHtml(netStr)}</b></td>
        <td data-label="Verbucht">${checkboxHtml}</td>
        ${canEdit ? `<td data-label="" class="dash-actions"><button type="button" class="ui-icon-btn" onclick="openShiftEdit('${escapeHtml(s.id)}')" aria-label="Schicht bearbeiten">${uiIcon('edit')}</button></td>` : ''}
      </tr>`;
    });

    html += `</tbody></table>`;

    // Key figures: total net hours (all shifts), pay, and the income limit of the current billing period
    let totalNetMins = 0;
    dashboardCurrentShifts.forEach(s => { totalNetMins += dashShiftNetMins(s); });
    const totalH = Math.floor(totalNetMins / 60);
    const totalM = totalNetMins % 60;
    const totalNetStr = totalNetMins > 0 ? (totalM > 0 ? `${totalH} h ${totalM} min` : `${totalH} h`) : '—';
    const worker = dashboardCurrentWorker;
    const rateConni = worker && worker.hourly_rate_conni ? parseFloat(worker.hourly_rate_conni) : null;
    const rateInternal = worker && worker.hourly_rate_internal ? parseFloat(worker.hourly_rate_internal) : null;
    const totalNetHrs = totalNetMins / 60;
    const eur = n => n.toFixed(2).replace('.', ',') + ' €';
    const cutoff = (typeof billingCutoff !== 'undefined') ? billingCutoff : 20;
    const periodKey = getBillingKeyForDate(new Date(), cutoff);
    let periodMins = 0;
    dashboardCurrentShifts.forEach(s => {
      const d = s.protocols?.date || s.shift_date || (s.created_at || '').slice(0, 10);
      if (d && getBillingKeyForDate(new Date(d + 'T12:00:00'), cutoff).key === periodKey.key) periodMins += dashShiftNetMins(s);
    });
    const share = incomeLimitShare(rateConni ? periodMins / 60 * rateConni : null, worker && worker.income_limit ? parseFloat(worker.income_limit) : null);
    let statsHtml = '<div class="ui-stats">' +
      `<div class="ui-stat"><span>Netto-Stunden gesamt</span><b>${totalNetStr}</b></div>` +
      (rateConni ? `<div class="ui-stat"><span>Lohn (${rateConni.toFixed(2).replace('.', ',')} €/h)</span><b>${totalNetHrs > 0 ? eur(totalNetHrs * rateConni) : '—'}</b></div>` : '') +
      (rateInternal ? `<div class="ui-stat"><span>Intern (${rateInternal.toFixed(2).replace('.', ',')} €/h)</span><b>${totalNetHrs > 0 ? eur(totalNetHrs * rateInternal) : '—'}</b></div>` : '') +
      (share ? `<div class="ui-stat"><span>Grenze ${eur(parseFloat(worker.income_limit))} · ${escapeHtml(periodKey.label)}</span>` +
        `<b>${eur(periodMins / 60 * rateConni)}</b>` +
        `<div class="ui-bar${share.over ? ' ui-bar-over' : share.pct >= 80 ? ' ui-bar-warn' : ''}"><i style="width:${share.pct}%"></i></div></div>` : '') +
      '</div>';

    // Actions above the table
    const pendingCount = dashboardCurrentShifts.filter(s => s.status !== 'eingetragen').length;
    statsHtml += `<div class="dash-shift-actions">`;
    if (canEdit) {
      statsHtml += `<button type="button" class="ui-btn dash-small-btn" onclick="openAddShift()">+ Schicht hinzufügen</button>`;
    }
    if (pendingCount > 0) {
      statsHtml += `<button type="button" class="ui-btn ui-btn-primary dash-small-btn" data-action="mark-all" data-user-id="${escapeHtml(userId)}">Alle offenen (${escapeHtml(String(pendingCount))}) verbuchen</button>`;
    }
    statsHtml += `</div>`;

    cont.innerHTML = statsHtml + html;
    populateDashboardMonthFilter(dashboardCurrentShifts);

    // Delegate change events for shift booking checkboxes
    cont.querySelectorAll('.shift-booked-cb').forEach(function(cb) {
      cb.addEventListener('change', function() {
        toggleShiftBooked(this.dataset.shiftId, this.checked);
      });
    });
    // Delegate click for mark-all button
    const markAllBtn = cont.querySelector('[data-action="mark-all"]');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', function() {
        markAllShiftsBooked(this.dataset.userId);
      });
    }
  } catch (err) {
    console.error("Shift load err:", err);
    cont.innerHTML = `<div class="empty-state" style="color:var(--danger)">Fehler beim Laden der Schichten.</div>`;
  }
}

async function toggleShiftBooked(shiftId, checked) {
  const newStat = checked ? 'eingetragen' : 'offen';
  try {
    const { error } = await supabaseClient
      .from('shifts')
      .update({ status: newStat })
      .eq('id', shiftId);
      
    if (error) throw error;
    if (typeof showToast === 'function') showToast(checked ? "Schicht verbucht!" : "Verbuchung aufgehoben");
    
    // Update local state without full rerender to avoid jumpiness
    const st = dashboardCurrentShifts.find(x => x.id === shiftId);
    if (st) st.status = newStat;
    loadDashboardWorkers(); // Update dropdown highlights silently
  } catch (err) {
    console.error("Update shift err", err);
    if (typeof showToast === 'function') showToast("Fehler: " + (err.message || "Speichern fehlgeschlagen"), "danger");
    renderWorkerShifts(); // Revert on failure
  }
}

async function markAllShiftsBooked(userId) {
  if (!confirm("Alle offenen Schichten dieses Mitarbeiters als eingetragen markieren?")) return;
  try {
    const { error } = await supabaseClient
      .from('shifts')
      .update({ status: 'eingetragen' })
      .eq('user_id', userId)
      .neq('status', 'eingetragen');
      
    if (error) throw error;
    if (typeof showToast === 'function') showToast("Alle Schichten erfolgreich gebucht!");
    renderWorkerShifts();
  } catch(e) {
    console.error("Update All Err:", e);
    if (typeof showToast === 'function') showToast("Fehler: " + (e.message || "Speichern fehlgeschlagen"), "danger");
  }
}

// ── SCHICHT BEARBEITEN / HINZUFÜGEN ──

let _shiftEditId = null; // null = neuer Eintrag, sonst Supabase-ID
let _shiftEditContext = 'worker'; // 'worker' | 'protocol-edit' | 'protocol-add'

function _shiftModalBase() {
  document.getElementById('shift-edit-person-row').style.display = 'none';
  document.getElementById('shift-edit-temp-name').value = '';
  const sel = document.getElementById('shift-edit-worker-select');
  if (sel) sel.value = '';
}

function openShiftEdit(shiftId) {
  const shift = dashboardCurrentShifts.find(s => s.id === shiftId);
  if (!shift) return;
  _shiftEditId = shiftId;
  _shiftEditContext = 'worker';
  _shiftModalBase();
  document.getElementById('shift-edit-title').textContent = 'Schicht bearbeiten';
  const dateVal = shift.protocols?.date || shift.shift_date || '';
  document.getElementById('shift-edit-date').value  = dateVal;
  document.getElementById('shift-edit-ort').value   = shift.ort || '';
  document.getElementById('shift-edit-role').value  = shift.position_role || 'MA frei';
  document.getElementById('shift-edit-start').value = (shift.start_time || '').substring(0, 5);
  document.getElementById('shift-edit-end').value   = (shift.end_time   || '').substring(0, 5);
  document.getElementById('shift-edit-note').value  = shift.note || '';
  document.getElementById('shift-edit-delete-row').style.display = 'block';
  document.getElementById('shift-edit-modal').classList.add('open');
}

function openAddShift() {
  _shiftEditId = null;
  _shiftEditContext = 'worker';
  _shiftModalBase();
  document.getElementById('shift-edit-title').textContent = 'Schicht hinzufügen';
  document.getElementById('shift-edit-date').value  = localDateStr();
  document.getElementById('shift-edit-ort').value   = '';
  document.getElementById('shift-edit-role').value  = 'MA frei';
  document.getElementById('shift-edit-start').value = '';
  document.getElementById('shift-edit-end').value   = '';
  document.getElementById('shift-edit-note').value  = '';
  document.getElementById('shift-edit-delete-row').style.display = 'none';
  document.getElementById('shift-edit-modal').classList.add('open');
}

function openProtShiftEdit(shiftId) {
  const p = dashboardProtocols.find(x => x.id === _editProtId);
  if (!p) return;
  const shift = (p.shifts || []).find(s => s.id === shiftId);
  if (!shift) return;
  _shiftEditId = shiftId;
  _shiftEditContext = 'protocol-edit';
  _shiftModalBase();
  document.getElementById('shift-edit-title').textContent = 'Schicht bearbeiten';
  document.getElementById('shift-edit-date').value  = shift.shift_date || p.date || '';
  document.getElementById('shift-edit-ort').value   = shift.ort || '';
  document.getElementById('shift-edit-role').value  = shift.position_role || 'MA frei';
  document.getElementById('shift-edit-start').value = (shift.start_time || '').substring(0, 5);
  document.getElementById('shift-edit-end').value   = (shift.end_time   || '').substring(0, 5);
  document.getElementById('shift-edit-note').value  = shift.note || '';
  document.getElementById('shift-edit-delete-row').style.display = 'block';
  document.getElementById('shift-edit-modal').classList.add('open');
}

function openAddProtShift() {
  const p = dashboardProtocols.find(x => x.id === _editProtId);
  if (!p) return;
  _shiftEditId = null;
  _shiftEditContext = 'protocol-add';
  // Populate worker dropdown
  const sel = document.getElementById('shift-edit-worker-select');
  if (sel) {
    sel.innerHTML = '<option value="">— Temp / Agentur (Name eingeben) —</option>' +
      (dashboardWorkers || []).map(function(w) {
        return '<option value="' + w.id + '">' + escapeHtml(w.full_name || '') + '</option>';
      }).join('');
  }
  document.getElementById('shift-edit-person-row').style.display = 'block';
  document.getElementById('shift-edit-temp-name').style.display = '';
  document.getElementById('shift-edit-title').textContent = 'Schicht hinzufügen';
  document.getElementById('shift-edit-date').value  = p.date || '';
  document.getElementById('shift-edit-ort').value   = (p.projects && p.projects.location) || '';
  document.getElementById('shift-edit-role').value  = 'MA frei';
  document.getElementById('shift-edit-start').value = '';
  document.getElementById('shift-edit-end').value   = '';
  document.getElementById('shift-edit-note').value  = '';
  document.getElementById('shift-edit-delete-row').style.display = 'none';
  document.getElementById('shift-edit-modal').classList.add('open');
}

function onShiftWorkerSelect(val) {
  const inp = document.getElementById('shift-edit-temp-name');
  if (!inp) return;
  if (val) {
    const w = (dashboardWorkers || []).find(function(x) { return x.id === val; });
    inp.value = w ? (w.full_name || '') : '';
    inp.style.display = 'none';
  } else {
    inp.value = '';
    inp.style.display = '';
  }
}

async function _refreshProtocolShifts() {
  if (!_editProtId) return;
  const { data } = await supabaseClient
    .from('shifts')
    .select('id, user_id, temp_worker_name, position_role, start_time, end_time, pause_mins, status, shift_date, ort, app_users(full_name)')
    .eq('protocol_id', _editProtId);
  const p = dashboardProtocols.find(function(x) { return x.id === _editProtId; });
  if (p) p.shifts = data || [];
}

function renderProtShiftsInEdit() {
  const c = document.getElementById('pe-shifts');
  if (!c) return;
  const p = dashboardProtocols.find(function(x) { return x.id === _editProtId; });
  const shifts = p ? (p.shifts || []) : [];
  if (!shifts.length) {
    c.innerHTML = '<div style="font-size:13px;color:var(--text3);padding:6px 0;">Keine Schichten erfasst.</div>';
    return;
  }
  c.innerHTML = shifts.map(function(s) {
    const name = s.temp_worker_name || (s.app_users ? s.app_users.full_name : '—');
    const von  = (s.start_time || '').substring(0, 5);
    const bis  = (s.end_time   || '').substring(0, 5);
    const time = von && bis ? von + '–' + bis : '—';
    return '<div style="display:flex;gap:8px;align-items:center;background:var(--bg2);border-radius:8px;padding:8px 10px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:13px;font-weight:600;">' + escapeHtml(name) + '</div>' +
        '<div style="font-size:11px;color:var(--text3);">' + escapeHtml(s.position_role || '—') + ' · ' + time + (s.ort ? ' · ' + escapeHtml(s.ort) : '') + '</div>' +
      '</div>' +
      '<button onclick="openProtShiftEdit(\'' + s.id + '\')" style="font-size:12px;padding:4px 10px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg3);cursor:pointer;">✏️</button>' +
    '</div>';
  }).join('');
}

function closeShiftEditModal() {
  document.getElementById('shift-edit-modal').classList.remove('open');
  _shiftEditId = null;
}

async function saveShiftEdit() {
  const dateVal  = document.getElementById('shift-edit-date').value;
  const role     = document.getElementById('shift-edit-role').value;
  const startVal = document.getElementById('shift-edit-start').value;
  const endVal   = document.getElementById('shift-edit-end').value;
  const ortVal   = (document.getElementById('shift-edit-ort') || {}).value || '';
  const rawMins  = (timeToMins(endVal) || 0) - (timeToMins(startVal) || 0);
  const pause    = autoPause(rawMins < 0 ? rawMins + 1440 : rawMins);

  if (!dateVal || !startVal || !endVal) {
    if (typeof showToast === 'function') showToast('Bitte Datum, Von und Bis ausfüllen.', 'danger');
    return;
  }

  const isProtocol = _shiftEditContext === 'protocol-edit' || _shiftEditContext === 'protocol-add';

  try {
    if (_shiftEditId) {
      // Edit existing shift (works for both worker and protocol context)
      const { error } = await supabaseClient.from('shifts').update({
        shift_date:    dateVal,
        position_role: role,
        start_time:    startVal,
        end_time:      endVal,
        pause_mins:    pause,
        ort:           ortVal || null,
      }).eq('id', _shiftEditId);
      if (error) throw error;
      if (typeof showToast === 'function') showToast('Schicht gespeichert!');
    } else if (_shiftEditContext === 'protocol-add') {
      // New shift linked to a protocol
      const workerId = (document.getElementById('shift-edit-worker-select') || {}).value || '';
      const tempName = (document.getElementById('shift-edit-temp-name') || {}).value.trim();
      if (!workerId && !tempName) {
        if (typeof showToast === 'function') showToast('Bitte Person angeben.', 'danger');
        return;
      }
      const { error } = await supabaseClient.from('shifts').insert({
        protocol_id:      _editProtId,
        user_id:          workerId || null,
        temp_worker_name: workerId ? null : (tempName || null),
        shift_date:       dateVal,
        position_role:    role,
        start_time:       startVal,
        end_time:         endVal,
        pause_mins:       pause,
        ort:              ortVal || null,
        status:           'offen',
      });
      if (error) throw error;
      if (typeof showToast === 'function') showToast('Schicht hinzugefügt!');
    } else {
      // New shift linked to a worker (existing worker-dashboard flow)
      const userId = document.getElementById('dash-worker-select').value;
      if (!userId) { if (typeof showToast === 'function') showToast('Kein Mitarbeiter ausgewählt.', 'danger'); return; }
      const { error } = await supabaseClient.from('shifts').insert({
        user_id:       userId,
        shift_date:    dateVal,
        position_role: role,
        start_time:    startVal,
        end_time:      endVal,
        pause_mins:    pause,
        ort:           ortVal || null,
        status:        'offen',
      });
      if (error) throw error;
      if (typeof showToast === 'function') showToast('Schicht hinzugefügt!');
    }

    closeShiftEditModal();
    if (isProtocol) {
      await _refreshProtocolShifts();
      renderProtShiftsInEdit();
    } else {
      renderWorkerShifts();
    }
  } catch (err) {
    console.error('saveShiftEdit error:', err);
    if (typeof showToast === 'function') showToast('Fehler: ' + (err.message || 'Speichern fehlgeschlagen'), 'danger');
  }
}

async function deleteShiftFromModal() {
  if (!_shiftEditId) return;
  if (!confirm('Schicht wirklich löschen?')) return;
  const isProtocol = _shiftEditContext === 'protocol-edit';
  try {
    const { error } = await supabaseClient.from('shifts').delete().eq('id', _shiftEditId);
    if (error) throw error;
    if (typeof showToast === 'function') showToast('Schicht gelöscht.');
    closeShiftEditModal();
    if (isProtocol) {
      await _refreshProtocolShifts();
      renderProtShiftsInEdit();
    } else {
      renderWorkerShifts();
    }
  } catch (err) {
    console.error('deleteShift error:', err);
    if (typeof showToast === 'function') showToast('Fehler beim Löschen.', 'danger');
  }
}

// ── PROTOCOL COST RECALCULATION ──

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
  return calcSplitShiftCosts(basePos, date, !!isHoliday, v, b, parseInt(s.pause_mins) || 0, customRate);
}

// Protocol total with the same formula as calcProtCosts in the app
function calcDashProtTotal(date, isHoliday, vehicleTypes, shifts) {
  var total = 0;
  (vehicleTypes || []).forEach(function(type) {
    total += (typeof calcTransportCost === 'function') ? calcTransportCost(type, date) : 0;
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
}

async function recalcAllProtocolCosts() {
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
      (p.protocol_transports || []).map(t => t.vehicle_type), p.shifts || []);

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
    </div>
    <div>
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
        <td>${escapeHtml(t.driver_name || '—')}</td>
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
      var r = (typeof calcTransportCost !== 'undefined') ? calcTransportCost(t.vehicle_type, p.date) : 0;
      var label = escapeHtml(t.vehicle_type || '—');
      if (t.vehicle_type === 'Spedition') {
        rows.push({ section: 'transport', label: label, detail: escapeHtml(t.driver_name || '') + ' (siehe Rechnung)', cost: 0 });
      } else if (r > 0) {
        logTotal += r;
        rows.push({ section: 'transport', label: label, detail: escapeHtml(t.driver_name || ''), cost: r });
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
        html += '<tr><td style="font-weight:600;">' + row.label + '</td><td style="color:var(--text2); font-size:12px;">' + row.detail + '</td><td style="text-align:right; font-weight:600; color:var(--accent);">' + row.cost.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €</td></tr>';
      } else {
        html += '<tr><td style="font-weight:600;">' + row.label + '<div style="font-size:10px; opacity:0.6;">' + row.detail + '</div></td>'
          + '<td style="font-size:12px; color:var(--text2);">' + row.hrs.toFixed(2) + 'h × ' + row.rate.toFixed(2) + ' €</td>'
          + '<td style="text-align:right; font-weight:600; color:var(--accent);">' + row.cost.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €</td></tr>';
      }
    });

    // Subtotals + grand total
    html += '<tr><td colspan="3" style="padding:0;"></td></tr>';
    if (logTotal > 0) {
      html += '<tr style="background:var(--bg2);"><td colspan="2" style="font-size:12px; color:var(--text2);">Logistik gesamt</td><td style="text-align:right; font-size:12px; color:var(--text2);">' + logTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €</td></tr>';
    }
    if (persTotal > 0) {
      html += '<tr style="background:var(--bg2);"><td colspan="2" style="font-size:12px; color:var(--text2);">Personal gesamt</td><td style="text-align:right; font-size:12px; color:var(--text2);">' + persTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €</td></tr>';
    }
    html += '<tr style="border-top:2px solid var(--accent);"><td colspan="2" style="font-weight:700;">Gesamtkosten (geschätzt)</td><td style="text-align:right; font-weight:700; font-size:15px; color:var(--accent);">' + grandTotal.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' €</td></tr>';
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

var _PE_CATEGORIES = [
  { id: 'mobiliar',  label: 'Mobiliar' },
  { id: 'stoffe',    label: 'Stoffe & Hussen' },
  { id: 'floristik', label: 'Floristik' },
  { id: 'tischlerei',label: 'Tischlerei' },
  { id: 'logistik',  label: 'Lager / Logistik' }
];

function openDashProtEdit() {
  const p = dashboardProtocols.find(x => x.id === _editProtId);
  if (!p) return;

  document.getElementById('pe-date').value    = p.date || '';
  document.getElementById('pe-action').value  = p.action || 'Aufbau';
  document.getElementById('pe-holiday').checked = !!p.is_holiday;
  document.getElementById('pe-al').value      = p.al ? p.al.full_name : (p.al_name_fallback || '');
  document.getElementById('pe-pl').value      = p.pl ? p.pl.full_name : (p.pl_name_fallback || '');
  document.getElementById('pe-damages').value  = p.notes_damages || '';
  document.getElementById('pe-incidents').value = p.notes_incidents || '';
  document.getElementById('pe-feedback').value  = p.notes_feedback || '';

  _editProtTransports = (p.protocol_transports || []).map(t => ({
    type: t.vehicle_type || 'Sprinter',
    driver: t.driver_name || '',
    punctuality: t.punctuality || 'pünktlich',
    delay: t.delay_mins || ''
  }));

  renderDashProtTransports();
  renderDashProtEquipment(p.protocol_equipments || []);
  renderProtShiftsInEdit();

  document.getElementById('dash-prot-edit-modal').classList.add('open');
}

function closeDashProtEdit() {
  document.getElementById('dash-prot-edit-modal').classList.remove('open');
}

function renderDashProtTransports() {
  var c = document.getElementById('pe-transports');
  if (!c) return;
  if (!_editProtTransports.length) {
    c.innerHTML = '<div style="font-size:13px;color:var(--text3);">Kein Transport erfasst.</div>';
    return;
  }
  var vehicleOpts = Object.keys(PROT_VEHICLE_RATES).map(function(v) {
    return '<option value="' + v + '">' + v + '</option>';
  }).join('');
  c.innerHTML = _editProtTransports.map(function(t, i) {
    var delayField = t.punctuality === 'verspätet'
      ? '<input type="number" placeholder="Min" value="' + escapeHtml(t.delay || '') + '" oninput="_editProtTransports[' + i + '].delay=this.value" class="meta-input" style="width:70px;padding:5px 6px;font-size:12px;">'
      : '';
    var selOpts = Object.keys(PROT_VEHICLE_RATES).map(function(v) {
      return '<option value="' + v + '"' + (t.type === v ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
    return '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
      '<select oninput="_editProtTransports[' + i + '].type=this.value" class="meta-input" style="flex:1;min-width:110px;padding:5px 6px;font-size:12px;">' + selOpts + '</select>' +
      '<input type="text" placeholder="Fahrer" value="' + escapeHtml(t.driver || '') + '" oninput="_editProtTransports[' + i + '].driver=this.value" class="meta-input" style="flex:1;min-width:100px;padding:5px 6px;font-size:12px;">' +
      '<select oninput="_editProtTransports[' + i + '].punctuality=this.value;renderDashProtTransports()" class="meta-input" style="flex:1;min-width:100px;padding:5px 6px;font-size:12px;">' +
        '<option value="pünktlich"' + (t.punctuality === 'pünktlich' ? ' selected' : '') + '>Pünktlich</option>' +
        '<option value="verspätet"' + (t.punctuality === 'verspätet' ? ' selected' : '') + '>Verspätet</option>' +
      '</select>' +
      delayField +
      '<button onclick="_editProtTransports.splice(' + i + ',1);renderDashProtTransports()" style="color:var(--danger);background:none;border:none;cursor:pointer;font-size:16px;padding:0 4px;">✕</button>' +
    '</div>';
  }).join('');
}

function addDashProtTransport() {
  _editProtTransports.push({ type: 'Sprinter', driver: '', punctuality: 'pünktlich', delay: '' });
  renderDashProtTransports();
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
      ? '<div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap;">' +
          '<span style="font-size:11px;color:var(--text3);">Hussen geliefert:</span>' +
          '<input type="number" id="pe-hd-' + cat.id + '" value="' + hDel + '" class="meta-input" style="width:60px;padding:4px 6px;font-size:12px;">' +
          '<span style="font-size:11px;color:var(--text3);">zurück:</span>' +
          '<input type="number" id="pe-hr-' + cat.id + '" value="' + hRet + '" class="meta-input" style="width:60px;padding:4px 6px;font-size:12px;">' +
        '</div>'
      : '';
    return '<div style="background:var(--bg2);border-radius:10px;padding:10px 12px;">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">' +
        '<span style="font-size:13px;font-weight:600;flex:1;">' + cat.label + '</span>' +
        '<select id="pe-st-' + cat.id + '" class="meta-input" style="width:auto;padding:4px 8px;font-size:12px;">' +
          '<option value=""' + (status === '' ? ' selected' : '') + '>Ausgeblendet</option>' +
          ['okay','unsauber','beschädigt','unvollständig'].map(function(s) {
            return '<option value="' + s + '"' + (status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<input type="text" id="pe-nt-' + cat.id + '" value="' + escapeHtml(note) + '" placeholder="Notiz (optional)" class="meta-input" style="font-size:12px;padding:5px 8px;">' +
      hussenHtml +
    '</div>';
  }).join('');
}

async function saveDashProtEdit() {
  const p = dashboardProtocols.find(x => x.id === _editProtId);
  if (!p) return;

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

  const protPayload = {
    date:            newDate,
    action:          document.getElementById('pe-action').value,
    is_holiday:      isHoliday,
    al_id:           al.id,
    pl_id:           pl.id,
    al_name_fallback: al.fallback,
    pl_name_fallback: pl.fallback,
    // Same formula as the app (transports by date, holiday, employee rates, minimum hours)
    total_cost:      calcDashProtTotal(newDate, isHoliday, _editProtTransports.map(t => t.type), p.shifts || []),
    notes_damages:   document.getElementById('pe-damages').value.trim()   || null,
    notes_incidents: document.getElementById('pe-incidents').value.trim() || null,
    notes_feedback:  document.getElementById('pe-feedback').value.trim()  || null,
  };

  try {
    const { data: pRows, error: pErr } = await supabaseClient.from('protocols').update(protPayload).eq('id', _editProtId).select('id');
    if (pErr) throw pErr;
    // RLS answers with 0 rows instead of an error
    if (!pRows || pRows.length === 0) throw new Error('Update abgelehnt – keine Berechtigung (protocols)');

    // Shifts carry their own date (Buchhaltung) → follow a date change
    if (newDate && newDate !== p.date) {
      const { error: sdErr } = await supabaseClient.from('shifts').update({ shift_date: newDate }).eq('protocol_id', _editProtId);
      if (sdErr) throw sdErr;
    }

    // Re-insert transports (delete first, check error before inserting)
    const { error: tDelErr } = await supabaseClient.from('protocol_transports').delete().eq('protocol_id', _editProtId);
    if (tDelErr) throw tDelErr;
    if (_editProtTransports.length) {
      const tInserts = _editProtTransports.map(function(t) {
        return { protocol_id: _editProtId, vehicle_type: t.type, driver_name: t.driver || null,
                 punctuality: t.punctuality, delay_mins: t.delay ? parseInt(t.delay) : 0 };
      });
      const { error: tErr } = await supabaseClient.from('protocol_transports').insert(tInserts);
      if (tErr) throw tErr;
    }

    // Re-insert equipment (delete first, check error before inserting)
    const { error: eDelErr } = await supabaseClient.from('protocol_equipments').delete().eq('protocol_id', _editProtId);
    if (eDelErr) throw eDelErr;
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
    if (eInserts.length) {
      const { error: eErr } = await supabaseClient.from('protocol_equipments').insert(eInserts);
      if (eErr) throw eErr;
    }

    showToast('✅ Protokoll gespeichert!');
    closeDashProtEdit();
    await refreshDashboard();
    // Re-open detail with updated data
    openDashDetail(_editProtId);
  } catch (err) {
    console.error('saveDashProtEdit error:', err);
    showToast('Fehler: ' + (err.message || 'Speichern fehlgeschlagen'), 'danger');
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
    buildProtPdfDoc(entry).save(protPdfFileName(entry));
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
  (shifts || []).forEach(function(s) {
    const dStr = (s.protocols && s.protocols.date) || s.shift_date;
    if (!dStr) return;
    const dObj = new Date(dStr + 'T12:00:00');
    const m = getBillingKeyForDate(dObj, billingCutoff);
    months[m.key] = m.label;
  });

  const sortedKeys = Object.keys(months).sort().reverse();
  sel.innerHTML = '<option value="">-- Monat --</option>' +
    sortedKeys.map(function(k) { return '<option value="' + k + '">' + months[k] + '</option>'; }).join('');

  if (sortedKeys.length > 0) {
    sel.value = sortedKeys[0];
    sel.style.display = '';
    btn.style.display = '';
  } else {
    sel.style.display = 'none';
    btn.style.display = 'none';
  }
}

async function exportDashboardMonthlyPDF() {
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
        sig: prot.signature_text || null
      });
    }
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
  const doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
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
