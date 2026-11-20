/* Material abhaken (Spec "Mengen abhaken und Abteilungs-Mails", Teil A).
 * AL, PL and the MA planned on an Einsatz tick off the positions of the Auftragsbestätigung (RPC order_check_items) or,
 * without one, the material lines of the Wochenplan, with the real quantity: once at Aufbau, once at Abbau.
 * One plan entry often covers several rooms of one Bestätigung (26-0287.01 CH II, .02 Saal Europa, .03 Foyer): all jobs
 * of that Bestätigung with the same day and phase are shown together, each still saved under its own job (list_key).
 * Every change goes to table order_checks at once and shows on every open phone through Supabase Realtime.
 * Offline, changes wait in localStorage and are sent when the phone is back online (the later change wins on the server).
 * Pure functions first (tested in tests/material.test.js), then the sheet. */

var MC_QUEUE_KEY = 'luebbert_mc_queue';
var MC_ITEMS_KEY = 'luebbert_mc_items_'; // + list key: last known positions for offline opening

// 'Abbau' / 'Teilabbau' / slot phase 'teardown' → 'abbau', everything else → 'aufbau'
function mcPhaseOf(actionOrPhase) {
  return /abbau|teardown/i.test(String(actionOrPhase || '')) ? 'abbau' : 'aufbau';
}

function mcJobKey(jobNo) { return 'job:' + jobNo; }
function mcPlanKey(date, eventKey) { return 'plan:' + date + '|' + String(eventKey || '').trim().toLowerCase().slice(0, 200); }
function mcIsJobNo(v) { return /^\d{2}-\d{4}\.\d{2}$/.test(String(v || '')); }

// order_check_items() result → positions [{key, group, name, soll}]. The key is the text of group and name (numbered when
// it repeats), like the plan list: a revised Bestätigung that adds or moves a position keeps every tick on its position
function mcJobItems(res) {
  var out = [], seen = {};
  ((res && res.materials) || []).forEach(function(g) {
    (g.items || []).forEach(function(it) {
      var q = Number(it.qty), name = String(it.name || '').trim();
      var base = 'j:' + (String(g.group || '').trim() + '|' + name).toLowerCase().slice(0, 180);
      seen[base] = (seen[base] || 0) + 1;
      out.push({ key: seen[base] > 1 ? base + '#' + seen[base] : base, group: g.group || '', name: name, soll: isFinite(q) ? q : null });
    });
  });
  return out;
}

// Material lines of a plan entry ("6 Flatsofa Eiche + Kissen schwarz") → positions; other lines ("Barbereich") are
// group headings. Key = the line's text, numbered when it repeats, so a re-upload with an added line keeps the ticks.
function mcPlanItems(lines) {
  var out = [], group = '', seen = {};
  (lines || []).forEach(function(raw) {
    var l = String(raw || '').trim(), m = /^(\d+)\s+(.+)$/.exec(l);
    if (!l) return;
    if (!m) { group = l; return; }
    var name = m[2].trim(), base = 'p:' + name.toLowerCase().slice(0, 180);
    seen[base] = (seen[base] || 0) + 1;
    out.push({ key: seen[base] > 1 ? base + '#' + seen[base] : base, group: group, name: name, soll: +m[1] });
  });
  return out;
}

// Jobs to tick for a plan entry: the linked ones plus every job of the same Bestätigung (26-0287.xx) with a slot on the
// same day and phase; the plan links each slot to one entry only, but the entry lists the material of all rooms
function mcJobsForShift(orders, slots) {
  var out = [], linked = (orders || []).filter(function(o) { return mcIsJobNo(o.job_no); });
  var add = function(j) { if (out.indexOf(j) === -1) out.push(j); };
  linked.forEach(function(o) { add(o.job_no); });
  linked.forEach(function(o) {
    var base = o.job_no.split('.')[0], day = String(o.start_at || '').slice(0, 10);
    (slots || []).forEach(function(s) {
      if (mcIsJobNo(s.job_no) && s.job_no.split('.')[0] === base && s.phase === o.phase && String(s.start_at || '').slice(0, 10) === day) add(s.job_no);
    });
  });
  return out.sort();
}

// Lines of positions from several lists (item.list = list_key): each position reads the rows of its own list
function mcLinesMulti(items, rows, phase) {
  var byList = {};
  (rows || []).forEach(function(r) { (byList[r.list_key] = byList[r.list_key] || []).push(r); });
  return (items || []).map(function(it) { return mcLines([it], mcIndexRows(byList[it.list] || []), phase)[0]; });
}

// "26-0287.01" / "26-0287.01, .02, .03"
function mcJobLabel(jobNos) {
  return (jobNos || []).map(function(j, i) { return i ? '.' + j.split('.')[1] : j; }).join(', ');
}

// rows (order_checks of one list) → { 'aufbau|key': row, 'abbau|key': row }
function mcIndexRows(rows) {
  var by = {};
  (rows || []).forEach(function(r) { by[r.phase + '|' + r.item_key] = r; });
  return by;
}

// What a position starts from: Soll at Aufbau; at Abbau what was really set up (Aufbau Ist), else the Soll
function mcBase(item, by, phase) {
  if (phase === 'abbau') {
    var up = by['aufbau|' + item.key];
    if (up && up.qty != null) return Number(up.qty); // taken back at Aufbau → the Soll again
  }
  return item.soll == null ? null : Number(item.soll);
}

// One line per position: base, Ist (null = not ticked yet or taken back), Fehlmenge, note and who changed it
function mcLines(items, by, phase) {
  return (items || []).map(function(it) {
    var r = by[phase + '|' + it.key] || null, base = mcBase(it, by, phase);
    var ist = r && r.qty != null ? Number(r.qty) : null;
    var fehlt = ist != null && base != null && ist < base ? base - ist : 0;
    return { item: it, base: base, ist: ist, fehlt: fehlt, note: r ? (r.note || '') : '', by: r ? r.updated_by : null, at: r ? r.updated_at : null };
  });
}

// "38 von 52 abgehakt, 3 mit Fehlmenge"
function mcSummary(lines) {
  var done = 0, short = 0;
  (lines || []).forEach(function(l) { if (l.ist != null) done++; if (l.fehlt > 0) short++; });
  return { done: done, total: (lines || []).length, short: short,
    text: done + ' von ' + (lines || []).length + ' abgehakt' + (short ? ', ' + short + ' mit Fehlmenge' : '') };
}

// "Fehlmengen laut Auftrag" for the protocol: ticked positions with less than their base, plus positions with a note
function mcShortages(items, rows, phase) {
  return mcLines(items, mcIndexRows(rows), phase)
    .filter(function(l) { return l.fehlt > 0 || (l.ist != null && l.note.trim()); })
    .map(function(l) { return { name: l.item.name, soll: l.base, ist: l.ist, fehlt: l.fehlt, note: l.note.trim() }; });
}

// "Stuhl Clara: 10 → 8, fehlt 2 (2 mit Kratzern)"
function mcShortageText(s) {
  return s.name + ': ' + (s.soll == null ? '?' : s.soll) + ' → ' + s.ist + (s.fehlt > 0 ? ', fehlt ' + s.fehlt : '') + (s.note ? ' (' + s.note + ')' : '');
}

// Offline queue: one pending row per list + phase + position, the newest change wins
function mcQueuePut(queue, row) {
  var k = row.list_key + '|' + row.phase + '|' + row.item_key;
  var out = (queue || []).filter(function(r) { return r.list_key + '|' + r.phase + '|' + r.item_key !== k; });
  out.push(row);
  return out;
}

// Server rows + own pending changes (a pending change is newer than what the server sent until it is flushed)
function mcWithPending(rows, queue, listKey) {
  var by = mcIndexRows(rows);
  (queue || []).forEach(function(q) {
    if (q.list_key !== listKey) return;
    var cur = by[q.phase + '|' + q.item_key];
    if (!cur || !cur.changed_at || q.changed_at >= cur.changed_at) by[q.phase + '|' + q.item_key] = Object.assign({}, cur || {}, q, { _pending: true });
  });
  return Object.keys(by).map(function(k) { return by[k]; });
}

// Which list to show. A list that was started stays, even when the Auftragsbestätigung comes later (no tick is lost);
// then switchToJob tells the sheet to offer the switch.
function mcPickSource(jobItems, planItems, jobRows, planRows) {
  var hasJob = (jobItems || []).length > 0, hasPlan = (planItems || []).length > 0;
  if (hasJob && hasPlan && (planRows || []).length && !(jobRows || []).length) return { use: 'plan', switchToJob: true };
  if (hasJob) return { use: 'job', switchToJob: false };
  if (hasPlan) return { use: 'plan', switchToJob: false };
  return { use: null, switchToJob: false };
}

// ── Sheet (browser only) ──

var _mc = null; // { listKeys (job lists or the plan list), phase, items, rows, channel, live, lastSync, alt }

function _mcEsc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }
function _mcQueue() { try { return JSON.parse(localStorage.getItem(MC_QUEUE_KEY) || '[]'); } catch (e) { return []; } }
function _mcSaveQueue(q) { try { localStorage.setItem(MC_QUEUE_KEY, JSON.stringify(q)); } catch (e) { /* storage full: stays in memory */ } }
function _mcRole() { return typeof userRole !== 'undefined' ? userRole : null; }
function _mcCanWrite() { var r = _mcRole(); return r && r !== 'Gast' && r !== 'Buchhaltung'; }

function _mcUserName(id) {
  if (!id) return '';
  var lists = [typeof appUsers !== 'undefined' ? appUsers : [], typeof allUsers !== 'undefined' ? allUsers : []];
  for (var i = 0; i < lists.length; i++) {
    var u = (lists[i] || []).find(function(x) { return x.id === id; });
    if (u) return u.full_name || '';
  }
  return (typeof currentUser !== 'undefined' && currentUser && currentUser.id === id) ? 'du' : '';
}

// The plan entry has material lines, or an Auftrag is linked to it → "Material abhaken" makes sense
function mcHasMaterial(s) {
  if (!s) return false;
  var lines = typeof planMaterialLines === 'function' ? planMaterialLines(s) : [];
  return mcPlanItems(lines).length > 0 || ((s._orders || []).some(function(o) { return mcIsJobNo(o.job_no); }));
}

// AL/PL/Admin/Buchhaltung everywhere; an MA only on own Einsätze
function mcCanOpen(s) {
  var role = _mcRole();
  if (['AL', 'PL', 'Admin', 'Buchhaltung'].indexOf(role) !== -1) return true;
  return role === 'MA' && typeof wpMyAssignment === 'function' && !!wpMyAssignment(s);
}

function mcButtonHtml(s, cls) {
  if (!s || !mcHasMaterial(s) || !mcCanOpen(s)) return '';
  return '<button type="button" class="btn ' + (cls || '') + ' mc-open-btn" onclick="event.stopPropagation(); openMaterialCheckForShift(\'' + s.id + '\')">Material abhaken</button>';
}

function openMaterialCheckForShift(shiftId) {
  var s = typeof _wpShiftCache !== 'undefined' ? _wpShiftCache[shiftId] : null;
  if (!s) return;
  var parsed = typeof planShiftFromDb === 'function' ? planShiftFromDb(s) : s;
  var order = (s._orders || []).find(function(o) { return mcIsJobNo(o.job_no); });
  openMaterialCheck({ shift: s, date: s.date, jobNos: mcJobsForShift(s._orders, typeof _wpSlots !== 'undefined' ? _wpSlots : null),
    phase: order ? mcPhaseOf(order.phase) : mcPhaseOf(typeof planGuessAction === 'function' ? planGuessAction(parsed.wann) : '') });
}

// From the protocol form: Projektnummer + date + action; the plan entry of that day is looked up by event name
async function openMaterialCheckForProtocol() {
  var val = function(id) { return ((document.getElementById(id) || {}).value || '').trim(); };
  var date = val('prot-date'), event = val('prot-event'), jobNo = (typeof protJobNo === 'function' ? protJobNo(val('prot-job')) : val('prot-job'));
  if (!date) { if (typeof showToast === 'function') showToast('Erst das Datum eintragen.'); return; }
  openMaterialCheck({ jobNos: mcIsJobNo(jobNo) ? [jobNo] : [], date: date, eventName: event, phase: mcPhaseOf(val('prot-action')), fromProtocol: true,
    onClose: function() { if (typeof refreshProtShortages === 'function') refreshProtShortages(); } });
}

async function _mcPlanShiftFor(date, eventName) {
  if (!date || !eventName || typeof supabaseClient === 'undefined') return null;
  try {
    var r = await supabaseClient.from('plan_shifts').select('*, plan_assignments(*)').eq('date', date);
    if (r.error) throw r.error;
    var key = eventName.trim().toLowerCase();
    return (r.data || []).find(function(s) { return planEventKey(planShiftFromDb(s)) === key; }) || null;
  } catch (e) { console.error('Material: Plan-Eintrag laden', e); return null; }
}

async function _mcJobForShift(s) {
  if (!s || typeof supabaseClient === 'undefined') return '';
  var keys = (s.keys && s.keys.length) ? s.keys : [s.key].filter(Boolean);
  if (!keys.length) return '';
  try {
    var r = await supabaseClient.from('order_plan_links').select('job_no, phase, plan_date, plan_key').eq('plan_date', s.date);
    if (r.error) throw r.error;
    var hit = (r.data || []).find(function(l) { return keys.indexOf(l.plan_key) !== -1 && mcIsJobNo(l.job_no); });
    return hit ? hit.job_no : '';
  } catch (e) { console.error('Material: Auftrag zum Plan-Eintrag', e); return ''; }
}

function _mcSheet() {
  var m = document.getElementById('mc-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'mc-modal';
    m.className = 'sig-modal ui-sheet';
    m.style.setProperty('--sheet-w', '640px');
    m.innerHTML = '<div class="sig-modal-inner mc-inner"></div>';
    m.addEventListener('click', function(e) { if (e.target === m) closeMaterialCheck(); });
    document.body.appendChild(m);
  }
  m.classList.add('open');
  return m.firstChild;
}

function closeMaterialCheck() {
  var m = document.getElementById('mc-modal');
  if (m) m.classList.remove('open');
  if (_mc && _mc.channel && typeof supabaseClient !== 'undefined') { try { supabaseClient.removeChannel(_mc.channel); } catch (e) { /* already gone */ } }
  var cb = _mc && _mc.onClose;
  _mc = null;
  if (typeof cb === 'function') cb();
}

function _mcHead(title) {
  return '<div class="ui-sheet-head"><h3 class="ui-title" style="font-size:18px;">' + _mcEsc(title) + '</h3>' +
    '<button type="button" class="ui-icon-btn" aria-label="Schließen" onclick="closeMaterialCheck()">' +
    '<svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>';
}

// opts: { shift?, jobNos?, date, eventName?, phase, fromProtocol?, onClose? }
async function openMaterialCheck(opts) {
  if (_mc) closeMaterialCheck();
  var box = _mcSheet();
  box.innerHTML = _mcHead('Material abhaken') + '<div class="wp-empty">Lädt…</div>';
  var shift = opts.shift || (opts.eventName ? await _mcPlanShiftFor(opts.date, opts.eventName) : null);
  var jobNos = (opts.jobNos && opts.jobNos.length) ? opts.jobNos : [];
  if (!jobNos.length && shift) { var j1 = await _mcJobForShift(shift); if (j1) jobNos = [j1]; }
  var parsed = shift && typeof planShiftFromDb === 'function' ? planShiftFromDb(shift) : shift;
  var planKey = shift ? mcPlanKey(shift.date, planEventKey(parsed)) : null;
  var planItems = shift ? mcPlanItems(planMaterialLines(parsed)).map(function(it) { return Object.assign(it, { list: planKey }); }) : [];
  // The other rooms of the same Bestätigung on that day (RPC order_check_group); without it (offline) the known jobs only
  var group = {};
  if (jobNos.length) {
    try {
      var gr = await supabaseClient.rpc('order_check_group', { p_job: jobNos[0], p_phase: (opts.phase || 'aufbau') === 'abbau' ? 'teardown' : 'setup' });
      if (gr.error) throw gr.error;
      (Array.isArray(gr.data) ? gr.data : []).forEach(function(j) {
        if (!mcIsJobNo(j.jobNo)) return;
        group[j.jobNo] = j;
        if (jobNos.indexOf(j.jobNo) === -1) jobNos.push(j.jobNo);
      });
      jobNos.sort();
    } catch (e) { console.warn('Material: weitere Räume', e); }
  }
  var jobKeys = jobNos.map(mcJobKey);
  var cached = function(k) { try { return JSON.parse(localStorage.getItem(MC_ITEMS_KEY + k) || 'null'); } catch (e) { return null; } };
  var jobItems = [], jobNames = [], rows = [], offline = false;
  for (var ji = 0; ji < jobNos.length; ji++) {
    var jobNo = jobNos[ji], jobKey = jobKeys[ji], its = [], nm = '';
    try {
      var ir = group[jobNo] ? { data: group[jobNo] } : await supabaseClient.rpc('order_check_items', { p_job: jobNo });
      if (ir.error) throw ir.error;
      its = mcJobItems(ir.data);
      nm = (ir.data && ir.data.name) || '';
      if (its.length) try { localStorage.setItem(MC_ITEMS_KEY + jobKey, JSON.stringify({ items: its, name: nm })); } catch (e) { /* full */ }
    } catch (e) {
      console.error('Material: Positionen laden', e);
      var c = cached(jobKey);
      if (c) { its = c.items || []; nm = c.name || ''; offline = true; }
    }
    its.forEach(function(it) { it.list = jobKey; jobItems.push(it); });
    if (nm) jobNames.push(nm);
  }
  var keys = jobKeys.concat(planKey ? [planKey] : []);
  if (keys.length) {
    try {
      var rr = await supabaseClient.from('order_checks').select('*').in('list_key', keys);
      if (rr.error) throw rr.error;
      rows = rr.data || [];
    } catch (e) { console.error('Material: Haken laden', e); offline = true; }
  }
  var pick = mcPickSource(jobItems, planItems, rows.filter(function(r) { return jobKeys.indexOf(r.list_key) !== -1; }), rows.filter(function(r) { return r.list_key === planKey; }));
  if (!pick.use) {
    box.innerHTML = _mcHead('Material abhaken') + '<div class="wp-empty">' + (offline
      ? 'Ohne Netz und ohne gespeicherte Liste geht es gerade nicht. Versuch es mit Netz noch einmal.'
      : 'Für diesen Einsatz gibt es weder eine Auftragsbestätigung noch Material im Wochenplan.') + '</div>';
    return;
  }
  var useJob = pick.use === 'job', jobSource = 'aus Auftragsbestätigung ' + mcJobLabel(jobNos) + (jobNames.length ? ' (' + jobNames.join(', ') + ')' : '');
  _mc = {
    listKeys: useJob ? jobKeys : [planKey], items: useJob ? jobItems : planItems,
    source: useJob ? jobSource : 'aus dem Wochenplan',
    alt: pick.switchToJob ? { listKeys: jobKeys, items: jobItems, source: jobSource } : null,
    phase: opts.phase || 'aufbau', date: (shift && shift.date) || opts.date,
    planKeys: shift ? ((shift.keys && shift.keys.length) ? shift.keys : [shift.key]).filter(Boolean) : [],
    rows: rows, live: false, lastSync: offline ? null : new Date(), onClose: opts.onClose || null, openNote: {}
  };
  _mcSubscribe();
  _mcRender();
  _mcFlush();
}

function mcSwitchToJob() {
  if (!_mc || !_mc.alt) return;
  if (!confirm('Zur Liste aus der Auftragsbestätigung wechseln? Die Haken aus dem Wochenplan bleiben gespeichert, zählen dann aber nicht mehr.')) return;
  var alt = _mc.alt;
  if (_mc.channel) { try { supabaseClient.removeChannel(_mc.channel); } catch (e) { /* gone */ } }
  Object.assign(_mc, { listKeys: alt.listKeys, items: alt.items, source: alt.source, alt: null, channel: null, live: false });
  _mcSubscribe();
  _mcRender();
}

function _mcSubscribe() {
  if (!_mc || typeof supabaseClient === 'undefined' || !supabaseClient.channel) return;
  var keys = _mc.listKeys.slice();
  var ch = supabaseClient.channel('mc-' + keys[0].replace(/[^A-Za-z0-9]/g, '-') + '-' + Date.now());
  keys.forEach(function(key) {
    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'order_checks', filter: 'list_key=eq.' + key }, function(p) {
      if (!_mc || _mc.listKeys.indexOf(key) === -1) return;
      var row = p.new && p.new.list_key ? p.new : null, old = p.old || {};
      _mc.rows = _mc.rows.filter(function(r) {
        var k = row || old;
        return !(r.list_key === k.list_key && r.phase === k.phase && r.item_key === k.item_key);
      });
      if (row) _mc.rows.push(row);
      _mc.lastSync = new Date();
      _mcRender();
    });
  });
  _mc.channel = ch
    .subscribe(function(status) {
      if (!_mc) return;
      _mc.live = status === 'SUBSCRIBED';
      if (_mc.live) _mc.lastSync = new Date();
      _mcRenderStatus();
    });
}

function _mcLines() {
  var q = _mcQueue(), rows = [];
  _mc.listKeys.forEach(function(k) { rows = rows.concat(mcWithPending(_mc.rows.filter(function(r) { return r.list_key === k; }), q, k)); });
  return mcLinesMulti(_mc.items, rows, _mc.phase);
}

function _mcStatusHtml() {
  var pending = _mcQueue().filter(function(r) { return _mc && _mc.listKeys.indexOf(r.list_key) !== -1; }).length;
  var online = _mc.live && (typeof navigator === 'undefined' || navigator.onLine !== false);
  var t = _mc.lastSync ? _mc.lastSync.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  return '<span class="mc-dot ' + (online ? 'mc-dot-live' : '') + '"></span>' + (online ? 'live' : 'offline' + (t ? ', zuletzt ' + t : '')) +
    (pending ? ' · ' + pending + (pending === 1 ? ' Änderung wartet' : ' Änderungen warten') + ' auf Netz' : '');
}

function _mcRenderStatus() {
  var el = document.getElementById('mc-status');
  if (el && _mc) el.innerHTML = _mcStatusHtml();
}

function _mcRender() {
  var m = document.getElementById('mc-modal');
  if (!m || !_mc) return;
  var lines = _mcLines(), sum = mcSummary(lines), write = _mcCanWrite();
  var focus = document.activeElement && document.activeElement.id; // keep the field being typed in
  var group = null, body = '';
  lines.forEach(function(l) {
    var it = l.item;
    if (it.group !== group) { group = it.group; if (group) body += '<div class="mc-group">' + _mcEsc(group) + '</div>'; }
    var who = l.by ? _mcUserName(l.by) : '', at = l.at ? new Date(l.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
    var idx = _mc.items.indexOf(it);
    body += '<div class="mc-row' + (l.ist != null ? (l.fehlt > 0 ? ' mc-short' : ' mc-done') : '') + '">' +
      '<button type="button" class="mc-check" aria-label="' + _mcEsc(it.name + (l.ist != null && l.fehlt === 0 ? ' zurücknehmen' : ' vollständig')) + '"' + (write ? ' onclick="mcTick(' + idx + ')"' : ' disabled') + '>' +
        (l.ist != null && l.fehlt === 0 ? '✓' : '') + '</button>' +
      '<div class="mc-main"><div class="mc-name">' + _mcEsc(it.name) + '</div>' +
        '<div class="mc-meta">' + (_mc.phase === 'abbau' ? 'aufgebaut ' : 'Soll ') + (l.base == null ? '?' : l.base) +
          (l.fehlt > 0 ? ' · <b class="mc-fehlt">fehlt ' + l.fehlt + '</b>' : '') +
          (who || at ? ' · ' + _mcEsc([who, at].filter(Boolean).join(' ')) : '') + '</div>' +
        (l.note || _mc.openNote[it.key] ? '<input type="text" class="meta-input mc-note" id="mc-note-' + idx + '" maxlength="500" placeholder="Bemerkung, z. B. 2 mit Kratzern" value="' + _mcEsc(l.note) + '"' +
          (write ? ' onchange="mcNote(' + idx + ', this.value)"' : ' disabled') + '>' : (write ? '<button type="button" class="ord-textbtn mc-note-btn" onclick="mcOpenNote(' + idx + ')">+ Bemerkung</button>' : '')) +
      '</div>' +
      '<input type="number" min="0" step="1" inputmode="numeric" class="meta-input mc-ist" id="mc-ist-' + idx + '" aria-label="' + _mcEsc('Ist-Menge ' + it.name) + '" placeholder="Ist" value="' + (l.ist == null ? '' : l.ist) + '"' +
        (write ? ' onchange="mcSetQty(' + idx + ', this.value)"' : ' disabled') + '>' +
    '</div>';
  });
  m.firstChild.innerHTML = _mcHead('Material abhaken') +
    '<div class="mc-top"><div class="ui-sub">' + _mcEsc(_mc.source) + '</div>' +
      '<div class="mc-status" id="mc-status">' + _mcStatusHtml() + '</div></div>' +
    (_mc.alt ? '<div class="mc-hint">Auftragsbestätigung ist jetzt da. <button type="button" class="ord-textbtn" onclick="mcSwitchToJob()">Zur Liste wechseln</button></div>' : '') +
    '<div class="ui-seg mc-phase">' + ['aufbau', 'abbau'].map(function(p) {
      return '<button type="button" class="' + (_mc.phase === p ? 'active' : '') + '" onclick="mcSetPhase(\'' + p + '\')">' + (p === 'aufbau' ? 'Aufbau' : 'Abbau (zurück)') + '</button>';
    }).join('') + '</div>' +
    '<div class="mc-sum"><b>' + _mcEsc(sum.text) + '</b></div>' +
    (write ? '' : '<div class="ui-sub">Nur lesen.</div>') +
    '<div class="mc-list">' + body + '</div>';
  if (focus) { var f = document.getElementById(focus); if (f) f.focus(); }
}

function mcSetPhase(p) { if (_mc) { _mc.phase = p; _mcRender(); } }
function mcOpenNote(idx) { if (!_mc) return; _mc.openNote[_mc.items[idx].key] = true; _mcRender(); var f = document.getElementById('mc-note-' + idx); if (f) f.focus(); }

function mcTick(idx) {
  if (!_mc) return;
  var l = _mcLines()[idx];
  if (!l) return;
  // Complete → tap again takes the tick back (position open again, note stays)
  if (l.ist != null && l.fehlt === 0) { _mcWrite(idx, null, l.note); return; }
  if (l.base == null) { var f = document.getElementById('mc-ist-' + idx); if (f) f.focus(); return; }
  _mcWrite(idx, l.base, l.note);
}

function mcSetQty(idx, v) {
  if (!_mc) return;
  var n = Number(v);
  if (v === '' || v == null) { if ((_mcLines()[idx] || {}).ist != null) _mcWrite(idx, null, (_mcLines()[idx] || {}).note || ''); return; } // emptied → open again
  if (!isFinite(n) || n < 0 || n >= 100000) { _mcRender(); return; }
  _mcWrite(idx, n, (_mcLines()[idx] || {}).note || '');
}

function mcNote(idx, v) {
  if (!_mc) return;
  var l = _mcLines()[idx];
  if (!l) return;
  // A note on an untouched position counts it as complete; the Ist can still be corrected
  _mcWrite(idx, l.ist != null ? l.ist : (l.base == null ? 0 : l.base), String(v || '').slice(0, 500));
}

function _mcWrite(idx, qty, note) {
  var it = _mc.items[idx], base = mcBase(it, mcIndexRows(_mc.rows.filter(function(r) { return r.list_key === it.list; })), _mc.phase);
  var row = { list_key: it.list, phase: _mc.phase, item_key: it.key, item_name: it.name.slice(0, 300),
    soll: base, qty: qty, note: note || '', plan_date: _mc.date, plan_keys: _mc.planKeys, changed_at: new Date().toISOString() };
  _mcSaveQueue(mcQueuePut(_mcQueue(), row));
  _mcRender();
  _mcFlush();
}

var _mcFlushing = false;
async function _mcFlush() {
  if (_mcFlushing || typeof supabaseClient === 'undefined') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { _mcRenderStatus(); return; }
  var queue = _mcQueue();
  if (!queue.length) return;
  _mcFlushing = true;
  var again = false;
  var rowId = function(q) { return q.list_key + '|' + q.phase + '|' + q.item_key + '|' + q.changed_at; };
  var permanent = function(e) { return !!e && (e.code === '42501' || e.code === '23514' || e.code === '22P02' || e.code === '23502'); };
  var send = function(rows) { return supabaseClient.from('order_checks').upsert(rows, { onConflict: 'list_key,phase,item_key' }).select('*'); };
  // Only drop what was handled: a tick made while the request ran stays queued
  var drop = function(rows) {
    var gone = {};
    rows.forEach(function(q) { gone[rowId(q)] = true; });
    _mcSaveQueue(_mcQueue().filter(function(q) { return !gone[rowId(q)]; }));
  };
  var take = function(data) {
    if (!_mc) return;
    (data || []).forEach(function(row) {
      _mc.rows = _mc.rows.filter(function(x) { return !(x.list_key === row.list_key && x.phase === row.phase && x.item_key === row.item_key); });
      _mc.rows.push(row);
    });
    _mc.lastSync = new Date();
  };
  try {
    var r = await send(queue);
    if (r.error) throw r.error;
    drop(queue);
    take(r.data);
    again = _mcQueue().length > 0; // a tick made while this request ran
  } catch (e) {
    console.error('Material: senden', e);
    // One row the server refuses for good (no right, bad value) rejects the whole batch and would block the queue
    // forever: send the rows one by one, drop only the refused ones, keep the rest for later
    if (permanent(e)) {
      var refused = 0;
      for (var qi = 0; qi < queue.length; qi++) {
        try {
          var one = await send([queue[qi]]);
          if (one.error) throw one.error;
          drop([queue[qi]]);
          take(one.data);
        } catch (e2) {
          if (permanent(e2)) { drop([queue[qi]]); refused++; } else break; // network trouble: the rest waits
        }
      }
      if (refused && typeof showToast === 'function') showToast('Änderung abgelehnt: keine Berechtigung für diese Liste.', 'error');
    }
  } finally {
    _mcFlushing = false;
    if (_mc) _mcRender();
    if (again) _mcFlush();
  }
}

// Back online: send what waited, then fetch what the others changed meanwhile
async function _mcOnline() {
  await _mcFlush();
  if (!_mc || typeof supabaseClient === 'undefined') return;
  try {
    var r = await supabaseClient.from('order_checks').select('*').in('list_key', _mc.listKeys);
    if (r.error) throw r.error;
    if (_mc) { _mc.rows = r.data || []; _mc.lastSync = new Date(); _mcRender(); }
  } catch (e) { console.error('Material: nachladen', e); }
  if (_mc && !_mc.live && _mc.channel) { try { supabaseClient.removeChannel(_mc.channel); } catch (e) { /* gone */ } _mcSubscribe(); }
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', _mcOnline);
  window.addEventListener('offline', function() { if (_mc) { _mc.live = false; _mcRenderStatus(); } });
}

// For the protocol: shortages of a job (or plan list) and phase, [] when nothing is ticked or the table is missing
async function mcLoadShortages(jobNo, date, eventName, phase) {
  if (typeof supabaseClient === 'undefined') return { items: [], source: '' };
  try {
    var listKey = null, items = [], rows = [];
    if (mcIsJobNo(jobNo)) {
      // the protocol's job and the other rooms of the same Bestätigung ticked for that day (one sheet ticks them together)
      var q = supabaseClient.from('order_checks').select('*').like('list_key', 'job:' + jobNo.split('.')[0] + '.%');
      var r = await (date ? q.or('list_key.eq.' + mcJobKey(jobNo) + ',plan_date.eq.' + date) : q.eq('list_key', mcJobKey(jobNo)));
      if (r.error) throw r.error;
      rows = r.data || [];
      var lists = rows.map(function(x) { return x.list_key; }).filter(function(k, i, a) { return a.indexOf(k) === i; }).sort();
      for (var li = 0; li < lists.length; li++) {
        var ir = await supabaseClient.rpc('order_check_items', { p_job: lists[li].slice(4) });
        if (!ir.error && ir.data) mcJobItems(ir.data).forEach(function(it) { it.list = lists[li]; items.push(it); });
      }
      if (rows.length) listKey = mcJobKey(jobNo);
    }
    if (!rows.length && eventName && date) {
      var s = await _mcPlanShiftFor(date, eventName);
      if (s) {
        var parsed = planShiftFromDb(s), pk = mcPlanKey(s.date, planEventKey(parsed));
        var r2 = await supabaseClient.from('order_checks').select('*').eq('list_key', pk);
        if (r2.error) throw r2.error;
        if ((r2.data || []).length) { rows = r2.data; items = mcPlanItems(planMaterialLines(parsed)).map(function(it) { return Object.assign(it, { list: pk }); }); listKey = pk; }
      }
    }
    if (!rows.length) return { items: [], source: '' };
    var short = mcLinesMulti(items, rows, phase).filter(function(l) { return l.fehlt > 0 || (l.ist != null && l.note.trim()); })
      .map(function(l) { return { name: l.item.name, soll: l.base, ist: l.ist, fehlt: l.fehlt, note: l.note.trim() }; });
    return { items: short, source: listKey.indexOf('job:') === 0 ? 'Auftragsbestätigung ' + jobNo.split('.')[0] : 'Wochenplan' };
  } catch (e) {
    console.error('Material: Fehlmengen laden', e);
    return { items: [], source: '' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mcPhaseOf: mcPhaseOf, mcJobKey: mcJobKey, mcPlanKey: mcPlanKey, mcIsJobNo: mcIsJobNo, mcJobItems: mcJobItems,
    mcPlanItems: mcPlanItems, mcIndexRows: mcIndexRows, mcBase: mcBase, mcLines: mcLines, mcSummary: mcSummary, mcShortages: mcShortages,
    mcShortageText: mcShortageText, mcQueuePut: mcQueuePut, mcWithPending: mcWithPending, mcPickSource: mcPickSource,
    mcJobsForShift: mcJobsForShift, mcLinesMulti: mcLinesMulti, mcJobLabel: mcJobLabel };
}
