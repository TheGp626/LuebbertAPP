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

test('queue cap drops oldest', () => {
  let q = [];
  for (let i = 0; i < 55; i++) q = ctx.errQueuePut(q, { i }, 50);
  assert.equal(q.length, 50);
  assert.equal(q[0].i, 5);
  assert.equal(q[49].i, 54);
});
