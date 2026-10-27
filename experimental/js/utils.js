/**
 * Helper & Utility Functions & Constants
 */

var BUCHHALTUNG_EMAIL = 'buchhaltung@peterluebbert.de';
var DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
var DAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

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

function autoPause(rawMins) {
  if (rawMins > 540) return 45;
  if (rawMins > 360) return 30;
  return 0;
}

var MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Billing period runs from <cutoff>. of the previous month to <cutoff-1>. of
// the key month (see getBillingPeriodLabel), so a date on or after the cutoff
// day belongs to the NEXT month's period.
function getBillingKeyForDate(d, billingCutoff) {
  var m = d.getMonth(), y = d.getFullYear();
  if (billingCutoff < 31 && d.getDate() >= billingCutoff) {
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

function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 2200);
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

function getBillingPeriodLabel(mKey, cutoff) {
  var parts = mKey.split('-'), y = +parts[0], m = +parts[1];
  var prevM = m === 1 ? 12 : m - 1;
  var prevY = m === 1 ? y - 1 : y;
  return pad(cutoff) + '.' + pad(prevM) + '.' + prevY + ' – ' + pad(cutoff - 1) + '.' + pad(m) + '.' + y;
}

// ── EINSÄTZE (AL-Erinnerung) ──
// Compares the folder's saved jobs with the edited form rows.
// Rows without id are new; saved ids missing from the form are removed; changed fields → update.
function diffEinsaetze(existing, edited) {
  var FIELDS = ['date', 'action', 'al_id', 'cancelled'];
  var pick = function(r) { var o = {}; FIELDS.forEach(function(f) { o[f] = r[f]; }); return o; };
  var byId = {};
  existing.forEach(function(e) { byId[e.id] = e; });
  var keep = {};
  var insert = [], update = [];
  edited.forEach(function(r) {
    if (!r.id || !byId[r.id]) { insert.push(pick(r)); return; }
    keep[r.id] = true;
    var old = byId[r.id];
    var changed = FIELDS.some(function(f) { return old[f] !== r[f]; });
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
