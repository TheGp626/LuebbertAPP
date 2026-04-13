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
  editingId: null,      // Supabase UUID for updates
  editingLocalId: null  // History ID (timestamp string)
};

var appUsers = [];
async function fetchAppUsers() {
  if (typeof supabaseClient === 'undefined') return;
  var { data, error } = await supabaseClient.from('app_users').select('id, full_name, email, role');
  if (error) console.error("Error fetching app_users:", error);
  if (data) {
    appUsers = data;
    renderProtPersonnel();
  }
}

function initProtokoll() {
  loadProtDraft();
  var alInput = document.getElementById('prot-al');
  if (alInput && !alInput.value) {
    alInput.value = localStorage.getItem('stundenzettel_name') || '';
    saveProtDraft();
  }
  if (protState.transports.length === 0) addProtTransport();
  if (protState.personnel.length === 0) addProtPersonnel();
  
  PROT_CATEGORIES_CONFIG.forEach(function(cat) {
    if (!protState.categories[cat.id]) protState.categories[cat.id] = { active: true, status: 'okay', note: '' };
  });

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
  ctx.scale(dpr, dpr); ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
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
  protState.personnel.push({ pos: 'MA', fest: true, isTemp: false, userId: '', tempName: '', name: '', start: '', end: '', pause: '0' });
  renderProtPersonnel();
  saveProtDraft();
}

function removeProtPersonnel(idx) {
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

    var showFest = (p.pos === 'AL' || p.pos === 'MA' || p.pos === 'Fahrer');
    var festCheck = showFest ? 
      '<label style="display:flex; align-items:center; gap:4px; font-size:12px; margin-top:4px; cursor:pointer;">' +
      '<input type="checkbox" onchange="updateProtPersonnel(' + i + ',\'fest\',this.checked)" ' + (p.fest !== false ? 'checked' : '') + ' /> Festangestellt</label>' : '';

    var userOpts = '<option value="">-- Personal wählen --</option>' + appUsers.map(function(u) {
      return '<option value="' + u.id + '" ' + (p.userId === u.id ? 'selected' : '') + '>' + (u.full_name || u.email || 'Unbenannt') + '</option>';
    }).join('');

    var nameField = p.isTemp 
      ? '<input type="text" class="meta-input" placeholder="Aushilfe Name" style="margin-bottom:0;" value="' + (p.tempName || '') + '" oninput="updateProtPersonnel(' + i + ', \'tempName\', this.value)"/>'
      : '<select class="meta-input" style="margin-bottom:0;" onchange="updateProtPersonnel(' + i + ', \'userId\', this.value)">' + userOpts + '</select>';
      
    var tempCheck = '<label style="display:flex; align-items:center; gap:4px; font-size:12px; margin-top:4px; cursor:pointer;">' +
      '<input type="checkbox" onchange="updateProtPersonnel(' + i + ',\'isTemp\',this.checked)" ' + (p.isTemp ? 'checked' : '') + ' /> Externe(r) / Aushilfe</label>';

    return '<div class="shift-block">' +
           '  <div class="shift-label">Personal ' + (i + 1) + 
           '    <button class="shift-remove" onclick="removeProtPersonnel(' + i + ')">×</button>' +
           '  </div>' +
           '  <div class="meta-fields">' +
           '    <div class="meta-field">' +
           '      <span class="meta-label">Position</span>' +
           '      <select class="meta-input" style="margin-bottom:0" onchange="updateProtPersonnel(' + i + ', \'pos\', this.value)">' + opts + '</select>' + festCheck +
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
           '</div>';
  }).join('');
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
  if (field === 'pos' || field === 'fest' || field === 'isTemp') renderProtPersonnel();

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
  
  // Logistics
  protState.transports.forEach(function(t) {
    total += PROT_VEHICLE_RATES[t.type] || 0;
  });

  // Personnel
  protState.personnel.forEach(function(p) {
    var v = timeToMins(p.start), b = timeToMins(p.end), pa = parseInt(p.pause) || 0;
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v !== null && b !== null && effB > v) {
      var basePos = p.pos;
      if (['AL', 'MA', 'Fahrer'].includes(p.pos)) {
        basePos += (p.fest ? ' fest' : ' frei');
      }
      var costs = calcSplitShiftCosts(basePos, protState.date || new Date().toISOString().split('T')[0], protState.holiday, v, effB, pa);
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
    damages: (document.getElementById('prot-damages') || {}).value || '',
    incidents: (document.getElementById('prot-incidents') || {}).value || '',
    feedback: (document.getElementById('prot-feedback') || {}).value || '',
    transports: protState.transports,
    personnel: protState.personnel,
    categories: protState.categories,
    signature: protState.signature,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem('luebbert_protokoll_draft', JSON.stringify(data));
  updateTopBarSub();
}

function loadProtDraft() {
  var saved = localStorage.getItem('luebbert_protokoll_draft');
  if (!saved) return;
  try {
    var data = JSON.parse(saved);
    if (document.getElementById('prot-event')) document.getElementById('prot-event').value = data.event || '';
    if (document.getElementById('prot-location')) document.getElementById('prot-location').value = data.location || '';
    if (document.getElementById('prot-date')) document.getElementById('prot-date').value = data.date || '';
    if (document.getElementById('prot-isholiday')) document.getElementById('prot-isholiday').checked = data.holiday || false;
    if (document.getElementById('prot-action')) document.getElementById('prot-action').value = data.action || 'Aufbau';
    if (document.getElementById('prot-al')) document.getElementById('prot-al').value = data.al || '';
    if (document.getElementById('prot-pl')) document.getElementById('prot-pl').value = data.pl || '';
    if (document.getElementById('prot-damages')) document.getElementById('prot-damages').value = data.damages || '';
    if (document.getElementById('prot-incidents')) document.getElementById('prot-incidents').value = data.incidents || '';
    if (document.getElementById('prot-feedback')) document.getElementById('prot-feedback').value = data.feedback || '';
    
    protState.transports = data.transports || [];
    protState.personnel = data.personnel || [];
    protState.categories = data.categories || {};
    protState.signature = data.signature || null;
  } catch(e) { console.error("Error loading draft", e); }
}

function clearProtForm(skipConfirm) {
  if (!skipConfirm && !confirm('Gesamtes Protokoll löschen?')) return;
  localStorage.removeItem('luebbert_protokoll_draft');
  protState = { transports: [], personnel: [], categories: {} };
  
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
    al: (document.getElementById('prot-al') || {}).value || '—',
    pl: (document.getElementById('prot-pl') || {}).value || '—',
    damages: (document.getElementById('prot-damages') || {}).value || 'nein',
    incidents: (document.getElementById('prot-incidents') || {}).value || 'nein',
    feedback: (document.getElementById('prot-feedback') || {}).value || '—',
    transports: protState.transports,
    personnel: protState.personnel,
    categories: protState.categories,
    totalCost: document.getElementById('prot-total-cost').textContent + ' €'
  };

  showToast('Speichere & Sende an Server...', 'info');
  var btn = document.querySelector('.fab-area .btn.primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Lädt...'; }

  // ── PUSH TO SUPABASE ──
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
    totalCost: data.totalCost,
    transports: data.transports,
    personnel: data.personnel,
    categories: data.categories,
    damages: data.damages,
    incidents: data.incidents,
    feedback: data.feedback,
    signature: protState.signature || null,
    synced: isSynced
  };

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
  clearProtForm(true); // Soft clear without reloading
  if (typeof navigateProt === 'function') navigateProt('protokoll-history');
}

async function syncProtokollToSupabase(data) {
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
    if (!parsedDate || parsedDate === '—') parsedDate = new Date().toISOString().split('T')[0];

    var protPayload = {
      project_id: projId,
      date: parsedDate,
      action: data.action === '—' ? null : data.action,
      is_holiday: protState.holiday || false,
      al_name_fallback: data.al === '—' ? null : data.al,
      pl_name_fallback: data.pl === '—' ? null : data.pl,
      signature_text: protState.signature,
      total_cost: costNum,
      notes_damages: data.damages === 'nein' ? null : data.damages,
      notes_incidents: data.incidents === 'nein' ? null : data.incidents,
      notes_feedback: data.feedback === '—' ? null : data.feedback
    };

    var protId = null;
    if (protState.editingId) {
      var { error: upErr } = await supabaseClient.from('protocols').update(protPayload).eq('id', protState.editingId);
      if (upErr) throw upErr;
      protId = protState.editingId;
      
      // Cleanup sub-tables before re-inserting
      await supabaseClient.from('protocol_transports').delete().eq('protocol_id', protId);
      await supabaseClient.from('protocol_equipments').delete().eq('protocol_id', protId);
      await supabaseClient.from('shifts').delete().eq('protocol_id', protId);
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
        if (['AL', 'MA', 'Fahrer'].includes(p.pos)) basePos += (p.fest !== false ? ' fest' : ' frei');
        
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
          status: 'approved',
          shift_date: protState.date || null
        });
      });
      if (shiftInserts.length > 0) {
        var { error: shErr } = await supabaseClient.from('shifts').insert(shiftInserts);
        if (shErr) console.error("Shifts Insert Error:", shErr);
      }
    }
    showToast('✅ Protokoll erfolgreich synchronisiert und gespeichert!');
    return protId;
  } catch(e) {
    console.error("Sync Exception:", e);
    showToast("Server Sync fehlgeschlagen. Offline gespeichert.", "danger");
    return null;
  }
}

// ── PDF EXPORT ──
async function exportProtPDF() {
  var data = {
    event: (document.getElementById('prot-event') || {}).value || '—',
    location: (document.getElementById('prot-location') || {}).value || '—',
    date: (document.getElementById('prot-date') || {}).value || '—',
    action: (document.getElementById('prot-action') || {}).value || '—',
    al: (document.getElementById('prot-al') || {}).value || '—',
    pl: (document.getElementById('prot-pl') || {}).value || '—',
    damages: (document.getElementById('prot-damages') || {}).value || 'nein',
    incidents: (document.getElementById('prot-incidents') || {}).value || 'nein',
    feedback: (document.getElementById('prot-feedback') || {}).value || '—',
    transports: protState.transports,
    personnel: protState.personnel,
    categories: protState.categories,
    totalCost: document.getElementById('prot-total-cost').textContent + ' €'
  };

  showToast('Generiere PDF...');
  
  var doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
  if (typeof LOGO_BASE64 !== 'undefined') {
    try {
      var lw = 30, lh = Math.round(lw * (LOGO_H / LOGO_W) * 100) / 100;
      doc.addImage(LOGO_BASE64, 'PNG', 160, 10, lw, lh);
    } catch (e) { }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Einsatzprotokoll', ml, 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120); doc.text('Lübbert Event Interiors', ml, 26); doc.setTextColor(0);
  var y = 20; // Initialize y here
  y += 18;

  // Metadata Table
  doc.setDrawColor(230); doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 32, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('Projekt:', ml + 4, y + 6); doc.setFont('helvetica', 'normal'); doc.text(data.event, ml + 25, y + 6);
  doc.setFont('helvetica', 'bold'); doc.text('Ort:', ml + 4, y + 12); doc.setFont('helvetica', 'normal'); doc.text(data.location, ml + 25, y + 12);
  doc.setFont('helvetica', 'bold'); doc.text('Datum:', ml + 4, y + 18); doc.setFont('helvetica', 'normal'); doc.text(data.date, ml + 25, y + 18);
  doc.setFont('helvetica', 'bold'); doc.text('Aktion:', ml + 80, y + 18); doc.setFont('helvetica', 'normal'); doc.text(data.action, ml + 100, y + 18);
  doc.setFont('helvetica', 'bold'); doc.text('AL:', ml + 4, y + 24); doc.setFont('helvetica', 'normal'); doc.text(data.al, ml + 25, y + 24);
  doc.setFont('helvetica', 'bold'); doc.text('PL:', ml + 80, y + 24); doc.setFont('helvetica', 'normal'); doc.text(data.pl, ml + 100, y + 24);
  y += 40;

  // Transports
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Logistik & Transport', ml, y); y += 6;
  if (data.transports.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Keine Lieferung hat stattgefunden.', ml, y); y += 8;
  } else {
    doc.setFillColor(30,30,28); doc.rect(ml, y, cw, 8, 'F'); doc.setTextColor(255);
    doc.setFontSize(8); doc.text('Fahrzeug', ml + 2, y + 5.5); doc.text('Fahrer', ml + 40, y + 5.5); doc.text('Status', ml + 80, y + 5.5); doc.text('Verspätung', ml + 120, y + 5.5);
    doc.setTextColor(0); y += 8;
    data.transports.forEach(function(t, i) {
      if (i % 2 === 1) { doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 8, 'F'); }
      doc.text(t.type, ml + 2, y + 5.5); doc.text(t.driver || '—', ml + 40, y + 5.5); doc.text(t.punctuality, ml + 80, y + 5.5); doc.text((t.delay ? t.delay + ' Min' : '—'), ml + 120, y + 5.5);
      y += 8;
    });
    y += 4;
  }

  // Categories
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Equipment & Gewerke', ml, y); y += 6;
  var activeCats = PROT_CATEGORIES_CONFIG.filter(function(c) { return data.categories[c.id] && data.categories[c.id].active; });
  if (activeCats.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Keine Gewerke dokumentiert.', ml, y); y += 8;
  } else {
    activeCats.forEach(function(cat) {
      var s = data.categories[cat.id];
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(cat.label + ':', ml, y);
      doc.setFont('helvetica', 'normal'); doc.text(s.status.toUpperCase(), ml + 40, y);
      
      if (s.note) { 
        y += 5; doc.setFontSize(8); doc.setTextColor(100); 
        doc.text(s.note, ml + 5, y); 
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
        
        // Underlines
        doc.setDrawColor(200); doc.line(ml + 44, y + 1, ml + 54, y + 1); doc.line(ml + 84, y + 1, ml + 94, y + 1);
      }
      
      y += 7;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 4;
  }

  // Personnel
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Personal', ml, y); y += 6;
  if (data.personnel.length === 0) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.text('Keine Personaldaten erfasst.', ml, y); y += 8;
  } else {
    doc.setFillColor(30,30,28); doc.rect(ml, y, cw, 8, 'F'); doc.setTextColor(255);
    doc.setFontSize(8); doc.text('Pos', ml + 2, y + 5.5); doc.text('Name', ml + 15, y + 5.5); doc.text('Arbeitszeit', ml + 70, y + 5.5); doc.text('Pause', ml + 110, y + 5.5); doc.text('Netto', ml + 140, y + 5.5);
    doc.setTextColor(0); y += 8;
    data.personnel.forEach(function(p, i) {
      if (i % 2 === 1) { doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 8, 'F'); }
      var v = timeToMins(p.start), b = timeToMins(p.end), pa = parseInt(p.pause) || 0;
      var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
      var netStr = '—';
      if (v !== null && b !== null && effB > v) {
        var n = Math.max(3, (effB - v - pa) / 60); netStr = n.toFixed(2) + ' h';
      }
      var posLabel = p.pos;
      if (['AL', 'MA', 'Fahrer'].includes(p.pos)) posLabel += (p.fest ? ' fest' : ' frei');
      doc.text(posLabel, ml + 2, y + 5.5); doc.text(p.name || '—', ml + 25, y + 5.5); doc.text(p.start + ' - ' + p.end, ml + 80, y + 5.5); doc.text(pa + ' Min', ml + 120, y + 5.5); doc.text(netStr, ml + 150, y + 5.5);
      y += 8;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 4;
  }

  // Incidents
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text('Vorkommnisse / Feedback', ml, y); y += 6;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('Mängel:', ml, y); doc.setFont('helvetica', 'normal'); doc.text(data.damages || 'nein', ml + 40, y); y += 6;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('Vorkommnisse:', ml, y); doc.setFont('helvetica', 'normal'); doc.text(data.incidents || 'nein', ml + 40, y); y += 6;
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.text('Feedback Location:', ml, y); doc.setFont('helvetica', 'normal'); doc.text(data.feedback || '—', ml + 40, y); y += 12;

  // Total & Nebenkalkulation
  doc.setDrawColor(24, 95, 165); doc.setLineWidth(0.5); doc.line(ml, y, ml + cw, y); y += 8;
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('Nebenkalkulation (itemisiert):', ml, y); y += 6;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
  
  var logTotal = 0;
  data.transports.forEach(function(t) {
    var r = PROT_VEHICLE_RATES[t.type] || 0;
    doc.text('- ' + t.type + ': ' + r.toFixed(2) + ' EUR', ml + 5, y); y += 4;
    logTotal += r;
  });
  
  var persTotal = 0;
  data.personnel.forEach(function(p) {
    var v = timeToMins(p.start), b = timeToMins(p.end), pa = parseInt(p.pause) || 0;
    var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
    if (v !== null && b !== null && effB > v) {
      var basePos = p.pos;
      if (['AL', 'MA', 'Fahrer'].includes(p.pos)) basePos += (p.fest ? ' fest' : ' frei');
      var costs = calcSplitShiftCosts(basePos, data.date || new Date().toISOString().split('T')[0], protState.holiday, v, effB, pa);
      costs.forEach(function(c) {
        var sub = c.hrs * c.rate;
        doc.text('- ' + p.name + ' (' + c.desc + '): ' + c.hrs.toFixed(2) + 'h x ' + c.rate.toFixed(2) + ' EUR = ' + sub.toFixed(2) + ' EUR', ml + 5, y); y += 4;
        persTotal += sub;
      });
    }
  });
  y += 2;
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(24, 95, 165);
  doc.text('Gesamtkosten (geschätzt): ' + data.totalCost, ml, y);
  y += 12;

  y += 12;

  // Signature section
  if (protState.signature) {
    if (y + 35 > 270) { doc.addPage(); y = 20; }
    doc.setDrawColor(24, 95, 165); doc.setLineWidth(0.3); doc.line(ml, y, ml + cw, y); y += 8;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.text('Unterschrift Aufbauleitung:', ml, y); y += 6;
    try {
      doc.addImage(protState.signature, 'JPEG', ml, y, 70, 22);
    } catch(e) {}
    y += 24;
    doc.setDrawColor(180); doc.line(ml, y, ml + 70, y); y += 4;
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
    doc.text(data.al || 'Aufbauleitung', ml, y);
    doc.setTextColor(0);
    y += 10;
  }

  var fName = 'protokoll_' + data.date + '_' + data.event.replace(/\s+/g, '_') + '.pdf';
  doc.save(fName);
  showToast('PDF generiert! Sende an Server...');

  // ── PUSH TO SUPABASE ──
  await syncProtokollToSupabase(data);
  
  // ── ARCHIVE TO HISTORY ──
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var entry = {
    id: Date.now().toString(),
    savedAt: new Date().toISOString(),
    event: data.event,
    location: data.location,
    date: data.date,
    action: data.action,
    al: data.al,
    pl: data.pl,
    totalCost: data.totalCost,
    transports: data.transports,
    personnel: data.personnel,
    categories: data.categories,
    damages: data.damages,
    incidents: data.incidents,
    feedback: data.feedback,
    signature: protState.signature || null,
    synced: isSynced
  };
  archive.unshift(entry);
  if (archive.length > 50) archive = archive.slice(0, 50);
  localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
  
  if (isSynced) {
    showToast('✅ Protokoll erfolgreich synchronisiert und gespeichert!');
  } else {
    showToast('⚠️ Offline gespeichert. Synchronisierung folgt bei Verbindung.', 'warning');
  }
  
  clearProtForm(true); // Soft clear without reloading
  if (typeof navigateProt === 'function') navigateProt('protokoll-history');
}

async function retrySyncAllProtocols() {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var unsynced = archive.filter(e => !e.synced);
  if (unsynced.length === 0) return;

  showToast(`Synchronisiere ${unsynced.length} Protokolle...`, 'info');
  let successCount = 0;

  for (let entry of archive) {
    if (!entry.synced) {
      const ok = await syncProtokollToSupabase(entry);
      if (ok) {
        entry.synced = true;
        successCount++;
      }
    }
  }

  if (successCount > 0) {
    localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
    renderProtHistory();
    showToast(`✅ ${successCount} Protokolle erfolgreich synchronisiert!`);
  }
}


// ── PROTOKOLL HISTORY ──
function renderProtHistory() {
  var list = document.getElementById('prot-history-list');
  if (!list) return;
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

function deleteProtHistory(id) {
  if (!confirm('Protokoll aus dem Verlauf löschen?')) return;
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  archive = archive.filter(function(e) { return e.id !== id; });
  localStorage.setItem('luebbert_protokoll_history', JSON.stringify(archive));
  renderProtHistory();
  showToast('Gelöscht');
}

function loadProtFromHistory(id) {
  var archive = JSON.parse(localStorage.getItem('luebbert_protokoll_history') || '[]');
  var entry = null;
  for (var i = 0; i < archive.length; i++) { if (archive[i].id === id) { entry = archive[i]; break; } }
  if (!entry) { showToast('Nicht gefunden'); return; }

  if (!confirm('Dieses Protokoll in das Formular laden? Nicht gespeicherte Änderungen gehen verloren.')) return;

  // Hydrate DOM fields
  var fieldMap = { event: 'prot-event', location: 'prot-location', date: 'prot-date', action: 'prot-action', al: 'prot-al', pl: 'prot-pl', damages: 'prot-damages', incidents: 'prot-incidents', feedback: 'prot-feedback' };
  Object.keys(fieldMap).forEach(function(key) {
    var el = document.getElementById(fieldMap[key]);
    if (el) el.value = entry[key] || '';
  });

  // Hydrate state
  protState.transports = (entry.transports || []).map(function(t) { return Object.assign({}, t); });
  protState.personnel  = (entry.personnel  || []).map(function(p) { return Object.assign({}, p); });
  protState.categories = JSON.parse(JSON.stringify(entry.categories || {}));
  protState.signature  = entry.signature || null;

  // Ensure at least one slot if empty
  if (!protState.transports.length) protState.transports.push({ type: 'Sprinter', driver: '', punctuality: 'pünktlich', delay: '' });
  if (!protState.personnel.length)  protState.personnel.push({ pos: 'MA', name: '', start: '', end: '', pause: '0' });

  // Re-initialize categories that might be missing
  PROT_CATEGORIES_CONFIG.forEach(function(cat) {
    if (!protState.categories[cat.id]) protState.categories[cat.id] = { active: true, status: 'okay', note: '' };
  });

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

  // Build PDF directly from archived data – no DOM, no re-archiving, no email
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
    if (s.note) { y+=5; doc.setFontSize(8); doc.setTextColor(100); doc.text(s.note, ml+5, y); doc.setTextColor(0); }
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
    doc.text('Pos',ml+2,y+5.5); doc.text('Name',ml+15,y+5.5); doc.text('Arbeitszeit',ml+70,y+5.5); doc.text('Pause',ml+110,y+5.5); doc.text('Netto',ml+140,y+5.5);
    doc.setTextColor(0); y += 8;
    data.personnel.forEach(function(p,i) {
      if (i%2===1){doc.setFillColor(248,248,246);doc.rect(ml,y,cw,8,'F');}
      var v=timeToMins(p.start),b=timeToMins(p.end),pa=parseInt(p.pause)||0;
      var effB = (b !== null && v !== null && b < v) ? b + 1440 : b;
      var netStr='—'; if(v!==null&&b!==null&&effB>v){var n=Math.max(3,(effB-v-pa)/60);netStr=n.toFixed(2)+' h';}
      var posLabel = p.pos;
      if (['AL', 'MA', 'Fahrer'].includes(p.pos)) posLabel += (p.fest ? ' fest' : ' frei');
      doc.text(posLabel,ml+2,y+5.5); doc.text(p.name||'—',ml+25,y+5.5); doc.text(p.start+' - '+p.end,ml+80,y+5.5); doc.text(pa+' Min',ml+120,y+5.5); doc.text(netStr,ml+150,y+5.5);
      y+=8; if(y>270){doc.addPage();y=20;}
    }); y += 4;
  }

  // Incidents
  doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.text('Vorkommnisse / Feedback', ml, y); y += 6;
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.text('Mängel:', ml, y); doc.setFont('helvetica','normal'); doc.text(data.damages, ml+40, y); y += 6;
  doc.setFont('helvetica','bold'); doc.text('Vorkommnisse:', ml, y); doc.setFont('helvetica','normal'); doc.text(data.incidents, ml+40, y); y += 6;
  doc.setFont('helvetica','bold'); doc.text('Feedback:', ml, y); doc.setFont('helvetica','normal'); doc.text(data.feedback, ml+40, y); y += 12;

  // Costs
  doc.setDrawColor(24,95,165); doc.setLineWidth(0.5); doc.line(ml,y,ml+cw,y); y += 8;
  doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.text('Gesamtkosten (geschätzt): ' + data.totalCost, ml, y); y += 12;

  // Signature
  if (entry.signature) {
    if (y+35>270){doc.addPage();y=20;}
    doc.setDrawColor(24,95,165); doc.setLineWidth(0.3); doc.line(ml,y,ml+cw,y); y+=8;
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(0); doc.text('Unterschrift Aufbauleitung:', ml, y); y+=6;
    try { doc.addImage(entry.signature,'JPEG',ml,y,70,22); } catch(e){}
    y+=24; doc.setDrawColor(180); doc.line(ml,y,ml+70,y); y+=4;
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(120); doc.text(data.al||'Aufbauleitung', ml, y); doc.setTextColor(0);
  }

  var fName = 'protokoll_' + data.date + '_' + data.event.replace(/\s+/g,'_') + '.pdf';
  doc.save(fName);
  showToast('PDF wurde gespeichert!');

  protState = savedProtState;
}

