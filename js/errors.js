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
    .replace(/‚[^‘’'\n]*[‘’']/g, SCRUB_MASK)
    .replace(/‘[^’\n]*’/g, SCRUB_MASK)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, SCRUB_MASK)
    // Phone-like runs, then any other run of 4+ digits; never the line:col of a stack frame
    // (capture group instead of a lookbehind: iOS Safari < 16.4 can't parse lookbehinds)
    .replace(/(^|[^\w:.+])\+?\d[\d \/-]{6,}\d/g, '$1' + SCRUB_MASK)
    .replace(/(^|[^\w:.])\d{4,}/g, '$1' + SCRUB_MASK);
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
  // Connection dropped mid-request (Chrome / Firefox / Safari wording): the phone's network, not a bug in the app
  if (/^(\w*Error: )?(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|Network request failed|The network connection was lost\.?)$/i.test(message)) return true;
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

// ── Runtime (only in a browser) ──

var ERR_QUEUE_KEY = 'luebbert-err-queue';
var ERR_SESSION_MAX = 20;
var _errSent = {}, _errCount = 0, _errInReport = false, _errFlushing = null, _errMemQueue = null;
var _errCrumbs = [], _errRecent = [], _errUncaughtCbs = [];

// Live app and /experimental/ share the origin (and localStorage) but have their own service worker
function _errVersionKey() {
  var p = (typeof location !== 'undefined' && location.pathname) || '';
  return 'luebbert-app-version' + (p.indexOf('/experimental/') !== -1 ? '-exp' : '');
}

function getAppVersion() {
  try { return localStorage.getItem(_errVersionKey()) || '?'; } catch (e) { return '?'; }
}

function _errQueueRead() {
  if (_errMemQueue) return _errMemQueue.slice();
  try { return JSON.parse(localStorage.getItem(ERR_QUEUE_KEY) || '[]'); } catch (e) { return []; }
}

function _errQueueWrite(q) {
  try { localStorage.setItem(ERR_QUEUE_KEY, JSON.stringify(q)); _errMemQueue = null; }
  catch (e) { _errMemQueue = q.slice(); } // storage full or blocked: keep it for this page load
}

function _errEnqueue(kind, p) {
  var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  _errQueueWrite(errQueuePut(_errQueueRead(), { id: id, kind: kind, p: p }, 50));
  // Never call supabase synchronously: inside an auth callback that waits on supabase-js's auth lock forever
  setTimeout(flushErrorQueue, 0);
  return id;
}

// A request that never settles (auth lock, dead connection) must not block sending for the rest of the page load
function _errWithTimeout(promise) {
  return Promise.race([promise, new Promise(function (_, reject) {
    setTimeout(function () { reject(new Error('timeout')); }, 15000);
  })]);
}

function _errStandalone() {
  try {
    return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
  } catch (e) { return false; }
}

function _errScreen() {
  try {
    var page = typeof document !== 'undefined' && document.querySelector && document.querySelector('.page.active');
    return (page && page.id) || ''; // page id only: a URL hash could carry data
  } catch (e) { return ''; }
}

function breadcrumb(name) {
  _errCrumbs.push({ t: new Date().toISOString(), a: String(name).slice(0, 60) });
  if (_errCrumbs.length > 20) _errCrumbs.shift();
}

function errorContextSnapshot() {
  return {
    version: getAppVersion(),
    device: deviceString(typeof navigator !== 'undefined' ? navigator.userAgent : '', _errStandalone()),
    online: typeof navigator === 'undefined' || navigator.onLine !== false,
    standalone: _errStandalone(),
    screen: _errScreen(),
    breadcrumbs: _errCrumbs.slice()
  };
}

function recentFingerprints(minutes) {
  var since = Date.now() - (minutes || 10) * 60000, seen = {}, out = [];
  _errRecent.forEach(function (r) { if (r.t >= since && !seen[r.fp]) { seen[r.fp] = 1; out.push(r.fp); } });
  return out;
}

// For catch blocks: reportError(e, { where: 'protokoll.save' }). Never throws.
// Returns true when the error counts (not noise), even if this session already sent it.
function reportError(err, opts) {
  if (_errInReport) return false;
  _errInReport = true;
  try {
    opts = opts || {};
    var msg = err == null ? '' : typeof err === 'string' ? err : err.message != null ? String(err.message) : String(err);
    var stack = err && err.stack ? String(err.stack) : '';
    if (isNoiseError(msg, stack, typeof location !== 'undefined' ? location.origin : '')) return false;
    // A request failing while the phone is offline is expected, not a bug
    if (typeof navigator !== 'undefined' && navigator.onLine === false && /Failed to fetch|Load failed|NetworkError|network error/i.test(msg)) return false;
    var fp = errorFingerprint(msg, stack);
    _errRecent.push({ fp: fp, t: Date.now() });
    if (_errRecent.length > 50) _errRecent.shift();
    if (_errSent[fp] || _errCount >= ERR_SESSION_MAX) return true;
    _errSent[fp] = 1; _errCount++;
    var ctx = errorContextSnapshot();
    _errEnqueue('error', {
      fingerprint: fp,
      message: scrubText(msg).slice(0, 1000),
      stack: scrubText(stack).slice(0, 4096),
      source: opts.source || 'catch',
      where: opts.where ? scrubText(opts.where).slice(0, 100) : null,
      version: ctx.version,
      device: ctx.device,
      context: { online: ctx.online, standalone: ctx.standalone, screen: ctx.screen },
      breadcrumbs: ctx.breadcrumbs
    });
    return true;
  } catch (e) {
    return false;
  } finally {
    _errInReport = false;
  }
}

function onUncaughtError(cb) { _errUncaughtCbs.push(cb); }

// "Problem melden" (js/problem.js): same queue, sent via report_problem
// Resolves true once this report has left the phone, false if it is still queued after maxMs (it is sent later)
function queueReport(p, maxMs) {
  var id = _errEnqueue('report', p);
  var sent = function () { return !_errQueueRead().some(function (e) { return e.id === id; }); };
  return new Promise(function (resolve) {
    var until = Date.now() + (maxMs || 8000);
    (function check() {
      if (sent()) return resolve(true);
      if (Date.now() >= until) return resolve(false);
      setTimeout(check, 300);
    })();
  });
}

function _errUncaught(err, source) {
  if (!reportError(err, { source: source })) return;
  _errUncaughtCbs.forEach(function (cb) { try { cb(); } catch (e) { /* a broken callback must not loop */ } });
}

// Sends the queue in order, one at a time; stops at the first failure (sent again on the next trigger)
// shortcut: an entry the server always rejects blocks the ones behind it until the cap of 50 drops it; fine for an RPC that only cuts and never rejects (except empty reports, which the form never sends)
function flushErrorQueue() {
  if (_errFlushing) return _errFlushing;
  _errFlushing = (async function () {
    try {
      for (;;) {
        if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        var q = _errQueueRead();
        if (!q.length) return;
        var entry = q[0];
        var res = await _errWithTimeout(supabaseClient.rpc(entry.kind === 'report' ? 'report_problem' : 'log_error', { p: entry.p }));
        // a failed fetch comes back as res.error (not thrown): try again later, else the report waits for the next reload
        if (!res || res.error) { setTimeout(flushErrorQueue, 30000); return; }
        _errQueueWrite(_errQueueRead().filter(function (e) { return e.id !== entry.id; }));
      }
    } catch (e) {
      setTimeout(flushErrorQueue, 30000); // timeout or network: stays queued, try again later
    } finally {
      _errFlushing = null;
    }
  })();
  return _errFlushing;
}

// The app logs failures as console.error/warn('Label:', err) in ~200 places: report those centrally
// (the label becomes "where"). Plain text logs without an error object are not reported.
function _errWrapConsole() {
  ['error', 'warn'].forEach(function (lvl) {
    var orig = console[lvl];
    if (typeof orig !== 'function' || orig._errWrapped) return;
    var wrapped = function () {
      orig.apply(console, arguments);
      try {
        var where = null, err = null;
        for (var i = 0; i < arguments.length; i++) {
          var a = arguments[i];
          if (!err && a && typeof a === 'object' && typeof a.message === 'string') err = a;
          else if (where == null && typeof a === 'string') where = a;
        }
        if (err) reportError(err, { where: where });
      } catch (e) { /* never break logging */ }
    };
    wrapped._errWrapped = true;
    console[lvl] = wrapped;
  });
}

function _errInit() {
  _errWrapConsole();
  window.addEventListener('error', function (e) {
    var err = e && e.error ? e.error
      : { message: e && e.message, stack: e && e.filename ? 'at ' + e.filename + ':' + e.lineno + ':' + e.colno : '' };
    _errUncaught(err, 'window');
  });
  window.addEventListener('unhandledrejection', function (e) { _errUncaught(e && e.reason, 'promise'); });
  window.addEventListener('online', function () { breadcrumb('online'); flushErrorQueue(); });
  window.addEventListener('offline', function () { breadcrumb('offline'); });
  window.addEventListener('load', function () { setTimeout(flushErrorQueue, 3000); });
  // An installed app is mostly resumed, not reloaded: send what is still queued when it comes back
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') flushErrorQueue(); });
  // App version = the service worker's CACHE name (sw.js answers GET_VERSION)
  try {
    var sw = navigator.serviceWorker;
    if (sw) {
      sw.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'VERSION' && e.data.version) {
          try { localStorage.setItem(_errVersionKey(), String(e.data.version).slice(0, 60)); } catch (x) { /* storage full */ }
        }
      });
      sw.ready.then(function (reg) { if (reg.active) reg.active.postMessage({ type: 'GET_VERSION' }); });
    }
  } catch (e) { /* no service worker: version stays '?' */ }
}

if (typeof window !== 'undefined' && window.addEventListener) _errInit();
