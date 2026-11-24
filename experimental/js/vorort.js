/* ══ "Vor Ort": Aufbauplan and Material abhaken as the two big buttons of a job ══
   On site these are what gets opened most, so they sit right under the job on Heute and on the next job in the
   Wochenplan instead of behind Ordner → Projekt → Plan and the details. The project folder of a plan entry is found
   like the protocol finds its project number (einsaetze around that day, folder name against venue/title), minus the
   words most folder names share (voPickFolder); the plans are its PDFs and pictures without the internal documents (ordnerIsPlan), subfolders included.
   Pure helpers first (node --test), the DOM part below. */

// folders = [{id, parent_id}] → rootId and every folder below it
function voFolderTree(folders, rootId) {
  var ids = [rootId], added = true, guard = 0;
  while (added && guard++ < 10) {
    added = false;
    (folders || []).forEach(function(f) {
      if (f.parent_id && ids.indexOf(f.parent_id) !== -1 && ids.indexOf(f.id) === -1) { ids.push(f.id); added = true; }
    });
  }
  return ids;
}

// Which project folder belongs to a plan entry. Like erPickFolder (erinnerung.js): the folders with an Einsatz around
// that day, scored by words they share with venue, title and place — but words found in 3 or more folder names
// ("Estrel", "Berlin") do not count: checked against the live data, "Estrel · Championsgala" otherwise got the plans
// of "Estrel Siemens Betriebsräte" just because that was the only Estrel folder with an Einsatz that day.
// rows = [{folder_id, folder: {name}}], folders = all folders [{name}] → folder id or '' (none or not unique)
function voWords(t) { return String(t || '').toLowerCase().split(/[^a-zäöüß]+/).filter(function(w) { return w.length >= 3; }); }
function voPickFolder(rows, shift, folders) {
  var df = {};
  (folders || []).forEach(function(f) {
    voWords(f.name).filter(function(w, i, a) { return a.indexOf(w) === i; }).forEach(function(w) { df[w] = (df[w] || 0) + 1; });
  });
  var have = voWords([shift.venue, shift.title].concat(shift.location || []).join(' ')), score = {}, best = 0;
  (rows || []).forEach(function(r) {
    if (!r.folder_id || !r.folder) return;
    var n = voWords(r.folder.name).filter(function(w, i, a) { return a.indexOf(w) === i && (df[w] || 0) < 3 && have.indexOf(w) !== -1; }).length;
    score[r.folder_id] = n;
    if (n > best) best = n;
  });
  var top = Object.keys(score).filter(function(id) { return best > 0 && score[id] === best; });
  return top.length === 1 ? top[0] : '';
}

// Plans first by "Aufbau/Plan/Setup" in the name, then by name
function voSortPlans(files) {
  var rank = function(f) { return /aufbau|setup|plan|grundriss|bestuhlung|skizze/i.test(f.name || '') ? 0 : 1; };
  return (files || []).slice().sort(function(a, b) { return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name), 'de'); });
}

/* ── DOM part ── */

var _voPlans = {}; // shift id → { folder: {id, name} | null, plans: [] } (or a pending promise)

function voEsc(t) { return typeof escapeHtml === 'function' ? escapeHtml(t) : String(t); }

function voBlockHtml(s) {
  if (!s || !s.id) return '';
  var mat = typeof mcHasMaterial === 'function' && mcHasMaterial(s) && mcCanOpen(s);
  var id = voEsc(s.id);
  setTimeout(function() { voFill(s); }, 0);
  return '<div class="vo" id="vo-' + id + '">' +
    '<button type="button" class="vo-tile" id="vo-plan-' + id + '" onclick="event.stopPropagation(); voOpenPlans(\'' + id + '\')" disabled>' +
      '<span class="vo-ico">' + uiIcon('file') + '</span><b>Aufbauplan</b><small>wird gesucht…</small></button>' +
    (mat ? '<button type="button" class="vo-tile" onclick="event.stopPropagation(); openMaterialCheckForShift(\'' + id + '\')">' +
      '<span class="vo-ico">' + uiIcon('check') + '</span><b>Material abhaken</b><small>' + (s._orders && s._orders.length ? 'aus dem Auftrag' : 'aus dem Plan') + '</small></button>' : '') +
  '</div>';
}

async function voFind(s) {
  if (_voPlans[s.id]) return _voPlans[s.id];
  var p = (async function() {
    var out = { folder: null, plans: [] };
    if (typeof supabaseClient === 'undefined') return out;
    var res = await Promise.all([
      supabaseClient.from('einsaetze').select('folder_id, job_no, date, cancelled, folder:project_folders(name)')
        .gte('date', wpAddDays(s.date, -1)).lte('date', s.date),
      supabaseClient.from('project_folders').select('id, parent_id, name')
    ]);
    if (res[0].error) throw res[0].error;
    var rows = (res[0].data || []).filter(function(x) { return !x.cancelled; }), all = res[1].error ? [] : (res[1].data || []);
    var loc = s.location ? String(s.location).split('\n') : [];
    var fid = voPickFolder(rows, { venue: s.venue, title: s.title, location: loc }, all);
    if (!fid) return out;
    var hit = rows.filter(function(x) { return x.folder_id === fid; })[0];
    out.folder = { id: fid, name: hit && hit.folder ? hit.folder.name : '' };
    var ids = voFolderTree(all, fid);
    var files = await supabaseClient.from('folder_files').select('id, name, file_url, file_type, file_size_bytes, folder_id').in('folder_id', ids);
    if (files.error) throw files.error;
    out.plans = voSortPlans((files.data || []).filter(function(x) { return typeof ordnerIsPlan === 'function' && ordnerIsPlan(x); }));
    return out;
  })();
  _voPlans[s.id] = p;
  try { var r = await p; _voPlans[s.id] = r; return r; }
  catch (err) { delete _voPlans[s.id]; throw err; }
}

async function voFill(s) {
  var r;
  try { r = await voFind(s); } catch (e) { console.warn('Aufbauplan suchen:', e); r = null; }
  var btn = document.getElementById('vo-plan-' + s.id);
  if (!btn) return;
  var small = btn.querySelector('small');
  if (!r) { if (small) small.textContent = 'offline – später nochmal'; return; }
  if (!r.plans.length) {
    btn.classList.add('vo-none');
    if (small) small.textContent = r.folder ? 'keiner im Ordner' : 'kein Projektordner';
    return;
  }
  btn.disabled = false;
  if (small) small.textContent = r.plans.length === 1 ? r.plans[0].name.replace(/\.[a-z0-9]+$/i, '') : r.plans.length + ' Pläne';
}

async function voOpenPlans(shiftId) {
  var r = _voPlans[shiftId];
  if (!r || !r.plans || !r.plans.length) return;
  if (r.plans.length === 1) return voOpenPlan(shiftId, 0);
  openUiMenu(r.plans.map(function(f, i) { return { label: f.name.replace(/\.[a-z0-9]+$/i, ''), action: 'voOpenPlan', args: [shiftId, i] }; }));
}

var _voOpening = false;
async function voOpenPlan(shiftId, i) {
  var r = _voPlans[shiftId], f = r && r.plans && r.plans[i];
  if (!f || _voOpening) return;
  _voOpening = true;
  try {
    var url = await signedProjectFileUrl(f.file_url);
    if (!url) { showToast('Plan konnte nicht geöffnet werden.', 'danger'); return; }
    openFileViewer(url, f.name, f.file_type || '', null);
  } finally { _voOpening = false; }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { voFolderTree: voFolderTree, voSortPlans: voSortPlans, voPickFolder: voPickFolder };
}
