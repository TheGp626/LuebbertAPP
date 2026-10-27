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
    renderProtPersonnel();
    populateAlPlSelects();
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

function populateAlPlSelects() {
  var alSel = document.getElementById('prot-al');
  var plSel = document.getElementById('prot-pl');

  // Shared datalist that powers the type-to-search personnel inputs
  var dl = document.getElementById('prot-users-datalist');
  if (dl) {
    dl.innerHTML = appUsers.map(function(u) {
      return '<option value="' + escapeHtml(u.full_name || u.email || '') + '"></option>';
    }).join('');
  }

  if (alSel) {
    var alUsers = appUsers.filter(function(u) { return u.role === 'AL' || u.role === 'Admin'; });
    alSel.innerHTML = '<option value="">— AL auswählen —</option>' +
      alUsers.map(function(u) { return '<option value="' + u.id + '">' + (u.full_name || u.email) + '</option>'; }).join('');
    if (protState.alId) alSel.value = protState.alId;
  }

  if (plSel) {
    var plUsers = appUsers.filter(function(u) { return u.role === 'PL' || u.role === 'Admin'; });
    plSel.innerHTML = '<option value="">— PL auswählen —</option>' +
      plUsers.map(function(u) { return '<option value="' + u.id + '">' + (u.full_name || u.email) + '</option>'; }).join('');
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
function addProtTransport() {
  protState.transports.push({ type: 'Sprinter', driver: '', punctuality: 'pünktlich', delay: '' });
  renderProtTransport();
  saveProtDraft();
}

function removeProtTransport(idx) {
  protState.transports.splice(idx, 1);
  renderProtTransport();
  saveProtDraft();
  calcProtCosts();
}

function renderProtTransport() {
  var list = document.getElementById('prot-transport-list');
  if (!list) return;
  list.innerHTML = protState.transports.map(function(t, i) {
    var delayHtml = '';
    if (t.punctuality === 'verspätet') {
      delayHtml = 
        '    <div class="meta-field">' +
        '      <span class="meta-label">Dauer (Min)</span>' +
        '      <input type="number" class="meta-input" placeholder="0" value="' + (t.delay || '') + '" oninput="updateProtTransport(' + i + ', \'delay\', this.value)"/>' +
        '    </div>';
    }

    return '<div class="shift-block">' +
           '  <div class="shift-label">Transport ' + (i + 1) + 
           '    <button class="shift-remove" onclick="removeProtTransport(' + i + ')">×</button>' +
           '  </div>' +
           '  <div class="meta-fields">' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Fahrzeugtyp</span>' +
           '      <select class="meta-input" onchange="updateProtTransport(' + i + ', \'type\', this.value)">' +
                    Object.keys(PROT_VEHICLE_RATES).map(function(v) {
                      return '<option value="' + v + '" ' + (t.type === v ? 'selected' : '') + '>' + v + '</option>';
                    }).join('') +
           '      </select>' +
           (t.type === 'Spedition' ? '      <div style="font-size:11px;color:var(--text3);margin-top:3px;">→ Kosten separat per Rechnung erfassen</div>' : '') +
           '    </div>' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Fahrer</span>' +
           '      <input type="text" class="meta-input" placeholder="Name" value="' + (t.driver || '') + '" oninput="updateProtTransport(' + i + ', \'driver\', this.value)"/>' +
           '    </div>' +
           '  </div>' +
           '  <div class="meta-fields" style="margin-top: 8px;">' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Pünktlichkeit</span>' +
           '      <select class="meta-input" onchange="updateProtTransport(' + i + ', \'punctuality\', this.value)">' +
           '        <option value="pünktlich" ' + (t.punctuality === 'pünktlich' ? 'selected' : '') + '>Pünktlich</option>' +
           '        <option value="verspätet" ' + (t.punctuality === 'verspätet' ? 'selected' : '') + '>Verspätung</option>' +
           '      </select>' +
           '    </div>' +
           delayHtml +
           '  </div>' +
           '</div>';
  }).join('');
}

function updateProtTransport(idx, field, val) {
  protState.transports[idx][field] = val;
  if (field === 'punctuality') {
    if (val !== 'verspätet') protState.transports[idx].delay = '';
    renderProtTransport();
  }
  saveProtDraft();
  if (field === 'type') calcProtCosts();
}

// ── PERSONNEL ──
function addProtPersonnel() {
  protState.personnel.push({ pos: 'MA', isTemp: false, userId: '', tempName: '', name: '', start: '', end: '', pause: '0', rating: null, isStar: false });
  renderProtPersonnel();
  saveProtDraft();
}

function updateProtRating(idx, field, val) {
  protState.personnel[idx][field] = val;
  renderProtPersonnel();
  saveProtDraft();
}

function removeProtPersonnel(idx) {
  var removed = protState.personnel[idx];
  // If this shift already exists in the DB, delete it immediately so it doesn't come back on history re-sync
  if (removed && removed.shiftId && typeof supabaseClient !== 'undefined') {
    supabaseClient.from('shifts').delete().eq('id', removed.shiftId)
      .then(function(res) { if (res.error) console.error('Shift delete error:', res.error); });
  }
  protState.personnel.splice(idx, 1);
  renderProtPersonnel();
  saveProtDraft();
  calcProtCosts();
}

function renderProtPersonnel() {
  var list = document.getElementById('prot-personnel-list');
  if (!list) return;
  list.innerHTML = protState.personnel.map(function(p, i) {
    var opts = ['AL', 'MA', 'Fahrer', 'Zenjob', 'Rockit'].map(function(o) {
      return '<option value="' + o + '" ' + (p.pos === o ? 'selected' : '') + '>' + o + '</option>';
    }).join('');

    var nameField = p.isTemp
      ? '<input type="text" class="meta-input" placeholder="Aushilfe Name" style="margin-bottom:0;" value="' + escapeHtml(p.tempName || '') + '" oninput="updateProtPersonnel(' + i + ', \'tempName\', this.value)"/>'
      : '<input type="text" class="meta-input" placeholder="Name tippen…" style="margin-bottom:0;" list="prot-users-datalist" autocomplete="off" value="' + escapeHtml(p.name || '') + '" onchange="onProtPersonnelName(' + i + ', this.value)"/>' +
        (p.userId ? '' : (p.name ? '<div style="font-size:11px;color:var(--danger);margin-top:3px;">⚠ Kein registrierter Mitarbeiter – wird als Externe(r) gespeichert</div>' : ''));
      
    var tempCheck = '<label style="display:flex; align-items:center; gap:4px; font-size:12px; margin-top:4px; cursor:pointer;">' +
      '<input type="checkbox" onchange="updateProtPersonnel(' + i + ',\'isTemp\',this.checked)" ' + (p.isTemp ? 'checked' : '') + ' /> Externe(r) / Aushilfe</label>';

    var isAgency = (p.pos === 'Zenjob' || p.pos === 'Rockit');
    var ratingBlock = isAgency
      ? '<div class="rating-block">' +
          '<span class="meta-label" style="display:block;margin-bottom:4px;">Bewertung</span>' +
          '<div class="rating-btns">' +
          '<button class="rating-btn' + (p.rating === 'up' ? ' active-up' : '') + '" onclick="updateProtRating(' + i + ',\'rating\',' + (p.rating === 'up' ? 'null' : '\'up\'') + ')" title="Daumen hoch">👍</button>' +
          '<button class="rating-btn' + (p.rating === 'down' ? ' active-down' : '') + '" onclick="updateProtRating(' + i + ',\'rating\',' + (p.rating === 'down' ? 'null' : '\'down\'') + ')" title="Daumen runter">👎</button>' +
          '<button class="rating-btn' + (p.isStar ? ' active-star' : '') + '" onclick="updateProtRating(' + i + ',\'isStar\',' + (!p.isStar) + ')" title="Besonders gut">⭐</button>' +
          '</div>' +
        '</div>'
      : '';

    return '<div class="shift-block">' +
           '  <div class="shift-label">Personal ' + (i + 1) +
           '    <button class="shift-remove" onclick="removeProtPersonnel(' + i + ')">×</button>' +
           '  </div>' +
           '  <div class="meta-fields">' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Position</span>' +
           '      <select class="meta-input" style="margin-bottom:0" onchange="updateProtPersonnel(' + i + ', \'pos\', this.value)">' + opts + '</select>' +
           '    </div>' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Name</span>' + nameField + tempCheck +
           '    </div>' +
           '  </div>' +
           '  <div class="meta-fields" style="margin-top: 8px;">' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Start</span>' +
           '      <input type="time" class="meta-input" value="' + (p.start || '') + '" oninput="updateProtPersonnel(' + i + ', \'start\', this.value)"/>' +
           '    </div>' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Ende</span>' +
           '      <input type="time" class="meta-input" value="' + (p.end || '') + '" oninput="updateProtPersonnel(' + i + ', \'end\', this.value)"/>' +
           '    </div>' +
           '    <div class="meta-field" style="max-width: 80px;">' +
           '      <span class="meta-label">Pause</span>' +
           '      <input type="number" class="meta-input" placeholder="Min" value="' + (p.pause || '0') + '" oninput="updateProtPersonnel(' + i + ', \'pause\', this.value)"/>' +
           '    </div>' +
           '  </div>' +
           (ratingBlock ? '  <div class="meta-fields" style="margin-top: 8px;">' + ratingBlock + '</div>' : '') +
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
  if (match) {
    protState.personnel[idx].userId = match.id;
    protState.personnel[idx].name = match.full_name || match.email;
  } else {
    protState.personnel[idx].userId = '';
    protState.personnel[idx].name = typed;
  }
  renderProtPersonnel();
  saveProtDraft();
  calcProtCosts();
}

function updateProtPersonnel(idx, field, val) {
  var oldVal = protState.personnel[idx][field];
  protState.personnel[idx][field] = val;
  
  if (field === 'userId') {
    var u = appUsers.find(x => x.id === val);
    if (u) protState.personnel[idx].name = u.full_name || u.email;
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
        if (!p.start || p.start === oldVal || p.start === '') p.start = protState.personnel[0].start;
        if (!p.end || p.end === oldVal || p.end === '') p.end = protState.personnel[0].end;
        var pv = timeToMins(p.start), pb = timeToMins(p.end);
        var effPb = (pb !== null && pv !== null && pb < pv) ? pb + 1440 : pb;
        if (pv !== null && pb !== null && effPb > pv) p.pause = autoPause(effPb - pv);
      });
      renderProtPersonnel();
    }
  }
  
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
      hussenFields = '<div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;">' +
                     '  <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">Rücklauf Estrel-Hussen:</div>' +
                     '  <div style="display: flex; gap: 12px; align-items: center;">' +
                     '    <div style="flex: 1;">' +
                     '      <span class="meta-label">Stück geliefert</span>' +
                     '      <input type="number" class="meta-input" placeholder="0" value="' + (state.hussenDelivered || '') + '" oninput="updateProtCategory(\'' + cat.id + '\', \'hussenDelivered\', this.value)"/>' +
                     '    </div>' +
                     '    <div style="flex: 1;">' +
                     '      <span class="meta-label">Stück zurück (gezählt)</span>' +
                     '      <input type="number" class="meta-input" placeholder="0" value="' + (state.hussenReturned || '') + '" oninput="updateProtCategory(\'' + cat.id + '\', \'hussenReturned\', this.value)"/>' +
                     '    </div>' +
                     '  </div>' +
                     '</div>';
    }

    return '<div class="shift-block" style="' + (!active ? 'opacity: 0.5; background: var(--bg3);' : '') + '">' +
           '  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">' +
           '    <div style="display: flex; align-items: center; gap: 8px;">' +
           '      <span style="font-size: 20px;">' + cat.icon + '</span>' +
           '      <span style="font-weight: 600;">' + cat.label + '</span>' +
           '    </div>' +
           '    <button class="chip ' + (active ? 'active' : '') + '" onclick="toggleProtCategory(\'' + cat.id + '\')">' + (active ? 'Aktiv' : 'Ausgeblendet') + '</button>' +
           '  </div>' +
           '  <div style="' + (!active ? 'display: none;' : '') + '">' +
           '    <div class="meta-label">Zustand</div>' +
           '    <div class="chips" style="margin-bottom: 12px;">' +
                  ['okay', 'unsauber', 'beschädigt', 'unvollständig'].map(function(s) {
                    return '<div class="chip ' + (state.status === s ? 'active' : '') + '" onclick="updateProtCategory(\'' + cat.id + '\', \'status\', \'' + s + '\')">' + s + '</div>';
                  }).join('') +
           '    </div>' +
           '    <div class="field">' +
           '      <input type="text" class="meta-input" placeholder="Anmerkungen / Details" value="' + (state.note || '') + '" oninput="updateProtCategory(\'' + cat.id + '\', \'note\', this.value)"/>' +
           '    </div>' +
           hussenFields +
           '  </div>' +
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
function calcProtCosts() {
  var total = 0;

  // Read date and holiday directly from the DOM so live edits are reflected
  var dateEl    = document.getElementById('prot-date');
  var holidayEl = document.getElementById('prot-isholiday');
  var currentDate    = (dateEl && dateEl.value)       ? dateEl.value    : (protState.date    || localDateStr());
  var currentHoliday = (holidayEl)                    ? holidayEl.checked : (protState.holiday || false);

  // Logistics
  protState.transports.forEach(function(t) {
    total += calcTransportCost(t.type, currentDate);
  });

  // Personnel
  protState.personnel.forEach(function(p) {
    var v = timeToMins(p.start), b = timeToMins(p.end), pa = parseInt(p.pause) || 0;
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v !== null && b !== null && effB > v) {
      var basePos = p.pos;
      if (['AL', 'MA', 'Fahrer'].includes(p.pos)) {
        var u = appUsers.find(function(x) { return x.id === p.userId; });
        basePos += (u && u.is_fest ? ' fest' : ' frei');
      }
      var customRate = (!p.isTemp && p.userId) ? getEffectivePersonnelRate(basePos, p.userId) : undefined;
      var costs = calcSplitShiftCosts(basePos, currentDate, currentHoliday, v, effB, pa, customRate);
      costs.forEach(function(c) {
        total += c.hrs * c.rate;
      });
    }
  });

  var el = document.getElementById('prot-total-cost');
  if (el) el.textContent = total.toFixed(2).replace('.', ',');
}

// ── PERSISTENCE ──
function saveProtDraft() {
  var data = {
    event: (document.getElementById('prot-event') || {}).value || '',
    location: (document.getElementById('prot-location') || {}).value || '',
    date: (document.getElementById('prot-date') || {}).value || '',
    holiday: (document.getElementById('prot-isholiday') || {}).checked || false,
    action: (document.getElementById('prot-action') || {}).value || 'Aufbau',
    al: (document.getElementById('prot-al') || {}).value || '',
    pl: (document.getElementById('prot-pl') || {}).value || '',
    alId: (document.getElementById('prot-al') || {}).value || '',
    plId: (document.getElementById('prot-pl') || {}).value || '',
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
}

function loadProtDraft() {
  var saved = localStorage.getItem('luebbert_protokoll_draft');
  if (!saved) return false;
  try {
    var data = JSON.parse(saved);
    if (document.getElementById('prot-event')) document.getElementById('prot-event').value = data.event || '';
    if (document.getElementById('prot-location')) document.getElementById('prot-location').value = data.location || '';
    if (document.getElementById('prot-date')) document.getElementById('prot-date').value = data.date || '';
    if (document.getElementById('prot-isholiday')) document.getElementById('prot-isholiday').checked = data.holiday || false;
    if (document.getElementById('prot-action')) document.getElementById('prot-action').value = data.action || 'Aufbau';
    protState.alId = data.alId || data.al || '';
    protState.plId = data.plId || data.pl || '';
    if (document.getElementById('prot-damages')) document.getElementById('prot-damages').value = data.damages || '';
    if (document.getElementById('prot-incidents')) document.getElementById('prot-incidents').value = data.incidents || '';
    if (document.getElementById('prot-feedback')) document.getElementById('prot-feedback').value = data.feedback || '';
    
    protState.transports = data.transports || [];
    protState.personnel = data.personnel || [];
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

// ── PROTOKOLL SAVE (replaces PDF Export) ──
async function saveProtokoll() {
  var data = {
    event: (document.getElementById('prot-event') || {}).value || '—',
    location: (document.getElementById('prot-location') || {}).value || '—',
    date: (document.getElementById('prot-date') || {}).value || '—',
    action: (document.getElementById('prot-action') || {}).value || '—',
    alId: (document.getElementById('prot-al') || {}).value || null,
    plId: (document.getElementById('prot-pl') || {}).value || null,
    al: (function() { var id = (document.getElementById('prot-al') || {}).value; var u = appUsers.find(function(u) { return u.id === id; }); return u ? u.full_name : (id || '—'); })(),
    pl: (function() { var id = (document.getElementById('prot-pl') || {}).value; var u = appUsers.find(function(u) { return u.id === id; }); return u ? u.full_name : (id || '—'); })(),
    damages: (document.getElementById('prot-damages') || {}).value || 'nein',
    incidents: (document.getElementById('prot-incidents') || {}).value || 'nein',
    feedback: (document.getElementById('prot-feedback') || {}).value || '—',
    transports: protState.transports,
    personnel: protState.personnel,
    categories: protState.categories,
    totalCost: document.getElementById('prot-total-cost').textContent + ' €'
  };

  showToast('Speichere & Sende an Server...', 'info');
  var btn = document.querySelector('#page-protokoll .fab-area .btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Lädt...'; }

  // ── PUSH TO SUPABASE ──
  var isUpdate = !!protState.editingId;
  var supabaseId = await syncProtokollToSupabase(data);
  var isSynced = !!supabaseId;
  
  // ── ARCHIVE TO HISTORY ──
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var entry = {
    id: protState.editingLocalId || Date.now().toString(),
    supabaseId: supabaseId || (protState.editingLocalId ? (archive.find(x => x.id === protState.editingLocalId)?.supabaseId) : null),
    savedAt: new Date().toISOString(),
    event: data.event,
    location: data.location,
    date: data.date,
    action: data.action,
    al: data.al,
    pl: data.pl,
    alId: data.alId || null,
    plId: data.plId || null,
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
    holiday: !!(document.getElementById('prot-isholiday') || {}).checked
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
  clearProtForm(true); // Soft clear without reloading
  if (typeof navigateProt === 'function') navigateProt('protokoll-history');
  // The start-page banner must not keep offering the job that was just documented
  if (typeof loadErinnerungen === 'function') loadErinnerungen();
}

// targetId: Supabase id to update (null = insert). Omitted → the protocol currently open in the form.
async function syncProtokollToSupabase(data, targetId) {
  var editId = (targetId === undefined) ? protState.editingId : targetId;
  if (typeof supabaseClient === 'undefined') return false;
  try {
    // 1. Resolve Project
    var projId = null;
    if (data.event && data.event !== '—') {
      var { data: pData, error: pErr1 } = await supabaseClient.from('projects').select('id').eq('name', data.event).maybeSingle();
      if (pErr1) console.error("Project Select Error:", pErr1);
      if (pData) projId = pData.id;
      else {
        var { data: iData, error: pErr2 } = await supabaseClient.from('projects').insert({ name: data.event, location: data.location === '—' ? null : data.location }).select().single();
        if (pErr2) console.error("Project Insert Error:", pErr2);
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
      is_holiday: protState.holiday || false,
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
      var { error: shDelErr } = await supabaseClient.from('shifts').delete().eq('protocol_id', protId);
      if (shDelErr) { console.error('Shifts delete failed, aborting to prevent duplicates:', shDelErr); throw shDelErr; }
    } else {
      var { data: protData, error: protError } = await supabaseClient.from('protocols').insert(protPayload).select().single();
      if (protError) throw protError;
      protId = protData.id;
    }

    // 3. Insert Transports
    if (data.transports.length > 0) {
      var transInserts = data.transports.map(function(t) {
        return {
          protocol_id: protId,
          vehicle_type: t.type,
          driver_name: t.driver || null,
          punctuality: t.punctuality,
          delay_mins: t.delay ? parseInt(t.delay) : 0
        };
      });
      var { error: trErr } = await supabaseClient.from('protocol_transports').insert(transInserts);
      if (trErr) console.error("Transports Insert Error:", trErr);
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
      if (catErr) console.error("Categories Insert Error:", catErr);
    }

    // 5. Insert Shifts (CRITICAL PIECE)
    if (data.personnel.length > 0) {
      var shiftInserts = [];
      data.personnel.forEach(function(p) {
        if (!p.start || !p.end) return; // Skip incomplete shifts
        var basePos = p.pos;
        if (['AL', 'MA', 'Fahrer'].includes(p.pos)) {
          var su = (!p.isTemp && p.userId) ? appUsers.find(function(x) { return x.id === p.userId; }) : null;
          basePos += (su && su.is_fest ? ' fest' : ' frei');
        }
        
        var uId = (p.isTemp || !p.userId) ? null : p.userId;
        var tName = (p.isTemp || !p.userId) ? (p.tempName || p.name || null) : null;
        
        shiftInserts.push({
          protocol_id: protId,
          user_id: uId,
          temp_worker_name: tName,
          position_role: basePos,
          start_time: p.start,
          end_time: p.end,
          pause_mins: parseInt(p.pause) || 0,
          status: 'offen',
          shift_date: (data.date && data.date !== '—') ? data.date : null
        });
      });
      if (shiftInserts.length > 0) {
        var { error: shErr } = await supabaseClient.from('shifts').insert(shiftInserts);
        if (shErr) console.error("Shifts Insert Error:", shErr);
      }
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
        rated_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
      });
    });
    // On edits old ratings go first, also when all of them were removed
    if (editId) {
      var { error: ratDelErr } = await supabaseClient.from('worker_ratings').delete().eq('protocol_id', protId);
      if (ratDelErr) console.error("Ratings Delete Error:", ratDelErr);
    }
    if (ratingInserts.length > 0) {
      var { error: ratErr } = await supabaseClient.from('worker_ratings').insert(ratingInserts);
      if (ratErr) console.error("Ratings Insert Error:", ratErr);
    }

    showToast('✅ Protokoll erfolgreich synchronisiert und gespeichert!');
    return protId;
  } catch(e) {
    console.error("Sync Exception:", e);
    showToast("Server Sync fehlgeschlagen. Offline gespeichert.", "danger");
    return null;
  }
}

async function retrySyncAllProtocols() {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var unsynced = archive.filter(e => !e.synced);
  var unmailed = archive.filter(e => e.synced && e.mailed === false && e.supabaseId);
  if (unsynced.length === 0 && unmailed.length === 0) return;

  if (unsynced.length) showToast(`Synchronisiere ${unsynced.length} Protokolle...`, 'info');
  let successCount = 0;
  const newlySynced = [];

  for (let entry of archive) {
    if (!entry.synced) {
      // Edits target their original row; never the protocol currently open in the form
      const ok = await syncProtokollToSupabase(entry, entry.isUpdate ? (entry.supabaseId || null) : null);
      if (ok) {
        entry.synced = true;
        entry.supabaseId = ok;
        entry.mailed = false;
        newlySynced.push(entry);
        successCount++;
      }
    }
  }

  if (successCount > 0) {
    localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
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
        body: { protocol_id: supabaseId, pdf_base64: pdfBase64, is_update: !!isUpdate }
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
        .limit(60);

      if (rows && rows.length) {
        var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
        var changed = false;
        rows.forEach(function(r) {
          changed = true;
          var catMap = {};
          (r.protocol_equipments || []).forEach(function(eq) {
            catMap[eq.category_id] = { active: true, status: eq.status || 'okay', note: eq.note || '',
              hussenDelivered: eq.hussen_delivered || null, hussenReturned: eq.hussen_returned || null };
          });
          var fresh = {
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
            totalCost: (r.total_cost || 0).toFixed(2).replace('.', ',') + ' €',
            transports: (r.protocol_transports || []).map(function(t) {
              return { type: t.vehicle_type, driver: t.driver_name, punctuality: t.punctuality, delay: t.delay_mins };
            }),
            personnel: (function(shifts) {
              // Deduplicate identical shifts (same user + times + role) caused by prior save bugs
              var seen = {};
              return shifts.filter(function(s) {
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
            })(r.shifts || []),
            categories: catMap,
            damages: r.notes_damages || 'nein',
            incidents: r.notes_incidents || 'nein',
            feedback: r.notes_feedback || '—',
            holiday: !!r.is_holiday,
            synced: true
          };
          var existingIdx = archive.findIndex(function(e) { return e.supabaseId === r.id; });
          if (existingIdx !== -1) {
            // Preserve local-only fields (signature, editingLocalId) but refresh Supabase data
            fresh.signature = archive[existingIdx].signature || null;
            // Keep a pending mail retry; older entries without the flag never get mailed retroactively
            fresh.mailed = archive[existingIdx].mailed !== false;
            fresh.isUpdate = !!archive[existingIdx].isUpdate;
            archive[existingIdx] = fresh;
          } else {
            fresh.mailed = true;
            archive.push(fresh);
          }
        });
        if (changed) {
          archive.sort(function(a, b) { return new Date(b.savedAt) - new Date(a.savedAt); });
          if (archive.length > 100) archive = archive.slice(0, 100);
          localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
        }
      }
    } catch(e) { console.warn('Verlauf Supabase fetch failed:', e); }
    retryPendingMails(); // fire-and-forget
  }

  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');

  if (!archive.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div>Noch keine Protokolle gespeichert.<br/>Sende ein Protokoll, um es hier zu archivieren.</div></div>';
    return;
  }

  var html = archive.map(function(e) {
    var savedDate = e.savedAt ? new Date(e.savedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    var personCount = (e.personnel || []).length;
    var transportCount = (e.transports || []).length;
    var syncStatus = e.synced 
      ? '<span style="color:var(--safe); font-size:10px;">● Synced</span>' 
      : '<span style="color:var(--danger); font-size:10px; cursor:pointer;" onclick="retrySyncAllProtocols()">● Nicht synchronisiert (Tippen zum Synchronisieren)</span>';

    return '<div class="card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div class="history-week" style="font-size:15px;">' + (e.event || '—') + '</div>' +
          '<div class="history-sub">' + (e.date || '—') + ' · ' + (e.location || '—') + '</div>' +
          '<div class="history-sub" style="margin-top:3px;">' +
            '<span class="badge">' + (e.action || '—') + '</span> ' +
            (e.al ? '· AL: ' + e.al : '') +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0;margin-left:10px;">' +
          '<div class="history-hours" style="font-size:16px;">' + (e.totalCost || '—') + '</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:2px;">' + personCount + ' Personal · ' + transportCount + ' Fzg</div>' +
          '<div style="margin-top:4px;">' + syncStatus + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:8px;border-top:0.5px solid var(--border);">' +
        '<span style="font-size:11px;color:var(--text3);">' + savedDate + '</span>' +
        '<div style="display:flex;gap:8px;">' +
          '<button onclick="loadProtFromHistory(\'' + e.id + '\')" style="font-size:12px;padding:5px 12px;border:0.5px solid var(--accent);border-radius:var(--radius);background:var(--accent-bg);color:var(--accent-text);cursor:pointer;font-weight:600;">Bearbeiten</button>' +
          '<button onclick="reExportProtPDF(\'' + e.id + '\')" style="font-size:12px;padding:5px 12px;border:0.5px solid var(--border2);border-radius:var(--radius);background:var(--bg2);color:var(--text2);cursor:pointer;">PDF</button>' +
          '<button onclick="deleteProtHistory(\'' + e.id + '\')" style="font-size:12px;padding:5px 12px;border:0.5px solid var(--border2);border-radius:var(--radius);background:none;color:var(--danger);cursor:pointer;">Löschen</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  list.innerHTML = html;
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

  // Hydrate state
  protState.transports = (entry.transports || []).map(function(t) { return Object.assign({}, t); });
  protState.personnel  = (entry.personnel  || []).map(function(p) { return Object.assign({}, p); });
  protState.categories = JSON.parse(JSON.stringify(entry.categories || {}));
  protState.signature  = entry.signature || null;
  // Resolve AL/PL UUIDs: prefer stored ID, fall back to name lookup for legacy entries
  var findUserByName = function(name) {
    if (!name || name === '—' || !appUsers.length) return null;
    var u = appUsers.find(function(u) { return u.full_name === name || u.email === name; });
    return u ? u.id : null;
  };
  protState.alId = entry.alId || findUserByName(entry.al) || null;
  protState.plId = entry.plId || findUserByName(entry.pl) || null;

  // If appUsers already loaded, set AL/PL selects immediately
  var alSel = document.getElementById('prot-al');
  var plSel = document.getElementById('prot-pl');
  if (alSel && appUsers.length) alSel.value = protState.alId || '';
  if (plSel && appUsers.length) plSel.value = protState.plId || '';

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
  var data = {
    event: entry.event || '—', location: entry.location || '—',
    date: entry.date || '—', action: entry.action || '—',
    al: entry.al || '—', pl: entry.pl || '—',
    damages: entry.damages || 'nein', incidents: entry.incidents || 'nein',
    feedback: entry.feedback || '—',
    transports: entry.transports || [], personnel: entry.personnel || [],
    categories: entry.categories || {},
    totalCost: entry.totalCost || '0,00 €'
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
      doc.text(t.type,ml+2,y+5.5); doc.text(t.driver||'—',ml+40,y+5.5); doc.text(t.punctuality,ml+80,y+5.5); doc.text(t.delay?t.delay+' Min':'—',ml+120,y+5.5); y += 8;
    }); y += 4;
  }

  // Categories
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('Equipment & Gewerke', ml, y); y += 6;
  var activeCats = PROT_CATEGORIES_CONFIG.filter(function(c){return data.categories[c.id] && data.categories[c.id].active;});
  activeCats.forEach(function(cat) {
    var s = data.categories[cat.id];
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text(cat.label+':', ml, y);
    doc.setFont('helvetica','normal'); doc.text(s.status.toUpperCase(), ml+40, y);
    if (s.note) {
      doc.setFontSize(8); doc.setTextColor(100);
      doc.splitTextToSize(String(s.note), cw - 5).forEach(function(line) { y += 4; if (y > 280) { doc.addPage(); y = 20; } doc.text(line, ml+5, y); });
      doc.setTextColor(0);
    }
    if (cat.id === 'stoffe') {
      y += 5;
      doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text('Rücklauf Estrel-Hussen:', ml + 5, y);
      var val1 = s.hussenDelivered || '0';
      var val2 = s.hussenReturned || '0';
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
      var posLabel = p.pos;
      if (['AL', 'MA', 'Fahrer'].includes(p.pos)) posLabel += (p.fest ? ' fest' : ' frei');
      doc.text(truncatePdf(doc,posLabel,22),ml+2,y+5.5); doc.text(truncatePdf(doc,p.name||'—',45),ml+25,y+5.5); doc.text(p.start+' - '+p.end,ml+72,y+5.5); doc.text(pa+' Min',ml+100,y+5.5); doc.text(netStr,ml+118,y+5.5);
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
  });
  data.personnel.forEach(function(p) {
    var v = timeToMins(p.start), b = timeToMins(p.end), pa = parseInt(p.pause) || 0;
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v === null || b === null || effB <= v) return;
    var basePos = p.pos;
    if (['AL', 'MA', 'Fahrer'].includes(p.pos)) {
      var u = p.userId ? appUsers.find(function(x) { return x.id === p.userId; }) : null;
      var fest = (p.fest !== undefined) ? p.fest : !!(u && u.is_fest);
      basePos += (fest ? ' fest' : ' frei');
    }
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

