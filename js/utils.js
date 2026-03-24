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
  if (rawMins >= 540) return 45;
  if (rawMins >= 360) return 30;
  return 0;
}

function getMonthKeyFromWeek(weekStart, billingCutoff) {
  var mon = getMondayFromWeekVal(weekStart);
  var fri = new Date(mon.getTime() + 4 * 86400000);

  var m = fri.getMonth();
  var y = fri.getFullYear();
  var dd = fri.getDate();

  if (billingCutoff < 31 && dd > billingCutoff) {
    m++;
    if (m > 11) { m = 0; y++; }
  }

  var months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  return { key: y + '-' + pad(m + 1), label: months[m] + ' ' + y };
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
