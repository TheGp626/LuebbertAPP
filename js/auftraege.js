/* Aufträge (Jenni, test build): jobs from the Auftragsbestätigungen in the project folders, with MA needed.
 * PDFs are parsed once (order-parser.js) and the result is stored in order_parsed for everyone;
 * only new files or files parsed by an older ORDER_PARSER_VERSION are downloaded again.
 * MA numbers live in order_staffing (job_no). Admin/PL and „Sieht Bewerbungen“ (moduleAllowedForRole, RLS);
 * Meldungen (order_applications + plan_shift_interest) are decided by Admin + „Sieht Bewerbungen“ only. */

var ORD_DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
var _ordSaved = {};   // job_no → { staff_setup, staff_teardown } as last confirmed by the server
var _ordFiles = [];
var _ordSeq = 0;      // bumped per render; a slower earlier render must not overwrite a newer one
var _ordView = null;  // { jobs, failed } of the last load, re-rendered after a decision
// Applications, manual links, Daniel's entries of the slot days, availability and names (each may stay empty on a load error)
var _ordCtx = { apps: [], interest: [], accepted: {}, links: {}, plan: [], avail: {}, names: {}, users: [] };
var ORD_PHASE = { setup: 'Aufbau', teardown: 'Abbau' };

function ordEsc(s) { return escapeHtml(s == null ? '' : String(s)); }

// Phases a job shares with an earlier job of the same file (orderSharedPhases) are dropped from that job and
// kept as sharedWith {phase: jobNo}, so the Abbau of an Aufbau + Deko + Umbau Bestätigung is staffed once
function ordFoldShared(parsed) {
  var out = {};
  Object.keys(parsed || {}).forEach(function(fid) {
    var p = parsed[fid], shared = orderSharedPhases(p.jobs);
    if (!Object.keys(shared).length) { out[fid] = p; return; }
    out[fid] = Object.assign({}, p, { jobs: p.jobs.map(function(j) {
      var nj = null;
      ['setup', 'teardown'].forEach(function(ph) {
        var to = shared[j.jobNo + '|' + ph];
        if (!to) return;
        nj = nj || Object.assign({}, j, { sharedWith: Object.assign({}, j.sharedWith) });
        nj[ph] = null; nj.sharedWith[ph] = to;
      });
      return nj || j;
    }) });
  });
  return out;
}

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

var ORD_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
var _ordOpen = {}; // jobNo → card expanded (kept across re-renders)

function ordToggle(jobNo) { _ordOpen[jobNo] = !_ordOpen[jobNo]; ordRenderList(); }

function ordName(id) { return _ordCtx.names[id] || 'Unbekannt'; }
function ordInitial(id) { return ordEsc((ordName(id).trim().charAt(0) || '?').toUpperCase()); }

// The slot of a card phase in the shape order-slots.js expects (as order_slots() returns it)
function ordCardSlot(x, phase) {
  var link = _ordCtx.links[x.job.jobNo + '|' + phase];
  return { job_no: x.job.jobNo, phase: phase, title: x.title, name: x.job.name, start_at: (x.job[phase] || {}).start || '',
    link_set: !!link, link_date: link ? link.plan_date : null, link_key: link ? link.plan_key : null };
}

// Everything a phase shows: number, Daniel's linked entry, who counts, applications
function ordPhaseInfo(x, phase) {
  var slot = ordCardSlot(x, phase), att = ordAttachSlots([slot], _ordCtx.plan), ps = null;
  Object.keys(att.bySid).forEach(function(id) { ps = _ordCtx.plan.find(function(p) { return p.id === id; }) || null; });
  return {
    slot: slot, ps: ps, needed: (_ordSaved[x.job.jobNo] || {})['staff_' + phase],
    taken: ordTaken(slot, ps, _ordCtx.apps).concat(((_ordCtx.accepted || {})[x.job.jobNo + '|' + phase] || []))
      .filter(function(id, i, all) { return all.indexOf(id) === i; }),
    // Applications are decided by Admin + „Sieht Bewerbungen“ only; for anyone else RLS returns just their own row
    apps: ordCanDecide() ? _ordCtx.apps.filter(function(a) { return a.job_no === x.job.jobNo && a.phase === phase; }) : []
  };
}

function ordPills(x) {
  var fresh = 0, pills = ['setup', 'teardown'].filter(function(ph) { return x.job[ph]; }).map(function(ph) {
    var i = ordPhaseInfo(x, ph);
    fresh += i.apps.filter(function(a) { return a.status === 'offen'; }).length;
    if (i.needed == null) return '<span class="ord-pill ord-pill-muted">' + ORD_PHASE[ph] + ' – MA eintragen</span>';
    if (!i.needed) return '';
    var cls = i.taken.length >= i.needed ? 'ok' : i.taken.length ? 'warn' : 'danger';
    return '<span class="ord-pill ord-pill-' + cls + '">' + ORD_PHASE[ph] + ' ' + i.taken.length + '/' + i.needed + '</span>';
  }).join('');
  return pills + (fresh ? '<span class="ord-pill ord-pill-new">' + fresh + ' neu</span>' : '');
}

var ORD_ICON = {
  chevron: '<svg class="ord-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  minus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 12h14"/></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  truck: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="1" y="7" width="13" height="10" rx="1"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="6" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>',
  file: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>'
};

function ordCardHtml(x) {
  var j = x.job, open = !!_ordOpen[j.jobNo], first = j.setup || j.event || j.teardown;
  var phase = j.setup ? orderPhaseAction(j, 'setup') : j.event ? 'Veranstaltung' : orderPhaseAction(j, 'teardown');
  var sub = [ordVenueLabel(x.title), j.room, j.jobNo].filter(Boolean).join(' · ');
  var head = '<button type="button" class="ord-head" aria-expanded="' + open + '" onclick="ordToggle(\'' + jsAttrArg(j.jobNo) + '\')">' +
    '<span class="ord-time"><b>' + ordEsc(first && first.start.length > 10 ? first.start.slice(11, 16) : '—') + '</b><span>' + phase + '</span></span>' +
    '<span class="ord-head-main"><span class="ord-title-row"><b class="ord-title">' + ordEsc(j.name) + '</b>' + ORD_ICON.chevron + '</span>' +
      '<span class="ord-sub">' + ordEsc(sub) + '</span><span class="ord-pills">' + ordPills(x) + '</span></span></button>';
  if (!open) return '<div class="ord-card">' + head + '</div>';
  var mats = j.materials || [], count = mats.reduce(function(n, g) { return n + g.items.length; }, 0);
  return '<div class="ord-card ord-card-open">' + head + '<div class="ord-body">' +
    ordSlotHtml(x, 'setup') + ordSlotHtml(x, 'teardown') +
    Object.keys(j.sharedWith || {}).map(function(ph) {
      return '<div class="ui-sub ord-shared">' + ORD_PHASE[ph] + ' zusammen mit Auftrag ' + ordEsc(j.sharedWith[ph]) + '</div>';
    }).join('') +
    '<div class="ord-meta">' + (j.event ? '<span>Veranstaltung: ' + ordEsc(ordRange(j.event)) + '</span>' : '') +
      '<span>AL: ' + (j.lead ? ordEsc(j.lead) : 'offen') + (j.room ? ' · Raum: ' + ordEsc(j.room) : '') + '</span>' +
      (x.folderName ? '<span>Ordner: ' + ordEsc(x.folderName) + '</span>' : '') + '</div>' +
    '<div class="ord-chips">' +
      (count ? '<details class="ord-chip-d"><summary class="ord-chip">Material <b>' + count + '</b></summary><div class="ord-chip-body">' +
        mats.map(function(g) {
          return '<div class="ord-group">' + ordEsc(g.group) + '</div><ul class="ord-items">' +
            g.items.map(function(it) { return '<li><b>' + ordEsc(it.qty) + '×</b> ' + ordEsc(it.name) + '</li>'; }).join('') + '</ul>';
        }).join('') + '</div></details>' : '') +
      (j.notes ? '<details class="ord-chip-d"><summary class="ord-chip">Hinweise</summary><div class="ord-chip-body">' + ordEsc(j.notes).replace(/\n/g, '<br>') + '</div></details>' : '') +
      '<button type="button" class="ord-chip" onclick="ordOpenPdf(\'' + jsAttrArg(x.file.id) + '\')">' + ORD_ICON.file + 'PDF</button>' +
    '</div></div></div>';
}

// Hints for a person on a day: availability („geht nicht“ / „nur im Notfall“) and „schon eingeplant“ on another entry
function ordHints(uid, date, ps) {
  var h = [], lvl = _ordCtx.avail[uid + '|' + date];
  if (lvl === 'nein') h.push('<span class="ord-pill ord-pill-danger">geht nicht</span>');
  else if (lvl === 'notfall') h.push('<span class="ord-pill ord-pill-warn">nur im Notfall</span>');
  if (_ordCtx.plan.some(function(p) { return p.date === date && p !== ps && ordAssignedIds(p, true).indexOf(uid) !== -1; })) h.push('<span class="ord-pill ord-pill-danger">schon eingeplant</span>');
  return h.join('');
}

// One phase: MA stepper, how full it is, link to Daniel's plan, who is on it, applications with hints, accept / reject
function ordSlotHtml(x, phase) {
  if (!x.job[phase]) return '';
  var i = ordPhaseInfo(x, phase), slot = i.slot, ps = i.ps, needed = i.needed, apps = i.apps, date = ordSlotDate(slot);
  var field = 'staff_' + phase, jobArg = jsAttrArg(slot.job_no);
  var stepper = !ordCanEdit() ? '<div class="ord-step ord-step-ro"><output>' + (needed == null ? '–' : needed) + '<small>MA</small></output></div>'
    : '<div class="ord-step" role="group" aria-label="MA für den ' + ORD_PHASE[phase] + '">' +
    '<button type="button" aria-label="Einen MA weniger"' + (needed ? '' : ' disabled') + ' onclick="ordStep(\'' + jobArg + '\', \'' + field + '\', -1)">' + ORD_ICON.minus + '</button>' +
    '<output>' + (needed == null ? '–' : needed) + '<small>MA</small></output>' +
    '<button type="button" aria-label="Einen MA mehr"' + (needed >= 99 ? ' disabled' : '') + ' onclick="ordStep(\'' + jobArg + '\', \'' + field + '\', 1)">' + ORD_ICON.plus + '</button></div>';
  var top = '<div class="ord-slot-top"><div class="ord-slot-name"><b>' + orderPhaseAction(x.job, phase) + '</b><span>' + ordEsc(ordRange(x.job[phase])) + '</span></div>' + stepper + '</div>';
  if (!needed && !apps.length) {
    return '<section class="ord-slot">' + top + '<div class="ord-slot-sub">' + (needed === 0 ? 'Keine MA ausgeschrieben.' : 'Trag ein, wie viele MA ihr braucht.') + '</div></section>';
  }
  var taken = i.taken, daniel = ordAssignedIds(ps), drivers = ordDrivers(ps);
  var extra = apps.filter(function(a) { return a.status === 'angenommen' && daniel.indexOf(a.user_id) === -1; });
  var progress = !needed ? '<div class="ord-slot-sub"><span class="ord-pill ord-pill-muted">nicht mehr ausgeschrieben</span></div>'
    : (function() {
      var pct = Math.min(100, Math.round(taken.length / needed * 100)), d = needed - taken.length;
      var cls = d <= 0 ? 'ok' : taken.length ? 'warn' : 'danger';
      return '<div class="ord-progress"><div class="ord-progress-row"><span><b>' + taken.length + '</b> von ' + needed + ' besetzt</span>' +
        '<span class="ord-tone-' + cls + '">' + (d > 0 ? d + (d === 1 ? ' fehlt' : ' fehlen') : d < 0 ? -d + ' zu viel' : 'voll') + '</span></div>' +
        '<div class="ord-bar"><i class="ord-bar-' + cls + '" style="width:' + pct + '%"></i></div></div>';
    })();
  var dayOptions = _ordCtx.plan.filter(function(p) { return p.date === date; }).map(function(p) {
    return '<option value="' + ordEsc(p.date + '|' + p.key) + '"' + (ps && ps.key === p.key ? ' selected' : '') + '>' + ordEsc((p.venue || '') + ' · ' + (p.title || '')) + '</option>';
  }).join('');
  var link = '<div class="ord-link"><span class="ord-link-text">' + ORD_ICON.link + (ps ? 'Daniels Plan: ' + ordEsc(ps.title || ps.venue || '') : 'Nicht in Daniels Plan') + '</span>' +
    (!ordCanEdit() ? '</div>' : '<details class="ord-link-edit"><summary>ändern</summary><label><span class="sr-only">Verknüpfung mit Daniels Plan</span>' +
    '<select data-job="' + ordEsc(slot.job_no) + '" data-phase="' + phase + '" onchange="ordSetLink(this)">' +
    '<option value="">Eintrag wählen …</option><option value="auto">Automatisch</option><option value="none">Nicht verknüpfen</option>' + dayOptions + '</select></label></details></div>');
  var decide = function(a, status) { return 'ordDecide(\'' + jobArg + '\', \'' + phase + '\', \'' + jsAttrArg(a.user_id) + '\', \'' + status + '\')'; };
  var person = function(id, cls, right) {
    return '<li class="ord-person"><span class="ord-avatar ' + cls + '">' + ordInitial(id) + '</span><span class="ord-person-name">' + ordEsc(ordName(id)) + '</span>' + right + '</li>';
  };
  var people = daniel.map(function(id) { return person(id, '', '<span class="ord-person-note">Daniels Plan</span>'); }).join('') +
    extra.map(function(a) {
      return person(a.user_id, 'ord-avatar-ok', '<span class="ord-person-note ord-tone-ok">angenommen</span><button type="button" class="ord-textbtn" onclick="' + decide(a, 'offen') + '">Zurücknehmen</button>');
    }).join('') +
    drivers.map(function(id) {
      return '<li class="ord-person ord-person-driver"><span class="ord-avatar">' + ORD_ICON.truck + '</span><span class="ord-person-name">' + ordEsc(ordName(id)) + ' · Fahrer</span><span class="ord-person-note">zählt nicht</span></li>';
    }).join('');
  var hint = function(uid) { return ordHints(uid, date, ps); };
  var open = apps.filter(function(a) { return a.status === 'offen'; });
  var rejected = apps.filter(function(a) { return a.status === 'abgelehnt'; });
  var requests = open.map(function(a) {
    return '<li class="ord-req"><div class="ord-req-top"><span class="ord-avatar ord-avatar-new">' + ordInitial(a.user_id) + '</span><b class="ord-person-name">' + ordEsc(ordName(a.user_id)) + '</b>' + hint(a.user_id) + '</div>' +
      '<div class="ord-req-acts"><button type="button" class="ord-accept" onclick="' + decide(a, 'angenommen') + '">' + ORD_ICON.check + 'Annehmen</button>' +
      '<button type="button" class="ord-reject" aria-label="' + ordEsc(ordName(a.user_id)) + ' ablehnen" onclick="' + decide(a, 'abgelehnt') + '">' + ORD_ICON.x + '</button></div></li>';
  }).join('') + rejected.map(function(a) {
    return '<li class="ord-person ord-person-off"><span class="ord-avatar">' + ordInitial(a.user_id) + '</span><span class="ord-person-name">' + ordEsc(ordName(a.user_id)) + ' · abgelehnt</span>' +
      '<button type="button" class="ord-textbtn" onclick="' + decide(a, 'angenommen') + '">Doch annehmen</button></li>';
  }).join('');
  return '<section class="ord-slot">' + top + progress + link +
    (people ? '<ul class="ord-people">' + people + '</ul>' : '') +
    (requests ? '<div class="ord-label">Meldungen' + (open.length ? ' · ' + open.length + ' neu' : '') + '</div><ul class="ord-reqs">' + requests + '</ul>'
      : needed > taken.length && ordCanDecide() ? '<div class="ord-slot-sub">Noch keine Meldungen.</div>' : '') +
    (extra.length ? '<div class="ord-slot-sub">Angenommen über Auftrag: ' + extra.map(function(a) { return ordEsc(ordName(a.user_id)); }).join(', ') + ' – Daniel Bescheid geben, damit er sie einplant.</div>' : '') +
  '</section>';
}

// Stepper: one more / one less MA for a phase, 0–99 (an empty number starts at 0).
// The number changes at once; taps in a row become one save (each tap waiting for the server lost taps).
var ORD_STEP_DELAY = 600;
var _ordStepWait = {}; // job|field → { before: last confirmed number, timer }
function ordStep(jobNo, field, delta) {
  var saved = _ordSaved[jobNo] || (_ordSaved[jobNo] = {}), k = jobNo + '|' + field;
  var cur = saved[field], v = (cur == null ? 0 : cur) + delta;
  if (v < 0 || v > 99 || (cur == null && delta < 0)) return Promise.resolve();
  var w = _ordStepWait[k] || (_ordStepWait[k] = { before: cur });
  clearTimeout(w.timer);
  saved[field] = v;
  ordRenderList();
  return new Promise(function(done) {
    w.timer = setTimeout(async function() {
      delete _ordStepWait[k];
      var row = { job_no: jobNo, updated_at: new Date().toISOString() };
      row[field] = v;
      try {
        var r = await supabaseClient.from('order_staffing').upsert(row, { onConflict: 'job_no' }).select('job_no');
        if (r.error || !r.data || !r.data.length) throw r.error || new Error('nicht gespeichert');
      } catch (err) {
        console.error('MA-Bedarf speichern:', err);
        showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger');
        if (saved[field] === v) { saved[field] = w.before; ordRenderList(); } // newer taps keep their own number
      }
      done();
    }, ORD_STEP_DELAY);
  });
}

// Besetzungsplaner (planer.js): an accepted person goes on the draft row of that phase or entry, anyone else comes off it.
// Runs beside the decision and never blocks or undoes it; without a draft (or the right to edit it) nothing happens.
function ordDraftSync(kind, a, b, userId, status) {
  if (typeof plDraftSync !== 'function') return;
  plDraftSync(kind, a, b, userId, status === 'angenommen', _ordCtx.users).catch(function(e) { console.error('Entwurf nachziehen:', e); });
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
  ordDraftSync('order', jobNo, phase, userId, status);
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
    if (r.error || !r.data || !r.data.length) throw r.error || new Error('nicht gespeichert'); // RLS: 0 rows, no error
    if (link) _ordCtx.links[k] = link; else delete _ordCtx.links[k];
  } catch (err) {
    console.error('Verknüpfung speichern:', err);
    showToast('Verknüpfung nicht gespeichert.', 'danger');
  }
  ordRenderList();
}

function ordDayHead(iso) {
  var p = iso.split('-').map(Number);
  return ORD_DAYS[new Date(p[0], p[1] - 1, p[2]).getDay()] + ' ' + ('0' + p[2]).slice(-2) + '.' + ('0' + p[1]).slice(-2) + '.';
}

// Cards grouped by the day they start (jobs come sorted from ordJobs), files that could not be read at the end
function ordListHtml(view) {
  var html = '', day = '', box = ordCanDecide() ? ordInbox(view.jobs, localDateStr()) : null, fresh = box ? box.open.length : 0;
  view.jobs.forEach(function(x) {
    var d = ordStart(x.job).slice(0, 10);
    if (d && d !== day) { day = d; html += '<div class="ord-day">' + ordDayHead(d) + '</div>'; }
    html += ordCardHtml(x);
  });
  var summary = '<p class="ord-summary">' + view.jobs.length + (view.jobs.length === 1 ? ' kommender Einsatz' : ' kommende Einsätze') +
    (fresh ? ' · ' + fresh + (fresh === 1 ? ' neue Meldung' : ' neue Meldungen') : '') + '</p>';
  return summary + (box ? ordInboxHtml(box, ordAvailable(view.jobs, localDateStr())) : '') + (view.jobs.length ? html : '<div class="wp-empty">Keine kommenden Aufträge in den Projektordnern.</div>') +
    view.failed.map(function(f) {
      return '<div class="ord-failed"><span>Nicht erkannt: ' + ordEsc(f.name) + '</span>' +
        '<button type="button" class="ord-textbtn" onclick="ordOpenPdf(\'' + jsAttrArg(f.id) + '\')">Ansehen</button></div>';
    }).join('');
}

function ordRenderList() {
  var content = document.getElementById('ord-content');
  if (!content || !_ordView) return;
  content.innerHTML = ordListHtml(_ordView);
}

// Context for the phase blocks and the inbox: all upcoming entries of Daniel's plan; a failing part only leaves its hints out
async function ordLoadCtx() {
  var today = localDateStr();
  // An order stays listed until its Abbau, so its Aufbau can already lie in the past: load Daniel's entries 14 days back
  var ordPlanFrom = localDateStr(new Date(Date.now() - 14 * 864e5));
  var res = await Promise.all([
    supabaseClient.from('order_applications').select('job_no, phase, user_id, status'),
    supabaseClient.from('order_plan_links').select('job_no, phase, plan_date, plan_key'),
    supabaseClient.from('plan_shifts').select('id, week_id, date, key, venue, location, title, wann, open_slots, plan_assignments(user_id, name, role)').gte('date', ordPlanFrom),
    supabaseClient.from('availability').select('user_id, day, level').gte('day', today),
    supabaseClient.from('app_users').select('id, full_name, role, is_active, availability_enabled, can_drive'),
    supabaseClient.from('plan_shift_interest').select('week_id, shift_key, user_id, status'),
    supabaseClient.rpc('order_slots') // accepted ids for everyone (security definer)
  ]);
  res.forEach(function(r) { if (r.error) console.warn('Aufträge: Zusatzdaten fehlen:', r.error); });
  var ok = function(r) { return r.error ? [] : (r.data || []); };
  var c = { apps: ok(res[0]), interest: ok(res[5]), accepted: {}, links: {}, plan: ok(res[2]), avail: {}, names: {}, users: ok(res[4]) };
  ok(res[6]).forEach(function(sl) { c.accepted[sl.job_no + '|' + sl.phase] = sl.accepted_ids || []; });
  ok(res[1]).forEach(function(l) { c.links[l.job_no + '|' + l.phase] = { plan_date: l.plan_date, plan_key: l.plan_key }; });
  ok(res[3]).forEach(function(a) { c.avail[a.user_id + '|' + a.day] = a.level; });
  ok(res[4]).forEach(function(u) { c.names[u.id] = u.full_name; });
  return c;
}

// Who sets MA numbers and links to Daniel's plan (RLS on order_staffing / order_plan_links)
function ordCanEdit() { return typeof userRole !== 'undefined' && (userRole === 'Admin' || userRole === 'PL'); }

// Who decides Meldungen (same rule as sees_plan_interest() in the database)
function ordCanDecide() {
  return (typeof userRole !== 'undefined' && userRole === 'Admin') || !!window.currentUserSeesInterest;
}

// Both kinds of Meldungen as one list: open ones, and accepted ones whose person is not in Daniel's plan yet.
// Item: { kind: 'order'|'shift', date, time, title, phase, full, user_id, job_no, phaseKey, week_id, shift_key, ps }
function ordInbox(jobs, today) {
  var open = [], accepted = [];
  var push = function(item, status) {
    if (!item.date || item.date < today) return;
    if (status === 'offen') open.push(item);
    else if (status === 'angenommen' && (!item.ps || ordAssignedIds(item.ps, true).indexOf(item.user_id) === -1)) accepted.push(item);
  };
  _ordCtx.apps.forEach(function(a) {
    var x = (jobs || []).find(function(j) { return j.job.jobNo === a.job_no; });
    if (!x || !x.job[a.phase]) return;
    var start = x.job[a.phase].start || '', info = ordPhaseInfo(x, a.phase);
    push({ kind: 'order', date: start.slice(0, 10), time: start.slice(11, 16), title: [ordVenueLabel(x.title), x.job.name].filter(Boolean).join(' – '),
      phase: ORD_PHASE[a.phase], user_id: a.user_id, job_no: a.job_no, phaseKey: a.phase, ps: info.ps,
      full: info.needed ? info.taken.length + ' von ' + info.needed + ' besetzt' : '' }, a.status);
  });
  (_ordCtx.interest || []).forEach(function(r) {
    var p = _ordCtx.plan.find(function(s) { return s.week_id === r.week_id && s.key === r.shift_key; });
    if (!p) return;
    push({ kind: 'shift', date: p.date, time: '', title: [p.venue, p.title].filter(Boolean).join(' – '),
      phase: String(p.wann || '').split('\n')[0], user_id: r.user_id, week_id: r.week_id, shift_key: r.shift_key, ps: p,
      full: (p.open_slots || []).map(function(o) { return o.count + ' ' + (o.role || 'MA') + (o.count === 1 ? ' fehlt' : ' fehlen'); }).join(', ') }, r.status || 'offen');
  });
  var order = function(a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title); };
  return { open: open.sort(order), accepted: accepted.sort(order) };
}

// Inbox above the Auftrag cards (deciders only): open Meldungen with ✓ / ✕, then accepted ones not in Daniel's plan yet
function ordInboxHtml(box, avail) {
  var call = function(it, status) {
    return it.kind === 'shift'
      ? 'ordDecideShift(\'' + jsAttrArg(it.week_id) + '\', \'' + jsAttrArg(it.shift_key) + '\', \'' + jsAttrArg(it.user_id) + '\', \'' + status + '\')'
      : 'ordDecide(\'' + jsAttrArg(it.job_no) + '\', \'' + it.phaseKey + '\', \'' + jsAttrArg(it.user_id) + '\', \'' + status + '\')';
  };
  var row = function(it, accepted) {
    var what = [ordDay(it.date) + (it.time ? ' ' + it.time : ''), it.title, it.phase, it.full].filter(Boolean).map(ordEsc).join(' · ');
    return '<li class="ord-req"><div class="ord-inbox-what">' + what + '</div>' +
      '<div class="ord-req-top"><span class="ord-avatar ' + (accepted ? 'ord-avatar-ok' : 'ord-avatar-new') + '">' + ordInitial(it.user_id) + '</span>' +
        '<b class="ord-person-name">' + ordEsc(ordName(it.user_id)) + '</b>' + (accepted ? '' : ordHints(it.user_id, it.date, it.ps)) +
        (accepted ? '<button type="button" class="ord-textbtn" onclick="' + call(it, 'offen') + '">Zurücknehmen</button>' : '') + '</div>' +
      (accepted ? '' : '<div class="ord-req-acts"><button type="button" class="ord-accept" onclick="' + call(it, 'angenommen') + '">' + ORD_ICON.check + 'Annehmen</button>' +
        '<button type="button" class="ord-reject" aria-label="' + ordEsc(ordName(it.user_id)) + ' ablehnen" onclick="' + call(it, 'abgelehnt') + '">' + ORD_ICON.x + '</button></div>') +
    '</li>';
  };
  return '<section class="ord-inbox"><div class="ord-label">Meldungen' + (box.open.length ? ' · ' + box.open.length + ' offen' : '') + '</div>' +
    (box.open.length ? '<ul class="ord-reqs">' + box.open.map(function(it) { return row(it, false); }).join('') + '</ul>'
      : '<div class="ord-slot-sub">Keine offenen Meldungen.</div>') +
    (box.accepted.length ? '<div class="ord-label">Angenommen, noch nicht in Daniels Plan</div><ul class="ord-reqs">' +
      box.accepted.map(function(it) { return row(it, true); }).join('') + '</ul>' : '') +
    ((avail || []).length ? '<div class="ord-label">Hätten laut Verfügbarkeit Zeit</div><ul class="ord-reqs">' + avail.map(function(g) {
      var add = function(p) {
        return '<li class="ord-person"><span class="ord-avatar">' + ordInitial(p.user_id) + '</span><span class="ord-person-name">' + ordEsc(ordName(p.user_id)) + '</span>' +
          (p.notfall ? '<span class="ord-pill ord-pill-warn">nur im Notfall</span>' : '') +
          '<button type="button" class="ord-textbtn" onclick="ordAcceptAvailable(\'' + g.kind + '\', \'' + jsAttrArg(g.kind === 'shift' ? g.week_id : g.job_no) + '\', \'' +
            jsAttrArg(g.kind === 'shift' ? g.shift_key : g.phaseKey) + '\', \'' + jsAttrArg(p.user_id) + '\')">Annehmen</button></li>';
      };
      var what = [ordDay(g.date) + (g.time ? ' ' + g.time : ''), g.title, g.phase, g.full].filter(Boolean).map(ordEsc).join(' · ');
      var rest = g.people.slice(5);
      return '<li class="ord-req"><div class="ord-inbox-what">' + what + '</div><ul class="ord-people">' + g.people.slice(0, 5).map(add).join('') + '</ul>' +
        (rest.length ? '<details class="ord-more"><summary class="ord-textbtn">+' + rest.length + ' weitere</summary><ul class="ord-people">' + rest.map(add).join('') + '</ul></details>' : '') + '</li>';
    }).join('') + '</ul>' : '') +
  '</section>';
}

// Same rule as wpSlotFits / public.fits_plan_slot: AL places for AL/PL/Admin, Fahrer places only with „Kann Fahrer“
function ordFitsSlot(role, u) {
  if (role === 'AL') return ['AL', 'PL', 'Admin'].indexOf(u.role) !== -1;
  if (role === 'Fahrer') return !!u.can_drive;
  return true;
}

// „Hätten laut Verfügbarkeit Zeit“: per place that is still free (Daniel's open slots, Auftrag phases below their number),
// unlocked people without „geht nicht“ that day, not on any of Daniel's entries that day, without a Meldung for it.
// Group: { kind, date, time, title, phase, full, week_id, shift_key | job_no, phaseKey, people: [{ user_id, notfall }] }
function ordAvailable(jobs, today) {
  var groups = [], withOrder = {};
  var busy = function(uid, date) { return _ordCtx.plan.some(function(p) { return p.date === date && ordAssignedIds(p, true).indexOf(uid) !== -1; }); };
  var people = function(date, fits, applied) {
    return (_ordCtx.users || []).filter(function(u) {
      return u.availability_enabled && u.is_active !== false && u.role !== 'Gast' && _ordCtx.avail[u.id + '|' + date] !== 'nein' &&
        applied.indexOf(u.id) === -1 && !busy(u.id, date) && fits(u);
    }).map(function(u) { return { user_id: u.id, notfall: _ordCtx.avail[u.id + '|' + date] === 'notfall' }; })
      .sort(function(a, b) { return (a.notfall - b.notfall) || ordName(a.user_id).localeCompare(ordName(b.user_id)); });
  };
  (jobs || []).forEach(function(x) {
    ['setup', 'teardown'].forEach(function(ph) {
      if (!x.job[ph]) return;
      var i = ordPhaseInfo(x, ph), start = x.job[ph].start || '', date = start.slice(0, 10);
      if (i.ps) withOrder[i.ps.id] = true;
      if (!i.needed || i.taken.length >= i.needed || date < today) return;
      var applied = _ordCtx.apps.filter(function(a) { return a.job_no === x.job.jobNo && a.phase === ph; }).map(function(a) { return a.user_id; }).concat(i.taken);
      var list = people(date, function() { return true; }, applied);
      if (list.length) groups.push({ kind: 'order', date: date, time: start.slice(11, 16), title: [ordVenueLabel(x.title), x.job.name].filter(Boolean).join(' – '),
        phase: ORD_PHASE[ph], full: i.taken.length + ' von ' + i.needed + ' besetzt', job_no: x.job.jobNo, phaseKey: ph, people: list });
    });
  });
  _ordCtx.plan.forEach(function(p) {
    if (withOrder[p.id] || p.date < today || !(p.open_slots || []).length) return;
    var applied = (_ordCtx.interest || []).filter(function(r) { return r.week_id === p.week_id && r.shift_key === p.key; }).map(function(r) { return r.user_id; });
    var list = people(p.date, function(u) { return p.open_slots.some(function(o) { return ordFitsSlot(o && o.role, u); }); }, applied);
    if (list.length) groups.push({ kind: 'shift', date: p.date, time: '', title: [p.venue, p.title].filter(Boolean).join(' – '), phase: String(p.wann || '').split('\n')[0],
      full: p.open_slots.map(function(o) { return o.count + ' ' + (o.role || 'MA') + (o.count === 1 ? ' fehlt' : ' fehlen'); }).join(', '),
      week_id: p.week_id, shift_key: p.key, people: list });
  });
  return groups.sort(function(a, b) { return a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title); });
}

// Accept someone straight from „Hätten laut Verfügbarkeit Zeit“: an accepted Meldung on their behalf
async function ordAcceptAvailable(kind, a, b, userId) {
  var row = kind === 'shift' ? { week_id: a, shift_key: b, user_id: userId, status: 'angenommen' }
    : { job_no: a, phase: b, user_id: userId, status: 'angenommen' };
  try {
    var r = await supabaseClient.from(kind === 'shift' ? 'plan_shift_interest' : 'order_applications').insert(row).select('user_id');
    if (r.error || !r.data || !r.data.length) throw r.error || new Error('nicht gespeichert');
  } catch (err) {
    console.error('Direkt annehmen:', err);
    showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger');
    return;
  }
  if (kind === 'shift') _ordCtx.interest.push(row); else _ordCtx.apps.push(row);
  ordDraftSync(kind, a, b, userId, 'angenommen');
  ordRenderList();
}

// Decide a Meldung on a shift of Daniel's plan (plan_shift_interest)
async function ordDecideShift(weekId, key, userId, status) {
  var row = (_ordCtx.interest || []).find(function(x) { return x.week_id === weekId && x.shift_key === key && x.user_id === userId; });
  if (!row) return;
  try {
    var r = await supabaseClient.from('plan_shift_interest').update({ status: status })
      .eq('week_id', weekId).eq('shift_key', key).eq('user_id', userId).select('user_id');
    if (r.error || !r.data || !r.data.length) throw r.error || new Error('nicht gespeichert');
    row.status = status;
  } catch (err) {
    console.error('Meldung entscheiden:', err);
    showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger');
    return;
  }
  ordDraftSync('shift', weekId, key, userId, status);
  ordRenderList();
}

async function initAuftraege() {
  var content = document.getElementById('ord-content'), seq = ++_ordSeq;
  if (!content) return;
  content.innerHTML = '<div class="wp-empty">Lädt…</div>';
  var res = await Promise.all([
    supabaseClient.from('folder_files').select('id, folder_id, name, file_url, file_type, created_at, project_folders(name)').ilike('name', '%auftragsbest%'),
    supabaseClient.from('order_staffing').select('job_no, staff_setup, staff_teardown'),
    supabaseClient.from('order_parsed').select('file_id, parser_version, result'),
    // Einsätze tagged with an Auftrag override its day and AL (folder form)
    supabaseClient.from('einsaetze').select('job_no, phase, date, al_id, cancelled').not('job_no', 'is', null)
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
  if (res[3].error) console.warn('Aufträge: Einsätze fehlen:', res[3].error); // PDF dates and AL then
  var c = await ordLoadCtx();
  if (seq !== _ordSeq) return;
  var jobs = ordJobs(_ordFiles, ordWithEinsaetze(ordFoldShared(out.parsed), res[3].error ? [] : res[3].data, c.names));
  _ordCtx = c;
  _ordView = { jobs: jobs, failed: out.failed };
  ordRenderList();
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
