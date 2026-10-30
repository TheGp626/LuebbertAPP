/**
 * Protokoll Module Logic
 */

// ── CONFIG & RATES ──
// ── CONFIG ──
// Rates are now in formulas.js

var PROT_CATEGORIES_CONFIG = [
  { id: 'mobiliar', label: 'Mobiliar', icon: '' },
  { id: 'stoffe', label: 'Stoffe', icon: '' },
  { id: 'floristik', label: 'Floristik', icon: '' },
  { id: 'tischlerei', label: 'Tischlerei', icon: '' },
  { id: 'logistik', label: 'Lager / Logistik', icon: '' }
];

// ── STATE ──
var protState = {
  transports: [],
  personnel: [],
  categories: {}, // { id: { active: true, status: 'okay', note: '' } }
  alId: null,           // UUID of selected AL user
  plId: null,           // UUID of selected PL user
  editingId: null,      // Supabase UUID for updates
  editingLocalId: null  // History ID (timestamp string)
};

var appUsers = [];
async function fetchAppUsers() {
  if (typeof supabaseClient === 'undefined') return;
  var { data, error } = await supabaseClient.from('app_users').select('id, full_name, email, role, role_rates, hourly_rate_internal, is_fest').or('is_active.is.null,is_active.eq.true');
  if (error) console.error("Error fetching app_users:", error);
  if (data) {
    // The guest login never works shifts → keep it out of AL/PL/staff pickers
    appUsers = data.filter(function(u) { return u.role !== 'Gast'; });
    // Rows resolved before the list was available get their fest flag now
    protState.personnel.forEach(function(p) {
      if (p.userId && (p.fest === undefined || p.fest === null)) {
        var u = appUsers.find(function(x) { return x.id === p.userId; });
        if (u) p.fest = !!u.is_fest;
      }
    });
    renderProtPersonnel();
    populateAlPlSelects();
    // A restored draft was calculated before the rates were known
    calcProtCosts();
  }
}

// Returns the effective internal hourly rate for a registered employee in a given position.
// Priority: role-specific rate_internal → general hourly_rate_internal → undefined (use template)
function getEffectivePersonnelRate(basePos, userId) {
  if (!userId) return undefined;
  var user = appUsers.find(function(u) { return u.id === userId; });
  if (!user) return undefined;
  if (Array.isArray(user.role_rates)) {
    var match = user.role_rates.find(function(r) { return r.role === basePos; });
    if (match && parseFloat(match.rate_internal) > 0) return parseFloat(match.rate_internal);
  }
  if (parseFloat(user.hourly_rate_internal) > 0) return parseFloat(user.hourly_rate_internal);
  return undefined;
}

// Value for jsPDF doc.text, which throws on numbers and null
function pdfStr(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback === undefined ? '' : fallback;
  return String(v);
}

// Billing position incl. fest/frei for AL/MA/Fahrer. The fest flag stored on the row wins
// (set when the name is resolved, or from the server), so an offline start before the
// user list has loaded doesn't bill fest staff as frei.
function protBasePos(p, users) {
  var basePos = p.pos;
  if (['AL', 'MA', 'Fahrer'].indexOf(p.pos) === -1) return basePos;
  if (p.isTemp || !p.userId) return basePos + ' frei';
  var fest = p.fest;
  if (fest === undefined || fest === null) {
    var u = (users || []).find(function(x) { return x.id === p.userId; });
    fest = !!(u && u.is_fest);
  }
  return basePos + (fest ? ' fest' : ' frei');
}

// AL/PL id from its <select>: before the user list has loaded the select is empty → keep the known id
function protSelectedId(selValue, stateId, usersLoaded) {
  if (selValue) return selValue;
  return usersLoaded ? null : (stateId || null);
}

// A draft belongs to the user who wrote it (shared devices); legacy drafts without owner are kept
function protDraftBelongsTo(draft, userId) {
  return !draft || !draft.ownerId || !userId || draft.ownerId === userId;
}

// "Meine Protokolle": written by the user, or the user is its AL/PL (old rows have no created_by).
// Takes history entries (createdBy/alId/plId) as well as dashboard rows (created_by/al_id/pl_id).
function protIsMine(e, userId) {
  if (!userId || !e) return false;
  return (e.createdBy || e.created_by) === userId || (e.alId || e.al_id) === userId || (e.plId || e.pl_id) === userId;
}

function protFilterScope(list, scope, userId) {
  return scope === 'all' ? (list || []) : (list || []).filter(function(e) { return protIsMine(e, userId); });
}

// Remembered per device and list; anything unknown falls back to "mine"
function protScopeGet(key) {
  try { return localStorage.getItem(key) === 'all' ? 'all' : 'mine'; } catch (e) { return 'mine'; }
}

function protScopeSet(key, scope) {
  try { localStorage.setItem(key, scope === 'all' ? 'all' : 'mine'); } catch (e) { /* storage unavailable */ }
}

// "Meine · Alle" switch above a list; setFn(scope) is a global function
function protScopeSegHtml(scope, setFn) {
  return '<div class="ui-seg prot-scope-seg" role="group" aria-label="Anzeige">' +
    '<button type="button" class="' + (scope === 'mine' ? 'active' : '') + '" onclick="' + setFn + '(\'mine\')">Meine</button>' +
    '<button type="button" class="' + (scope === 'all' ? 'active' : '') + '" onclick="' + setFn + '(\'all\')">Alle</button></div>';
}

// Server protocol row (with joins) → history entry shape. Shared by the history re-sync and the dashboard PDF.
function protRowToEntry(r) {
  var catMap = {};
  (r.protocol_equipments || []).forEach(function(eq) {
    catMap[eq.category_id] = { active: true, status: eq.status || 'okay', note: eq.note || '',
      hussenDelivered: eq.hussen_delivered || null, hussenReturned: eq.hussen_returned || null };
  });
  // Deduplicate identical shifts (same user + times + role) caused by prior save bugs
  var seen = {};
  var personnel = (r.shifts || []).filter(function(s) {
    var key = (s.user_id || s.temp_worker_name || '') + '|' + s.position_role + '|' + s.start_time + '|' + s.end_time;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(function(s) {
    var rKey = ratingKeyForShift(s);
    var rat = rKey ? (r.worker_ratings || []).find(function(w) {
      return (w.temp_worker_name || '').trim().toLowerCase() === rKey;
    }) : null;
    return {
      rating: rat ? rat.rating : null,
      isStar: rat ? !!rat.is_star : false,
      shiftId: s.id || null,
      name: (s.app_users && s.app_users.full_name) || s.temp_worker_name || '—',
      userId: s.user_id || null,
      isTemp: !s.user_id,
      tempName: s.user_id ? null : (s.temp_worker_name || null),
      pos: (s.position_role || '').replace(/ (fest|frei)$/, ''),
      fest: / fest$/.test(s.position_role || ''),
      start: (s.start_time || '').substring(0, 5),
      end: (s.end_time || '').substring(0, 5),
      pause: s.pause_mins || 0
    };
  });
  return {
    id: r.id,
    supabaseId: r.id,
    savedAt: r.created_at || r.date,
    event: (r.projects && r.projects.name) || '—',
    location: (r.projects && r.projects.location) || '—',
    date: r.date || '—',
    action: r.action || '—',
    al: (r.al && r.al.full_name) || r.al_name_fallback || '—',
    pl: (r.pl && r.pl.full_name) || r.pl_name_fallback || '—',
    alId: r.al_id || null,
    plId: r.pl_id || null,
    createdBy: r.created_by || null,
    totalCost: (Number(r.total_cost) || 0).toFixed(2).replace('.', ',') + ' €',
    transports: (r.protocol_transports || []).map(function(t) {
      // hours stays null for rows saved before driver hours existed → no driver cost on recalc
      return { type: t.vehicle_type, driver: t.driver_name, punctuality: t.punctuality, delay: t.delay_mins,
        hours: t.driver_hours == null ? null : Number(t.driver_hours), driverUserId: t.driver_user_id || '' };
    }),
    personnel: personnel,
    categories: catMap,
    damages: r.notes_damages || 'nein',
    incidents: r.notes_incidents || 'nein',
    feedback: r.notes_feedback || '—',
    holiday: !!r.is_holiday,
    signature: r.signature_text || null,
    synced: true
  };
}

// Merges fresh server entries into the local archive (in place). A local entry that is still
// unsynced holds an edit the server doesn't have yet → it is kept until the retry pushes it.
// limit = row limit of the fetch: fewer rows than that means the server sent everything, so synced entries
// it doesn't have were deleted there → dropped. With a full window only entries newer than the oldest
// fetched date can be judged. Unsynced entries are never dropped.
function mergeProtHistory(archive, freshList, limit) {
  if (limit && freshList.length) {
    var onServer = {}, minDate = null;
    freshList.forEach(function(f) {
      onServer[f.supabaseId] = true;
      if (f.date && (minDate === null || f.date < minDate)) minDate = f.date;
    });
    var complete = freshList.length < limit;
    for (var i = archive.length - 1; i >= 0; i--) {
      var old = archive[i];
      if (old.synced !== true || !old.supabaseId || onServer[old.supabaseId]) continue;
      if (complete || (minDate !== null && /^\d{4}-\d{2}-\d{2}/.test(old.date || '') && old.date.slice(0, 10) > minDate)) archive.splice(i, 1);
    }
  }
  freshList.forEach(function(fresh) {
    var idx = archive.findIndex(function(e) { return e.supabaseId === fresh.supabaseId; });
    // Server signatures stay out of localStorage (quota); only a locally drawn one is kept
    if (idx === -1) {
      fresh.signature = null;
      fresh.mailed = true; // never mail older protocols retroactively
      archive.push(fresh);
      return;
    }
    var old = archive[idx];
    if (old.synced === false) return;
    fresh.signature = old.signature || null;
    // Keep a pending mail retry; older entries without the flag never get mailed retroactively
    fresh.mailed = old.mailed !== false;
    fresh.isUpdate = !!old.isUpdate;
    archive[idx] = fresh;
  });
  return archive;
}

// <option>s of the AL/PL select. A stored person who isn't in the list any more (deactivated, role changed)
// stays selectable under the stored name, otherwise editing an old protocol would drop AL/PL on Senden.
function protPersonOptionsHtml(users, placeholder, selectedId, storedName) {
  var known = false;
  var html = '<option value="">' + placeholder + '</option>' + users.map(function(u) {
    if (u.id === selectedId) known = true;
    return '<option value="' + escapeHtml(u.id) + '">' + escapeHtml(u.full_name || u.email) + '</option>';
  }).join('');
  if (selectedId && !known) {
    var u = appUsers.find(function(x) { return x.id === selectedId; });
    var name = (u && (u.full_name || u.email)) || (storedName && storedName !== '—' ? storedName : 'Bisherige Person');
    html += '<option value="' + escapeHtml(selectedId) + '">' + escapeHtml(name) + '</option>';
  }
  return html;
}

function populateAlPlSelects() {
  var alSel = document.getElementById('prot-al');
  var plSel = document.getElementById('prot-pl');

  if (alSel) {
    var alUsers = appUsers.filter(function(u) { return userHasRole(u, 'AL') || u.role === 'Admin'; });
    alSel.innerHTML = protPersonOptionsHtml(alUsers, '— AL auswählen —', protState.alId, protState.alName);
    if (protState.alId) alSel.value = protState.alId;
  }

  if (plSel) {
    var plUsers = appUsers.filter(function(u) { return userHasRole(u, 'PL') || u.role === 'Admin'; });
    plSel.innerHTML = protPersonOptionsHtml(plUsers, '— PL auswählen —', protState.plId, protState.plName);
    if (protState.plId) plSel.value = protState.plId;
  }
}

function initProtokoll() {
  var hadDraft = loadProtDraft();
  if (!protState.alId && typeof currentUser !== 'undefined' && currentUser) {
    protState.alId = currentUser.id;
    saveProtDraft();
  }
  // Default Sprinter only for a brand-new form; a draft whose transports were removed stays without
  if (!hadDraft && protState.transports.length === 0) addProtTransport();
  if (protState.personnel.length === 0) addProtPersonnel();

  fillMissingCategories(protState.categories, PROT_CATEGORIES_CONFIG, true);

  renderProtTransport();
  renderProtPersonnel();
  renderProtCategories();
  calcProtCosts();
  setTimeout(redrawProtSig, 50);
  // Restored draft: action segment, section checks and textarea heights follow the loaded values
  syncProtActionSeg();
  renderProtSectionNav();
  ['prot-damages', 'prot-incidents', 'prot-feedback'].forEach(function(id) { var t = document.getElementById(id); if (t && t.style) growProtText(t); });

  fetchAppUsers();
}

// ── PROTOKOLL SIGNATURE ──
function initProtSig() {
  var canvas = document.getElementById('sigc-prot');
  if (!canvas) return;
  var dpr = window.devicePixelRatio || 1, pw = canvas.parentElement.offsetWidth || 300, ph = 100;
  canvas.width = pw * dpr; canvas.height = ph * dpr;
  canvas.style.width = pw + 'px'; canvas.style.height = ph + 'px';
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pw, ph); ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
}

function redrawProtSig() {
  var canvas = document.getElementById('sigc-prot');
  if (!canvas) return;
  if (!canvas.width || canvas.width < 10) initProtSig();
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  var ph = document.getElementById('sigph-prot');
  if (protState.signature) {
    var img = new Image();
    img.onload = function() { ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr); };
    img.src = protState.signature;
    if (ph) ph.style.display = 'none';
  } else {
    if (ph) ph.style.display = '';
  }
  renderProtSectionNav(); // signature check mark + pill
}

function openProtSig() {
  sigModalState.key = 'prot';
  var m = document.getElementById('sig-modal');
  if (m) m.classList.add('open');
  setTimeout(function() {
    initSigModalCanvas();
    if (protState.signature) {
      var c = document.getElementById('sig-modal-canvas');
      var pad = { ctx: c.getContext('2d'), w: c.width / (window.devicePixelRatio||1), h: c.height / (window.devicePixelRatio||1) };
      var img = new Image();
      img.onload = function() { pad.ctx.drawImage(img, 0, 0, pad.w, pad.h); sigModalState.hasInk = true; };
      img.src = protState.signature;
    }
  }, 50);
}

function clearProtSig() {
  protState.signature = null;
  redrawProtSig();
  saveProtDraft();
}



// ── TRANSPORT ──
// Open/closed rows of the form ('t<i>' transport, 'p<i>' personnel); new entries start open
var protOpenRows = {};

function toggleProtRow(key) {
  protOpenRows[key] = !protOpenRows[key];
  if (key.charAt(0) === 't') { protTransportOpened = true; renderProtTransport(); renderProtSectionNav(); }
  else renderProtPersonnel();
}

// After removing row `idx` of kind 't'/'p', the rows behind it move up one place
function protShiftOpenRows(kind, idx) {
  var next = {};
  Object.keys(protOpenRows).forEach(function(k) {
    if (!protOpenRows[k]) return;
    if (k.charAt(0) !== kind) { next[k] = true; return; }
    var n = parseInt(k.slice(1), 10);
    if (n < idx) next[k] = true;
    else if (n > idx) next[kind + (n - 1)] = true;
  });
  protOpenRows = next;
}

// "Sprinter · Max · 5 h · pünktlich" / "LKW · ohne Fahrer · 20 min Verspätung"
function protTransportSummary(t) {
  var driver = (t.driver || '').trim() || 'ohne Fahrer';
  var hrs = parseFloat(t.hours);
  var when = t.punctuality === 'verspätet' ? ((t.delay ? t.delay + ' min ' : '') + 'Verspätung') : 'pünktlich';
  return (t.type || 'Fahrzeug') + ' · ' + driver + (hrs > 0 ? ' · ' + String(hrs).replace('.', ',') + ' h' : '') + ' · ' + when;
}

// Same driver: by user id when both sides have one, else by name (case-insensitive)
function protDriverSame(a, b) {
  if (a.driverUserId && b.driverUserId) return a.driverUserId === b.driverUserId;
  var na = (a.driver || '').trim().toLowerCase();
  return !!na && na === (b.driver || '').trim().toLowerCase();
}

// Other tours of the driver of form row idx: in this form (other rows) and on other protocols of the day
// (others = rows of protocol_transports: { driver_name, driver_user_id })
function protDriverBusyCount(transports, idx, others) {
  var me = transports[idx];
  if (!me || (!me.driverUserId && !(me.driver || '').trim())) return 0;
  var n = 0;
  transports.forEach(function(t, j) { if (j !== idx && protDriverSame(me, t)) n++; });
  (others || []).forEach(function(o) {
    if (protDriverSame(me, { driver: o.driver_name, driverUserId: o.driver_user_id })) n++;
  });
  return n;
}

function protDriverHint(name, n) {
  if (!n) return '';
  return name + ' hat an diesem Tag schon ' + n + ' weitere ' + (n === 1 ? 'Tour' : 'Touren') + ' – Stunden ggf. aufteilen.';
}

// "08:00–16:30 · 30 min"
function protPersonSummary(p) {
  var pause = parseInt(p.pause) || 0;
  if (p.start && p.end) return p.start + '–' + p.end + (pause > 0 ? ' · ' + pause + ' min' : '');
  if (p.start) return 'ab ' + p.start + ' · Ende fehlt';
  if (p.end) return 'bis ' + p.end + ' · Start fehlt';
  return 'Zeiten fehlen';
}

function protRowChevron(key) {
  return '<button type="button" class="ui-icon-btn prot-chev" aria-label="Details" aria-expanded="' + (protOpenRows[key] ? 'true' : 'false') + '" onclick="event.stopPropagation();toggleProtRow(\'' + key + '\')">' + uiIcon('chevron-right') + '</button>';
}

function addProtTransport() {
  protState.transports.push({ type: 'Sprinter', driver: '', driverUserId: '', hours: 5, punctuality: 'pünktlich', delay: '' });
  protOpenRows['t' + (protState.transports.length - 1)] = true;
  renderProtTransport();
  saveProtDraft();
}

function removeProtTransport(idx) {
  protState.transports.splice(idx, 1);
  protShiftOpenRows('t', idx);
  renderProtTransport();
  saveProtDraft();
  calcProtCosts();
}

function renderProtTransport() {
  var list = document.getElementById('prot-transport-list');
  if (!list) return;
  list.innerHTML = protState.transports.map(function(t, i) {
    var key = 't' + i;
    var vehicles = Object.keys(PROT_VEHICLE_RATES).map(function(v) {
      return '<option value="' + v + '" ' + (t.type === v ? 'selected' : '') + '>' + v + '</option>';
    }).join('');
    return '<div class="ui-row ui-row-wrap' + (protOpenRows[key] ? ' ui-row-open' : '') + '">' +
      '<div class="ui-row-main" onclick="toggleProtRow(\'' + key + '\')">' +
        '<div class="ui-row-title">Transport ' + (i + 1) + '</div>' +
        '<div class="ui-sub" id="prot-tsum-' + i + '">' + escapeHtml(protTransportSummary(t)) + '</div>' +
      '</div>' +
      '<div class="ui-row-end">' + protRowChevron(key) + '</div>' +
      '<div class="ui-row-body">' +
        '<div class="stunden-grid">' +
          '<label class="ui-field"><span>Fahrzeugtyp</span><select onchange="updateProtTransport(' + i + ', \'type\', this.value)">' + vehicles + '</select></label>' +
          '<div class="ui-field"><span>Fahrer</span>' + uiComboHtml('prot-drv-' + i, t.driver || '', 'Name tippen…', 'onProtDriverName', i) + '</div>' +
        '</div>' +
        '<label class="ui-field"><span>Fahrerstunden</span><input type="number" step="0.5" min="0" placeholder="0" value="' + escapeHtml(t.hours == null ? '' : t.hours) + '" oninput="updateProtTransport(' + i + ', \'hours\', this.value)"/></label>' +
        '<div class="ui-sub" id="prot-drvhint-' + i + '" style="margin:-6px 2px 10px;"></div>' +
        (t.type === 'Spedition' ? '<div class="ui-sub" style="margin:-4px 2px 10px;">Kosten separat per Rechnung erfassen</div>' : '') +
        '<div class="stunden-grid">' +
          '<label class="ui-field"><span>Pünktlichkeit</span><select onchange="updateProtTransport(' + i + ', \'punctuality\', this.value)">' +
            '<option value="pünktlich" ' + (t.punctuality === 'pünktlich' ? 'selected' : '') + '>Pünktlich</option>' +
            '<option value="verspätet" ' + (t.punctuality === 'verspätet' ? 'selected' : '') + '>Verspätung</option>' +
          '</select></label>' +
          (t.punctuality === 'verspätet'
            ? '<label class="ui-field"><span>Dauer (Min)</span><input type="number" placeholder="0" value="' + escapeHtml(t.delay || '') + '" oninput="updateProtTransport(' + i + ', \'delay\', this.value)"/></label>'
            : '') +
        '</div>' +
        '<button type="button" class="ui-btn ui-btn-danger prot-remove" onclick="removeProtTransport(' + i + ')">Transport entfernen</button>' +
      '</div>' +
    '</div>';
  }).join('');
  protRefreshDriverHints();
}

function updateProtTransport(idx, field, val) {
  protState.transports[idx][field] = val;
  if (field === 'punctuality') {
    if (val !== 'verspätet') protState.transports[idx].delay = '';
    renderProtTransport();
  }
  var sum = document.getElementById('prot-tsum-' + idx);
  if (sum) sum.textContent = protTransportSummary(protState.transports[idx]);
  saveProtDraft();
  if (field === 'type') { calcProtCosts(); renderProtTransport(); }
  if (field === 'hours') calcProtCosts();
}

// Transport rows of other protocols on the form's date (read-only), cached per date + edited protocol;
// feeds the "driver already has another tour today" hint
var protDayDrivers = { key: null, rows: [] };
function protRefreshDriverHints() {
  var dateEl = document.getElementById('prot-date');
  var date = dateEl && dateEl.value;
  var apply = function() {
    protState.transports.forEach(function(t, i) {
      var el = document.getElementById('prot-drvhint-' + i);
      if (el) el.textContent = protDriverHint((t.driver || '').trim(), protDriverBusyCount(protState.transports, i, protDayDrivers.rows));
    });
  };
  apply();
  var key = date + '|' + (protState.editingId || '');
  if (!date || protDayDrivers.key === key || typeof supabaseClient === 'undefined' || !navigator.onLine) return;
  protDayDrivers = { key: key, rows: [] };
  var q = supabaseClient.from('protocol_transports').select('driver_name, driver_user_id, protocol_id, protocols!inner(date)').eq('protocols.date', date);
  if (protState.editingId) q = q.neq('protocol_id', protState.editingId);
  q.then(function(res) {
    if (protDayDrivers.key !== key) return;
    if (res.error) { protDayDrivers.key = null; return; }
    protDayDrivers.rows = res.data || [];
    apply();
  }, function() { protDayDrivers.key = null; });
}

// Driver picked from the list or typed: a registered user sets driverUserId, free text clears it
function onProtDriverName(idx, val) {
  var typed = (val || '').trim();
  var lower = typed.toLowerCase();
  var exact = appUsers.filter(function(u) { return (u.full_name || '').toLowerCase() === lower; });
  var t = protState.transports[idx];
  if (!t) return;
  t.driver = typed;
  t.driverUserId = exact.length === 1 ? exact[0].id : '';
  var sum = document.getElementById('prot-tsum-' + idx);
  if (sum) sum.textContent = protTransportSummary(t);
  saveProtDraft();
  calcProtCosts();
  protRefreshDriverHints();
}

// ── PERSONNEL ──
function addProtPersonnel() {
  protState.personnel.push({ pos: 'MA', isTemp: false, userId: '', tempName: '', name: '', start: '', end: '', pause: '0', rating: null, isStar: false });
  protOpenRows['p' + (protState.personnel.length - 1)] = true;
  renderProtPersonnel();
  saveProtDraft();
}

// Wochenplan shift (planShiftFromDb shape) → personnel rows for "Protokoll starten": only people the plan
// names, AL first. Start: personal note ("ab 14 Uhr", agency "8.30 - 16.30 Uhr") → else the shift's Wann time.
// End only when the plan states one for that person; the AL fills in the rest.
function protPlanPersonnel(shift, users) {
  var shiftWhen = planWhen(shift.wann || []);
  var shiftStart = shiftWhen.prefix === 'bis' ? '' : (shiftWhen.time || '');
  var posOf = function(role) {
    if (role === 'ROCKiT') return 'Rockit';
    return ['AL', 'MA', 'Fahrer', 'Zenjob'].indexOf(role) !== -1 ? role : 'MA';
  };
  var rows = (shift.people || []).map(function(p) {
    var own = p.note ? planWhen([p.note]) : { time: null };
    var start = shiftStart, end = '';
    if (own.time && own.prefix === 'bis') end = own.time;
    else if (own.time) { start = own.time; end = own.end || ''; }
    var pos = posOf(p.role), isAgency = pos === 'Zenjob' || pos === 'Rockit';
    var u = p.userId && !isAgency ? (users || []).find(function(x) { return x.id === p.userId; }) : null;
    var row = { pos: pos, isTemp: isAgency, userId: u ? u.id : '', tempName: isAgency ? p.name : '',
      name: u ? (u.full_name || u.email) : p.name, start: start, end: end, pause: '0', rating: null, isStar: false };
    if (u) row.fest = !!u.is_fest;
    var a = timeToMins(start), b = timeToMins(end);
    if (a !== null && b !== null) row.pause = String(autoPause((b < a ? b + 1440 : b) - a));
    return row;
  });
  return rows.filter(function(r) { return r.pos === 'AL'; }).concat(rows.filter(function(r) { return r.pos !== 'AL'; }));
}

// Puts plan rows into the form unless the AL already entered someone (then nothing changes)
function protApplyPlanPersonnel(rows) {
  if (!rows || !rows.length) return false;
  var touched = protState.personnel.some(function(p) { return p.name || p.tempName || p.start || p.end; });
  if (touched) return false;
  protState.personnel = rows;
  protOpenRows = {};
  renderProtPersonnel();
  saveProtDraft();
  if (typeof calcProtCosts === 'function') calcProtCosts();
  return true;
}

function updateProtRating(idx, field, val) {
  protState.personnel[idx][field] = val;
  renderProtPersonnel();
  saveProtDraft();
}

function removeProtPersonnel(idx) {
  // No server delete here: Senden replaces all shifts of the protocol, and abandoning the edit must keep them
  protState.personnel.splice(idx, 1);
  protShiftOpenRows('p', idx);
  renderProtPersonnel();
  saveProtDraft();
  calcProtCosts();
}

function protRatingButtons(p, i) {
  return '<span class="prot-rating">' +
    '<button type="button" class="prot-rate' + (p.rating === 'up' ? ' on' : '') + '" onclick="event.stopPropagation();updateProtRating(' + i + ',\'rating\',' + (p.rating === 'up' ? 'null' : '\'up\'') + ')" title="Daumen hoch">👍</button>' +
    '<button type="button" class="prot-rate' + (p.rating === 'down' ? ' on' : '') + '" onclick="event.stopPropagation();updateProtRating(' + i + ',\'rating\',' + (p.rating === 'down' ? 'null' : '\'down\'') + ')" title="Daumen runter">👎</button>' +
    '<button type="button" class="prot-rate' + (p.isStar ? ' on' : '') + '" onclick="event.stopPropagation();updateProtRating(' + i + ',\'isStar\',' + (!p.isStar) + ')" title="Besonders gut">⭐</button>' +
  '</span>';
}

function renderProtPersonnel() {
  var list = document.getElementById('prot-personnel-list');
  if (!list) return;
  list.innerHTML = protState.personnel.map(function(p, i) {
    var key = 'p' + i;
    var opts = ['AL', 'MA', 'Fahrer', 'Zenjob', 'Rockit'].map(function(o) {
      return '<option value="' + o + '" ' + (p.pos === o ? 'selected' : '') + '>' + o + '</option>';
    }).join('');
    var isAgency = (p.pos === 'Zenjob' || p.pos === 'Rockit');
    var unregistered = !p.isTemp && !p.userId && p.name;
    var nameField = p.isTemp
      ? '<input type="text" placeholder="Aushilfe Name" value="' + escapeHtml(p.tempName || '') + '" oninput="updateProtPersonnel(' + i + ', \'tempName\', this.value)"/>'
      : uiComboHtml('prot-pn-' + i, p.name || '', 'Name tippen…', 'onProtPersonnelName', i);
    return '<div class="ui-row ui-row-wrap' + (protOpenRows[key] ? ' ui-row-open' : '') + '">' +
      '<div class="ui-row-main" onclick="toggleProtRow(\'' + key + '\')">' +
        '<div class="ui-row-title"><span id="prot-pname-' + i + '">' + escapeHtml(p.name || p.tempName || 'Ohne Name') + '</span> <span class="ui-pill ui-pill-info">' + escapeHtml(p.pos || '') + '</span></div>' +
        '<div class="ui-sub" id="prot-psum-' + i + '">' + escapeHtml(protPersonSummary(p)) + '</div>' +
        // Always present (hidden when registered) so onProtPersonnelName can toggle it without a re-render
        '<span id="prot-punreg-' + i + '" class="ui-pill ui-pill-warn" style="margin-top:4px;' + (unregistered ? '' : 'display:none;') + '" title="Kein registrierter Mitarbeiter – wird als Externe(r) gespeichert">nicht registriert</span>' +
      '</div>' +
      '<div class="ui-row-end">' + (isAgency ? protRatingButtons(p, i) : '') + protRowChevron(key) + '</div>' +
      '<div class="ui-row-body">' +
        '<div class="stunden-grid">' +
          '<label class="ui-field"><span>Position</span><select onchange="updateProtPersonnel(' + i + ', \'pos\', this.value)">' + opts + '</select></label>' +
          '<div class="ui-field"><span>Name</span>' + nameField + '</div>' +
        '</div>' +
        '<label class="prot-switch-label" style="margin:-4px 2px 12px;"><input type="checkbox" class="ui-switch" onchange="updateProtPersonnel(' + i + ',\'isTemp\',this.checked)" ' + (p.isTemp ? 'checked' : '') + ' /> Externe(r) / Aushilfe</label>' +
        '<div class="prot-time-grid">' +
          '<label class="ui-field"><span>Start</span><input type="time" value="' + (p.start || '') + '" oninput="updateProtPersonnel(' + i + ', \'start\', this.value)"/></label>' +
          '<label class="ui-field"><span>Ende</span><input type="time" value="' + (p.end || '') + '" oninput="updateProtPersonnel(' + i + ', \'end\', this.value)"/></label>' +
          '<label class="ui-field"><span>Pause</span><input type="number" placeholder="Min" value="' + (p.pause || '0') + '" oninput="updateProtPersonnel(' + i + ', \'pause\', this.value)"/></label>' +
        '</div>' +
        '<button type="button" class="ui-btn ui-btn-danger prot-remove" onclick="removeProtPersonnel(' + i + ')">Person entfernen</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Resolves a typed personnel name to a registered user (exact match first,
// then unique substring match). Unresolved names are kept as free text and
// stored like an Aushilfe (temp_worker_name) — the warning under the field
// makes that visible.
function onProtPersonnelName(idx, val) {
  var typed = (val || '').trim();
  var lower = typed.toLowerCase();
  var exact = appUsers.filter(function(u) { return (u.full_name || '').toLowerCase() === lower; });
  var partial = typed.length >= 3 ? appUsers.filter(function(u) { return (u.full_name || '').toLowerCase().includes(lower); }) : [];
  var match = exact.length === 1 ? exact[0] : (partial.length === 1 ? partial[0] : null);
  var row = protState.personnel[idx];
  if (!row) return;
  var userId = match ? match.id : '';
  var name = match ? (match.full_name || match.email) : typed;
  // Also fires on blur: nothing changed → leave the DOM alone (a rebuild would destroy the field just tapped)
  if (row.userId === userId && row.name === name) return;
  row.userId = userId;
  row.name = name;
  if (match) row.fest = !!match.is_fest; // kept on the row for offline saves
  else delete row.fest;
  // Update only this row; renderProtPersonnel() would rebuild all inputs and drop the keyboard
  var title = document.getElementById('prot-pname-' + idx);
  if (title) title.textContent = row.name || row.tempName || 'Ohne Name';
  var unreg = document.getElementById('prot-punreg-' + idx);
  if (unreg) unreg.style.display = (!row.isTemp && !row.userId && row.name) ? '' : 'none';
  var inp = document.getElementById('prot-pn-' + idx);
  if (inp && match && inp.value !== name && document.activeElement !== inp) inp.value = name;
  saveProtDraft();
  calcProtCosts();
}

function updateProtPersonnel(idx, field, val) {
  // Old AL times, tracked separately: an end must never be compared with other rows' start (or vice versa)
  var oldStart = protState.personnel[idx].start, oldEnd = protState.personnel[idx].end;
  protState.personnel[idx][field] = val;
  
  if (field === 'userId') {
    var u = appUsers.find(x => x.id === val);
    if (u) { protState.personnel[idx].name = u.full_name || u.email; protState.personnel[idx].fest = !!u.is_fest; }
    else delete protState.personnel[idx].fest;
  }
  if (field === 'tempName') {
    protState.personnel[idx].name = val;
  }
  if (field === 'pos' || field === 'isTemp') renderProtPersonnel();

  // Auto-pause calculation
  if (field === 'start' || field === 'end') {
    var v = timeToMins(protState.personnel[idx].start);
    var b = timeToMins(protState.personnel[idx].end);
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v !== null && b !== null && effB > v) {
      protState.personnel[idx].pause = autoPause(effB - v);
      renderProtPersonnel();
    }
    
    // Time sync: if AL (index 0) changes, update others if they are empty or matched old AL time
    if (idx === 0) {
      protState.personnel.forEach(function(p, i) {
        if (i === 0) return;
        if (!p.start || (field === 'start' && p.start === oldStart)) p.start = protState.personnel[0].start;
        if (!p.end || (field === 'end' && p.end === oldEnd)) p.end = protState.personnel[0].end;
        var pv = timeToMins(p.start), pb = timeToMins(p.end);
        var effPb = (pb !== null && pv !== null && pb < pv) ? pb + 1440 : pb;
        if (pv !== null && pb !== null && effPb > pv) p.pause = autoPause(effPb - pv);
      });
      renderProtPersonnel();
    }
  }
  var sum = document.getElementById('prot-psum-' + idx);
  if (sum) sum.textContent = protPersonSummary(protState.personnel[idx]);
  var title = document.getElementById('prot-pname-' + idx);
  if (title) title.textContent = protState.personnel[idx].name || protState.personnel[idx].tempName || 'Ohne Name';

  saveProtDraft();
  calcProtCosts();
}

// ── CATEGORIES ──
function renderProtCategories() {
  var list = document.getElementById('prot-categories-list');
  if (!list) return;
  list.innerHTML = PROT_CATEGORIES_CONFIG.map(function(cat) {
    var state = protState.categories[cat.id];
    var active = state.active;
    var hussenFields = '';
    if (cat.id === 'stoffe') {
      hussenFields = '<div class="ui-label" style="margin:12px 2px 6px;">Rücklauf Estrel-Hussen</div>' +
        '<div class="stunden-grid">' +
          '<label class="ui-field"><span>Stück geliefert</span><input type="number" placeholder="0" value="' + (state.hussenDelivered || '') + '" oninput="updateProtCategory(\'' + cat.id + '\', \'hussenDelivered\', this.value)"/></label>' +
          '<label class="ui-field"><span>Stück zurück (gezählt)</span><input type="number" placeholder="0" value="' + (state.hussenReturned || '') + '" oninput="updateProtCategory(\'' + cat.id + '\', \'hussenReturned\', this.value)"/></label>' +
        '</div>';
    }
    return '<div class="ui-card prot-cat' + (active ? '' : ' prot-cat-off') + '">' +
      '<label class="prot-cat-head"><span class="ui-row-title">' + escapeHtml(cat.label) + '</span>' +
        '<span class="ui-sub">' + (active ? 'vorhanden' : 'nicht vorhanden') + '</span>' +
        '<input type="checkbox" class="ui-switch" ' + (active ? 'checked' : '') + ' onchange="toggleProtCategory(\'' + cat.id + '\')" aria-label="' + escapeHtml(cat.label) + ' vorhanden"/></label>' +
      (active
        ? '<div class="ui-field" style="margin-top:10px;"><span>Zustand</span><div class="ui-seg prot-action-seg">' +
            ['okay', 'unsauber', 'beschädigt', 'unvollständig'].map(function(s) {
              return '<button type="button" class="' + (state.status === s ? 'active' : '') + '" onclick="updateProtCategory(\'' + cat.id + '\', \'status\', \'' + s + '\')">' + s + '</button>';
            }).join('') +
          '</div></div>' +
          '<label class="ui-field"><span>Anmerkungen</span><input type="text" placeholder="Details, falls nötig" value="' + escapeHtml(state.note || '') + '" oninput="updateProtCategory(\'' + cat.id + '\', \'note\', this.value)"/></label>' +
          hussenFields
        : '') +
    '</div>';
  }).join('');
}

function toggleProtCategory(id) {
  protState.categories[id].active = !protState.categories[id].active;
  renderProtCategories();
  saveProtDraft();
}

function updateProtCategory(id, field, val) {
  protState.categories[id][field] = val;
  if (field === 'status') renderProtCategories();
  saveProtDraft();
}

// ── CALCULATIONS ──
// Driver cost of a transport: hours × rate of position "Fahrer" (fest/frei and personal rate for a registered
// driver, else "Fahrer frei"). null without hours (old rows) or without a driver. Shared with the dashboard.
function protDriverCost(t, users) {
  var hrs = parseFloat(t.hours);
  if (!(hrs > 0) || (!t.driverUserId && !(t.driver || '').trim())) return null;
  var basePos = protBasePos({ pos: 'Fahrer', userId: t.driverUserId || '' }, users);
  var custom = t.driverUserId ? getEffectivePersonnelRate(basePos, t.driverUserId) : undefined;
  var rate = (typeof custom === 'number' && custom > 0) ? custom : (PROT_PERSONNEL_RATES[basePos] || 0);
  return { hrs: hrs, rate: rate, amount: hrs * rate };
}

// Cost lines of a protocol: one per transport, driver (with hours) and per person with valid times; total = their sum
function protCostLines(state, date, holiday) {
  var lines = [];
  (state.transports || []).forEach(function(t) {
    lines.push({ label: t.type || 'Fahrzeug', amount: calcTransportCost(t.type, date) });
    var drv = protDriverCost(t, appUsers);
    if (drv) lines.push({ label: 'Fahrer ' + ((t.driver || '').trim() || 'ohne Name'), amount: drv.amount });
  });
  (state.personnel || []).forEach(function(p) {
    var v = timeToMins(p.start), b = timeToMins(p.end), pa = parseInt(p.pause) || 0;
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v !== null && b !== null && effB > v) {
      var basePos = protBasePos(p, appUsers);
      var customRate = (!p.isTemp && p.userId) ? getEffectivePersonnelRate(basePos, p.userId) : undefined;
      var amount = 0;
      calcSplitShiftCosts(basePos, date, holiday, v, effB, pa, customRate).forEach(function(c) { amount += c.hrs * c.rate; });
      lines.push({ label: (p.name || p.tempName || 'Person') + ' (' + (p.pos || '') + ')', amount: amount });
    }
  });
  var total = 0;
  lines.forEach(function(l) { total += l.amount; });
  return { lines: lines, total: total };
}

var protLastCost = { lines: [], total: 0 };

function calcProtCosts() {
  // Read date and holiday directly from the DOM so live edits are reflected
  var dateEl    = document.getElementById('prot-date');
  var holidayEl = document.getElementById('prot-isholiday');
  var currentDate    = (dateEl && dateEl.value)       ? dateEl.value    : (protState.date    || localDateStr());
  var currentHoliday = (holidayEl)                    ? holidayEl.checked : (protState.holiday || false);

  protLastCost = protCostLines(protState, currentDate, currentHoliday);
  var el = document.getElementById('prot-total-cost');
  if (el) el.textContent = protLastCost.total.toFixed(2).replace('.', ',');
}

// Tapping the cost in the action bar: the breakdown of the current calculation
function openProtCostSheet() {
  calcProtCosts();
  var fmt = function(n) { return n.toFixed(2).replace('.', ',') + ' €'; };
  var m = document.getElementById('prot-cost-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'prot-cost-modal';
    m.className = 'sig-modal ui-sheet';
    m.style.setProperty('--sheet-w', '480px');
    m.innerHTML = '<div class="sig-modal-inner"></div>';
    m.addEventListener('click', function(e) { if (e.target === m) m.classList.remove('open'); });
    document.body.appendChild(m);
  }
  m.firstChild.innerHTML =
    '<div class="ui-sheet-head"><h3 class="ui-title" style="font-size:18px;">Nachkalkulation</h3>' +
      '<button type="button" class="ui-icon-btn" aria-label="Schließen" onclick="document.getElementById(\'prot-cost-modal\').classList.remove(\'open\')">' +
      '<svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
    (protLastCost.lines.length
      ? protLastCost.lines.map(function(l) { return '<div class="prot-cost-line"><span>' + escapeHtml(l.label) + '</span><b>' + fmt(l.amount) + '</b></div>'; }).join('')
      : '<div class="ui-sub">Noch keine Kosten: Transport oder Personal mit Zeiten eintragen.</div>') +
    '<div class="prot-cost-line prot-cost-total"><span>Gesamt</span><b>' + fmt(protLastCost.total) + '</b></div>' +
    '<div class="ui-sub" style="margin-top:8px;">Logistik + Personal, mit den aktuellen Sätzen.</div>';
  m.classList.add('open');
}

// ── SECTIONS (redesign): navigation chips with check marks; hints only, Senden stays allowed ──
var PROT_SECTIONS = [['basis', 'Basis'], ['transport', 'Transport'], ['equipment', 'Equipment'], ['personal', 'Personal'], ['vorkommnisse', 'Vorkommnisse'], ['unterschrift', 'Unterschrift']];
var PROT_ACTIONS = ['Aufbau', 'Teilaufbau', 'Umbau', 'Teilabbau', 'Abbau'];
var protTransportOpened = false;

// state = protState; basis = {event, date, alId}; opened = {transport} (section looked at, "bewusst keiner")
function protSectionStatus(state, basis, opened) {
  basis = basis || {}; opened = opened || {};
  var cats = state.categories || {};
  return {
    basis: !!(basis.event && basis.date && basis.alId),
    transport: (state.transports || []).length > 0 || !!opened.transport,
    equipment: Object.keys(cats).every(function(k) { return !cats[k].active || !!cats[k].status; }),
    personal: (state.personnel || []).some(function(p) { return p.start && p.end; }),
    vorkommnisse: true,
    unterschrift: !!state.signature
  };
}

function protBasisValues() {
  var v = function(id) { return (document.getElementById(id) || {}).value || ''; };
  return { event: v('prot-event'), date: v('prot-date'), alId: v('prot-al') || protState.alId || '' };
}

function renderProtSectionNav() {
  var nav = document.getElementById('prot-section-nav');
  if (!nav) return;
  var st = protSectionStatus(protState, protBasisValues(), { transport: protTransportOpened });
  nav.innerHTML = PROT_SECTIONS.map(function(s) {
    return '<button type="button" class="ui-chip' + (st[s[0]] ? ' ui-chip-on' : '') + '" onclick="scrollProtSection(\'' + s[0] + '\')">' +
      (st[s[0]] ? uiIcon('check') : '') + s[1] + '</button>';
  }).join('');
  var pill = document.getElementById('prot-sig-pill');
  if (pill) {
    pill.className = 'ui-pill ' + (protState.signature ? 'ui-pill-ok' : 'ui-pill-warn');
    pill.textContent = protState.signature ? 'unterschrieben' : 'fehlt';
  }
}

function scrollProtSection(id) {
  var el = document.getElementById('prot-sec-' + id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (id === 'transport' && !protTransportOpened) { protTransportOpened = true; renderProtSectionNav(); }
}

// Aktion as a segmented control; the hidden #prot-action select stays the data source
function syncProtActionSeg() {
  var sel = document.getElementById('prot-action'), seg = document.getElementById('prot-action-seg');
  if (!sel || !seg) return;
  seg.querySelectorAll('button').forEach(function(b) { b.classList.toggle('active', b.dataset.value === sel.value); });
}

function setProtAction(v) {
  var sel = document.getElementById('prot-action');
  if (!sel) return;
  sel.value = v;
  sel.dispatchEvent(new Event('change'));
  syncProtActionSeg();
}

// Textareas grow with their content
function growProtText(el) {
  el.style.height = 'auto';
  el.style.height = Math.max(72, el.scrollHeight) + 'px';
}

// ── PERSISTENCE ──
function saveProtDraft() {
  // Offline start: the AL/PL selects are still empty → keep the known ids instead of storing ''
  var usersLoaded = appUsers.length > 0;
  var alId = protSelectedId((document.getElementById('prot-al') || {}).value, protState.alId, usersLoaded) || '';
  var plId = protSelectedId((document.getElementById('prot-pl') || {}).value, protState.plId, usersLoaded) || '';
  // The selects change without touching the state; the next populateAlPlSelects must not switch back
  protState.alId = alId || null;
  protState.plId = plId || null;
  var data = {
    ownerId: protDraftOwner(),
    event: (document.getElementById('prot-event') || {}).value || '',
    location: (document.getElementById('prot-location') || {}).value || '',
    date: (document.getElementById('prot-date') || {}).value || '',
    holiday: (document.getElementById('prot-isholiday') || {}).checked || false,
    action: (document.getElementById('prot-action') || {}).value || 'Aufbau',
    al: alId,
    pl: plId,
    alId: alId,
    plId: plId,
    alName: protState.alName || '', // name of a person who is no longer in the select (see protPersonOptionsHtml)
    plName: protState.plName || '',
    damages: (document.getElementById('prot-damages') || {}).value || '',
    incidents: (document.getElementById('prot-incidents') || {}).value || '',
    feedback: (document.getElementById('prot-feedback') || {}).value || '',
    transports: protState.transports,
    personnel: protState.personnel,
    categories: protState.categories,
    signature: protState.signature,
    editingId: protState.editingId || null,
    editingLocalId: protState.editingLocalId || null,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem('luebbert_protokoll_draft', JSON.stringify(data));
  updateTopBarSub();
  renderProtSectionNav();
  syncProtActionSeg();
}

// Owner for the stored draft; before the login is restored the previous owner is kept
function protDraftOwner() {
  if (typeof currentUser !== 'undefined' && currentUser) return currentUser.id;
  try { return (JSON.parse(localStorage.getItem('luebbert_protokoll_draft') || '{}') || {}).ownerId || null; }
  catch (e) { return null; }
}

// Empties the form state and fields without touching localStorage (used when a foreign draft is discarded)
function resetProtFormState() {
  protState = { transports: [], personnel: [], categories: {}, alId: null, plId: null, editingId: null, editingLocalId: null, signature: null };
  protOpenRows = {};
  ['prot-event', 'prot-location', 'prot-date', 'prot-damages', 'prot-incidents', 'prot-feedback', 'prot-al', 'prot-pl'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var act = document.getElementById('prot-action');
  if (act) act.value = 'Aufbau';
  var hol = document.getElementById('prot-isholiday');
  if (hol) hol.checked = false;
}

function loadProtDraft() {
  var saved = localStorage.getItem('luebbert_protokoll_draft');
  if (!saved) return false;
  try {
    var data = JSON.parse(saved);
    // Shared device: another user's draft (incl. its editingId) must never be sent under this login
    var uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    if (!protDraftBelongsTo(data, uid)) {
      localStorage.removeItem('luebbert_protokoll_draft');
      resetProtFormState();
      return false;
    }
    if (document.getElementById('prot-event')) document.getElementById('prot-event').value = data.event || '';
    if (document.getElementById('prot-location')) document.getElementById('prot-location').value = data.location || '';
    if (document.getElementById('prot-date')) document.getElementById('prot-date').value = data.date || '';
    if (document.getElementById('prot-isholiday')) document.getElementById('prot-isholiday').checked = data.holiday || false;
    if (document.getElementById('prot-action')) document.getElementById('prot-action').value = data.action || 'Aufbau';
    protState.alId = data.alId || data.al || '';
    protState.plId = data.plId || data.pl || '';
    protState.alName = data.alName || '';
    protState.plName = data.plName || '';
    if (document.getElementById('prot-damages')) document.getElementById('prot-damages').value = data.damages || '';
    if (document.getElementById('prot-incidents')) document.getElementById('prot-incidents').value = data.incidents || '';
    if (document.getElementById('prot-feedback')) document.getElementById('prot-feedback').value = data.feedback || '';
    
    protState.transports = data.transports || [];
    protState.personnel = data.personnel || [];
    protOpenRows = {}; // rows of the previous form must not stay open on the loaded one
    protState.categories = data.categories || {};
    protState.signature = data.signature || null;
    protState.editingId = data.editingId || null;
    protState.editingLocalId = data.editingLocalId || null;
    return true;
  } catch(e) { console.error("Error loading draft", e); return false; }
}

function clearProtForm(skipConfirm) {
  if (!skipConfirm && !confirm('Gesamtes Protokoll löschen?')) return;
  localStorage.removeItem('luebbert_protokoll_draft');
  protState = { transports: [], personnel: [], categories: {}, alId: null, plId: null };
  protOpenRows = {};

  // Re-hydrate UI without reloading if possible
  document.getElementById('prot-event').value = '';
  document.getElementById('prot-location').value = '';
  document.getElementById('prot-date').value = '';
  if (document.getElementById('prot-isholiday')) document.getElementById('prot-isholiday').checked = false;
  document.getElementById('prot-action').value = 'Aufbau';
  document.getElementById('prot-al').value = '';
  document.getElementById('prot-pl').value = '';
  document.getElementById('prot-damages').value = '';
  document.getElementById('prot-incidents').value = '';
  document.getElementById('prot-feedback').value = '';
  
  addProtTransport();
  addProtPersonnel();
  PROT_CATEGORIES_CONFIG.forEach(function(cat) { protState.categories[cat.id] = { active: true, status: 'okay', note: '' }; });
  renderProtCategories();
  clearProtSig();
  calcProtCosts();
  protState.editingId = null;
  protState.editingLocalId = null;
}

// Rows that Senden would skip (no start or no end) although someone filled them in; untouched blank rows don't count
function protIncompleteNames(personnel) {
  return (personnel || []).filter(function(p) {
    var used = p.name || p.tempName || p.start || p.end;
    return used && (!p.start || !p.end);
  }).map(function(p) { return p.name || p.tempName || 'Ohne Name'; });
}

// ── PROTOKOLL SAVE (replaces PDF Export) ──
async function saveProtokoll() {
  var missing = protIncompleteNames(protState.personnel);
  if (missing.length && !confirm('Ohne Start- oder Endzeit: ' + missing.join(', ') + '.\n\n' +
      (missing.length === 1 ? 'Diese Person wird' : 'Diese Personen werden') + ' nicht mitgespeichert und fehlen bei den Stunden. Trotzdem senden?')) return;
  calcProtCosts(); // the shown total may be stale (restored draft, rates loaded late)
  var usersLoaded = appUsers.length > 0;
  var alId = protSelectedId((document.getElementById('prot-al') || {}).value, protState.alId, usersLoaded);
  var plId = protSelectedId((document.getElementById('prot-pl') || {}).value, protState.plId, usersLoaded);
  // Before the user list has loaded the name comes from the protocol being edited (never a raw UUID)
  var editedEntry = protState.editingLocalId
    ? JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]').find(function(x) { return x.id === protState.editingLocalId; })
    : null;
  var personName = function(id, key) {
    if (!id) return '—';
    var u = appUsers.find(function(u) { return u.id === id; });
    if (u) return u.full_name || u.email || '—';
    return (editedEntry && editedEntry[key + 'Id'] === id && editedEntry[key]) || '—';
  };
  var data = {
    event: (document.getElementById('prot-event') || {}).value || '—',
    location: (document.getElementById('prot-location') || {}).value || '—',
    date: (document.getElementById('prot-date') || {}).value || '—',
    action: (document.getElementById('prot-action') || {}).value || '—',
    holiday: !!(document.getElementById('prot-isholiday') || {}).checked,
    alId: alId,
    plId: plId,
    al: personName(alId, 'al'),
    pl: personName(plId, 'pl'),
    damages: (document.getElementById('prot-damages') || {}).value || 'nein',
    incidents: (document.getElementById('prot-incidents') || {}).value || 'nein',
    feedback: (document.getElementById('prot-feedback') || {}).value || '—',
    transports: protState.transports,
    personnel: protState.personnel,
    categories: protState.categories,
    totalCost: document.getElementById('prot-total-cost').textContent + ' €'
  };

  showToast('Speichere & Sende an Server...', 'info');
  var btn = document.querySelector('#page-protokoll .ui-actionbar .ui-btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Lädt...'; }

  // ── PUSH TO SUPABASE ──
  var isUpdate = !!protState.editingId;
  var syncOut = {};
  var supabaseId = await syncProtokollToSupabase(data, undefined, syncOut);
  var isSynced = !!supabaseId;

  // ── ARCHIVE TO HISTORY ──
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var entry = {
    id: protState.editingLocalId || Date.now().toString(),
    // A row created by a partly failed sync is kept so the retry updates it instead of inserting again
    supabaseId: supabaseId || syncOut.protId || (protState.editingLocalId ? (archive.find(x => x.id === protState.editingLocalId)?.supabaseId) : null),
    savedAt: new Date().toISOString(),
    event: data.event,
    location: data.location,
    date: data.date,
    action: data.action,
    al: data.al,
    pl: data.pl,
    alId: data.alId || null,
    plId: data.plId || null,
    // Author stays as first saved; an edit by someone else does not take it over
    createdBy: (protState.editingLocalId && (archive.find(x => x.id === protState.editingLocalId) || {}).createdBy) ||
      (!isUpdate && typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null),
    totalCost: data.totalCost,
    transports: data.transports,
    personnel: data.personnel,
    categories: data.categories,
    damages: data.damages,
    incidents: data.incidents,
    feedback: data.feedback,
    signature: protState.signature || null,
    synced: isSynced,
    isUpdate: isUpdate,
    holiday: data.holiday
  };
  entry.mailed = false; // flipped by sendMailForEntry once the mail went out

  if (protState.editingLocalId) {
    // Replace existing entry if editing
    var idx = -1;
    for (var i = 0; i < archive.length; i++) {
      if (archive[i].id === protState.editingLocalId) {
        idx = i;
        break;
      }
    }
    if (idx !== -1) {
      archive[idx] = entry;
    } else {
      archive.unshift(entry);
    }
  } else {
    archive.unshift(entry);
  }

  if (archive.length > 50) archive = archive.slice(0, 50);
  localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
  
  if (btn) { btn.disabled = false; btn.textContent = 'Senden'; }
  // Mail in the background so Senden never waits on SMTP (registered as in-flight before the history retry runs)
  if (isSynced) sendMailForEntry(entry, true);
  protDayDrivers.key = null; // next form (same date, no editingId) must not reuse the hints of this protocol
  clearProtForm(true); // Soft clear without reloading
  if (typeof navigateProt === 'function') navigateProt('protokoll-history');
  // The start-page banner must not keep offering the job that was just documented
  if (typeof loadErinnerungen === 'function') loadErinnerungen();
}

// Diff of the stored shifts of a protocol against the form rows (only rows with start and end are shifts).
// Stored shifts are matched by the row's shiftId, else by an identical person + times, and only ever updated
// in place (patch = changed fields): id and status ('eingetragen') survive. Unmatched rows are inserted as 'offen';
// stored shifts without a row are deleted only while 'offen' (booked ones stay). Sets person.shiftId on matches.
function protShiftChanges(oldShifts, personnel, users, shiftDate) {
  var old = oldShifts || [], used = {}, updates = [], inserts = [], deletes = [];
  var hhmm = function(t) { return (t || '').substring(0, 5); };
  var rows = (personnel || []).filter(function(p) { return p.start && p.end; }).map(function(p) {
    var asUser = !p.isTemp && p.userId;
    return { person: p, old: null, db: {
      user_id: asUser ? p.userId : null,
      temp_worker_name: asUser ? null : (p.tempName || p.name || null),
      position_role: protBasePos(p, users),
      start_time: p.start,
      end_time: p.end,
      pause_mins: parseInt(p.pause) || 0,
      shift_date: shiftDate || null
    } };
  });
  rows.forEach(function(r) {
    if (!r.person.shiftId) return;
    var o = old.find(function(s) { return s.id === r.person.shiftId && !used[s.id]; });
    if (o) { r.old = o; used[o.id] = true; }
  });
  rows.forEach(function(r) {
    if (r.old) return;
    var o = old.find(function(s) {
      return !used[s.id] && (s.user_id || null) === r.db.user_id && (s.temp_worker_name || null) === r.db.temp_worker_name &&
        hhmm(s.start_time) === r.db.start_time && hhmm(s.end_time) === r.db.end_time;
    });
    if (o) { r.old = o; used[o.id] = true; }
  });
  rows.forEach(function(r) {
    var o = r.old, next = r.db;
    if (!o) { inserts.push({ person: r.person, row: Object.assign({}, next, { status: 'offen' }) }); return; }
    r.person.shiftId = o.id;
    var patch = {};
    var oldBase = (o.position_role || '').replace(/ (fest|frei)$/, '');
    if ((o.user_id || null) !== next.user_id || (o.temp_worker_name || null) !== next.temp_worker_name) {
      patch.user_id = next.user_id;
      patch.temp_worker_name = next.temp_worker_name;
    }
    // Same base position and person: keep the stored role as it is (fest/frei, legacy values)
    if (!(r.person.pos === oldBase && (o.user_id || null) === next.user_id) && o.position_role !== next.position_role) patch.position_role = next.position_role;
    if (hhmm(o.start_time) !== next.start_time) patch.start_time = next.start_time;
    if (hhmm(o.end_time) !== next.end_time) patch.end_time = next.end_time;
    if ((parseInt(o.pause_mins, 10) || 0) !== next.pause_mins) patch.pause_mins = next.pause_mins;
    if (((o.shift_date || '').substring(0, 10) || null) !== next.shift_date) patch.shift_date = next.shift_date;
    // Booked hours that change (person, times, break) must be checked again in Buchhaltung – same rule as the dashboard
    var paidChange = 'user_id' in patch || 'start_time' in patch || 'end_time' in patch || 'pause_mins' in patch;
    if (paidChange && o.status && o.status !== 'offen') patch.status = 'offen';
    if (Object.keys(patch).length) updates.push({ id: o.id, patch: patch });
  });
  old.forEach(function(s) { if (!used[s.id] && s.status === 'offen') deletes.push(s.id); });
  return { updates: updates, inserts: inserts, deletes: deletes };
}

// targetId: Supabase id to update (null = insert). Omitted → the protocol currently open in the form.
// out (optional): out.protId is set as soon as the protocols row exists, also when a later step fails,
// so the caller can retry as an update instead of inserting the protocol twice.
async function syncProtokollToSupabase(data, targetId, out) {
  var editId = (targetId === undefined) ? protState.editingId : targetId;
  if (typeof supabaseClient === 'undefined') return false;
  try {
    // 1. Resolve Project
    var projId = null;
    if (data.event && data.event !== '—') {
      var { data: pData, error: pErr1 } = await supabaseClient.from('projects').select('id').eq('name', data.event).maybeSingle();
      // A failed lookup must not fall through to an insert (duplicate project), a failed insert must not save without project
      if (pErr1) { console.error("Project Select Error:", pErr1); throw pErr1; }
      if (pData) projId = pData.id;
      else {
        var { data: iData, error: pErr2 } = await supabaseClient.from('projects').insert({ name: data.event, location: data.location === '—' ? null : data.location }).select().single();
        if (pErr2) { console.error("Project Insert Error:", pErr2); throw pErr2; }
        if (iData) projId = iData.id;
      }
    }

    // 2. Insert or Update Protokoll
    var costNum = parseFloat(data.totalCost.replace(' €', '').replace('.', '').replace(',', '.')) || 0;
    var parsedDate = data.date;
    if (!parsedDate || parsedDate === '—') parsedDate = localDateStr();

    var protPayload = {
      project_id: projId,
      date: parsedDate,
      action: data.action === '—' ? null : data.action,
      is_holiday: (data.holiday !== undefined) ? !!data.holiday : !!(document.getElementById('prot-isholiday') || {}).checked,
      al_id: data.alId || null,
      pl_id: data.plId || null,
      al_name_fallback: data.al === '—' ? null : data.al,
      pl_name_fallback: data.pl === '—' ? null : data.pl,
      signature_text: (data.signature !== undefined) ? data.signature : protState.signature,
      total_cost: costNum,
      notes_damages: data.damages === 'nein' ? null : data.damages,
      notes_incidents: data.incidents === 'nein' ? null : data.incidents,
      notes_feedback: data.feedback === '—' ? null : data.feedback
    };

    var protId = null;
    if (editId) {
      var { data: upData, error: upErr } = await supabaseClient.from('protocols').update(protPayload).eq('id', editId).select('id');
      if (upErr) throw upErr;
      // RLS can silently match 0 rows instead of erroring — treat that as a failure
      if (!upData || upData.length === 0) throw new Error('Update abgelehnt – fehlende Berechtigung auf dem Server (protocols).');
      protId = editId;

      // Cleanup sub-tables before re-inserting (errors here abort to prevent duplicates)
      var { error: trDelErr } = await supabaseClient.from('protocol_transports').delete().eq('protocol_id', protId);
      if (trDelErr) { console.error('Transports delete failed, aborting:', trDelErr); throw trDelErr; }
      var { error: eqDelErr } = await supabaseClient.from('protocol_equipments').delete().eq('protocol_id', protId);
      if (eqDelErr) { console.error('Equipment delete failed, aborting:', eqDelErr); throw eqDelErr; }
      // Shifts are NOT deleted here: booked ones ('eingetragen') must keep id and status (see step 5)
    } else {
      // created_by is set on INSERT only (never changed by later edits); a retry keeps the entry's author
      var insPayload = Object.assign({ created_by: data.createdBy || ((typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null) }, protPayload);
      var { data: protData, error: protError } = await supabaseClient.from('protocols').insert(insPayload).select().single();
      // Column not migrated yet: save without it rather than lose the protocol
      if (protError && /created_by/.test(protError.message || '')) {
        delete insPayload.created_by;
        ({ data: protData, error: protError } = await supabaseClient.from('protocols').insert(insPayload).select().single());
      }
      if (protError) throw protError;
      protId = protData.id;
    }
    if (out) out.protId = protId;

    // From here on every failure throws: the entry stays unsynced and the retry repeats the steps (shifts are diffed again)

    // 3. Insert Transports
    if (data.transports.length > 0) {
      var transInserts = data.transports.map(function(t) {
        return {
          protocol_id: protId,
          vehicle_type: t.type,
          driver_name: t.driver || null,
          punctuality: t.punctuality,
          delay_mins: t.delay ? parseInt(t.delay) : 0,
          driver_hours: (t.hours === null || t.hours === undefined || t.hours === '' || isNaN(parseFloat(t.hours))) ? null : parseFloat(t.hours),
          driver_user_id: t.driverUserId || null
        };
      });
      var { error: trErr } = await supabaseClient.from('protocol_transports').insert(transInserts);
      if (trErr) throw trErr;
    }

    // 4. Insert Categories
    var activeCats = PROT_CATEGORIES_CONFIG.filter(function(c) { return data.categories[c.id] && data.categories[c.id].active; });
    if (activeCats.length > 0) {
      var catInserts = activeCats.map(function(cat) {
        var s = data.categories[cat.id];
        return {
          protocol_id: protId,
          category_id: cat.id,
          status: s.status,
          note: s.note || null,
          hussen_delivered: s.hussenDelivered ? parseInt(s.hussenDelivered) : null,
          hussen_returned: s.hussenReturned ? parseInt(s.hussenReturned) : null
        };
      });
      var { error: catErr } = await supabaseClient.from('protocol_equipments').insert(catInserts);
      if (catErr) throw catErr;
    }

    // 5. Shifts (CRITICAL PIECE): on an edit the stored shifts are updated in place, never replaced,
    // so booked hours ('eingetragen') keep their id and status
    var oldShifts = [];
    if (editId) {
      var { data: shOld, error: shOldErr } = await supabaseClient.from('shifts')
        .select('id, user_id, temp_worker_name, position_role, start_time, end_time, pause_mins, status, shift_date')
        .eq('protocol_id', protId);
      if (shOldErr) throw shOldErr;
      oldShifts = shOld || [];
    }
    var shiftDate = (data.date && data.date !== '—') ? data.date : null;
    var ch = protShiftChanges(oldShifts, data.personnel, appUsers, shiftDate);
    for (var ui = 0; ui < ch.updates.length; ui++) {
      var { data: shUpd, error: shUpdErr } = await supabaseClient.from('shifts').update(ch.updates[ui].patch).eq('id', ch.updates[ui].id).select('id');
      if (shUpdErr) throw shUpdErr;
      if (!shUpd || shUpd.length === 0) throw new Error('Schicht-Update abgelehnt – fehlende Berechtigung auf dem Server (shifts).');
    }
    if (ch.inserts.length > 0) {
      var { data: shNew, error: shErr } = await supabaseClient.from('shifts')
        .insert(ch.inserts.map(function(i) { return Object.assign({ protocol_id: protId }, i.row); })).select('id');
      if (shErr) throw shErr;
      // Remember the ids on the rows: a retry or the next edit then matches them instead of inserting again
      (shNew || []).forEach(function(r, k) { if (ch.inserts[k]) ch.inserts[k].person.shiftId = r.id; });
    }
    if (ch.deletes.length > 0) {
      var { error: shDelErr } = await supabaseClient.from('shifts').delete().in('id', ch.deletes);
      if (shDelErr) { console.error('Shifts delete failed:', shDelErr); throw shDelErr; }
    }

    // 6. Save Ratings for Zenjob/Rockit workers
    var ratingInserts = [];
    data.personnel.forEach(function(p) {
      if (p.pos !== 'Zenjob' && p.pos !== 'Rockit') return;
      var r = ratingToSave(p);
      if (!r) return;
      var workerName = p.isTemp ? (p.tempName || p.name || null) : (p.name || p.tempName || null);
      if (!workerName) return;
      ratingInserts.push({
        protocol_id: protId,
        temp_worker_name: workerName.trim(),
        rating: r.rating,
        is_star: r.is_star,
        rated_by: data.createdBy || (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null)
      });
    });
    // On edits old ratings go first, also when all of them were removed
    if (editId) {
      var { error: ratDelErr } = await supabaseClient.from('worker_ratings').delete().eq('protocol_id', protId);
      if (ratDelErr) throw ratDelErr;
    }
    if (ratingInserts.length > 0) {
      var { error: ratErr } = await supabaseClient.from('worker_ratings').insert(ratingInserts);
      if (ratErr) throw ratErr;
    }

    showToast('✅ Protokoll erfolgreich synchronisiert und gespeichert!');
    return protId;
  } catch(e) {
    console.error("Sync Exception:", e);
    showToast("Server Sync fehlgeschlagen. Offline gespeichert.", "danger");
    return null;
  }
}

var _protRetryRunning = false; // a second tap while the first run is still syncing would insert the protocols twice
async function retrySyncAllProtocols() {
  if (_protRetryRunning) return;
  _protRetryRunning = true;
  try { await retrySyncAllProtocolsRun(); } finally { _protRetryRunning = false; }
}

async function retrySyncAllProtocolsRun() {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var unsynced = archive.filter(e => !e.synced);
  var unmailed = archive.filter(e => e.synced && e.mailed === false && e.supabaseId);
  if (unsynced.length === 0 && unmailed.length === 0) return;

  if (unsynced.length) showToast(`Synchronisiere ${unsynced.length} Protokolle...`, 'info');
  let successCount = 0;
  let rowIdLearned = false;
  const newlySynced = [];

  for (let entry of archive) {
    if (!entry.synced) {
      // Edits (and protocols whose row was created by an earlier, partly failed try) target their
      // row; never the protocol currently open in the form
      const out = {};
      const ok = await syncProtokollToSupabase(entry, entry.supabaseId || null, out);
      if (!ok && out.protId && !entry.supabaseId) {
        entry.supabaseId = out.protId;
        rowIdLearned = true;
      }
      if (ok) {
        entry.synced = true;
        entry.supabaseId = ok;
        entry.mailed = false;
        newlySynced.push(entry);
        successCount++;
      }
    }
  }

  if (successCount > 0 || rowIdLearned) {
    // Entries may have been saved while the sync was running → write only what the sync changed into the current archive
    var current = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
    archive.forEach(function(done) {
      if (!done.supabaseId) return;
      var cur = current.find(function(x) { return x.id === done.id; });
      if (!cur) return;
      if (!cur.supabaseId) cur.supabaseId = done.supabaseId;
      // Only a still identical entry takes over the result; one re-saved meanwhile stays as it is (unsynced)
      if (cur.savedAt === done.savedAt) {
        if (done.personnel) cur.personnel = done.personnel; // carries the shift ids learned by the sync
        if (done.synced && !cur.synced) { cur.synced = true; cur.mailed = false; }
      }
    });
    localStorage.setItem('luebbert_protokoll_history', JSON.stringify(current));
  }
  if (successCount > 0) {
    showToast(`✅ ${successCount} Protokolle erfolgreich synchronisiert!`);
  }
  for (const entry of newlySynced) await sendMailForEntry(entry, true);
  if (successCount > 0) renderProtHistory(); // also retries older pending mails quietly
  else if (unmailed.length) await retryPendingMails();
}

var MAIL_RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
var _mailInFlight = {};

// Sends the mail for one archived entry and flips its `mailed` flag when done.
// In-flight guard keeps the save path and the history retry from mailing the same protocol twice.
async function sendMailForEntry(entry, notify) {
  var sid = entry.supabaseId;
  if (!sid || _mailInFlight[sid]) return false;
  _mailInFlight[sid] = true;
  try {
    var done = await mailProtokoll(sid, entry, !!entry.isUpdate, notify);
    if (done) markProtMailed(sid);
    return done;
  } finally {
    delete _mailInFlight[sid];
  }
}

// Re-reads the archive so entries written meanwhile aren't lost; only flips the flag
function markProtMailed(supabaseId) {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var changed = false;
  archive.forEach(function(x) {
    if (x.supabaseId === supabaseId && x.mailed === false) { x.mailed = true; changed = true; }
  });
  if (changed) localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
}

// Quietly retries mails of synced protocols whose mail failed (runs on every history render).
// Skips offline and entries older than 7 days, so fixing the mail setup never sends an old backlog.
var _mailRetryRunning = false;
async function retryPendingMails() {
  if (_mailRetryRunning || navigator.onLine === false) return;
  _mailRetryRunning = true;
  try {
    var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
    var now = Date.now();
    for (var i = 0; i < archive.length; i++) {
      var e = archive[i];
      if (!e.synced || e.mailed !== false || !e.supabaseId) continue;
      if (!e.savedAt || now - new Date(e.savedAt).getTime() > MAIL_RETRY_MAX_AGE_MS) continue;
      await sendMailForEntry(e, false);
    }
  } finally {
    _mailRetryRunning = false;
  }
}

var MAIL_THROTTLE_RETRY_MS = 65000; // server THROTTLE_MS (60 s) + margin
var _mailRetryTimer = null;
function scheduleMailRetry() {
  if (_mailRetryTimer) return;
  _mailRetryTimer = setTimeout(function() {
    _mailRetryTimer = null;
    if (_mailRetryRunning) scheduleMailRetry(); // a running pass may have read the archive before this entry
    else retryPendingMails();
  }, MAIL_THROTTLE_RETRY_MS);
}

// Above the server worst case (cold start + SMTP timeouts 10/10/15 s), else a slow success looks like a failure and gets mailed twice
var MAIL_TIMEOUT_MS = 60000;
var MAIL_MAX_PDF_B64 = 4900000; // just under the function's 5 MB limit

// Mails the protocol (summary + PDF) to its PL via the send-protocol-mail Edge Function.
// Returns true when nothing is left to retry; never throws. `notify` = user just pressed Senden/Sync,
// so failures get a toast; background retries stay quiet.
async function mailProtokoll(supabaseId, entry, isUpdate, notify) {
  if (!supabaseId || typeof supabaseClient === 'undefined') return false;
  var pdfBase64 = null;
  try {
    pdfBase64 = buildProtPdfDoc(entry).output('datauristring').split(',')[1] || null;
    // The function rejects >5 MB with 413 forever → send the summary without attachment instead
    if (pdfBase64 && pdfBase64.length > MAIL_MAX_PDF_B64) {
      console.warn('Protokoll-PDF zu groß für Mail, sende ohne Anhang:', pdfBase64.length);
      pdfBase64 = null;
    }
  } catch (e) {
    console.warn('Protokoll-PDF für Mail fehlgeschlagen, sende ohne Anhang:', e);
  }
  try {
    var timeout = new Promise(function(_, reject) { setTimeout(function() { reject(new Error('timeout')); }, MAIL_TIMEOUT_MS); });
    var { data: res, error } = await Promise.race([
      supabaseClient.functions.invoke('send-protocol-mail', {
        body: { protocol_id: supabaseId, pdf_base64: pdfBase64, is_update: !!isUpdate, client: 2 }  // client 2 knows reason 'disabled'
      }),
      timeout
    ]);
    if (error) throw error;
    if (res && res.sent) {
      showToast('📧 Protokoll an ' + (res.to_name || 'PL') + ' gesendet');
      return true;
    }
    var reason = res && res.reason;
    if (reason === 'no_pl' || reason === 'no_email') {
      if (notify) showToast('Kein Mail: PL hat keine E-Mail hinterlegt', 'info');
      return true;
    }
    if (reason === 'not_found') return true;
    // Switched off in the admin settings → nothing to retry
    if (reason === 'disabled') {
      if (notify) showToast('Protokoll-Mails sind ausgeschaltet', 'info');
      return true;
    }
    // A correction right after Senden must still reach the PL → stays pending and is retried once the
    // server's 60 s duplicate guard has passed (not only on the next history visit)
    if (reason === 'throttled') {
      if (!isUpdate) return true;
      scheduleMailRetry();
      if (notify) showToast('Korrektur wird in ca. 1 Minute an die PL gemailt', 'info');
      return false;
    }
    // Mail setup not finished / hourly cap: retry later without bothering the AL
    if (reason === 'not_configured' || reason === 'rate_limited') return false;
    throw new Error(reason || 'unknown');
  } catch (e) {
    console.error('Protokoll-Mail fehlgeschlagen:', e);
    if (notify) showToast('Mail konnte nicht gesendet werden – wird beim nächsten Sync erneut versucht', 'danger');
    return false;
  }
}

// ── PROTOKOLL HISTORY ──
var PROT_HIST_FETCH_LIMIT = 60;
async function renderProtHistory() {
  var list = document.getElementById('prot-history-list');
  if (!list) return;

  // Show loading state while fetching
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;">Lädt...</div>';

  // Fetch from Supabase and seed any missing entries into localStorage
  if (typeof supabaseClient !== 'undefined') {
    try {
      var { data: rows } = await supabaseClient
        .from('protocols')
        .select('*, projects(name,location), al:app_users!protocols_al_id_fkey(full_name), pl:app_users!protocols_pl_id_fkey(full_name), shifts(*,app_users(full_name)), protocol_transports(*), protocol_equipments(*), worker_ratings(temp_worker_name, rating, is_star)')
        .order('date', { ascending: false })
        .limit(PROT_HIST_FETCH_LIMIT);

      if (rows && rows.length) {
        var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
        // Unsynced local edits are kept; protocols deleted on the server are dropped (see mergeProtHistory)
        mergeProtHistory(archive, rows.map(protRowToEntry), PROT_HIST_FETCH_LIMIT);
        archive.sort(function(a, b) { return new Date(b.savedAt) - new Date(a.savedAt); });
        if (archive.length > 100) archive = archive.slice(0, 100);
        localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
      }
    } catch(e) { console.warn('Verlauf Supabase fetch failed:', e); }
    retryPendingMails(); // fire-and-forget
  }

  renderProtHistoryList();
}

var PROT_HIST_SCOPE_KEY = 'luebbert_prot_hist_scope';

function setProtHistScope(scope) {
  protScopeSet(PROT_HIST_SCOPE_KEY, scope);
  renderProtHistoryList();
}

// Draws the history from localStorage, "Meine" by default
function renderProtHistoryList() {
  var list = document.getElementById('prot-history-list');
  if (!list) return;
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var scope = protScopeGet(PROT_HIST_SCOPE_KEY);
  var seg = protScopeSegHtml(scope, 'setProtHistScope');

  if (!archive.length) {
    list.innerHTML = uiEmptyHtml('Noch keine Protokolle', 'Gesendete Protokolle erscheinen hier.');
    return;
  }
  archive = protFilterScope(archive, scope, typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
  if (!archive.length) {
    list.innerHTML = seg + uiEmptyHtml('Noch keine eigenen Protokolle', '',
      '<button type="button" class="ui-btn" style="margin-top:10px;" onclick="setProtHistScope(\'all\')">Alle anzeigen</button>');
    return;
  }

  var html = seg + archive.map(function(e) {
    var d = /^(\d{4})-(\d{2})-(\d{2})/.exec(e.date || '');
    var id = jsAttrArg(e.id);
    var pills = '<span class="ui-pill ui-pill-info">' + escapeHtml(e.action || '—') + '</span>' +
      (e.synced === false || !e.synced
        ? ' <span class="ui-pill ui-pill-warn" role="button" title="Tippen zum Synchronisieren" onclick="event.stopPropagation();retrySyncAllProtocols()">nicht synchronisiert</span>'
        : (e.mailed === false ? ' <span class="ui-pill ui-pill-warn">Mail ausstehend</span>' : ''));
    return '<div class="ui-row" onclick="loadProtFromHistory(\'' + id + '\')">' +
      '<div class="prot-date-block">' + (d ? '<b>' + d[3] + '</b><span>' + d[2] + '.' + d[1].slice(2) + '</span>' : '<b>–</b>') + '</div>' +
      '<div class="ui-row-main">' +
        '<div class="ui-row-title">' + escapeHtml(e.event || '—') + '</div>' +
        '<div class="ui-sub">' + escapeHtml(e.location || '—') + (e.al ? ' · AL ' + escapeHtml(e.al) : '') + '</div>' +
        '<div style="margin-top:4px;">' + pills + '</div>' +
      '</div>' +
      '<div class="ui-row-end"><b class="stunden-h">' + escapeHtml(e.totalCost || '—') + '</b>' +
        '<button type="button" class="ui-icon-btn" aria-label="Protokoll-Aktionen" onclick="event.stopPropagation();protHistoryMenu(\'' + id + '\')">' + uiIcon('dots') + '</button></div>' +
    '</div>';
  }).join('');

  list.innerHTML = html;
}

function protHistoryMenu(id) {
  openUiMenu([
    { label: 'Bearbeiten', action: 'loadProtFromHistory', args: [id] },
    { label: 'PDF herunterladen', action: 'reExportProtPDF', args: [id] },
    { label: 'Aus dem Verlauf löschen', action: 'deleteProtHistory', args: [id], danger: true }
  ]);
}

async function deleteProtHistory(id) {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var entry = archive.find(function(e) { return e.id === id; });
  var supabaseId = entry && entry.supabaseId;

  var msg = supabaseId
    ? 'Protokoll vollständig löschen?\n\nAlle zugehörigen Schichten, Transporte und Bewertungen werden unwiderruflich aus der Datenbank entfernt.'
    : 'Protokoll aus dem lokalen Verlauf entfernen?';
  if (!confirm(msg)) return;

  if (supabaseId && typeof supabaseClient !== 'undefined') {
    showToast('Lösche...', 'info');
    var { error } = await supabaseClient.from('protocols').delete().eq('id', supabaseId);
    if (error) {
      console.error('Protocol delete error:', error);
      showToast('Fehler beim Löschen: ' + (error.message || error), 'danger');
      return;
    }
  }

  archive = archive.filter(function(e) { return e.id !== id; });
  localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
  renderProtHistory();
  showToast(supabaseId ? '✅ Protokoll und alle Schichten gelöscht.' : 'Aus Verlauf entfernt.');
}

function loadProtFromHistory(id) {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var entry = null;
  for (var i = 0; i < archive.length; i++) { if (archive[i].id === id) { entry = archive[i]; break; } }
  if (!entry) { showToast('Nicht gefunden'); return; }

  if (!confirm('Dieses Protokoll in das Formular laden? Nicht gespeicherte Änderungen gehen verloren.')) return;

  // Hydrate DOM fields (al/pl handled separately via protState.alId/plId)
  var fieldMap = { event: 'prot-event', location: 'prot-location', date: 'prot-date', action: 'prot-action', damages: 'prot-damages', incidents: 'prot-incidents', feedback: 'prot-feedback' };
  Object.keys(fieldMap).forEach(function(key) {
    var el = document.getElementById(fieldMap[key]);
    if (el) el.value = entry[key] || '';
  });
  // A server protocol without action arrives as '—': no such option, the select would be empty and Senden saves null
  var actEl = document.getElementById('prot-action');
  if (actEl && (!entry.action || entry.action === '—')) actEl.value = 'Aufbau';

  // Hydrate state
  protState.transports = (entry.transports || []).map(function(t) { return Object.assign({}, t); });
  protState.personnel  = (entry.personnel  || []).map(function(p) { return Object.assign({}, p); });
  protOpenRows = {};
  protState.categories = JSON.parse(JSON.stringify(entry.categories || {}));
  protState.signature  = entry.signature || null;
  var holEl = document.getElementById('prot-isholiday');
  if (holEl) holEl.checked = !!entry.holiday;
  // Resolve AL/PL UUIDs: prefer stored ID, fall back to name lookup for legacy entries
  var findUserByName = function(name) {
    if (!name || name === '—' || !appUsers.length) return null;
    var u = appUsers.find(function(u) { return u.full_name === name || u.email === name; });
    return u ? u.id : null;
  };
  protState.alId = entry.alId || findUserByName(entry.al) || null;
  protState.plId = entry.plId || findUserByName(entry.pl) || null;

  // Stored names keep a deactivated / re-roled AL or PL selectable (protPersonOptionsHtml)
  protState.alName = entry.al || '';
  protState.plName = entry.pl || '';
  // If appUsers already loaded, set AL/PL selects immediately
  if (appUsers.length) populateAlPlSelects();

  // No transport stays no transport (a default Sprinter would also add its cost on re-save)
  if (!protState.personnel.length)  protState.personnel.push({ pos: 'MA', name: '', start: '', end: '', pause: '0' });

  // Categories not saved with the protocol were switched off
  fillMissingCategories(protState.categories, PROT_CATEGORIES_CONFIG, false);

  // Re-render dynamic sections
  renderProtTransport();
  renderProtPersonnel();
  renderProtCategories();
  calcProtCosts();

  // Redraw signature preview if present
  redrawProtSig();

  // Switch to Erfassen tab and save as draft
  if (typeof navigateProt === 'function') navigateProt('protokoll');
  
  protState.editingLocalId = id;
  protState.editingId = entry.supabaseId || null;

  saveProtDraft();
  showToast('✏️ Protokoll geladen – Änderungen werden beim Senden gespeichert.');
}

async function reExportProtPDF(id) {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var entry = null;
  for (var i = 0; i < archive.length; i++) { if (archive[i].id === id) { entry = archive[i]; break; } }
  if (!entry) { showToast('Nicht gefunden'); return; }

  showToast('Generiere PDF...');
  buildProtPdfDoc(entry).save(protPdfFileName(entry));
  showToast('PDF wurde gespeichert!');
}

function protPdfFileName(entry) {
  return 'protokoll_' + (entry.date || '—') + '_' + (entry.event || '—').replace(/\s+/g,'_') + '.pdf';
}

// Builds the protocol PDF from an archived history entry (shared by download and mail)
function buildProtPdfDoc(entry) {
  // Everything that reaches doc.text is a string (jsPDF throws on numbers/null)
  var data = {
    event: pdfStr(entry.event, '—'), location: pdfStr(entry.location, '—'),
    date: pdfStr(entry.date, '—'), action: pdfStr(entry.action, '—'),
    al: pdfStr(entry.al, '—'), pl: pdfStr(entry.pl, '—'),
    damages: pdfStr(entry.damages, 'nein'), incidents: pdfStr(entry.incidents, 'nein'),
    feedback: pdfStr(entry.feedback, '—'),
    transports: entry.transports || [], personnel: entry.personnel || [],
    categories: entry.categories || {},
    totalCost: pdfStr(entry.totalCost, '0,00 €')
  };
  var savedProtState = protState;
  protState = { transports: data.transports, personnel: data.personnel, categories: data.categories, signature: entry.signature || null };
  try {

  var doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
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
  doc.setFont('helvetica','bold'); doc.text('Datum:', ml+4, y+18); doc.setFont('helvetica','normal'); doc.text(data.date, ml+25, y+18);
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
      doc.text(pdfStr(t.type,'—'),ml+2,y+5.5); doc.text(truncatePdf(doc,pdfStr(t.driver,'—') + (parseFloat(t.hours) > 0 ? ' · ' + String(parseFloat(t.hours)).replace('.', ',') + ' h' : ''),38),ml+40,y+5.5); doc.text(pdfStr(t.punctuality,'—'),ml+80,y+5.5); doc.text(t.delay?t.delay+' Min':'—',ml+120,y+5.5); y += 8;
    }); y += 4;
  }

  // Categories
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Equipment & Gewerke', ml, y); y += 6;
  var activeCats = PROT_CATEGORIES_CONFIG.filter(function(c){return data.categories[c.id] && data.categories[c.id].active;});
  activeCats.forEach(function(cat) {
    var s = data.categories[cat.id];
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text(cat.label+':', ml, y);
    doc.setFont('helvetica','normal'); doc.text(pdfStr(s.status, 'okay').toUpperCase(), ml+40, y);
    if (s.note) {
      doc.setFontSize(8); doc.setTextColor(100);
      doc.splitTextToSize(String(s.note), cw - 5).forEach(function(line) { y += 4; if (y > 280) { doc.addPage(); y = 20; } doc.text(line, ml+5, y); });
      doc.setTextColor(0);
    }
    if (cat.id === 'stoffe') {
      y += 5;
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text('Rücklauf Estrel-Hussen:', ml + 5, y);
      var val1 = pdfStr(s.hussenDelivered, '0');
      var val2 = pdfStr(s.hussenReturned, '0');
      doc.setFont('helvetica', 'bold');
      doc.text(val1, ml + 45, y);
      doc.setFont('helvetica', 'normal');
      doc.text('Stück geliefert', ml + 55, y);
      doc.setFont('helvetica', 'bold');
      doc.text(val2, ml + 85, y);
      doc.setFont('helvetica', 'normal');
      doc.text('Stück zurück (gezählt)', ml + 95, y);
      doc.setDrawColor(200); doc.line(ml + 44, y + 1, ml + 54, y + 1); doc.line(ml + 84, y + 1, ml + 94, y + 1);
    }
    y += 7; if (y > 270) { doc.addPage(); y = 20; }
  }); y += 4;

  // Personnel
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Personal', ml, y); y += 6;
  if (!data.personnel.length) {
    doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.text('Keine Personaldaten.', ml, y); y += 8;
  } else {
    doc.setFillColor(30,30,28); doc.rect(ml,y,cw,8,'F'); doc.setTextColor(255); doc.setFontSize(8);
    doc.text('Pos',ml+2,y+5.5); doc.text('Name',ml+25,y+5.5); doc.text('Arbeitszeit',ml+72,y+5.5); doc.text('Pause',ml+100,y+5.5); doc.text('Netto',ml+118,y+5.5); doc.text('Bewertung',ml+138,y+5.5);
    doc.setTextColor(0); y += 8;
    data.personnel.forEach(function(p,i) {
      if (i%2===1){doc.setFillColor(248,248,246);doc.rect(ml,y,cw,8,'F');}
      var v=timeToMins(p.start),b=timeToMins(p.end),pa=parseInt(p.pause)||0;
      var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
      var netStr='—'; if(v!==null&&b!==null&&effB>v){var n=Math.max(3,(effB-v-pa)/60);netStr=n.toFixed(2)+' h';}
      // Same fest/frei rule as the cost lines below
      var posLabel = pdfStr(protBasePos(p, appUsers), '—');
      doc.text(truncatePdf(doc,posLabel,22),ml+2,y+5.5); doc.text(truncatePdf(doc,pdfStr(p.name,'—'),45),ml+25,y+5.5); doc.text(pdfStr(p.start,'—')+' - '+pdfStr(p.end,'—'),ml+72,y+5.5); doc.text(pa+' Min',ml+100,y+5.5); doc.text(netStr,ml+118,y+5.5);
      if (p.pos === 'Zenjob' || p.pos === 'Rockit') doc.text(ratingPdfLabel(p.rating, p.isStar),ml+138,y+5.5);
      y+=8; if(y>270){doc.addPage();y=20;}
    }); y += 4;
  }

  // Incidents (free text → wrapped, can span pages)
  y += 4; if (y > 260) { doc.addPage(); y = 20; }
  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.text('Vorkommnisse / Feedback', ml, y); y += 6;
  doc.setFontSize(9);
  y = pdfWrappedRow(doc, 'Mängel:', data.damages, ml, ml+40, cw-40, y, 4.5, 280);
  y = pdfWrappedRow(doc, 'Vorkommnisse:', data.incidents, ml, ml+40, cw-40, y, 4.5, 280);
  y = pdfWrappedRow(doc, 'Feedback:', data.feedback, ml, ml+40, cw-40, y, 4.5, 280); y += 6;

  // Costs, itemized with the same rules as calcProtCosts (custom rates, holiday) so the lines add up to the total
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setDrawColor(24,95,165); doc.setLineWidth(0.5); doc.line(ml,y,ml+cw,y); y += 8;
  doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Nebenkalkulation (itemisiert):', ml, y); y += 6;
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(100);
  var calcDate = (data.date && data.date !== '—') ? data.date : localDateStr();
  data.transports.forEach(function(t) {
    if (!t.type) return;
    var r = calcTransportCost(t.type, calcDate);
    doc.text('- ' + t.type + (t.driver ? ' (' + t.driver + ')' : '') + ': ' + r.toFixed(2) + ' EUR', ml + 5, y); y += 4;
    if (y > 280) { doc.addPage(); y = 20; }
    var drv = protDriverCost(t, appUsers);
    if (drv) {
      doc.text('- Fahrer ' + pdfStr(t.driver, '—') + ': ' + drv.hrs.toFixed(2) + 'h x ' + drv.rate.toFixed(2) + ' EUR = ' + drv.amount.toFixed(2) + ' EUR', ml + 5, y); y += 4;
      if (y > 280) { doc.addPage(); y = 20; }
    }
  });
  data.personnel.forEach(function(p) {
    var v = timeToMins(p.start), b = timeToMins(p.end), pa = parseInt(p.pause) || 0;
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v === null || b === null || effB <= v) return;
    var basePos = protBasePos(p, appUsers);
    var customRate = (!p.isTemp && p.userId) ? getEffectivePersonnelRate(basePos, p.userId) : undefined;
    calcSplitShiftCosts(basePos, calcDate, !!entry.holiday, v, effB, pa, customRate).forEach(function(c) {
      var sub = c.hrs * c.rate;
      doc.text('- ' + (p.name || '—') + ' (' + c.desc + '): ' + c.hrs.toFixed(2) + 'h x ' + c.rate.toFixed(2) + ' EUR = ' + sub.toFixed(2) + ' EUR', ml + 5, y); y += 4;
      if (y > 280) { doc.addPage(); y = 20; }
    });
  });
  y += 2;
  doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(24,95,165);
  doc.text('Gesamtkosten (geschätzt): ' + data.totalCost, ml, y); doc.setTextColor(0); y += 12;

  // Signature
  if (entry.signature) {
    if (y+35>270){doc.addPage();y=20;}
    doc.setDrawColor(24,95,165); doc.setLineWidth(0.3); doc.line(ml,y,ml+cw,y); y+=8;
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(0); doc.text('Unterschrift Aufbauleitung:', ml, y); y+=6;
    try { doc.addImage(entry.signature,'JPEG',ml,y,70,22); } catch(e){}
    y+=24; doc.setDrawColor(180); doc.line(ml,y,ml+70,y); y+=4;
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(120); doc.text(data.al||'Aufbauleitung', ml, y); doc.setTextColor(0);
  }

  return doc;
  } finally {
    protState = savedProtState;
  }
}


// Top bar "…": rare actions of the form
if (typeof UI_TOPBAR_ITEMS !== 'undefined') {
  UI_TOPBAR_ITEMS.protokoll = function() { return [{ label: 'Formular leeren', action: 'clearProtForm', danger: true }]; };
}
