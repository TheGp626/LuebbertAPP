// Run from the repo root: node --test tests/wochenplan.test.js
// Loads utils.js, ui.js, plan-parser.js and wochenplan.js into one sandbox (as in index.html); only pure helpers are tested.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let ctx;
beforeEach(() => {
  ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {} },
    navigator: { onLine: true },
    setTimeout: () => 0,
  });
  ctx.window = ctx;
  for (const f of ['utils.js', 'ui.js', 'plan-parser.js', 'wochenplan.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  }
});
const plain = v => JSON.parse(JSON.stringify(v));

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

test('wpCalendarUrls: https feed, webcal and Google link', () => {
  const u = plain(ctx.wpCalendarUrls('https://abc.supabase.co', TOKEN));
  const feed = 'abc.supabase.co/functions/v1/calendar-feed?t=' + TOKEN + '.ics';
  assert.equal(u.https, 'https://' + feed);
  assert.equal(u.webcal, 'webcal://' + feed);
  assert.equal(u.google, 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent('webcal://' + feed));
});

test('wpCalendarUrls: no token → null', () => {
  assert.equal(ctx.wpCalendarUrls('https://abc.supabase.co', ''), null);
  assert.equal(ctx.wpCalendarUrls('https://abc.supabase.co', null), null);
});

test('wpIsIos: iPhone, iPad, iPadOS desktop UA; not Android or desktop Mac', () => {
  assert.equal(ctx.wpIsIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5), true);
  assert.equal(ctx.wpIsIos('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)', 'iPad', 5), true);
  assert.equal(ctx.wpIsIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), true);
  assert.equal(ctx.wpIsIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), false);
  assert.equal(ctx.wpIsIos('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5), false);
  assert.equal(ctx.wpIsIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0), false);
  assert.equal(ctx.wpIsIos(undefined, undefined, undefined), false);
});

test('wpCalendarMenuItems: subscribe options only with a token', () => {
  const withToken = plain(ctx.wpCalendarMenuItems(true));
  assert.deepEqual(withToken.map(i => i.action), ['wpSubscribeCalendar', 'wpCopyCalendarLink', 'wpDownloadCalendar', 'wpRenewCalendarToken']);
  assert.equal(withToken[0].label, 'Kalender abonnieren');
  assert.equal(withToken[3].danger, true);
  const without = plain(ctx.wpCalendarMenuItems(false));
  assert.deepEqual(without.map(i => i.action), ['wpDownloadCalendar']);
});
