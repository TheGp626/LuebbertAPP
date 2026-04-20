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
        // If real-time is unavailable, polling fallback kicks in anyway
        console.log('[Realtime]', status);
      });
  }

  // ── Polling fallback — refreshes every 30s regardless ──
  if (!_dashboardPollInterval) {
    _dashboardPollInterval = setInterval(function () {
      if (typeof refreshDashboard === 'function') refreshDashboard();
    }, 30000);
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
  document.getElementById('dash-tab-prot').classList.toggle('primary', tab === 'prot');
  document.getElementById('dash-tab-work').classList.toggle('primary', tab === 'work');
  
  document.getElementById('dash-view-prot').style.display = tab === 'prot' ? 'block' : 'none';
  document.getElementById('dash-view-work').style.display = tab === 'work' ? 'block' : 'none';

  if (tab === 'work' && dashboardWorkers.length === 0) {
    loadDashboardWorkers();
  }
}

function toggleAddUserForm() {
  const form = document.getElementById('add-user-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function addDashboardUser() {
  const name = document.getElementById('new-user-name').value.trim();
  const role = document.getElementById('new-user-role').value;
  const dept = document.getElementById('new-user-dept').value.trim();

  if (!name || !dept) {
    if (typeof showToast === 'function') showToast('Bitte Name und Abteilung ausfüllen.', 'danger');
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('app_users')
      .insert({ full_name: name, role: role, default_dept: dept });

    if (error) throw error;

    if (typeof showToast === 'function') showToast('Mitarbeiter erfolgreich hinzugefügt!');
    
    // Clear form and reload
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-dept').value = '';
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
    const { data: protocols, error: protError } = await supabaseClient
      .from('protocols')
      .select(`
        *,
        projects(name, location),
        al:app_users!protocols_al_id_fkey(full_name),
        pl:app_users!protocols_pl_id_fkey(full_name),
        shifts(*, app_users(full_name)),
        protocol_transports(*),
        protocol_equipments(*)
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
    const holidayTag = p.is_holiday
      ? ' <span style="font-size:10px;background:#f59e0b;color:#fff;padding:1px 5px;border-radius:8px;vertical-align:middle;margin-left:4px;">Feiertag</span>'
      : '';
    const plLine = plName
      ? `<div style="font-size:11px; color:var(--text3);">PL: ${escapeHtml(plName)}</div>`
      : '';

    tr.innerHTML = `
      <td data-label="Datum">${new Date(p.date).toLocaleDateString('de-DE')}</td>
      <td data-label="Projekt" style="font-weight:600;">${escapeHtml(projName)}</td>
      <td data-label="Aktion"><span class="badge ${p.action === 'Abbau' ? 'badge-al' : 'badge-pl'}">${escapeHtml(p.action)}</span>${holidayTag}</td>
      <td data-label="AL/PL" style="font-size: 13px; color: var(--text2);">
        <div>${escapeHtml(alName)}</div>
        ${plLine}
      </td>
      <td data-label="Kosten" style="font-weight:700; color: var(--accent);">${escapeHtml(costStr)}</td>
      <td data-label="" style="text-align:right; display:flex; gap:8px; justify-content:flex-end;">
        <button class="view-btn" data-action="pdf" data-id="${escapeHtml(p.id)}">PDF</button>
        <button class="view-btn" data-action="detail" data-id="${escapeHtml(p.id)}">Details</button>
      </td>
    `;
    body.appendChild(tr);
  });
}

// ── BUCHHALTUNG SHIFTS LOGIC ──

async function loadDashboardWorkers() {
  try {
    const { data: users, error: uErr } = await supabaseClient
      .from('app_users')
      .select('id, full_name, role')
      .order('full_name');
    if (uErr) throw uErr;
    
    // Fetch all pending shifts to highlight workers
    const { data: pendingShifts, error: pErr } = await supabaseClient
      .from('shifts')
      .select('user_id')
      .neq('status', 'eingetragen');
    
    const pendingIds = new Set((pendingShifts || []).map(s => s.user_id));
    dashboardWorkers = users || [];

    const sel = document.getElementById('dash-worker-select');
    sel.innerHTML = '<option value="">-- Mitarbeiter wählen --</option>';
    dashboardWorkers.forEach(w => {
      const indicator = pendingIds.has(w.id) ? ' 🔴' : '';
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = (w.full_name || 'Unbekannt') + ' (' + (w.role || '') + ')' + indicator;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Worker fetch err:", err);
  }
}

async function renderWorkerShifts() {
  const userId = document.getElementById('dash-worker-select').value;
  const cont = document.getElementById('worker-shifts-container');
  
  if (!userId) {
    cont.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><div>Bitte wählen Sie einen Mitarbeiter aus.</div></div>`;
    return;
  }
  
  dashboardCurrentWorker = dashboardWorkers.find(w => w.id === userId);
  cont.innerHTML = `<div style="text-align:center; padding: 20px; color:var(--text3);">Lade Schichten...</div>`;
  
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
    
    if (dashboardCurrentShifts.length === 0) {
      cont.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><div>Keine Schichten für diesen Mitarbeiter gefunden.</div></div>`;
      return;
    }
    
    let html = `<table class="compact-table" style="width:100%; margin-top: 10px;">
      <thead>
        <tr>
          <th>Datum/Projekt</th>
          <th>Rolle</th>
          <th>Zeiten</th>
          <th>Netto</th>
          <th style="text-align:center;">Verbucht</th>
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
      const timeStr = st !== '—' ? `${st} - ${en} (${s.pause_mins}m P)` : '—';
      
      let netStr = '—';
      if (st !== '—' && en !== '—') {
        const [sh, sm] = st.split(':').map(Number);
        const [eh, em] = en.split(':').map(Number);
        if (!isNaN(sh) && !isNaN(eh)) {
          const startMins = sh * 60 + sm;
          let endMins = eh * 60 + em;
          if (endMins < startMins) endMins += 1440; // overnight
          let netMins = endMins - startMins - (s.pause_mins || 0);
          if (BUCHHALTUNG_MIN_HOURS_ENABLED) netMins = Math.max(BUCHHALTUNG_MIN_HOURS * 60, netMins);
          if (netMins > 0) {
            netStr = (netMins / 60).toFixed(2).replace('.', ',') + ' h';
          }
        }
      }
      
      const isBooked = s.status === 'eingetragen';
      const checkedAttr = isBooked ? 'checked' : '';
      const checkboxHtml = `<input type="checkbox" ${checkedAttr} data-shift-id="${escapeHtml(s.id)}" class="shift-booked-cb" style="width:18px;height:18px;cursor:pointer;">`;

      html += `<tr>
        <td data-label="Datum/Projekt">
          <div style="font-weight:600;">${escapeHtml(dateLabel)}</div>
          <div style="font-size:11px; color:var(--text3);">${escapeHtml(projLabel)}</div>
        </td>
        <td data-label="Rolle" style="font-size:12px;">${escapeHtml(s.position_role || '—')}</td>
        <td data-label="Zeiten" style="font-size:13px;">${escapeHtml(timeStr)}</td>
        <td data-label="Netto" style="font-weight:600; color:var(--accent); font-size:13px;">${escapeHtml(netStr)}</td>
        <td data-label="" style="text-align:center;">${checkboxHtml}</td>
      </tr>`;
    });
    
    html += `</tbody></table>`;

    // Summary row: total net hours
    let totalNetMins = 0;
    dashboardCurrentShifts.forEach(s => {
      const st = s.start_time ? s.start_time.substring(0, 5) : null;
      const en = s.end_time ? s.end_time.substring(0, 5) : null;
      if (st && en) {
        const [sh, sm] = st.split(':').map(Number);
        const [eh, em] = en.split(':').map(Number);
        if (!isNaN(sh) && !isNaN(eh)) {
          let startMins = sh * 60 + sm;
          let endMins = eh * 60 + em;
          if (endMins < startMins) endMins += 1440;
          let net = endMins - startMins - (s.pause_mins || 0);
          if (BUCHHALTUNG_MIN_HOURS_ENABLED) net = Math.max(BUCHHALTUNG_MIN_HOURS * 60, net);
          if (net > 0) totalNetMins += net;
        }
      }
    });
    const totalH = Math.floor(totalNetMins / 60);
    const totalM = totalNetMins % 60;
    const totalNetStr = totalNetMins > 0 ? (totalM > 0 ? `${totalH}h ${totalM}m` : `${totalH}h`) : '—';
    html += `<div style="display:flex; justify-content:flex-end; align-items:center; gap:12px; padding:12px 4px; border-top:1px solid var(--border); margin-top:4px;">
      <span style="font-size:13px; color:var(--text3);">Gesamtstunden (netto):</span>
      <span style="font-size:16px; font-weight:700; color:var(--accent);">${totalNetStr}</span>
    </div>`;

    // Quick action: Mark all as booked
    const pendingCount = dashboardCurrentShifts.filter(s => s.status !== 'eingetragen').length;
    if (pendingCount > 0) {
      html += `<div style="margin-top: 20px; text-align: right;">
        <button class="btn primary" style="width:auto; padding: 10px 20px;" data-action="mark-all" data-user-id="${escapeHtml(userId)}">Alle offenen Schichten (${escapeHtml(String(pendingCount))}) verbuchen</button>
      </div>`;
    }

    cont.innerHTML = html;

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
  const newStat = checked ? 'eingetragen' : 'approved';
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

// ── PROTOCOL COST RECALCULATION ──

async function recalcAllProtocolCosts() {
  if (!dashboardProtocols || dashboardProtocols.length === 0) {
    if (typeof showToast === 'function') showToast('Keine Protokolle geladen.', 'danger');
    return;
  }
  const btn = document.getElementById('btn-recalc-costs');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Berechne...'; }

  let updated = 0, errors = 0;

  for (const p of dashboardProtocols) {
    let total = 0;

    // Transport costs
    (p.protocol_transports || []).forEach(function(t) {
      total += (typeof PROT_VEHICLE_RATES !== 'undefined' && PROT_VEHICLE_RATES[t.vehicle_type]) || 0;
    });

    // Personnel costs
    (p.shifts || []).forEach(function(s) {
      const von = (s.start_time || '').substring(0, 5);
      const bis = (s.end_time  || '').substring(0, 5);
      const pa  = parseInt(s.pause_mins) || 0;
      if (!von || !bis) return;
      const [sh, sm] = von.split(':').map(Number);
      const [eh, em] = bis.split(':').map(Number);
      if (isNaN(sh) || isNaN(eh)) return;
      let v = sh * 60 + sm;
      let b = eh * 60 + em;
      if (b < v) b += 1440;
      if (b <= v) return;
      const basePos = s.position_role || 'MA frei';
      if (typeof calcSplitShiftCosts === 'function') {
        const costs = calcSplitShiftCosts(basePos, p.date, p.is_holiday || false, v, b, pa);
        costs.forEach(c => { total += c.hrs * c.rate; });
      }
    });

    const rounded = Math.round(total * 100) / 100;
    if (rounded === p.total_cost) continue; // nothing changed

    try {
      const { error } = await supabaseClient
        .from('protocols')
        .update({ total_cost: rounded })
        .eq('id', p.id);
      if (error) throw error;
      p.total_cost = rounded; // update local copy
      updated++;
    } catch (e) {
      console.error('recalc error for', p.id, e);
      errors++;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = '↻ Kosten neu berechnen'; }
  renderDashboardTable();
  const msg = `${updated} Protokoll${updated !== 1 ? 'e' : ''} aktualisiert` + (errors ? `, ${errors} Fehler` : '');
  if (typeof showToast === 'function') showToast(msg, errors ? 'danger' : 'success');
}

// ── PROTOCOL DETAILS & EXPORT ──

function openDashDetail(id) {
  const p = dashboardProtocols.find(x => x.id === id);
  if (!p) return;

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

      shiftsHtml += `<tr>
        <td><div style="font-weight:600;">${escapeHtml(name)}</div><div style="font-size:10px; opacity:0.6;">${escapeHtml(role)}</div></td>
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
      var r = (typeof PROT_VEHICLE_RATES !== 'undefined' && PROT_VEHICLE_RATES[t.vehicle_type]) || 0;
      if (r > 0) {
        logTotal += r;
        rows.push({ section: 'transport', label: escapeHtml(t.vehicle_type || '—'), detail: escapeHtml(t.driver_name || ''), cost: r });
      }
    });

    // Personnel costs
    (p.shifts || []).forEach(function(s) {
      var name = s.temp_worker_name || (s.app_users ? s.app_users.full_name : 'Mitarbeiter');
      var von = (s.start_time || '').substring(0, 5);
      var bis = (s.end_time || '').substring(0, 5);
      var pa = parseInt(s.pause_mins) || 0;
      var v = null, b = null;
      if (von && bis) {
        var sp = von.split(':'), ep = bis.split(':');
        if (sp.length === 2 && ep.length === 2) {
          v = parseInt(sp[0]) * 60 + parseInt(sp[1]);
          b = parseInt(ep[0]) * 60 + parseInt(ep[1]);
        }
      }
      var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
      if (v !== null && b !== null && effB > v && typeof calcSplitShiftCosts === 'function') {
        var basePos = s.position_role || 'MA frei';
        var costs = calcSplitShiftCosts(basePos, p.date, p.is_holiday || false, v, effB, pa);
        costs.forEach(function(c) {
          var sub = c.hrs * c.rate;
          persTotal += sub;
          rows.push({ section: 'personal', label: escapeHtml(name), detail: escapeHtml(c.desc), hrs: c.hrs, rate: c.rate, cost: sub });
        });
      }
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

// PDF EXPORT FROM DASHBOARD
async function exportDashProtPDF(pId) {
  const p = dashboardProtocols.find(x => x.id === pId);
  if (!p) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("PDF Engine nicht geladen!"); return;
  }
  
  if (typeof showToast === 'function') showToast('Generiere Protokoll-PDF...');

  // Map Dashboard Data exactly to traditional data format
  // totalCost is missing from p if it was not computed correctly, but it has total_cost
  var data = {
    event: p.projects ? p.projects.name : 'Unbekannt', 
    location: p.location || (p.projects ? p.projects.location : '—'),
    date: p.date ? p.date : new Date().toISOString().split('T')[0], 
    action: p.action || '—',
    al: p.al ? p.al.full_name : p.al_name_fallback || '—', 
    pl: p.pl ? p.pl.full_name : p.pl_name_fallback || '—',
    damages: p.notes_damages || 'nein', 
    incidents: p.notes_incidents || 'nein',
    feedback: p.notes_feedback || '—',
    totalCost: (p.total_cost || 0).toLocaleString('de-DE', {minimumFractionDigits: 2}) + ' €',
    transports: (p.protocol_transports || []).map(t => ({
      type: t.vehicle_type, driver: t.driver_name, punctuality: t.punctuality, delay: t.delay_mins
    })), 
    personnel: (p.shifts || []).map(s => ({
      pos: s.position_role, 
      name: s.temp_worker_name || (s.app_users ? s.app_users.full_name : 'Fest'), 
      start: (s.start_time||'').substring(0,5), 
      end: (s.end_time||'').substring(0,5), 
      pause: s.pause_mins, 
      fest: true
    })),
    categories: {}
  };

  if (p.protocol_equipments) {
    p.protocol_equipments.forEach(eq => {
      data.categories[eq.category_id] = {
        active: true, status: eq.status, note: eq.note, hussenDelivered: eq.hussen_delivered, hussenReturned: eq.hussen_returned
      };
    });
  }

  // Backup protState and temporarily inject dashboard state into protState so formulas.js functions work seamlessly
  var savedProtState = window.protState;
  window.protState = { holiday: false, signature: p.signature_base64 || null };

  var doc = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
  if (typeof LOGO_BASE64 !== 'undefined') {
    try { var lw = 30, lh = Math.round(lw * (LOGO_H / LOGO_W) * 100) / 100; doc.addImage(LOGO_BASE64, 'PNG', 160, 10, lw, lh); } catch(e) {}
  }
  
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Einsatzprotokoll', ml, 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120); doc.text('Lübbert Event Interiors', ml, 26); doc.setTextColor(0);
  var y = 38;

  doc.setDrawColor(230); doc.setFillColor(248,248,246); doc.rect(ml, y, cw, 32, 'F');
  doc.setFontSize(9); doc.setFont('helvetica','bold');
  doc.text('Projekt:', ml+4, y+6); doc.setFont('helvetica','normal'); doc.text(data.event, ml+25, y+6);
  doc.setFont('helvetica','bold'); doc.text('Ort:', ml+4, y+12); doc.setFont('helvetica','normal'); doc.text(data.location, ml+25, y+12);
  doc.setFont('helvetica','bold'); doc.text('Datum:', ml+4, y+18); doc.setFont('helvetica','normal'); doc.text(new Date(data.date).toLocaleDateString('de-DE'), ml+25, y+18);
  doc.setFont('helvetica','bold'); doc.text('Aktion:', ml+80, y+18); doc.setFont('helvetica','normal'); doc.text(data.action, ml+100, y+18);
  doc.setFont('helvetica','bold'); doc.text('AL:', ml+4, y+24); doc.setFont('helvetica','normal'); doc.text(data.al, ml+25, y+24);
  doc.setFont('helvetica','bold'); doc.text('PL:', ml+80, y+24); doc.setFont('helvetica','normal'); doc.text(data.pl, ml+100, y+24);
  y += 40;

  // Transports
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Logistik & Transport', ml, y); y += 6;
  if (!data.transports.length) {
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.text('Keine Lieferung.', ml, y); y += 8;
  } else {
    doc.setFillColor(30,30,28); doc.rect(ml,y,cw,8,'F'); doc.setTextColor(255); doc.setFontSize(8);
    doc.text('Fahrzeug',ml+2,y+5.5); doc.text('Fahrer',ml+40,y+5.5); doc.text('Status',ml+80,y+5.5); doc.text('Verspätung',ml+120,y+5.5);
    doc.setTextColor(0); y += 8;
    data.transports.forEach(function(t,i) {
      if (i%2===1){doc.setFillColor(248,248,246);doc.rect(ml,y,cw,8,'F');}
      doc.text(t.type,ml+2,y+5.5); doc.text(t.driver||'—',ml+40,y+5.5); doc.text(t.punctuality,ml+80,y+5.5); doc.text(t.delay?t.delay+' Min':'—',ml+120,y+5.5); y += 8;
    }); y += 4;
  }

  // Categories
  if (y > 240) { doc.addPage(); y = 20; }
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Equipment & Gewerke', ml, y); y += 6;
  var activeCatKeys = Object.keys(data.categories);
  if (activeCatKeys.length === 0) {
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.text('Keine Gewerke dokumentiert.', ml, y); y += 8;
  } else {
    activeCatKeys.forEach(function(catId) {
      var s = data.categories[catId];
      const fallbackLabels = { 'stoffe': 'Vorhänge & Stoffe', 'moebel': 'Möbel & Ausstattung', 'buehne': 'Bühne & Rigging', 'sonstiges': 'Sonstiges Equipment' };
      const catLabel = fallbackLabels[catId] || catId;
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text(catLabel+':', ml, y);
      doc.setFont('helvetica','normal'); doc.text((s.status||'okay').toUpperCase(), ml+40, y);
      if (s.note) { y+=5; doc.setFontSize(8); doc.setTextColor(100); doc.text(s.note, ml+5, y); doc.setTextColor(0); }
      y += 7; if (y > 270) { doc.addPage(); y = 20; }
    }); y += 4;
  }

  // Personnel
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Personal', ml, y); y += 6;
  if (!data.personnel.length) {
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.text('Keine Personaldaten.', ml, y); y += 8;
  } else {
    doc.setFillColor(30,30,28); doc.rect(ml,y,cw,8,'F'); doc.setTextColor(255); doc.setFontSize(8);
    doc.text('Pos',ml+2,y+5.5); doc.text('Name',ml+15,y+5.5); doc.text('Arbeitszeit',ml+70,y+5.5); doc.text('Pause',ml+110,y+5.5); doc.text('Netto',ml+140,y+5.5);
    doc.setTextColor(0); y += 8;
    data.personnel.forEach(function(pen,i) {
      if (i%2===1){doc.setFillColor(248,248,246);doc.rect(ml,y,cw,8,'F');}
      var v=null,b=null,pa=parseInt(pen.pause)||0;
      if (pen.start && pen.end) {
        var sp=pen.start.split(':'), ep=pen.end.split(':');
        if(sp.length===2 && ep.length===2) { v=parseInt(sp[0])*60+parseInt(sp[1]); b=parseInt(ep[0])*60+parseInt(ep[1]); }
      }
      var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
      var netStr='—'; if(v!==null&&b!==null&&effB>v){var n=(effB-v-pa)/60;netStr=n.toFixed(2)+' h';}
      var posLabel = pen.pos || 'MA';
      doc.text(posLabel,ml+2,y+5.5); doc.text(pen.name||'—',ml+25,y+5.5); doc.text((pen.start||'—')+' - '+(pen.end||'—'),ml+80,y+5.5); doc.text(pa+' Min',ml+120,y+5.5); doc.text(netStr,ml+150,y+5.5);
      y+=8; if(y>270){doc.addPage();y=20;}
    }); y += 4;
  }

  // Incidents
  if (y > 230) { doc.addPage(); y = 20; }
  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.text('Vorkommnisse / Feedback', ml, y); y += 6;
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.text('Mängel:', ml, y); doc.setFont('helvetica','normal'); doc.text(data.damages, ml+40, y); y += 6;
  doc.setFont('helvetica','bold'); doc.text('Vorkommnisse:', ml, y); doc.setFont('helvetica','normal'); doc.text(data.incidents, ml+40, y); y += 6;
  doc.setFont('helvetica','bold'); doc.text('Feedback:', ml, y); doc.setFont('helvetica','normal'); doc.text(data.feedback, ml+40, y); y += 12;

  // Costs (Matches protokoll.js style identically)
  doc.setDrawColor(24,95,165); doc.setLineWidth(0.5); doc.line(ml,y,ml+cw,y); y += 8;
  doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Nebenkalkulation (itemisiert):', ml, y); y += 6;
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100);
  
  data.transports.forEach(function(t) {
    if (typeof PROT_VEHICLE_RATES !== 'undefined') {
      var r = PROT_VEHICLE_RATES[t.type] || 0;
      doc.text('- ' + t.type + ': ' + r.toFixed(2) + ' EUR', ml + 5, y); y += 4;
      if (y > 280) { doc.addPage(); y = 20; }
    }
  });
  
  data.personnel.forEach(function(pen) {
    var v=null,b=null,pa=parseInt(pen.pause)||0;
    if (pen.start && pen.end) {
      var sp=pen.start.split(':'), ep=pen.end.split(':');
      if(sp.length===2 && ep.length===2) { v=parseInt(sp[0])*60+parseInt(sp[1]); b=parseInt(ep[0])*60+parseInt(ep[1]); }
    }
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v !== null && b !== null && effB > v) {
      var basePos = pen.pos;
      if (['AL', 'MA', 'Fahrer'].includes(pen.pos)) basePos += (pen.fest ? ' fest' : ' frei');
      var costs = [];
      if (typeof calcSplitShiftCosts === 'function') costs = calcSplitShiftCosts(basePos, data.date, false, v, effB, pa);
      costs.forEach(function(c) {
        var sub = c.hrs * c.rate;
        doc.text('- ' + pen.name + ' (' + c.desc + '): ' + c.hrs.toFixed(2) + 'h x ' + c.rate.toFixed(2) + ' EUR = ' + sub.toFixed(2) + ' EUR', ml + 5, y); y += 4;
        if (y > 280) { doc.addPage(); y = 20; }
      });
    }
  });
  y += 2;
  doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(24,95,165); 
  doc.text('Gesamtkosten (geschätzt): ' + data.totalCost, ml, y); y += 12;

  // Signature
  if (window.protState.signature) {
    if (y+35>270){doc.addPage();y=20;}
    doc.setDrawColor(24,95,165); doc.setLineWidth(0.3); doc.line(ml,y,ml+cw,y); y+=8;
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(0); doc.text('Unterschrift Aufbauleitung:', ml, y); y+=6;
    try { doc.addImage(window.protState.signature,'PNG',ml,y,60,30); } catch(e){}
    y+=35; doc.setDrawColor(180); doc.line(ml,y,ml+70,y); y+=4;
  }

  var fName = 'protokoll_' + data.date + '_' + data.event.replace(/\s+/g,'_') + '.pdf';
  doc.save(fName);
  
  // Revert temporary protState injection
  window.protState = savedProtState;
}
