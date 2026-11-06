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
  for (const f of ['utils.js', 'ui.js', 'plan-parser.js', 'order-slots.js', 'wochenplan.js']) {
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

test('wpWannRest: a note line before the timed line stays in the details, the timed line is not repeated', () => {
  assert.deepEqual(plain(ctx.wpWannRest({ wann: 'Material vor Ort!!\nAufbau: 8 Uhr' })), ['Material vor Ort!!']);
  assert.deepEqual(plain(ctx.wpWannRest({ wann: 'Aufbau: 8 Uhr\nAbbau: 0.30 Uhr' })), ['Abbau: 0.30 Uhr']);
  assert.deepEqual(plain(ctx.wpWannRest({ wann: 'tagsüber\nTeam folgt' })), ['Team folgt']);
  assert.deepEqual(plain(ctx.wpWannRest({ wann: null })), []);
});

test('wpRenewCalendarToken: calls rpc renew_calendar_token and uses the returned uuid', async () => {
  const calls = [];
  ctx.supabaseClient = { rpc: async fn => { calls.push(fn); return { data: TOKEN, error: null }; } };
  ctx.currentUser = { id: 'u1' };
  ctx.confirm = () => true;
  ctx.showToast = () => {};
  await ctx.wpRenewCalendarToken();
  assert.deepEqual(calls, ['renew_calendar_token']);
  assert.equal(plain(vm.runInContext('_wpCalToken', ctx)).token, TOKEN);
});

test('wpRenewCalendarToken: rpc error keeps the old token', async () => {
  ctx.supabaseClient = { rpc: async () => ({ data: null, error: { message: 'x' } }) };
  ctx.currentUser = { id: 'u1' };
  ctx.confirm = () => true;
  ctx.showToast = () => {};
  await ctx.wpRenewCalendarToken();
  assert.equal(vm.runInContext('_wpCalToken', ctx), null);
});

test('wpCanApply: open slots, future, not assigned, interest loaded', () => {
  const s = { date: '2030-01-02', open_slots: [1], plan_assignments: [{ user_id: 'b' }], _interest: [] };
  assert.equal(ctx.wpCanApply(s, 'a', '2030-01-01'), true);
  assert.equal(ctx.wpCanApply(s, 'a', '2030-01-02'), true);
  assert.equal(ctx.wpCanApply({ ...s, plan_assignments: [{ user_id: 'a' }] }, 'a', '2030-01-01'), false);
  assert.equal(ctx.wpCanApply({ ...s, open_slots: [] }, 'a', '2030-01-01'), false);
  assert.equal(ctx.wpCanApply(s, 'a', '2030-01-03'), false);
  assert.equal(ctx.wpCanApply({ ...s, _interest: null }, 'a', '2030-01-01'), false);
  assert.equal(ctx.wpCanApply(s, null, '2030-01-01'), false);
});

test('wpSlotFits: AL slot for AL/PL/Admin, Fahrer slot only with can_drive, everything else for all', () => {
  assert.equal(ctx.wpSlotFits('Fahrer', { role: 'MA', canDrive: false }), false);
  assert.equal(ctx.wpSlotFits('Fahrer', { role: 'MA', canDrive: true }), true);
  assert.equal(ctx.wpSlotFits('Fahrer', { role: 'Admin', canDrive: false }), false);
  assert.equal(ctx.wpSlotFits('AL', { role: 'MA', canDrive: true }), false);
  ['AL', 'PL', 'Admin'].forEach(r => assert.equal(ctx.wpSlotFits('AL', { role: r }), true));
  ['MA', 'Zenjob', 'ROCKiT', undefined].forEach(r => assert.equal(ctx.wpSlotFits(r, { role: 'MA' }), true));
});

test('wpCanApply: only when one open slot fits the person', () => {
  const s = { date: '2030-01-02', open_slots: [{ role: 'Fahrer', count: 1 }], plan_assignments: [], _interest: [] };
  assert.equal(ctx.wpCanApply(s, 'a', '2030-01-01', { role: 'MA', canDrive: false }), false);
  assert.equal(ctx.wpCanApply(s, 'a', '2030-01-01', { role: 'MA', canDrive: true }), true);
  assert.equal(ctx.wpCanApply({ ...s, open_slots: [{ role: 'Fahrer', count: 1 }, { role: 'MA', count: 2 }] }, 'a', '2030-01-01', { role: 'MA' }), true);
  assert.equal(ctx.wpCanApply({ ...s, open_slots: [{ role: 'AL', count: 1 }] }, 'a', '2030-01-01', { role: 'MA' }), false);
  assert.equal(ctx.wpCanApply({ ...s, open_slots: [{ role: 'AL', count: 1 }] }, 'a', '2030-01-01', { role: 'AL' }), true);
});

test('wpInterested: drops assigned users; [] when not loaded', () => {
  assert.deepEqual(plain(ctx.wpInterested({ plan_assignments: [{ user_id: 'a' }], _interest: ['a', 'b'] })), ['b']);
  assert.deepEqual(plain(ctx.wpInterested({ plan_assignments: [] })), []);
});

test('wochenplan.js: no top-level function is defined twice (the later one silently wins)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'wochenplan.js'), 'utf8');
  const names = [...src.matchAll(/^(?:async )?function (\w+)/gm)].map(m => m[1]);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

test('wpSeesInterest: only with the per-user switch (PL/Admin role check needs auth.js, not loaded here)', () => {
  ctx.currentUserSeesInterest = false;
  assert.equal(ctx.wpSeesInterest(), false);
  ctx.currentUserSeesInterest = true;
  assert.equal(ctx.wpSeesInterest(), true);
  ctx.currentUserSeesInterest = false;
});

// ── Verfügbarkeit ──
test('wpAvailNext cycles verfügbar → notfall → nein → verfügbar', () => {
  assert.equal(ctx.wpAvailNext(''), 'notfall');
  assert.equal(ctx.wpAvailNext('notfall'), 'nein');
  assert.equal(ctx.wpAvailNext('nein'), '');
});

test('wpAvailWeeks: starts Monday, crosses the year (KW 53/1)', () => {
  const w = plain(ctx.wpAvailWeeks('2026-12-30', 2));
  assert.equal(w[0].monday, '2026-12-28');
  assert.equal(w[0].days[6], '2027-01-03');
  assert.equal(w[0].kw, 53);
  assert.equal(w[1].monday, '2027-01-04');
  assert.equal(w[1].kw, 1);
  assert.equal(plain(ctx.wpAvailWeeks('2026-11-08', 1))[0].monday, '2026-11-02'); // Sunday as today
  assert.equal(plain(ctx.wpAvailWeeks('2026-11-06', 8)).length, 8);
});

test('wpCanSetAvail: flag or forAll, never Gast', () => {
  assert.equal(ctx.wpCanSetAvail({ role: 'MA', availability_enabled: true }, false), true);
  assert.equal(ctx.wpCanSetAvail({ role: 'MA' }, false), false);
  assert.equal(ctx.wpCanSetAvail({ role: 'MA' }, true), true);
  assert.equal(ctx.wpCanSetAvail({ role: 'Gast', availability_enabled: true }, true), false);
  assert.equal(ctx.wpCanSetAvail(null, true), false);
});

test('wpAvailGrid: one row per person, cells Mo–So, sorted by name', () => {
  const g = plain(ctx.wpAvailGrid([{ id: 'b', full_name: 'Mo' }, { id: 'a', full_name: 'Kacper' }],
    [{ user_id: 'b', day: '2026-11-04', level: 'nein' }, { user_id: 'a', day: '2026-11-09', level: 'notfall' }], '2026-11-02'));
  assert.deepEqual(g.map(r => r.name), ['Kacper', 'Mo']);
  assert.deepEqual(g[1].cells, ['', '', 'nein', '', '', '', '']);
  assert.deepEqual(g[0].cells, ['', '', '', '', '', '', '']);
});

// Fake client for availability writes: records calls, answers in the order the test releases them
function availClient(opts) {
  const calls = [], pending = [];
  const from = () => {
    const q = { filters: [] };
    const b = {
      upsert(row, o) { q.op = 'upsert'; q.row = row; q.onConflict = o && o.onConflict; return b; },
      delete() { q.op = 'delete'; return b; },
      eq(k, v) { q.filters.push([k, v]); return b; },
      select() {
        calls.push(q);
        return new Promise(res => {
          const answer = () => res(opts && opts.fail ? { data: null, error: { message: 'x' } } : { data: [{ day: 'd' }], error: null });
          if (opts && opts.manual) pending.push(answer); else answer();
        });
      },
    };
    return b;
  };
  return { calls, pending, from };
}

test('wpAvailMode: own calendar for unlocked people, grid for planners', () => {
  ctx.userRole = 'MA'; ctx.currentUserAvailability = true; ctx.currentUserSeesInterest = false;
  assert.deepEqual(plain(ctx.wpAvailMode()), { own: true, grid: false });
  ctx.currentUserAvailability = false; ctx.currentUserSeesInterest = true;
  assert.deepEqual(plain(ctx.wpAvailMode()), { own: false, grid: true });
  ctx.userRole = 'Gast'; ctx.currentUserAvailability = true; ctx.currentUserSeesInterest = false;
  assert.deepEqual(plain(ctx.wpAvailMode()), { own: false, grid: false });
});

test('wpToggleAvail: verfügbar → upsert notfall; nein → delete; past day → no request', async () => {
  const sb = availClient(); ctx.supabaseClient = sb; ctx.currentUser = { id: 'me' }; ctx.showToast = () => {};
  stubToday('2026-11-06');
  await ctx.wpToggleAvail('2026-11-10');
  assert.equal(sb.calls[0].op, 'upsert');
  assert.deepEqual(plain(sb.calls[0].row).level, 'notfall');
  assert.equal(sb.calls[0].row.user_id, 'me');
  assert.equal(sb.calls[0].onConflict, 'user_id,day');
  vm.runInContext('wpAvailRows["2026-11-11"] = "nein"', ctx);
  await ctx.wpToggleAvail('2026-11-11');
  assert.equal(sb.calls[1].op, 'delete');
  assert.deepEqual(plain(sb.calls[1].filters), [['user_id', 'me'], ['day', '2026-11-11']]);
  await ctx.wpToggleAvail('2026-11-05');
  assert.equal(sb.calls.length, 2);
});

test('wpToggleAvail: save error reverts the day and shows a toast', async () => {
  ctx.supabaseClient = availClient({ fail: true }); ctx.currentUser = { id: 'me' }; stubToday('2026-11-06');
  let toast = null; ctx.showToast = (m, t) => { toast = t; };
  await ctx.wpToggleAvail('2026-11-10');
  assert.equal(vm.runInContext('wpAvailRows["2026-11-10"] || ""', ctx), '');
  assert.equal(toast, 'danger');
});

test('wpToggleAvail: rapid taps reach the server in tap order, last state wins', async () => {
  const sb = availClient({ manual: true }); ctx.supabaseClient = sb; ctx.currentUser = { id: 'me' }; ctx.showToast = () => {};
  stubToday('2026-11-06');
  const a = ctx.wpToggleAvail('2026-11-10'), b = ctx.wpToggleAvail('2026-11-10');
  await new Promise(r => setImmediate(r));
  assert.equal(sb.calls.length, 1); // second write waits for the first
  sb.pending.shift()();
  await new Promise(r => setImmediate(r));
  assert.equal(sb.calls.length, 2);
  sb.pending.shift()();
  await Promise.all([a, b]);
  assert.deepEqual(sb.calls.map(c => c.row.level), ['notfall', 'nein']);
  assert.equal(vm.runInContext('wpAvailRows["2026-11-10"]', ctx), 'nein');
});

test('wpRenderAvail: planner without own unlock gets the grid, no calendar; week nav stays within now…+8 weeks', async () => {
  const el = { innerHTML: '' }, planner = { innerHTML: '' };
  ctx.document.getElementById = id => (id === 'wp-content' ? el : id === 'wp-av-planner' ? planner : null);
  ctx.userRole = 'PL'; ctx.currentUserAvailability = false; ctx.currentUserSeesInterest = true;
  stubToday('2026-11-06');
  const q = { select() { return q; }, gte() { return q; }, lte() { return Promise.resolve({ data: [{ user_id: 'k', day: '2026-11-04', level: 'nein' }], error: null }); } };
  ctx.supabaseClient = { from: () => q, rpc: () => Promise.resolve({ data: [{ id: 'k', full_name: 'Kacper' }], error: null }) };
  await ctx.wpRenderAvail();
  await new Promise(r => setImmediate(r));
  assert.doesNotMatch(el.innerHTML, /wp-av-cal/);
  assert.match(planner.innerHTML, /wp-av-grid/);
  assert.match(planner.innerHTML, /Kacper/);
  assert.match(planner.innerHTML, /geht nicht/);
  assert.equal(ctx.wpAvailGridBounds().min, '2026-11-02');
  assert.equal(ctx.wpAvailGridBounds().max, '2026-12-21'); // + 7 weeks = 8th week shown
});

// "today" fixed; localDateStr(date) keeps formatting real dates (wpAddDays uses it)
function stubToday(iso) {
  const real = ctx.localDateStr;
  ctx.localDateStr = d => (d ? real(d) : iso);
}

test('wpToggleAvail: two failed taps fall back to the last saved value, not an unsaved one', async () => {
  const sb = availClient({ manual: true, fail: true }); ctx.supabaseClient = sb; ctx.currentUser = { id: 'me' }; ctx.showToast = () => {};
  stubToday('2026-11-06');
  const a = ctx.wpToggleAvail('2026-11-10'), b = ctx.wpToggleAvail('2026-11-10');
  await new Promise(r => setImmediate(r));
  sb.pending.shift()();
  await new Promise(r => setImmediate(r));
  sb.pending.shift()();
  await Promise.all([a, b]);
  assert.equal(vm.runInContext('wpAvailRows["2026-11-10"] || ""', ctx), '');
});

// ── Aufträge im Wochenplan (order_slots) ──
const oslot = (extra) => Object.assign({ job_no: '26-0415.01', phase: 'setup', start_at: '2026-11-09T10:00', end_at: '2026-11-09T18:00',
  title: '261112_Estrel_Vernissage', name: 'Speicher', room: 'Halle', needed: 4, accepted: 1, my_status: null,
  materials: [{ group: 'Bar', items: [{ qty: 2, name: 'Barelement <weiß>' }] }], notes: 'Info: X', link_set: false }, extra || {});

test('wpOrderBlock: open = needed − taken, „Ich kann“ only when applying is possible', () => {
  stubToday('2026-11-06'); ctx.currentUser = { id: 'me' }; ctx.userRole = 'MA';
  const ps = { id: 'p1', date: '2026-11-09', plan_assignments: [{ user_id: 'u1' }] };
  let html = ctx.wpOrderBlock(oslot(), ps);
  assert.match(html, /4 MA · 2 offen/);
  assert.match(html, /Ich kann/);
  assert.match(html, /Barelement &lt;weiß&gt;/);
  html = ctx.wpOrderBlock(oslot(), { id: 'p1', date: '2026-11-09', plan_assignments: [{ user_id: 'me' }] });
  assert.doesNotMatch(html, /Ich kann/);
  assert.match(ctx.wpOrderBlock(oslot({ my_status: 'offen' }), null), /Zurückziehen/);
  assert.match(ctx.wpOrderBlock(oslot({ my_status: 'angenommen' }), null), /Angenommen/);
  ctx.userRole = 'Gast';
  assert.doesNotMatch(ctx.wpOrderBlock(oslot(), null), /Ich kann/);
});

test('wpRow: a shift with an Auftrag shows its block instead of „Ich hätte Zeit“', () => {
  stubToday('2026-11-06'); ctx.currentUser = { id: 'me' }; ctx.userRole = 'MA';
  const s = { id: 'p1', date: '2026-11-09', key: 'k', venue: 'Estrel', wann: 'Aufbau: 10 Uhr', plan_assignments: [],
    open_slots: [{ role: 'MA', count: 2 }], _interest: [] };
  assert.match(ctx.wpRow(s), /Ich hätte Zeit/);
  s._orders = [oslot()];
  const html = ctx.wpRow(s);
  assert.doesNotMatch(html, /Ich hätte Zeit/);
  assert.match(html, /Ich kann/);
});

function applyClient(fail) {
  const calls = [];
  return { calls, from: (t) => { const q = { t, filters: [] }; const b = {
    insert(row) { q.op = 'insert'; q.row = row; return b; }, delete() { q.op = 'delete'; return b; },
    eq(k, v) { q.filters.push([k, v]); return b; },
    select() { calls.push(q); return Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: [{ job_no: 'j' }], error: null }); } };
    return b; } };
}

test('wpOrderApply: insert row shape; error toasts and keeps the state', async () => {
  ctx.currentUser = { id: 'me' }; let toast = null; ctx.showToast = (m, t) => { toast = t; };
  ctx.wpRenderWeek = async () => {}; ctx.wpRenderMine = async () => {};
  vm.runInContext('_wpSlots = [' + JSON.stringify(oslot()) + ']', ctx);
  let sb = applyClient(false); ctx.supabaseClient = sb;
  await ctx.wpOrderApply('26-0415.01', 'setup', true);
  assert.equal(sb.calls[0].t, 'order_applications');
  assert.deepEqual(plain(sb.calls[0].row), { job_no: '26-0415.01', phase: 'setup', user_id: 'me' });
  assert.equal(vm.runInContext('_wpSlots[0].my_status', ctx), 'offen');
  sb = applyClient(true); ctx.supabaseClient = sb;
  await ctx.wpOrderApply('26-0415.01', 'setup', false);
  assert.equal(toast, 'danger');
  assert.equal(vm.runInContext('_wpSlots[0].my_status', ctx), 'offen');
});

test('wpOrderApply: withdraw deletes only the own open row', async () => {
  ctx.currentUser = { id: 'me' }; ctx.showToast = () => {};
  ctx.wpRenderWeek = async () => {}; ctx.wpRenderMine = async () => {};
  vm.runInContext('_wpSlots = [' + JSON.stringify(oslot({ my_status: 'offen' })) + ']', ctx);
  const sb = applyClient(false); ctx.supabaseClient = sb;
  await ctx.wpOrderApply('26-0415.01', 'setup', false);
  assert.equal(sb.calls[0].op, 'delete');
  assert.deepEqual(plain(sb.calls[0].filters), [['job_no', '26-0415.01'], ['phase', 'setup'], ['user_id', 'me'], ['status', 'offen']]);
  assert.equal(vm.runInContext('_wpSlots[0].my_status', ctx), null);
});
