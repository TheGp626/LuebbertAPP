/* Aufträge (Jenni, test build): jobs from the Auftragsbestätigungen in the project folders, with MA needed.
 * PDFs are parsed once (order-parser.js) and the result is stored in order_parsed for everyone;
 * only new files or files parsed by an older ORDER_PARSER_VERSION are downloaded again.
 * MA numbers live in order_staffing (job_no). Admin/PL only (moduleAllowedForRole, RLS). */

var ORD_DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
var _ordSaved = {};   // job_no → { staff_setup, staff_teardown } as last confirmed by the server
var _ordFiles = [];
var _ordSeq = 0;      // bumped per render; a slower earlier render must not overwrite a newer one
var _ordView = null;  // { jobs, failed } of the last load, re-rendered after a decision
// Applications, manual links, Daniel's entries of the slot days, availability and names (each may stay empty on a load error)
var _ordCtx = { apps: [], links: {}, plan: [], avail: {}, names: {} };
var ORD_PHASE = { setup: 'Aufbau', teardown: 'Abbau' };

function ordEsc(s) { return escapeHtml(s == null ? '' : String(s)); }

function ordEndDay(j) {
  var r = j.teardown || j.event || j.setup;
  return ((r && (r.end || r.start)) || '').slice(0, 10);
}
function ordStart(j) { var r = j.setup || j.event || j.teardown; return (r && r.start) || ''; }

// Jobs of all parsed files: one per job number (newest file wins), upcoming only, by start
function ordJobs(files, parsedByFileId) {
  var today = localDateStr(), best = {};
  (files || []).slice().sort(function(a, b) { return String(a.created_at).localeCompare(String(b.created_at)); }).forEach(function(f) {
    var p = parsedByFileId[f.id];
    if (!p) return;
    (p.jobs || []).forEach(function(j) {
      best[j.jobNo] = { job: j, file: f, folderName: (f.project_folders && f.project_folders.name) || '', project: p.project || '', title: p.title || '' };
    });
  });
  return Object.keys(best).map(function(k) { return best[k]; })
    .filter(function(x) { return ordEndDay(x.job) >= today; })
    .sort(function(a, b) { return ordStart(a.job).localeCompare(ordStart(b.job)) || a.job.jobNo.localeCompare(b.job.jobNo); });
}

function ordDay(iso) {
  var p = iso.slice(0, 10).split('-').map(Number);
  return ORD_DOW[new Date(p[0], p[1] - 1, p[2]).getDay()] + ' ' + p[2] + '.' + p[1] + '.';
}
// {start,end} → "Mi 11.11. 09:00–16:00" | "Mo 2.11. 08:00 – Do 5.11. 01:00" | "Do 12.11. 18:00 – Fr 13.11."
function ordRange(r) {
  if (!r) return '—';
  var s = ordDay(r.start) + (r.start.length > 10 ? ' ' + r.start.slice(11) : '');
  if (!r.end) return s;
  if (r.end.slice(0, 10) === r.start.slice(0, 10)) return s + (r.end.length > 10 ? '–' + r.end.slice(11) : '');
  return s + ' – ' + ordDay(r.end) + (r.end.length > 10 ? ' ' + r.end.slice(11) : '');
}

// Stored results first; files without a current one are read (readFile) and stored (saveCache).
// A download error is not stored (next open retries); a PDF without jobs is, so it is not downloaded again.
async function ordResolve(files, cacheRows, readFile, saveCache, onProgress, isStale) {
  var cache = {}, parsed = {}, failed = [], todo = [];
  (cacheRows || []).forEach(function(r) { cache[r.file_id] = r; });
  files.forEach(function(f) {
    var c = cache[f.id];
    if (c && c.parser_version >= ORDER_PARSER_VERSION && c.result) {
      if (c.result.jobs && c.result.jobs.length) parsed[f.id] = c.result; else failed.push(f);
    } else todo.push(f);
  });
  for (var i = 0; i < todo.length; i++) { // one after another: phones run out of memory with several PDFs at once
    var f = todo[i];
    onProgress(i + 1, todo.length);
    var p;
    try { p = await readFile(f); } catch (err) { console.error('Auftrag lesen:', f.name, err); failed.push(f); continue; }
    if (isStale && isStale()) return null;
    if (p.warnings && p.warnings.length) console.warn('Auftrag ' + f.name + ':', p.warnings);
    if (p.jobs && p.jobs.length) parsed[f.id] = p; else failed.push(f);
    try { await saveCache({ file_id: f.id, parser_version: ORDER_PARSER_VERSION, result: p, parsed_at: new Date().toISOString() }); }
    catch (err) { console.warn('Auftrag nicht zwischengespeichert:', f.name, err); }
  }
  return { parsed: parsed, failed: failed };
}

async function ordReadFile(f) {
  var url = await signedProjectFileUrl(f.file_url);
  if (!url) throw new Error('kein Link');
  var resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return orderParse(orderLines(await readPlanPdf(await resp.arrayBuffer(), { textOnly: true })));
}

async function ordSaveCache(row) {
  var r = await supabaseClient.from('order_parsed').upsert(row, { onConflict: 'file_id' }).select('file_id');
  if (r.error) throw r.error;
}

function ordCardHtml(x) {
  var j = x.job, saved = _ordSaved[j.jobNo] || {}, mats = j.materials || [];
  var num = function(field, label) {
    var v = saved[field];
    return '<label class="ui-field ord-num"><span>' + label + '</span><input type="number" min="0" max="99" step="1" inputmode="numeric"' +
      ' data-job="' + ordEsc(j.jobNo) + '" data-field="' + field + '" value="' + (v == null ? '' : v) + '" onchange="ordSaveStaff(this)"></label>';
  };
  var count = mats.reduce(function(n, g) { return n + g.items.length; }, 0);
  return '<div class="ui-card ord">' +
    '<div class="ord-title">' + ordEsc(j.name) + '</div>' +
    '<div class="ord-sub">' + ordEsc([j.jobNo, x.folderName || x.title].filter(Boolean).join(' · ')) + '</div>' +
    (j.room ? '<div class="ord-room">' + ordEsc(j.room) + '</div>' : '') +
    '<dl class="ord-times"><dt>Aufbau</dt><dd>' + ordEsc(ordRange(j.setup)) + '</dd>' +
    '<dt>Veranstaltung</dt><dd>' + ordEsc(ordRange(j.event)) + '</dd>' +
    '<dt>Abbau</dt><dd>' + ordEsc(ordRange(j.teardown)) + '</dd>' +
    '<dt>AL</dt><dd>' + (j.lead ? ordEsc(j.lead) : '<span class="ui-pill ui-pill-warn">offen</span>') + '</dd></dl>' +
    (count ? '<details class="ord-more"><summary>Material (' + count + ' Position' + (count === 1 ? '' : 'en') + ')</summary>' +
      mats.map(function(g) {
        return '<div class="ord-group">' + ordEsc(g.group) + '</div><ul class="ord-items">' +
          g.items.map(function(it) { return '<li><b>' + it.qty + '×</b> ' + ordEsc(it.name) + '</li>'; }).join('') + '</ul>';
      }).join('') + '</details>' : '') +
    (j.notes ? '<details class="ord-more"><summary>Hinweise</summary><div>' + ordEsc(j.notes).replace(/\n/g, '<br>') + '</div></details>' : '') +
    '<div class="ord-foot">' + num('staff_setup', 'MA Aufbau') + num('staff_teardown', 'MA Abbau') +
    '<button type="button" class="ui-btn dash-small-btn" onclick="ordOpenPdf(\'' + jsAttrArg(x.file.id) + '\')">PDF öffnen</button></div>' +
    ordSlotHtml(x, 'setup') + ordSlotHtml(x, 'teardown') +
    '</div>';
}

function ordName(id) { return _ordCtx.names[id] || 'Unbekannt'; }

// The slot of a card phase in the shape order-slots.js expects (as order_slots() returns it)
function ordCardSlot(x, phase) {
  var link = _ordCtx.links[x.job.jobNo + '|' + phase];
  return { job_no: x.job.jobNo, phase: phase, title: x.title, name: x.job.name, start_at: (x.job[phase] || {}).start || '',
    link_set: !!link, link_date: link ? link.plan_date : null, link_key: link ? link.plan_key : null };
}

// One phase with an MA number: link to Daniel's plan, who is on it, applicants with hints, accept / reject
function ordSlotHtml(x, phase) {
  var needed = (_ordSaved[x.job.jobNo] || {})['staff_' + phase];
  if (!needed || !x.job[phase]) return '';
  var slot = ordCardSlot(x, phase), date = ordSlotDate(slot);
  var att = ordAttachSlots([slot], _ordCtx.plan), ps = null;
  Object.keys(att.bySid).forEach(function(id) { ps = _ordCtx.plan.find(function(p) { return p.id === id; }); });
  var taken = ordTaken(slot, ps, _ordCtx.apps), daniel = ordAssignedIds(ps);
  var apps = _ordCtx.apps.filter(function(a) { return a.job_no === slot.job_no && a.phase === phase; });
  var extra = apps.filter(function(a) { return a.status === 'angenommen' && daniel.indexOf(a.user_id) === -1; });
  var dayOptions = _ordCtx.plan.filter(function(p) { return p.date === date; }).map(function(p) {
    var v = p.date + '|' + p.key;
    return '<option value="' + ordEsc(v) + '"' + (ps && ps.key === p.key ? ' selected' : '') + '>' + ordEsc((p.venue || '') + ' · ' + (p.title || '')) + '</option>';
  }).join('');
  var hint = function(uid) {
    var h = [], lvl = _ordCtx.avail[uid + '|' + date];
    if (lvl === 'nein') h.push('<span class="ui-pill ui-pill-danger">geht nicht</span>');
    else if (lvl === 'notfall') h.push('<span class="ui-pill ui-pill-warn">nur im Notfall</span>');
    var busy = _ordCtx.plan.some(function(p) { return p.date === date && p !== ps && ordAssignedIds(p).indexOf(uid) !== -1; });
    if (busy) h.push('<span class="ui-pill ui-pill-warn">schon eingeplant</span>');
    return h.join(' ');
  };
  var btn = function(a, status, label, primary) {
    return '<button type="button" class="ui-btn dash-small-btn' + (primary ? ' ui-btn-primary' : '') + '" onclick="ordDecide(\'' + jsAttrArg(slot.job_no) + '\', \'' + phase +
      '\', \'' + jsAttrArg(a.user_id) + '\', \'' + status + '\')">' + label + '</button>';
  };
  var full = taken.length >= needed;
  return '<div class="ord-slot">' +
    '<div class="ord-slot-head"><b>' + ORD_PHASE[phase] + '</b> · ' + ordEsc(ordRange(x.job[phase])) +
      ' <span class="ui-pill ' + (full ? 'ui-pill-ok' : 'ui-pill-warn') + '">' + taken.length + ' / ' + needed + ' besetzt' + (taken.length > needed ? ' · zu viele' : full ? ' · voll' : '') + '</span></div>' +
    '<div class="ord-slot-link">' + (ps ? 'Daniels Plan: ' + ordEsc(ordDay(ps.date) + ' · ' + (ps.title || ps.venue || '')) : 'Nicht in Daniels Plan') +
      '<label class="ord-slot-pick"><span class="sr-only">Verknüpfung ändern</span><select data-job="' + ordEsc(slot.job_no) + '" data-phase="' + phase + '" onchange="ordSetLink(this)">' +
        '<option value="">Ändern …</option><option value="auto">Automatisch</option><option value="none">Nicht verknüpfen</option>' + dayOptions + '</select></label></div>' +
    (daniel.length ? '<div class="ord-slot-sub">Eingeteilt: ' + daniel.map(function(id) { return ordEsc(ordName(id)); }).join(', ') + '</div>' : '') +
    (apps.length ? '<ul class="ord-apps">' + apps.map(function(a) {
      var st = a.status === 'angenommen' ? '<span class="ui-pill ui-pill-ok">angenommen</span>' : a.status === 'abgelehnt' ? '<span class="ui-pill">abgelehnt</span>' : '';
      var acts = a.status === 'offen' ? btn(a, 'angenommen', 'Annehmen', true) + btn(a, 'abgelehnt', 'Ablehnen')
        : a.status === 'angenommen' ? btn(a, 'offen', 'Zurücknehmen') : btn(a, 'angenommen', 'Annehmen');
      return '<li><span class="ord-app-name">' + ordEsc(ordName(a.user_id)) + ' ' + st + ' ' + hint(a.user_id) + '</span><span class="ord-app-acts">' + acts + '</span></li>';
    }).join('') + '</ul>' : '<div class="ord-slot-sub">Noch keine Meldungen.</div>') +
    (extra.length ? '<div class="ord-slot-sub">Angenommen über Auftrag: ' + extra.map(function(a) { return ordEsc(ordName(a.user_id)); }).join(', ') +
      ' <span class="ui-sub">(in Daniels Plan übertragen)</span></div>' : '') +
  '</div>';
}

async function ordDecide(jobNo, phase, userId, status) {
  var a = _ordCtx.apps.find(function(x) { return x.job_no === jobNo && x.phase === phase && x.user_id === userId; });
  if (!a) return;
  try {
    var r = await supabaseClient.from('order_applications').update({ status: status })
      .eq('job_no', jobNo).eq('phase', phase).eq('user_id', userId).select('job_no');
    if (r.error || !r.data || !r.data.length) throw r.error || new Error('nicht gespeichert');
    a.status = status;
  } catch (err) {
    console.error('Bewerbung entscheiden:', err);
    showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger');
    return;
  }
  ordRenderList();
}

// <select>: 'auto' = automatic match again, 'none' = not in Daniel's plan, 'date|key' = that entry
async function ordSetLink(sel) {
  var job = sel.dataset.job, phase = sel.dataset.phase, v = sel.value, k = job + '|' + phase;
  if (!v) return;
  try {
    var q = supabaseClient.from('order_plan_links'), r, link = null;
    if (v === 'auto') r = await q.delete().eq('job_no', job).eq('phase', phase).select('job_no');
    else {
      var parts = v === 'none' ? [null, null] : v.split('|');
      link = { plan_date: parts[0], plan_key: parts[0] ? parts.slice(1).join('|') : null };
      r = await q.upsert({ job_no: job, phase: phase, plan_date: link.plan_date, plan_key: link.plan_key }, { onConflict: 'job_no,phase' }).select('job_no');
    }
    if (r.error) throw r.error;
    if (link) _ordCtx.links[k] = link; else delete _ordCtx.links[k];
  } catch (err) {
    console.error('Verknüpfung speichern:', err);
    showToast('Verknüpfung nicht gespeichert.', 'danger');
  }
  ordRenderList();
}

function ordRenderList() {
  var content = document.getElementById('ord-content');
  if (!content || !_ordView) return;
  var jobs = _ordView.jobs, failed = _ordView.failed;
  content.innerHTML =
    (jobs.length ? jobs.map(ordCardHtml).join('') : '<div class="wp-empty">Keine kommenden Aufträge in den Projektordnern.</div>') +
    failed.map(function(f) {
      return '<div class="ui-card ord ord-failed"><div class="ord-title">Nicht erkannt</div><div class="ord-sub">' + ordEsc(f.name) + '</div>' +
        '<div class="ord-foot"><button type="button" class="ui-btn dash-small-btn" onclick="ordOpenPdf(\'' + jsAttrArg(f.id) + '\')">PDF öffnen</button></div></div>';
    }).join('');
}

// Context for the phase blocks; a failing part only leaves its hints out
async function ordLoadCtx(jobs) {
  var days = {};
  jobs.forEach(function(x) { ['setup', 'teardown'].forEach(function(ph) { if (x.job[ph]) days[x.job[ph].start.slice(0, 10)] = true; }); });
  days = Object.keys(days);
  var res = await Promise.all([
    supabaseClient.from('order_applications').select('job_no, phase, user_id, status'),
    supabaseClient.from('order_plan_links').select('job_no, phase, plan_date, plan_key'),
    days.length ? supabaseClient.from('plan_shifts').select('id, date, key, venue, location, title, wann, plan_assignments(user_id, name)').in('date', days) : { data: [] },
    days.length ? supabaseClient.from('availability').select('user_id, day, level').in('day', days) : { data: [] },
    supabaseClient.from('app_users').select('id, full_name')
  ]);
  res.forEach(function(r) { if (r.error) console.warn('Aufträge: Zusatzdaten fehlen:', r.error); });
  var ok = function(r) { return r.error ? [] : (r.data || []); };
  var c = { apps: ok(res[0]), links: {}, plan: ok(res[2]), avail: {}, names: {} };
  ok(res[1]).forEach(function(l) { c.links[l.job_no + '|' + l.phase] = { plan_date: l.plan_date, plan_key: l.plan_key }; });
  ok(res[3]).forEach(function(a) { c.avail[a.user_id + '|' + a.day] = a.level; });
  ok(res[4]).forEach(function(u) { c.names[u.id] = u.full_name; });
  return c;
}

async function initAuftraege() {
  var content = document.getElementById('ord-content'), seq = ++_ordSeq;
  if (!content) return;
  content.innerHTML = '<div class="wp-empty">Lädt…</div>';
  var res = await Promise.all([
    supabaseClient.from('folder_files').select('id, folder_id, name, file_url, file_type, created_at, project_folders(name)').ilike('name', '%auftragsbest%'),
    supabaseClient.from('order_staffing').select('job_no, staff_setup, staff_teardown'),
    supabaseClient.from('order_parsed').select('file_id, parser_version, result')
  ]);
  if (seq !== _ordSeq) return;
  var err = res[0].error || res[1].error || res[2].error;
  if (err) {
    console.error('Aufträge laden:', err);
    content.innerHTML = '<div class="wp-empty">Aufträge konnten nicht geladen werden. Prüf deine Verbindung und öffne die Seite erneut.</div>';
    return;
  }
  _ordSaved = {};
  (res[1].data || []).forEach(function(r) { _ordSaved[r.job_no] = { staff_setup: r.staff_setup, staff_teardown: r.staff_teardown }; });
  _ordFiles = (res[0].data || []).filter(function(f) { return orderIsAb(f.name) && /pdf/i.test((f.file_type || '') + f.name); });
  var out = await ordResolve(_ordFiles, res[2].data, ordReadFile, ordSaveCache, function(i, n) {
    content.innerHTML = '<div class="wp-empty">Neuer Auftrag wird gelesen (' + i + ' von ' + n + ') …</div>';
  }, function() { return seq !== _ordSeq; });
  if (!out || seq !== _ordSeq) return;
  var jobs = ordJobs(_ordFiles, out.parsed);
  var c = await ordLoadCtx(jobs);
  if (seq !== _ordSeq) return;
  _ordCtx = c;
  _ordView = { jobs: jobs, failed: out.failed };
  ordRenderList();
}

// Number field changed: empty = not set; 0–99 saved, anything else goes back to the saved value
async function ordSaveStaff(input) {
  var job = input.dataset.job, field = input.dataset.field, raw = String(input.value).trim();
  var saved = _ordSaved[job] || (_ordSaved[job] = {});
  var back = function() { input.value = saved[field] == null ? '' : String(saved[field]); };
  if (input.validity && input.validity.badInput) { back(); return; } // "5-" reads as '' and must not clear the number
  var v = raw === '' ? null : Number(raw);
  if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 99)) { showToast('Bitte eine Zahl von 0 bis 99 eintragen.', 'danger'); back(); return; }
  var row = { job_no: job, updated_at: new Date().toISOString() };
  row[field] = v;
  try {
    var r = await supabaseClient.from('order_staffing').upsert(row, { onConflict: 'job_no' }).select('job_no');
    if (r.error || !r.data || !r.data.length) throw r.error || new Error('nicht gespeichert');
    saved[field] = v;
    ordRenderList();
  } catch (err) {
    console.error('MA-Bedarf speichern:', err);
    showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger');
    back();
  }
}

var _ordOpening = false; // double tap while signing must not open two viewers
// In-app viewer like the Projektordner: window.open after an await is blocked on iOS
async function ordOpenPdf(fileId) {
  var f = _ordFiles.find(function(x) { return x.id === fileId; });
  if (!f || _ordOpening) return;
  _ordOpening = true;
  try {
    var url = await signedProjectFileUrl(f.file_url);
    if (url) openFileViewer(url, f.name, f.file_type || 'application/pdf'); else showToast('PDF konnte nicht geöffnet werden.', 'danger');
  } finally { _ordOpening = false; }
}
