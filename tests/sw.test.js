// Run: node --test tests/sw.test.js
// The service worker's precache list is read from index.html: if it finds nothing, the app only looks offline-ready.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
function loadSw() {
  const listeners = {};
  const ctx = vm.createContext({ self: { registration: { scope: 'https://x.test/app/' }, location: { origin: 'https://x.test' },
    addEventListener: (t, f) => { listeners[t] = f; } }, URL, console });
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), ctx);
  ctx._listeners = listeners;
  return ctx;
}

test('sw: precache list holds every script and stylesheet of index.html plus the lazy libraries', () => {
  const ctx = loadSw();
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const urls = vm.runInContext('assetUrlsOf', ctx)(html);
  const scripts = (html.match(/<script\b[^>]*\bsrc=/gi) || []).length;
  const sheets = (html.match(/<link\b[^>]*rel="stylesheet"/gi) || []).length;
  assert.ok(scripts > 10, 'index.html has its scripts');
  assert.equal(urls.length, scripts + sheets);
  assert.ok(urls.includes('https://x.test/app/js/app.js?v=' + /js\/app\.js\?v=(\d+)/.exec(html)[1]));
  const lazy = vm.runInContext('LAZY_ASSETS', ctx);
  for (const f of lazy) assert.ok(fs.existsSync(path.join(root, f)), f + ' exists');
  for (const f of lazy) assert.ok(!html.includes(f), f + ' is loaded on demand, not by index.html');
});

test('no stray control characters in app code (a "\\b" once became a raw backspace and broke offline)', () => {
  const files = ['sw.js', 'index.html', ...fs.readdirSync(path.join(root, 'js')).map(f => 'js/' + f), ...fs.readdirSync(path.join(root, 'css')).map(f => 'css/' + f)];
  for (const f of files) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(s), f + ' contains a control character');
  }
});

test('sw: answers GET_VERSION with its cache name (Fehlerberichte)', () => {
  const ctx = loadSw();
  const sent = [];
  ctx._listeners.message({ data: { type: 'GET_VERSION' }, source: { postMessage: m => sent.push(m) } });
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'VERSION', version: vm.runInContext('CACHE', ctx) }]);
});
