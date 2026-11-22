/**
 * Helper & Utility Functions & Constants
 */

var BUCHHALTUNG_EMAIL = 'buchhaltung@peterluebbert.de';
var DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
var DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Can this person act in a role (AL/PL pickers)? Main role, or an additional role of the Personalbogen
// (app_users.role_rates entries like 'AL frei' → first word 'AL')
function userHasRole(user, role) {
  if (!user) return false;
  if (user.role === role) return true;
  return Array.isArray(user.role_rates) && user.role_rates.some(function(r) {
    return r && String(r.role || '').split(' ')[0] === role;
  });
}

// Costs and rates are shown only to PL, Buchhaltung and Admin (also as an additional role)
function canSeeCosts(user) {
  return ['PL', 'Buchhaltung', 'Admin'].some(function (r) { return userHasRole(user, r); });
}

function pad(n) {
  return String(n).padStart(2, '0'); 
}

function fmtDate(d) { 
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1); 
}

function fmtDateFull(d) { 
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear(); 
}

// ISO week of today. Date-only UTC math: the old version counted the time of day
// and returned the following week for most of 2027.
function currentWeekVal() {
  var d = new Date();
  var thu = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  thu.setUTCDate(thu.getUTCDate() + 4 - (thu.getUTCDay() || 7));
  var year = thu.getUTCFullYear();
  var week = Math.ceil(((thu - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return year + '-W' + pad(week);
}

// Today as YYYY-MM-DD in local time (toISOString() is UTC → yesterday's date after midnight in Germany)
function localDateStr(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function getMondayFromWeekVal(val) {
  var parts = val.split('-W');
  var year = parseInt(parts[0]), week = parseInt(parts[1]);
  var jan4 = new Date(year, 0, 4);
  var dow = jan4.getDay() || 7;
  var mon = new Date(jan4);
  mon.setDate(jan4.getDate() - (dow - 1) + (week - 1) * 7);
  return mon;
}

function weekLabelFromVal(val) {
  if (!val) return '';
  var parts = val.split('-W');
  var mon = getMondayFromWeekVal(val);
  var sun = new Date(mon.getTime() + 6 * 86400000);
  return 'KW ' + parseInt(parts[1]) + '  ·  ' + fmtDateFull(mon) + ' – ' + fmtDateFull(sun);
}

function timeToMins(t) {
  if (!t) return null;
  var p = t.split(':'); 
  return parseInt(p[0]) * 60 + parseInt(p[1]);
}

// Break from the shift length (start to end). Adults (ArbZG): over 6 h 30 min, over 9 h 45 min.
// minor = unter 18 (JArbSchG §11: over 4,5 h work 30 min, over 6 h work 60 min) → from the length: over 4:30 h 30, over 6:30 h 60
function autoPause(rawMins, minor) {
  if (minor) return rawMins > 390 ? 60 : rawMins > 270 ? 30 : 0;
  if (rawMins > 540) return 45;
  if (rawMins > 360) return 30;
  return 0;
}

// People under 18 (staff_minors, ended by the 18th birthday on the server). The office learns it for the people it
// loaded (RPC minors_among), the person itself through i_am_minor (window.currentUserIsMinor, mitarbeiter.js).
var minorUserIds = {};
function isMinorUser(id) {
  if (!id) return false;
  if (minorUserIds[id]) return true;
  return typeof window !== 'undefined' && !!window.currentUserIsMinor && typeof currentUser !== 'undefined' && !!currentUser && currentUser.id === id;
}
async function loadMinorIds(ids) {
  if (typeof supabaseClient === 'undefined' || !ids || !ids.length) return;
  try {
    var r = await supabaseClient.rpc('minors_among', { p_ids: ids });
    if (r.error) { console.warn('Unter 18:', r.error); return; }
    var next = {};
    (r.data || []).forEach(function(x) { next[typeof x === 'string' ? x : x.minors_among] = true; });
    minorUserIds = next;
  } catch (e) { /* offline: keep what is known */ }
}

var MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Billing period runs from <cutoff>. of the previous month to <cutoff-1>. of
// the key month (see getBillingPeriodLabel), so a date on or after the cutoff
// day belongs to the NEXT month's period. Cutoff 1 and 31 mean calendar months.
function getBillingKeyForDate(d, billingCutoff) {
  var m = d.getMonth(), y = d.getFullYear();
  if (billingCutoff > 1 && billingCutoff < 31 && d.getDate() >= billingCutoff) {
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return { key: y + '-' + pad(m + 1), label: MONTHS_DE[m] + ' ' + y };
}

function monthLabelFromKey(mKey) {
  var parts = mKey.split('-');
  return MONTHS_DE[parseInt(parts[1]) - 1] + ' ' + parts[0];
}

// Coarse week→period mapping via the week's Friday. Only used as fallback for
// weeks without parseable day dates — day-precise grouping uses getBillingKeyForDate.
function getMonthKeyFromWeek(weekStart, billingCutoff) {
  var mon = getMondayFromWeekVal(weekStart);
  var fri = new Date(mon.getTime() + 4 * 86400000);
  return getBillingKeyForDate(fri, billingCutoff);
}

// Parses a stored day entry back into a Date (Supabase-synced weeks carry
// isoDate, locally saved ones only "dd.mm.yyyy")
function parseDayDate(dd) {
  if (dd.isoDate) return new Date(dd.isoDate + 'T12:00:00');
  var p = (dd.date || '').split('.');
  if (p.length !== 3) return null;
  var d = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]), 12);
  return isNaN(d.getTime()) ? null : d;
}

// Net hours of one shift entry incl. the 3h minimum billing floor
function shiftNetHours(sh) {
  var v = timeToMins(sh.von), b = timeToMins(sh.bis), p = parseInt(sh.pause) || 0;
  if (v === null || b === null) return 0;
  var effB = (b < v) ? b + 1440 : b;
  return effB > v ? Math.max(180, effB - v - p) / 60 : 0;
}

function compressSignature(base64, callback) {
  if (!base64 || base64.length < 30000) return callback(base64);
  var img = new Image();
  img.onload = function () {
    var scale = Math.min(1, 400 / img.width);
    var canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    callback(canvas.toDataURL('image/jpeg', 0.6));
  };
  img.onerror = function () { callback(base64); };
  img.src = base64;
}

// onTap (optional): the toast can be tapped once and stays 6 s (crash hint "Tippen, um es zu melden")
function showToast(msg, type, onTap) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  if (type === 'danger') t.classList.add('toast-danger'); else t.classList.remove('toast-danger');
  var hide = function () { t.classList.remove('show'); t.classList.remove('toast-tap'); t.onclick = null; };
  if (onTap) {
    t.classList.add('toast-tap');
    t.onclick = function () { hide(); onTap(); };
  } else {
    t.classList.remove('toast-tap');
    t.onclick = null;
  }
  t.classList.add('show');
  if (t._toastTimer) clearTimeout(t._toastTimer);
  t._toastTimer = setTimeout(hide, onTap ? 6000 : 2200);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// A value passed as a '...' string argument inside an onclick="..." attribute:
// JS-escape first, then HTML-escape (the browser decodes the entities before parsing the JS)
function jsAttrArg(str) {
  return escapeHtml(String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

function safeNote(text) {
  return escapeHtml(text || 'Keine Angaben').replace(/\n/g, '<br>');
}

function truncatePdf(doc, text, maxWidth) {
  var full = (text || '');
  if (doc.getTextWidth(full) <= maxWidth) return full;
  while (full.length > 1 && doc.getTextWidth(full + '…') > maxWidth) {
    full = full.slice(0, -1);
  }
  return full + '…';
}

// Zenjob/Rockit rating as plain text (jsPDF helvetica can't draw emoji)
function ratingPdfLabel(rating, isStar) {
  if (!rating) return isStar ? 'gut + Stern' : 'keine';
  return (rating === 'up' ? 'gut' : 'schlecht') + (isStar ? ' + Stern' : '');
}

// worker_ratings.rating is NOT NULL → a star on its own is saved as a good rating
function ratingToSave(p) {
  var rating = p.rating || (p.isStar ? 'up' : null);
  if (!rating) return null;
  return { rating: rating, is_star: !!p.isStar };
}

// The DB only stores active categories → for a loaded protocol a missing one means "ausgeblendet"
function fillMissingCategories(cats, config, activeDefault) {
  config.forEach(function(cat) {
    if (!cats[cat.id]) cats[cat.id] = { active: activeDefault, status: 'okay', note: '' };
  });
  return cats;
}

// Ratings are stored by worker name; a Zenjob/Rockit picked from the employee list has no temp name
function ratingKeyForShift(s) {
  return (s.temp_worker_name || (s.app_users && s.app_users.full_name) || '').trim().toLowerCase();
}

// Label + wrapped value for long free text in jsPDF; returns the y below the block (page breaks included)
function pdfWrappedRow(doc, label, text, x, valueX, maxW, y, lineH, pageBottom) {
  doc.setFont('helvetica', 'bold'); doc.text(label, x, y);
  doc.setFont('helvetica', 'normal');
  var lines = doc.splitTextToSize(String(text), maxW);
  for (var i = 0; i < lines.length; i++) {
    if (y > pageBottom) { doc.addPage(); y = 20; }
    doc.text(lines[i], valueX, y);
    y += lineH;
  }
  return y + 1.5;
}

// Describes exactly the days getBillingKeyForDate puts into mKey: the previous
// month's days >= cutoff plus this month's days < cutoff (short months clamp).
function getBillingPeriodLabel(mKey, cutoff) {
  var parts = mKey.split('-'), y = +parts[0], m = +parts[1];
  var prevM = m === 1 ? 12 : m - 1;
  var prevY = m === 1 ? y - 1 : y;
  var daysIn = function (yy, mm) { return new Date(yy, mm, 0).getDate(); }; // mm is 1-based
  var lastDay = daysIn(y, m);
  var thisMonth = '.' + pad(m) + '.' + y;
  if (!(cutoff > 1 && cutoff < 31)) return '01' + thisMonth + ' – ' + pad(lastDay) + thisMonth;
  var start = cutoff <= daysIn(prevY, prevM) ? pad(cutoff) + '.' + pad(prevM) + '.' + prevY : '01' + thisMonth;
  return start + ' – ' + pad(Math.min(cutoff - 1, lastDay)) + thisMonth;
}

// ── EINSÄTZE (AL-Erinnerung) ──
// Compares the folder's saved jobs with the edited form rows.
// Rows without id are new; saved ids missing from the form are removed; changed fields → update.
// Merges the app_user_private embed (object or one-element array) into the row; missing → null
function flattenPrivate(row) {
  const p = Array.isArray(row.app_user_private) ? row.app_user_private[0] : row.app_user_private;
  const out = Object.assign({}, row);
  delete out.app_user_private;
  out.hourly_rate_conni = (p && p.hourly_rate_conni) ?? null;
  // Own limit (form value) and the one that counts: own, else the default for the Art der Anstellung (js/mitarbeiter.js)
  out.income_limit_own = (p && p.income_limit) ?? null;
  out.income_limit = out.income_limit_own ?? (typeof mitDefaultLimit === 'function' ? mitDefaultLimit(row) : null);
  out.email = (p && p.email) ?? null;
  return out;
}

function diffEinsaetze(existing, edited) {
  var FIELDS = ['date', 'action', 'al_id', 'cancelled'];
  // Auftrag tag (job_no/phase) only on rows that have one, so untagged rows keep their old shape
  var pick = function(r) { var o = {}; FIELDS.forEach(function(f) { o[f] = r[f]; }); if (r.job_no) { o.job_no = r.job_no; o.phase = r.phase; } return o; };
  var byId = {};
  existing.forEach(function(e) { byId[e.id] = e; });
  var keep = {};
  var insert = [], update = [];
  edited.forEach(function(r) {
    if (!r.id || !byId[r.id]) { insert.push(pick(r)); return; }
    keep[r.id] = true;
    var old = byId[r.id];
    var changed = FIELDS.some(function(f) { return old[f] !== r[f]; }) || (old.job_no || null) !== (r.job_no || null) || (old.phase || null) !== (r.phase || null);
    if (changed) update.push(Object.assign({ id: r.id }, pick(r)));
  });
  var remove = existing.filter(function(e) { return !keep[e.id]; }).map(function(e) { return e.id; });
  return { insert: insert, update: update, remove: remove };
}

// 'cancelled' | 'done' (protocol exists) | 'future' (after today) | 'open'
function einsatzStatus(einsatz, hasProtocol, todayStr) {
  if (einsatz.cancelled) return 'cancelled';
  if (hasProtocol) return 'done';
  if (einsatz.date > todayStr) return 'future';
  return 'open';
}

// Open jobs of one AL for the banner: folder jobs [{id, date, action, folderName}] plus plan rows
// [{date, venue, action}] (one entry per date, venues joined); a folder job on the same date wins
function mergeOpenJobs(folderJobs, planRows) {
  var out = folderJobs.map(function(e) { return { id: e.id, date: e.date, action: e.action, folderName: e.folderName, source: 'folder' }; });
  var taken = {};
  out.forEach(function(e) { taken[e.date] = true; });
  var byDate = {};
  planRows.forEach(function(r) {
    if (taken[r.date]) return;
    if (!byDate[r.date]) { byDate[r.date] = { id: null, date: r.date, action: r.action, folderName: r.venue || 'Einsatz', source: 'plan' }; out.push(byDate[r.date]); }
    else if (r.venue && byDate[r.date].folderName.split(' / ').indexOf(r.venue) === -1) byDate[r.date].folderName += ' / ' + r.venue;
  });
  return out.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
}

// jsPDF's built-in fonts only hold Western European letters (WinAnsi): "Sieńkowski" would print as garbage.
// Letters outside that set fall back to their base letter (ń → n, ł → l), anything else to "?".
var PDF_EXTRA_CHARS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
var PDF_CHAR_MAP = { 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'ı': 'i', '−': '-', '‐': '-', '‑': '-', '→': '->', '✓': 'x', '≥': '>=', '≤': '<=' };
function pdfText(t) {
  if (typeof t !== 'string') return t;
  var out = '';
  for (var i = 0; i < t.length; i++) {
    var ch = t.charAt(i), code = t.charCodeAt(i);
    if (code <= 0xFF || PDF_EXTRA_CHARS.indexOf(ch) !== -1) { out += ch; continue; }
    if (PDF_CHAR_MAP[ch] != null) { out += PDF_CHAR_MAP[ch]; continue; }
    if (code >= 0x0300 && code <= 0x036F) continue; // a combining mark on its own
    var base = ch.normalize ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : ch;
    out += (base && base !== ch && base.charCodeAt(0) <= 0xFF) ? base : '?';
  }
  return out;
}
// Big libraries load only when a feature needs them, not at app start (about 900 KB less to parse on every open).
// The service worker precaches them (sw.js LAZY_ASSETS), so this is instant and works offline after the first install.
var LIBS = {
  jspdf: { src: 'vendor/jspdf-2.5.1.umd.min.js', ready: function() { return window.jspdf && window.jspdf.jsPDF; } },
  pdfjs: { src: 'vendor/pdfjs-3.11.174/pdf.min.js', ready: function() { return window.pdfjsLib; },
    after: function() { if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-3.11.174/pdf.worker.min.js'; } },
  chart: { src: 'vendor/chart-4.6.1.umd.min.js', ready: function() { return window.Chart; } },
};
var _libLoads = {};
function loadLib(name) {
  var lib = LIBS[name];
  if (!lib) return Promise.reject(new Error('unknown lib ' + name));
  if (lib.ready()) { if (lib.after) lib.after(); return Promise.resolve(lib.ready()); }
  if (_libLoads[name]) return _libLoads[name];
  _libLoads[name] = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = lib.src;
    s.onload = function() {
      if (!lib.ready()) { _libLoads[name] = null; reject(new Error(name + ' did not load')); return; }
      if (lib.after) lib.after();
      resolve(lib.ready());
    };
    s.onerror = function() { _libLoads[name] = null; reject(new Error(name + ' load failed')); };
    document.head.appendChild(s);
  });
  return _libLoads[name];
}
// For buttons: true when the library is there, otherwise a toast and false
async function needLib(name) {
  try { await loadLib(name); return true; }
  catch (e) {
    console.error('loadLib', name, e);
    if (typeof showToast === 'function') showToast('Funktion konnte nicht geladen werden. Prüf deine Verbindung.', 'danger');
    return false;
  }
}

// All rows of a query, page by page: PostgREST answers at most 1000 rows per request and cuts the rest off without an error.
// makeQuery() builds a fresh query each time and must order it by a unique column, so pages neither overlap nor skip rows.
async function sbFetchAll(makeQuery, page) {
  page = page || 1000;
  var all = [];
  for (var from = 0; ; from += page) {
    var r = await makeQuery().range(from, from + page - 1);
    if (r.error) return { data: null, error: r.error };
    all = all.concat(r.data || []);
    if (!r.data || r.data.length < page) return { data: all, error: null };
  }
}

// Every PDF of the app goes through this once after "new jsPDF": text, wrapping and measuring see the same letters
function pdfPatch(doc) {
  var fix = function(v) { return Array.isArray(v) ? v.map(pdfText) : pdfText(v); };
  ['text', 'splitTextToSize', 'getTextWidth'].forEach(function(name) {
    var orig = doc[name];
    if (typeof orig !== 'function') return;
    doc[name] = function() { var a = Array.prototype.slice.call(arguments); a[0] = fix(a[0]); return orig.apply(doc, a); };
  });
  return doc;
}
