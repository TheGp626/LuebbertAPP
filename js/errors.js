// Fehlerberichte: catches errors, scrubs them, queues them offline and sends them via the RPC log_error.
// Loaded before every other script, so it also sees errors during startup and on the PIN screen.
// Nothing personal leaves the phone: scrubText masks quoted values, names in Postgres details, emails,
// phone numbers and long digit runs. Only the user id (server side), role and action names go along.

// ── Pure helpers (tested in tests/errors.test.js) ──

var SCRUB_MASK = '‹x›';

function scrubText(s) {
  if (s == null) return '';
  s = String(s);
  return s
    // Postgres: Key (full_name)=(Max Muster) / DETAIL: Failing row contains (...)
    .replace(/Key \(([^)]*)\)=\(([^)]*)\)/g, 'Key ($1)=(' + SCRUB_MASK + ')')
    .replace(/\b(DETAIL|Detail):[^\n]*/g, '$1: ' + SCRUB_MASK)
    // URL query strings; a stack frame's trailing :line:col stays
    .replace(/(https?:\/\/[^\s?#)]+)\?([^\s)]*)/g, function (m, base, q) {
      var lc = q.match(/(:\d+:\d+)$/);
      return base + '?' + SCRUB_MASK + (lc ? lc[1] : '');
    })
    // Quoted values: '…' (not an apostrophe inside a word), "…", „…“, “…”
    .replace(/(^|[^\w])'[^'\n]*'/g, '$1' + SCRUB_MASK)
    .replace(/"[^"\n]*"/g, SCRUB_MASK)
    .replace(/„[^“”"\n]*[“”"]/g, SCRUB_MASK)
    .replace(/“[^”\n]*”/g, SCRUB_MASK)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, SCRUB_MASK)
    // Phone-like runs, then any other run of 4+ digits; never the line:col of a stack frame
    .replace(/(?<![\w:.+])\+?\d[\d \/-]{6,}\d/g, SCRUB_MASK)
    .replace(/(?<![\w:.])\d{4,}/g, SCRUB_MASK);
}

// First frame of a stack: Chrome/Firefox "at …" line, Safari "fn@url" line
function firstStackFrame(stack) {
  var lines = String(stack || '').split('\n');
  for (var i = 0; i < lines.length; i++) if (/^\s*at\s/.test(lines[i])) return lines[i].trim();
  for (var j = 0; j < lines.length; j++) if (lines[j].indexOf('@') !== -1) return lines[j].trim();
  return '';
}

function _hash32(str, fnv) {
  var h = fnv ? 0x811c9dc5 : 5381;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h = fnv ? Math.imul(h ^ c, 0x01000193) : (Math.imul(h, 33) + c) | 0;
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

// One bug = scrubbed message + first frame (no app version, so a release doesn't make every bug new)
function errorFingerprint(message, stack) {
  var s = scrubText(message) + '|' + scrubText(firstStackFrame(stack));
  return _hash32(s, true) + _hash32(s, false);
}

function deviceString(ua, standalone) {
  ua = String(ua || '');
  var os = '', m;
  if ((m = ua.match(/(?:iPhone|CPU) OS (\d+)/))) os = 'iOS ' + m[1];
  else if ((m = ua.match(/Android (\d+)/))) os = 'Android ' + m[1];
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  var br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  var dev = (os + ' ' + br).trim() || 'unbekannt';
  return (dev + (standalone ? ', standalone' : ', Tab')).slice(0, 120);
}

// Errors that are not ours or say nothing
function isNoiseError(message, stack, origin) {
  message = String(message || ''); stack = String(stack || '');
  if (!message && !stack) return true;
  if (/^Script error\.?$/.test(message)) return true;
  if (/ResizeObserver loop/.test(message)) return true;
  if (/(chrome|moz|safari|safari-web)-extension:\/\//.test(stack)) return true;
  var urls = stack.match(/https?:\/\/[^\s)]+/g);
  if (urls && origin && !urls.some(function (u) { return u.indexOf(origin) === 0; })) return true;
  return false;
}

function errQueuePut(queue, entry, cap) {
  cap = cap || 50;
  var q = (queue || []).concat([entry]);
  return q.length > cap ? q.slice(q.length - cap) : q;
}
