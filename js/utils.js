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

function currentWeekVal() {
  var d = new Date();
  var thu = new Date(d); 
  thu.setDate(d.getDate() + (4 - (d.getDay() || 7)));
  var year = thu.getFullYear();
  var jan1 = new Date(year, 0, 1);
  var week = Math.ceil(((thu - jan1) / 86400000 + 1) / 7);
  return year + '-W' + pad(week);
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

function getBillingPeriodLabel(mKey, cutoff) {
  var parts = mKey.split('-'), y = +parts[0], m = +parts[1];
  var prevM = m === 1 ? 12 : m - 1;
  var prevY = m === 1 ? y - 1 : y;
  return pad(cutoff) + '.' + pad(prevM) + '.' + prevY + ' – ' + pad(cutoff - 1) + '.' + pad(m) + '.' + y;
}
