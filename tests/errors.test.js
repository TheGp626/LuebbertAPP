// Run from the repo root: node --test tests/errors.test.js
// Test data is fake (Max, Lena, 0170 1234567).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../js/errors.js'), 'utf8');

// Pure functions only: no window, so the runtime part stays idle
let ctx;
beforeEach(() => {
  ctx = vm.createContext({ console });
  vm.runInContext(SRC, ctx, { filename: 'errors.js' });
});

test('scrub: quoted values', () => {
  assert.equal(ctx.scrubText("Name 'Max Muster' nicht gefunden"), 'Name ‹x› nicht gefunden');
  assert.equal(ctx.scrubText('Zeile „Lena Beispiel 08:00“ fehlt'), 'Zeile ‹x› fehlt');
  assert.equal(ctx.scrubText('bad "Max"'), 'bad ‹x›');
});

test('scrub: postgres key and detail', () => {
  assert.equal(ctx.scrubText('duplicate key value violates unique constraint "u" Key (full_name)=(Max Muster) already exists.'),
    'duplicate key value violates unique constraint ‹x› Key (full_name)=(‹x›) already exists.');
  assert.ok(!/Max/.test(ctx.scrubText('DETAIL: Failing row contains (1, Max, 0170 1234567).')));
  assert.ok(!/Lena/.test(ctx.scrubText('null value in column "x"\nDetail: Failing row contains (Lena).')));
});

test('scrub: emails, phones, digit runs, urls', () => {
  assert.equal(ctx.scrubText('mail max@example.com fehlt'), 'mail ‹x› fehlt');
  assert.equal(ctx.scrubText('Tel 0170 1234567'), 'Tel ‹x›');
  assert.equal(ctx.scrubText('Tel +49 170 1234567'), 'Tel ‹x›');
  assert.equal(ctx.scrubText('Auftrag 4711234'), 'Auftrag ‹x›');
  assert.equal(ctx.scrubText('GET https://x.supabase.co/rest/v1/t?id=eq.5&name=Max'), 'GET https://x.supabase.co/rest/v1/t?‹x›');
});

test('scrub: keeps stack line:col and short numbers', () => {
  assert.equal(ctx.scrubText('at save (https://a.b/js/protokoll.js?v=12:1234:56)'), 'at save (https://a.b/js/protokoll.js?‹x›:1234:56)');
  assert.equal(ctx.scrubText('at https://a.b/js/p.js:10234:5'), 'at https://a.b/js/p.js:10234:5');
  assert.equal(ctx.scrubText('HTTP 500'), 'HTTP 500');
});

test('scrub: empty and non-string safe', () => {
  assert.equal(ctx.scrubText(''), '');
  assert.equal(ctx.scrubText(null), '');
  assert.equal(ctx.scrubText(undefined), '');
  assert.equal(ctx.scrubText(42), '42');
});

test('firstStackFrame: first "at" line, or first line for Safari style', () => {
  assert.equal(ctx.firstStackFrame('Error: x\n    at save (https://a.b/js/p.js:10:5)\n    at y'), 'at save (https://a.b/js/p.js:10:5)');
  assert.equal(ctx.firstStackFrame('save@https://a.b/js/p.js:10:5\nglobal code@'), 'save@https://a.b/js/p.js:10:5');
  assert.equal(ctx.firstStackFrame(''), '');
});

test('fingerprint: stable, ignores scrubbed data', () => {
  const st = 'Error\n    at save (https://a.b/js/p.js:10:5)\n    at x (https://a.b/js/q.js:1:1)';
  assert.match(ctx.errorFingerprint("no 'Max'", st), /^[0-9a-f]{16}$/);
  assert.equal(ctx.errorFingerprint("no 'Max'", st), ctx.errorFingerprint("no 'Lena'", st));
  assert.notEqual(ctx.errorFingerprint('a', st), ctx.errorFingerprint('b', st));
  assert.notEqual(ctx.errorFingerprint('a', st), ctx.errorFingerprint('a', st.replace(':10:5', ':11:5')));
});

test('device string', () => {
  assert.equal(ctx.deviceString('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', true), 'iOS 18 Safari, standalone');
  assert.equal(ctx.deviceString('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', false), 'Android 14 Chrome, Tab');
  assert.equal(ctx.deviceString('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0', false), 'Windows Edge, Tab');
  assert.equal(ctx.deviceString('', false), 'unbekannt, Tab');
});

test('noise filter', () => {
  assert.equal(ctx.isNoiseError('Script error.', '', 'https://a.b'), true);
  assert.equal(ctx.isNoiseError('ResizeObserver loop limit exceeded', 'x', 'https://a.b'), true);
  assert.equal(ctx.isNoiseError('x', 'at f (chrome-extension://abc/c.js:1:1)', 'https://a.b'), true);
  assert.equal(ctx.isNoiseError('TypeError: x is undefined', 'at f (https://a.b/js/p.js:1:1)', 'https://a.b'), false);
  assert.equal(ctx.isNoiseError('', '', 'https://a.b'), true);
});

test('network drops are noise in every browser wording, real TypeErrors are not', () => {
  for (const m of ['Failed to fetch', 'TypeError: Failed to fetch', 'StorageUnknownError: Failed to fetch',
    'TypeError: NetworkError when attempting to fetch resource.', 'Load failed', 'TypeError: Load failed', 'Network request failed'])
    assert.equal(ctx.isNoiseError(m, '', 'https://a.b'), true, m);
  assert.equal(ctx.isNoiseError('TypeError: Failed to fetch dynamically imported module x', 'at f (https://a.b/js/p.js:1:1)', 'https://a.b'), false);
  assert.equal(ctx.isNoiseError('nicht gespeichert', 'at f (https://a.b/js/p.js:1:1)', 'https://a.b'), false);
});

test('queue cap drops oldest', () => {
  let q = [];
  for (let i = 0; i < 55; i++) q = ctx.errQueuePut(q, { i }, 50);
  assert.equal(q.length, 50);
  assert.equal(q[0].i, 5);
  assert.equal(q[49].i, 54);
});

// ── Runtime: fake browser around errors.js ──
function browserCtx(extra) {
  const store = {};
  const handlers = {};
  const c = vm.createContext(Object.assign({
    console: { log() {}, warn() {}, error() {} }, // own copy: errors.js wraps it
    setTimeout: () => 0,
    window: { addEventListener: (t, f) => { handlers[t] = f; } },
    navigator: { onLine: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile' },
    location: { origin: 'https://a.b', pathname: '/LuebbertAPP/', hash: '' },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  }, extra || {}));
  vm.runInContext(SRC, c, { filename: 'errors.js' });
  c._store = store; c._handlers = handlers;
  return c;
}
const queueOf = c => JSON.parse(c._store['luebbert-err-queue'] || '[]');

test('reportError queues a scrubbed payload', () => {
  const c = browserCtx();
  c.reportError(new Error("no 'Max'"), { where: 'protokoll.save' });
  const q = queueOf(c);
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'error');
  assert.ok(!/Max/.test(q[0].p.message));
  assert.equal(q[0].p.where, 'protokoll.save');
  assert.equal(q[0].p.source, 'catch');
  assert.match(q[0].p.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(q[0].p.device, 'Android 14 Chrome, Tab');
});

test('session cap 20', () => {
  const c = browserCtx();
  for (let i = 0; i < 25; i++) c.reportError(new Error('e' + i));
  assert.equal(queueOf(c).length, 20);
});

test('same fingerprint once per session', () => {
  const c = browserCtx();
  const e = new Error('same');
  c.reportError(e); c.reportError(e); c.reportError(e);
  assert.equal(queueOf(c).length, 1);
});

test('noise is dropped', () => {
  const c = browserCtx();
  c.reportError({ message: 'Script error.' });
  assert.equal(queueOf(c).length, 0);
});

test('reportError swallows its own failures', () => {
  const c = browserCtx({ supabaseClient: { rpc: () => { throw new Error('boom'); } } });
  c.localStorage.setItem = () => { throw new Error('full'); };
  assert.doesNotThrow(() => c.reportError(new Error('x')));
});

test('flush without supabaseClient keeps queue', async () => {
  const c = browserCtx();
  c.reportError(new Error('early'));
  await c.flushErrorQueue();
  assert.equal(queueOf(c).length, 1);
});

test('flush sends and removes; failed send stays', async () => {
  const calls = [];
  let fail = true;
  const c = browserCtx({ supabaseClient: { rpc: async (n, a) => { calls.push([n, a]); return { error: fail ? { message: 'down' } : null }; } } });
  c.reportError(new Error('one'));
  await c.flushErrorQueue();
  assert.equal(queueOf(c).length, 1);
  fail = false;
  await c.flushErrorQueue();
  assert.equal(queueOf(c).length, 0);
  assert.equal(calls.at(-1)[0], 'log_error');
  assert.equal(calls.at(-1)[1].p.message, 'one');
});

test('flush skipped while offline', async () => {
  const calls = [];
  const c = browserCtx({ supabaseClient: { rpc: async () => { calls.push(1); return { error: null }; } } });
  c.navigator.onLine = false;
  c.reportError(new Error('off'));
  await c.flushErrorQueue();
  assert.equal(calls.length, 0);
  assert.equal(queueOf(c).length, 1);
});

test('breadcrumb ring 20 and in payload', () => {
  const c = browserCtx();
  for (let i = 0; i < 25; i++) c.breadcrumb('nav:' + i);
  c.reportError(new Error('with crumbs'));
  const bc = queueOf(c)[0].p.breadcrumbs;
  assert.equal(bc.length, 20);
  assert.equal(bc[0].a, 'nav:5');
});

test('window error and unhandled rejection are caught and fire onUncaughtError', () => {
  const c = browserCtx();
  let fired = 0;
  c.onUncaughtError(() => { fired++; });
  c._handlers.error({ error: new Error('boom') });
  c._handlers.unhandledrejection({ reason: new Error('rejected') });
  c._handlers.error({ message: 'Script error.' });
  const q = queueOf(c);
  assert.deepEqual(q.map(e => e.p.source), ['window', 'promise']);
  assert.equal(fired, 2);
});

test('recentFingerprints lists errors of the last minutes', () => {
  const c = browserCtx();
  const e = new Error('r1');
  c.reportError(e);
  c.reportError(e);
  assert.equal(c.recentFingerprints(10).length, 1);
  c.reportError(new Error('r2'));
  assert.equal(c.recentFingerprints(10).length, 2);
});

test('app version per build: test copy has its own key', () => {
  const c = browserCtx();
  c._store['luebbert-app-version'] = 'stundenzettel-v231';
  assert.equal(c.getAppVersion(), 'stundenzettel-v231');
  const e = browserCtx({ location: { origin: 'https://a.b', pathname: '/LuebbertAPP/experimental/', hash: '' } });
  e._store['luebbert-app-version'] = 'stundenzettel-v231';
  assert.equal(e.getAppVersion(), '?');
});

test('console.error with an error object is reported, label becomes where', () => {
  const c = browserCtx();
  c.console.error('Plan speichern:', new Error("insert failed for 'Max'"));
  const q = queueOf(c);
  assert.equal(q.length, 1);
  assert.equal(q[0].p.where, 'Plan speichern:');
  assert.ok(!/Max/.test(q[0].p.message));
});

test('console.warn with a Supabase error object is reported; plain logs are not', () => {
  const c = browserCtx();
  c.console.warn('Unter 18:', { message: 'permission denied for table staff_minors', code: '42501' });
  c.console.warn('Protokoll-PDF zu groß für Mail, sende ohne Anhang:', 12345678);
  c.console.error('nur Text');
  c.console.error(null);
  assert.deepEqual(queueOf(c).map(e => e.p.message), ['permission denied for table staff_minors']);
});

test('the original console still gets the call', () => {
  const seen = [];
  const c = browserCtx({ console: { log() {}, warn() {}, error: (...a) => seen.push(a) } });
  const e = new Error('x');
  c.console.error('A:', e);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1], e);
});

test('network failures are not reported, offline or not (phones report "online" on a dead connection)', () => {
  const c = browserCtx();
  c.navigator.onLine = false;
  c.console.error('Week Sync Error:', new TypeError('Failed to fetch'));
  c.reportError(new TypeError('Load failed'));
  assert.equal(queueOf(c).length, 0);
  c.navigator.onLine = true;
  c.console.error('Week Sync Error:', new TypeError('Failed to fetch'));
  c.console.warn('Profilbilder laden:', new TypeError('NetworkError when attempting to fetch resource.'));
  assert.equal(queueOf(c).length, 0);
  c.console.error('Verknüpfung speichern:', new Error('nicht gespeichert'));
  assert.equal(queueOf(c).length, 1);
});

test('review: no regex lookbehind (SyntaxError on iOS Safari < 16.4 would kill errors.js)', () => {
  assert.ok(!/\(\?<[!=]/.test(SRC));
});

test('review: German single low quotes are masked', () => {
  const c = vm.createContext({ console });
  vm.runInContext(SRC, c);
  assert.equal(c.scrubText('Name ‚Lena Beispiel‘ fehlt'), 'Name ‹x› fehlt');
  assert.equal(c.scrubText('Tel 0170 1234567, at p.js:10234:5'), 'Tel ‹x›, at p.js:10234:5');
});

test('review: screen (location.hash) is scrubbed', () => {
  const c = browserCtx({ location: { origin: 'https://a.b', pathname: '/', hash: '#name=Max&tel=01701234567' } });
  assert.ok(!/Max|01701234567/.test(c.errorContextSnapshot().screen));
});

test('e2e: reportError never calls the rpc synchronously (supabase auth lock inside callbacks)', () => {
  let calls = 0;
  const c = browserCtx({ supabaseClient: { rpc: () => { calls++; return Promise.resolve({ error: null }); } } });
  c.reportError(new Error('sync?'));
  assert.equal(calls, 0);
});

test('e2e: a hung rpc times out, so later flushes still send', async () => {
  const timers = [];
  let calls = 0;
  const c = browserCtx({ setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; },
    supabaseClient: { rpc: () => { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve({ error: null }); } } });
  c.reportError(new Error('hang'));
  const p = c.flushErrorQueue();
  timers.filter(t => t[1] === 15000).forEach(t => t[0]());
  await p;
  assert.equal(queueOf(c).length, 1);
  assert.ok(timers.some(t => t[1] === 30000), 'retry scheduled');
  await c.flushErrorQueue();
  assert.equal(queueOf(c).length, 0);
});
