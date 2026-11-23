// Admin page tab "Fehler" (/admin, js/admin.js; Admin only, RLS enforces it): automatic error reports (app_errors) and
// "Problem melden" reports (bug_reports). Status per entry: neu → gesehen / behoben / ignoriert.
// A bug marked behoben comes back as neu when a version it was never seen on reports it (log_error RPC).

var FEHLER_STATUS = { neu: 'Neu', gesehen: 'Gesehen', behoben: 'Behoben', ignoriert: 'Ignoriert' };
var _fehler = { list: 'errors', onlyCurrent: false, onlyNew: true, errors: [], reports: [], open: null, loaded: false };

function filterErrors(rows, f) {
  return (rows || []).filter(function (r) {
    if (f.onlyNew && r.status !== 'neu') return false;
    if (f.onlyCurrent && (r.versions || []).indexOf(f.version) === -1) return false;
    return true;
  });
}

// Auto-tidy: an error that was not seen on the current or the previous app version and not for 3 days counts as fixed.
// App versions are the service worker cache names ("stundenzettel-v239"); the test build (exp-<commit>) has no number → never.
// If it shows up again, log_error reopens it as "neu" (a version it was never seen on).
var FEHLER_AUTO_VERSIONS = 2, FEHLER_AUTO_DAYS = 3;
function fehlerVersionNum(v) { var m = /-v(\d+)$/.exec(String(v || '')); return m ? parseInt(m[1], 10) : null; }
function autoResolveCandidates(errors, currentVersion, now) {
  var cur = fehlerVersionNum(currentVersion);
  if (cur === null) return [];
  var cutoff = now.getTime() - FEHLER_AUTO_DAYS * 86400000;
  return (errors || []).filter(function (r) {
    if (r.status !== 'neu' && r.status !== 'gesehen') return false;
    var nums = (r.versions || []).map(fehlerVersionNum).filter(function (n) { return n !== null; });
    if (!nums.length) return false;
    if (Math.max.apply(null, nums) > cur - FEHLER_AUTO_VERSIONS) return false;
    return !!r.last_seen && new Date(r.last_seen).getTime() < cutoff;
  }).map(function (r) { return r.fingerprint; });
}

function errorsBadgeCount(errors, reports) {
  var n = function (l) { return (l || []).filter(function (r) { return r.status === 'neu'; }).length; };
  return n(errors) + n(reports);
}

function _fehlerDate(ts) {
  return ts ? new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}

function _fehlerSetBadge(n) {
  if (typeof adminSetErrorsBadge === 'function') adminSetErrorsBadge(n);
}

// On Admin login: only the two counts, so the badge shows before the tab is opened
async function loadErrorsBadge() {
  try {
    var q = function (t) { return supabaseClient.from(t).select('*', { count: 'exact', head: true }).eq('status', 'neu'); };
    var res = await Promise.all([q('app_errors'), q('bug_reports')]);
    _fehlerSetBadge((res[0].count || 0) + (res[1].count || 0));
  } catch (e) { /* badge is a hint only */ }
}

async function renderErrorsTab() {
  var box = document.getElementById('admin-view-errors');
  if (!box) return;
  if (!_fehler.loaded) box.innerHTML = '<div class="ui-sub">Lade…</div>';
  var res = await Promise.all([
    sbFetchAll(function () { return supabaseClient.from('app_errors').select('*').order('last_seen', { ascending: false }); }),
    sbFetchAll(function () { return supabaseClient.from('bug_reports').select('*').order('created_at', { ascending: false }); })
  ]);
  if (res[0].error || res[1].error) {
    box.innerHTML = '<div class="ui-sub">Fehlerliste konnte nicht geladen werden.</div>';
    return;
  }
  _fehler.errors = res[0].data;
  _fehler.reports = res[1].data;
  _fehler.loaded = true;
  await fehlerAutoResolve();
  _fehlerSetBadge(errorsBadgeCount(_fehler.errors, _fehler.reports));
  drawErrorsTab();
}

async function fehlerAutoResolve() {
  var version = typeof getAppVersion === 'function' ? getAppVersion() : '?';
  var fps = autoResolveCandidates(_fehler.errors, version, new Date());
  if (!fps.length) return;
  var res = await supabaseClient.from('app_errors').update({ status: 'behoben', fixed_in: version }).in('fingerprint', fps).select('fingerprint');
  if (res.error) { console.warn('Fehler automatisch erledigen:', res.error); return; }
  var done = (res.data || []).map(function (r) { return r.fingerprint; });
  _fehler.errors.forEach(function (r) { if (done.indexOf(r.fingerprint) !== -1) { r.status = 'behoben'; r.fixed_in = version; } });
  _fehler.autoResolved = done.length;
}

function _fehlerButtons(kind, key, status) {
  return '<div class="fehler-actions">' + ['gesehen', 'behoben', 'ignoriert'].map(function (s) {
    return '<button type="button" class="ui-btn' + (s === status ? ' ui-btn-primary' : '') + '" data-kind="' + kind + '" data-key="' +
      escapeHtml(key) + '" onclick="fehlerSetStatus(this.dataset.kind, this.dataset.key, \'' + s + '\')">' + FEHLER_STATUS[s] + '</button>';
  }).join('') + '</div>';
}

function _fehlerErrorHtml(r) {
  var open = _fehler.open === r.fingerprint;
  var meta = [r.where_, r.count + '×', r.users_affected + (r.users_affected === 1 ? ' Person' : ' Personen'),
    (r.versions || []).join(', '), 'zuletzt ' + _fehlerDate(r.last_seen), FEHLER_STATUS[r.status] || r.status].filter(Boolean);
  var h = '<div class="ui-card fehler-row' + (r.status === 'neu' ? ' fehler-new' : '') + '">' +
    '<div class="fehler-head" data-fp="' + escapeHtml(r.fingerprint) + '" onclick="fehlerToggleOpen(this.dataset.fp)">' +
    '<div class="fehler-msg">' + escapeHtml(r.message || '(ohne Text)') + '</div>' +
    '<div class="ui-sub">' + escapeHtml(meta.join(' · ')) + '</div></div>';
  if (open) {
    var crumbs = (r.last_breadcrumbs || []).map(function (b) { return (b.t || '').slice(11, 19) + '  ' + b.a; }).join('\n');
    h += '<div class="ui-label">Stack</div><pre class="fehler-pre">' + escapeHtml(r.stack || '–') + '</pre>' +
      '<div class="ui-label">Letzte Aktionen</div><pre class="fehler-pre">' + escapeHtml(crumbs || '–') + '</pre>' +
      '<div class="ui-sub">' + escapeHtml([r.last_device, r.last_role, 'zuerst ' + _fehlerDate(r.first_seen), r.source,
        r.fixed_in ? 'behoben in ' + r.fixed_in : ''].filter(Boolean).join(' · ')) + '</div>' +
      (r.last_context ? '<pre class="fehler-pre">' + escapeHtml(JSON.stringify(r.last_context, null, 2)) + '</pre>' : '') +
      _fehlerButtons('error', r.fingerprint, r.status);
  }
  return h + '</div>';
}

function _fehlerReportHtml(r) {
  var u = r.user_id ? (typeof allUsers !== 'undefined' ? allUsers : []).find(function (x) { return x.id === r.user_id; }) : null;
  var who = r.user_id ? (u && u.full_name) || 'Unbekannt' : 'Nicht angemeldet';
  var links = (r.fingerprints || []).map(function (fp) {
    var e = _fehler.errors.find(function (x) { return x.fingerprint === fp; });
    return '<button type="button" class="ui-chip" data-fp="' + escapeHtml(fp) + '" onclick="fehlerJump(this.dataset.fp)">' +
      escapeHtml(e ? (e.message || fp).slice(0, 40) : fp) + '</button>';
  }).join('');
  return '<div class="ui-card fehler-row' + (r.status === 'neu' ? ' fehler-new' : '') + '">' +
    '<div class="ui-sub">' + escapeHtml([who, r.role, _fehlerDate(r.created_at), FEHLER_STATUS[r.status] || r.status].filter(Boolean).join(' · ')) + '</div>' +
    (r.wanted ? '<div class="ui-label">Wollte</div><div class="fehler-text">' + escapeHtml(r.wanted) + '</div>' : '') +
    (r.happened ? '<div class="ui-label">Passiert</div><div class="fehler-text">' + escapeHtml(r.happened) + '</div>' : '') +
    (links ? '<div class="ui-label">Fehler davor</div><div class="ui-chipbar">' + links + '</div>' : '') +
    (r.context ? '<pre class="fehler-pre">' + escapeHtml(JSON.stringify(r.context, null, 2)) + '</pre>' : '') +
    _fehlerButtons('report', r.id, r.status) + '</div>';
}

function drawErrorsTab() {
  var box = document.getElementById('admin-view-errors');
  if (!box) return;
  var isErr = _fehler.list === 'errors';
  var version = typeof getAppVersion === 'function' ? getAppVersion() : '?';
  var rows = isErr ? filterErrors(_fehler.errors, { onlyCurrent: _fehler.onlyCurrent, onlyNew: _fehler.onlyNew, version: version })
    : _fehler.reports.filter(function (r) { return !_fehler.onlyNew || r.status === 'neu'; });
  var nErr = errorsBadgeCount(_fehler.errors, []), nRep = errorsBadgeCount([], _fehler.reports);
  box.innerHTML =
    '<div class="ui-seg" role="tablist">' +
    '<button type="button" class="' + (isErr ? 'active' : '') + '" onclick="fehlerSetList(\'errors\')">Fehler' + (nErr ? ' (' + nErr + ')' : '') + '</button>' +
    '<button type="button" class="' + (!isErr ? 'active' : '') + '" onclick="fehlerSetList(\'reports\')">Meldungen' + (nRep ? ' (' + nRep + ')' : '') + '</button></div>' +
    '<div class="ui-chipbar fehler-filters">' +
    (isErr ? '<button type="button" class="ui-chip' + (_fehler.onlyCurrent ? ' ui-chip-on' : '') + '" onclick="fehlerToggleFilter(\'onlyCurrent\')">nur aktuelle Version</button>' : '') +
    '<button type="button" class="ui-chip' + (_fehler.onlyNew ? ' ui-chip-on' : '') + '" onclick="fehlerToggleFilter(\'onlyNew\')">nur neue</button></div>' +
    (isErr && _fehler.autoResolved ? '<div class="ui-sub fehler-auto">' + _fehler.autoResolved + (_fehler.autoResolved === 1 ? ' alter Fehler' : ' alte Fehler') +
      ' automatisch auf Behoben gesetzt (seit ' + FEHLER_AUTO_VERSIONS + ' Versionen und ' + FEHLER_AUTO_DAYS + ' Tagen nicht mehr aufgetreten). Kommt einer wieder, steht er wieder auf Neu.</div>' : '') +
    (rows.length ? rows.map(isErr ? _fehlerErrorHtml : _fehlerReportHtml).join('')
      : '<div class="ui-sub fehler-empty">' + (isErr ? 'Keine Fehler.' : 'Keine Meldungen.') + '</div>');
}

function fehlerSetList(l) { _fehler.list = l; drawErrorsTab(); }
function fehlerToggleFilter(k) { _fehler[k] = !_fehler[k]; drawErrorsTab(); }
function fehlerToggleOpen(fp) { _fehler.open = _fehler.open === fp ? null : fp; drawErrorsTab(); }

// From a report's linked error: show it even if filters would hide it
function fehlerJump(fp) {
  _fehler.list = 'errors'; _fehler.onlyNew = false; _fehler.onlyCurrent = false; _fehler.open = fp;
  drawErrorsTab();
}

async function fehlerSetStatus(kind, key, status) {
  var isErr = kind === 'error';
  var patch = { status: status };
  if (isErr && status === 'behoben') patch.fixed_in = typeof getAppVersion === 'function' ? getAppVersion() : null;
  var res = await supabaseClient.from(isErr ? 'app_errors' : 'bug_reports').update(patch).eq(isErr ? 'fingerprint' : 'id', key);
  if (res.error) { showToast('Speichern fehlgeschlagen', 'danger'); return; }
  var list = isErr ? _fehler.errors : _fehler.reports;
  var row = list.find(function (r) { return (isErr ? r.fingerprint : r.id) === key; });
  if (row) Object.assign(row, patch);
  _fehlerSetBadge(errorsBadgeCount(_fehler.errors, _fehler.reports));
  drawErrorsTab();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { filterErrors: filterErrors, errorsBadgeCount: errorsBadgeCount, autoResolveCandidates: autoResolveCandidates, fehlerVersionNum: fehlerVersionNum };
}
