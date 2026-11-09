// Run from the repo root: node --test tests/auftraege.test.js
// Loads utils.js, order-parser.js and auftraege.js into one sandbox (as in index.html).
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
  for (const f of ['utils.js', 'order-parser.js', 'order-slots.js', 'auftraege.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  }
});
const plain = v => JSON.parse(JSON.stringify(v));
function stubToday(iso) {
  const real = ctx.localDateStr;
  ctx.localDateStr = d => (d ? real(d) : iso);
}

const ordJob = (no, setup, teardown, room) => ({ jobNo: no, name: 'Job ' + no, room: room || '', setup: setup && { start: setup, end: null },
  event: null, teardown: teardown && { start: teardown, end: null }, lead: '', notes: '', materials: [] });

test('ordJobs: newer file wins per jobNo', () => {
  stubToday('2026-11-06');
  const files = [{ id: 'a', name: 'AB alt.pdf', created_at: '2026-10-01T10:00:00Z', project_folders: { name: 'GdP' } },
    { id: 'b', name: 'AB neu.pdf', created_at: '2026-11-01T10:00:00Z', project_folders: { name: 'GdP' } }];
  const parsed = { a: { project: '26-0394', jobs: [ordJob('26-0394.01', '2026-11-10T08:00', '2026-11-12T08:00', 'alt')] },
    b: { project: '26-0394', jobs: [ordJob('26-0394.01', '2026-11-10T08:00', '2026-11-12T08:00', 'neu')] } };
  const r = plain(ctx.ordJobs(files, parsed));
  assert.equal(r.length, 1);
  assert.equal(r[0].job.room, 'neu');
  assert.equal(r[0].file.id, 'b');
  assert.equal(r[0].folderName, 'GdP');
});

test('ordJobs: past jobs hidden, sorted by setup start, unparsed files skipped', () => {
  stubToday('2026-11-06');
  const files = [{ id: 'a', name: 'a.pdf', created_at: '2026-10-01' }, { id: 'b', name: 'b.pdf', created_at: '2026-10-02' }, { id: 'c', name: 'c.pdf', created_at: '2026-10-03' }];
  const parsed = {
    a: { jobs: [ordJob('26-0001.01', '2026-11-20T08:00', '2026-11-21T08:00'), ordJob('26-0001.02', '2026-11-01T08:00', '2026-11-05T22:00')] },
    b: { jobs: [ordJob('26-0002.01', '2026-11-09T08:00', '2026-11-06T08:00')] },
    c: null,
  };
  assert.deepEqual(plain(ctx.ordJobs(files, parsed)).map(x => x.job.jobNo), ['26-0002.01', '26-0001.01']);
});

test('ordRange: same day, multi-day, date-only end', () => {
  assert.equal(ctx.ordRange({ start: '2026-11-11T09:00', end: '2026-11-11T16:00' }), 'Mi 11.11. 09:00–16:00');
  assert.equal(ctx.ordRange({ start: '2026-11-02T08:00', end: '2026-11-05T01:00' }), 'Mo 2.11. 08:00 – Do 5.11. 01:00');
  assert.equal(ctx.ordRange({ start: '2026-11-12T18:00', end: '2026-11-13' }), 'Do 12.11. 18:00 – Fr 13.11.');
  assert.equal(ctx.ordRange(null), '—');
});

// ── Cache: each PDF is parsed once ──
const files3 = [{ id: 'fresh' }, { id: 'old' }, { id: 'new' }];
const okResult = no => ({ project: '26-0001', title: 't', jobs: [ordJob(no, '2026-11-10T08:00', '2026-11-11T08:00')], warnings: [] });

test('ordResolve: fresh cache rows are used, stale and missing files are parsed and stored', async () => {
  const cache = [{ file_id: 'fresh', parser_version: ctx.ORDER_PARSER_VERSION, result: okResult('26-0001.01') },
    { file_id: 'old', parser_version: ctx.ORDER_PARSER_VERSION - 1, result: okResult('26-0002.01') }];
  const read = [], saved = [], progress = [];
  const r = await ctx.ordResolve(files3, cache, async f => { read.push(f.id); return okResult('26-9999.0' + read.length); },
    async row => { saved.push(row); }, (i, n) => progress.push(i + '/' + n));
  assert.deepEqual(read, ['old', 'new']);
  assert.deepEqual(saved.map(s => [s.file_id, s.parser_version]), [['old', ctx.ORDER_PARSER_VERSION], ['new', ctx.ORDER_PARSER_VERSION]]);
  assert.equal(r.parsed.fresh.jobs[0].jobNo, '26-0001.01');
  assert.equal(r.parsed.old.jobs[0].jobNo, '26-9999.01');
  assert.deepEqual(progress, ['1/2', '2/2']);
  assert.deepEqual(plain(r.failed), []);
});

test('ordResolve: download error → failed, not stored; PDF without jobs → failed and stored', async () => {
  const saved = [];
  const r = await ctx.ordResolve([{ id: 'net' }, { id: 'foreign' }], [], async f => {
    if (f.id === 'net') throw new Error('offline');
    return { project: '', title: '', jobs: [], warnings: ['Keine Auftragsbestätigung erkannt.'] };
  }, async row => { saved.push(row.file_id); }, () => {});
  assert.deepEqual(plain(r.failed).map(f => f.id), ['net', 'foreign']);
  assert.deepEqual(saved, ['foreign']); // a cached foreign PDF is not downloaded again
});

test('ordResolve: cached foreign PDF stays failed without a download', async () => {
  let reads = 0;
  const r = await ctx.ordResolve([{ id: 'x' }], [{ file_id: 'x', parser_version: ctx.ORDER_PARSER_VERSION, result: { jobs: [] } }],
    async () => { reads++; }, async () => {}, () => {});
  assert.equal(reads, 0);
  assert.deepEqual(plain(r.failed).map(f => f.id), ['x']);
});

test('ordResolve: a failing cache write still shows the parsed jobs', async () => {
  const r = await ctx.ordResolve([{ id: 'a' }], [], async () => okResult('26-0003.01'), async () => { throw new Error('RLS'); }, () => {});
  assert.equal(r.parsed.a.jobs[0].jobNo, '26-0003.01');
});

// ── MA numbers ──
function staffClient(fail) {
  const calls = [];
  return { calls, from: () => { const b = { upsert(row, o) { calls.push({ row, o }); return b; },
    select: () => Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: [{ job_no: 'j' }], error: null }) }; return b; } };
}
const staffInput = (value) => ({ value, dataset: { job: '26-0447.01', field: 'staff_setup' } });

// Timer the test runs by hand: taps in a row become one save after ORD_STEP_DELAY
function stepTimer() {
  const t = { fn: null };
  ctx.setTimeout = (fn) => { t.fn = fn; return 1; };
  ctx.clearTimeout = () => { t.fn = null; };
  return t;
}

test('ordStep: three quick taps show 3 at once and save 3 once', async () => {
  ctx.showToast = () => {}; ctx.ordRenderList = () => {};
  const timer = stepTimer();
  vm.runInContext('_ordSaved = { "26-0447.01": { staff_setup: null, staff_teardown: 2 } }', ctx);
  const sb = staffClient(false); ctx.supabaseClient = sb;
  ctx.ordStep('26-0447.01', 'staff_setup', 1); ctx.ordStep('26-0447.01', 'staff_setup', 1);
  const done = ctx.ordStep('26-0447.01', 'staff_setup', 1);
  assert.equal(vm.runInContext('_ordSaved["26-0447.01"].staff_setup', ctx), 3);
  assert.equal(sb.calls.length, 0);
  timer.fn(); await done;
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].row.staff_setup, 3);
  assert.equal(sb.calls[0].row.staff_teardown, undefined); // the other number is left alone
  assert.equal(sb.calls[0].o.onConflict, 'job_no');
});

test('ordStep: a failed save goes back to the confirmed number and toasts', async () => {
  let toast = null; ctx.showToast = (m, t) => { toast = t; }; ctx.ordRenderList = () => {};
  const timer = stepTimer();
  vm.runInContext('_ordSaved = { "26-0447.01": { staff_setup: 3 } }', ctx);
  ctx.supabaseClient = staffClient(true);
  ctx.ordStep('26-0447.01', 'staff_setup', 1);
  const done = ctx.ordStep('26-0447.01', 'staff_setup', 1);
  assert.equal(vm.runInContext('_ordSaved["26-0447.01"].staff_setup', ctx), 5);
  timer.fn(); await done;
  assert.equal(vm.runInContext('_ordSaved["26-0447.01"].staff_setup', ctx), 3);
  assert.equal(toast, 'danger');
});

test('ordOpenPdf: opens the in-app viewer (window.open after await is blocked on iOS)', async () => {
  let shown = null; ctx.openFileViewer = (u, n, t) => { shown = [u, n, t]; };
  ctx.signedProjectFileUrl = async u => 'https://signed/' + u;
  ctx.showToast = () => {};
  vm.runInContext('_ordFiles = [{ id: "f1", name: "AB.pdf", file_url: "x/AB.pdf", file_type: "application/pdf" }]', ctx);
  await ctx.ordOpenPdf('f1');
  assert.deepEqual(shown, ['https://signed/x/AB.pdf', 'AB.pdf', 'application/pdf']);
});

test('ordCardHtml: materials listed per group, escaped, no prices', () => {
  const j = ordJob('26-0415.01', '2026-11-09T10:00', '2026-11-13T10:00');
  j.materials = [{ group: 'Bar <b>', items: [{ qty: 2, name: 'Barelement weiß' }, { qty: 1, name: 'Stuhl "Clara"' }] }];
  vm.runInContext('_ordOpen = { "26-0415.01": true }', ctx);
  const html = ctx.ordCardHtml({ job: j, file: { id: 'f' }, folderName: 'Ordner', project: '26-0415' });
  assert.match(html, /Material <b>2<\/b>/);
  assert.match(html, /Bar &lt;b&gt;/);
  assert.ok(html.includes('<b>2×</b> Barelement weiß'));
  assert.match(html, /Stuhl &quot;Clara&quot;/);
});

// ── Bewerbungen (PL) ──
const vjob = () => Object.assign(ordJob('26-0415.01', '2026-11-09T10:00', '2026-11-13T10:00'), { name: 'Neuköllnspeicher' });
const vx = () => ({ job: vjob(), file: { id: 'f' }, folderName: 'O', project: '26-0415', title: '261112_Estrel_Vernissage Streletzki' });
function setCtx(extra) {
  ctx.userRole = 'Admin'; ctx.currentUserSeesInterest = false;
  vm.runInContext('_ordSaved = { "26-0415.01": { staff_setup: 2, staff_teardown: 0 } }', ctx);
  vm.runInContext('_ordCtx = ' + JSON.stringify(Object.assign({
    apps: [], links: {}, avail: {},
    names: { u1: 'Ana', u2: 'Ben <b>', u3: 'Cem' },
    plan: [{ id: 'p1', date: '2026-11-09', key: 'k1', venue: 'Estrel', location: 'Vernissage Streletzki', title: 'Neuköllnspeicher',
      wann: 'Aufbau: 10 Uhr', plan_assignments: [{ user_id: 'u1', name: 'Ana' }] },
      { id: 'p2', date: '2026-11-09', key: 'k2', venue: 'Estrel', location: 'Reservisten', title: 'STB', wann: 'Abbau: 18 Uhr', plan_assignments: [{ user_id: 'u3', name: 'Cem' }] }],
  }, extra || {})), ctx);
}

test('ordSlotHtml: besetzt counts Daniel + accepted without duplicates, warns when full; no block without a number', () => {
  setCtx({ apps: [{ job_no: '26-0415.01', phase: 'setup', user_id: 'u1', status: 'angenommen' },
    { job_no: '26-0415.01', phase: 'setup', user_id: 'u2', status: 'angenommen' }] });
  const html = ctx.ordSlotHtml(vx(), 'setup');
  assert.match(html, /2<\/b> von 2 besetzt/);
  assert.match(html, /voll/);
  assert.doesNotMatch(html, /Noch keine Meldungen/); // full: nothing to wait for
  assert.match(html, /Daniels Plan: Neuköllnspeicher/);
  assert.match(html, /Angenommen über Auftrag: Ben &lt;b&gt;/);
  const td = ctx.ordSlotHtml(vx(), 'teardown'); // 0 MA: compact block with the stepper, so the number can go up again
  assert.match(td, /Keine MA ausgeschrieben/);
  assert.match(td, /Einen MA mehr/);
  assert.doesNotMatch(td, /besetzt/);
});

test('ordSlotHtml: applicants with availability hint and „schon eingeplant“, escaped names', () => {
  setCtx({ apps: [{ job_no: '26-0415.01', phase: 'setup', user_id: 'u2', status: 'offen' },
    { job_no: '26-0415.01', phase: 'setup', user_id: 'u3', status: 'offen' }],
    avail: { 'u2|2026-11-09': 'notfall' } });
  const html = ctx.ordSlotHtml(vx(), 'setup');
  assert.match(html, /Ben &lt;b&gt;/);
  assert.match(html, /nur im Notfall/);
  assert.match(html, /schon eingeplant/); // Cem is on p2 the same day
  assert.match(html, /Annehmen/);
  assert.match(html, /1<\/b> von 2 besetzt/);
  assert.match(html, /1 fehlt/);
  assert.doesNotMatch(html, /Noch keine Meldungen/);
});

function decideClient(fail) {
  const calls = [];
  return { calls, from: (t) => { const q = { t, filters: [] }; const b = {
    update(row) { q.op = 'update'; q.row = row; return b; }, upsert(row, o) { q.op = 'upsert'; q.row = row; q.o = o; return b; },
    delete() { q.op = 'delete'; return b; }, eq(k, v) { q.filters.push([k, v]); return b; },
    select() { calls.push(q); return Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: [{ job_no: 'j' }], error: null }); } };
    return b; } };
}

test('ordDecide: update shape; error keeps the status and toasts', async () => {
  setCtx({ apps: [{ job_no: '26-0415.01', phase: 'setup', user_id: 'u2', status: 'offen' }] });
  ctx.ordRenderList = () => {}; let toast = null; ctx.showToast = (m, t) => { toast = t; };
  let sb = decideClient(false); ctx.supabaseClient = sb;
  await ctx.ordDecide('26-0415.01', 'setup', 'u2', 'angenommen');
  assert.equal(sb.calls[0].t, 'order_applications');
  assert.deepEqual(plain(sb.calls[0].row), { status: 'angenommen' });
  assert.deepEqual(plain(sb.calls[0].filters), [['job_no', '26-0415.01'], ['phase', 'setup'], ['user_id', 'u2']]);
  assert.equal(vm.runInContext('_ordCtx.apps[0].status', ctx), 'angenommen');
  sb = decideClient(true); ctx.supabaseClient = sb;
  await ctx.ordDecide('26-0415.01', 'setup', 'u2', 'abgelehnt');
  assert.equal(vm.runInContext('_ordCtx.apps[0].status', ctx), 'angenommen');
  assert.equal(toast, 'danger');
});

test('ordSetLink: unlink writes nulls, a pick writes date + key, auto deletes the row', async () => {
  setCtx(); ctx.ordRenderList = () => {}; ctx.showToast = () => {};
  const sb = decideClient(false); ctx.supabaseClient = sb;
  const sel = v => ({ value: v, dataset: { job: '26-0415.01', phase: 'setup' } });
  await ctx.ordSetLink(sel('none'));
  assert.deepEqual(plain(sb.calls[0].row), { job_no: '26-0415.01', phase: 'setup', plan_date: null, plan_key: null });
  assert.equal(sb.calls[0].o.onConflict, 'job_no,phase');
  await ctx.ordSetLink(sel('2026-11-09|k2'));
  assert.deepEqual(plain(sb.calls[1].row), { job_no: '26-0415.01', phase: 'setup', plan_date: '2026-11-09', plan_key: 'k2' });
  await ctx.ordSetLink(sel('auto'));
  assert.equal(sb.calls[2].op, 'delete');
  assert.equal(vm.runInContext('Object.keys(_ordCtx.links).length', ctx), 0);
});

test('ordSlotHtml: MA number set to 0 keeps the applications visible as „nicht mehr ausgeschrieben“; quantities escaped', () => {
  setCtx({ apps: [{ job_no: '26-0415.01', phase: 'teardown', user_id: 'u2', status: 'angenommen' }] });
  const html = ctx.ordSlotHtml(vx(), 'teardown');
  assert.match(html, /nicht mehr ausgeschrieben/);
  assert.match(html, /Ben &lt;b&gt;/);
  const x = vx(); x.job.materials = [{ group: 'G', items: [{ qty: '<img src=x>', name: 'n' }] }];
  vm.runInContext('_ordOpen = { "26-0415.01": true }', ctx);
  assert.doesNotMatch(ctx.ordCardHtml(x), /<img/);
});

// ── Layout: collapsed cards, status pills, day groups, stepper, drivers ──
test('ordCardHtml: collapsed by default with phase pills and a „neu“ badge; open shows the phase blocks', () => {
  setCtx({ apps: [{ job_no: '26-0415.01', phase: 'setup', user_id: 'u2', status: 'offen' },
    { job_no: '26-0415.01', phase: 'setup', user_id: 'u3', status: 'offen' }] });
  vm.runInContext('_ordSaved["26-0415.01"] = { staff_setup: 1, staff_teardown: null }; _ordOpen = {}', ctx);
  let html = ctx.ordCardHtml(vx());
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /ord-pill-ok">Aufbau 1\/1/);
  assert.match(html, /Abbau – MA eintragen/);
  assert.match(html, /2 neu/);
  assert.doesNotMatch(html, /ord-slot/);
  ctx.ordToggle('26-0415.01');
  html = ctx.ordCardHtml(vx());
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /ord-slot/);
});

test('ordCardHtml: no taken places → red pill', () => {
  setCtx({ plan: [] });
  vm.runInContext('_ordOpen = {}', ctx);
  assert.match(ctx.ordCardHtml(vx()), /ord-pill-danger">Aufbau 0\/2/);
});

test('ordListHtml: grouped by day in date order, failed files at the end', () => {
  setCtx();
  stubToday('2026-11-06');
  const a = vx(), b = vx();
  b.job = Object.assign(ordJob('26-0447.01', '2026-11-11T09:00', '2026-11-12T19:15'), { name: 'Business of Apps' });
  const html = ctx.ordListHtml({ jobs: [a, b], failed: [{ id: 'f9', name: 'kaputt.pdf' }] });
  const i = html.indexOf('Montag 09.11.'), k = html.indexOf('Mittwoch 11.11.'), f = html.indexOf('kaputt.pdf');
  assert.ok(i !== -1 && k > i && f > k, [i, k, f].join());
});

test('ordStep: never below 0 or above 99, no minus on an empty number', async () => {
  ctx.ordRenderList = () => {};
  const timer = stepTimer();
  vm.runInContext('_ordSaved = { "26-0415.01": { staff_setup: 0, staff_teardown: 99 } }', ctx);
  ctx.supabaseClient = staffClient(false);
  await ctx.ordStep('26-0415.01', 'staff_setup', -1);
  await ctx.ordStep('26-0415.01', 'staff_teardown', 1);
  await ctx.ordStep('26-0415.02', 'staff_setup', -1);
  assert.equal(timer.fn, null);
  assert.equal(vm.runInContext('_ordSaved["26-0415.01"].staff_setup', ctx), 0);
});

test('ordSlotHtml: a Fahrer on Daniel’s entry is listed but does not count', () => {
  setCtx();
  vm.runInContext('_ordCtx.plan[0].plan_assignments.push({ user_id: "d1", name: "Hassan", role: "Fahrer" }); _ordCtx.names.d1 = "Hassan"', ctx);
  const html = ctx.ordSlotHtml(vx(), 'setup');
  assert.match(html, /Hassan · Fahrer/);
  assert.match(html, /zählt nicht/);
  assert.match(html, /1<\/b> von 2 besetzt/);
});

test('ordSlotHtml: „2 fehlen“, open places without applications say „Noch keine Meldungen“', () => {
  setCtx({ plan: [] });
  const html = ctx.ordSlotHtml(vx(), 'setup');
  assert.match(html, /2 fehlen/);
  assert.match(html, /Noch keine Meldungen/);
});

test('ordCardHtml: venue shown as written in the title (umlauts kept)', () => {
  setCtx();
  vm.runInContext('_ordOpen = {}', ctx);
  const x = vx(); x.title = '261109_Neuköllnspeicher_Vernissage';
  assert.match(ctx.ordCardHtml(x), /Neuköllnspeicher · /);
});

// ── Inbox (both kinds of Meldungen) ──
function inboxCtx(extra) {
  stubToday('2026-11-06');
  vm.runInContext('_ordSaved = { "26-0447.01": { staff_setup: 2, staff_teardown: null } }', ctx);
  vm.runInContext('_ordCtx = ' + JSON.stringify(Object.assign({
    apps: [{ job_no: '26-0447.01', phase: 'setup', user_id: 'u2', status: 'offen' }],
    interest: [{ week_id: 'w', shift_key: 'k1', user_id: 'u3', status: 'offen' }],
    links: {}, avail: {}, names: { u2: 'Ben', u3: 'Cem' },
    plan: [{ id: 'p1', week_id: 'w', date: '2026-11-09', key: 'k1', venue: 'Tempodrom', title: 'Gala', wann: 'Aufbau: 8 Uhr',
      open_slots: [{ role: 'MA', count: 1 }], plan_assignments: [] }],
  }, extra || {})), ctx);
}
const boa = () => ({ job: Object.assign(ordJob('26-0447.01', '2026-11-11T09:00', null), { name: 'Business of Apps' }),
  file: { id: 'f2' }, folderName: 'O', project: '26-0447', title: '261111_Estrel_Business of Apps' });

test('ordInbox: open from both tables, sorted by day', () => {
  inboxCtx();
  const box = ctx.ordInbox([boa()], '2026-11-06');
  assert.deepEqual(plain(box.open.map(i => i.kind)), ['shift', 'order']);
  assert.equal(box.open[0].date, '2026-11-09');
  assert.equal(box.open[1].phase, 'Aufbau');
  assert.equal(box.open[1].time, '09:00');
});

test('ordInbox: only today and later', () => {
  inboxCtx({ plan: [{ id: 'p1', week_id: 'w', date: '2026-11-05', key: 'k1', venue: 'Tempodrom', title: 'Gala', wann: '', plan_assignments: [] }] });
  assert.equal(ctx.ordInbox([], '2026-11-06').open.length, 0);
});

test('ordInbox: skips rows without a shift', () => {
  inboxCtx({ apps: [], interest: [{ week_id: 'w', shift_key: 'weg', user_id: 'u3', status: 'offen' }] });
  assert.equal(ctx.ordInbox([], '2026-11-06').open.length, 0);
});

test('ordInbox: accepted-not-in-plan', () => {
  inboxCtx({ apps: [{ job_no: '26-0447.01', phase: 'setup', user_id: 'u2', status: 'angenommen' }],
    interest: [{ week_id: 'w', shift_key: 'k1', user_id: 'u3', status: 'angenommen' }] });
  let box = ctx.ordInbox([boa()], '2026-11-06');
  assert.equal(box.open.length, 0);
  assert.deepEqual(plain(box.accepted.map(i => i.kind)), ['shift', 'order']); // the Auftrag phase is not linked → not in plan
  vm.runInContext('_ordCtx.plan[0].plan_assignments.push({ user_id: "u3", name: "Cem" })', ctx);
  box = ctx.ordInbox([boa()], '2026-11-06');
  assert.deepEqual(plain(box.accepted.map(i => i.kind)), ['order']);
});

test('ordDecideShift: update shape and filters; error keeps status and toasts', async () => {
  inboxCtx();
  ctx.ordRenderList = () => {}; let toast = null; ctx.showToast = (m, t) => { toast = t; };
  let sb = decideClient(false); ctx.supabaseClient = sb;
  await ctx.ordDecideShift('w', 'k1', 'u3', 'angenommen');
  assert.equal(sb.calls[0].t, 'plan_shift_interest');
  assert.deepEqual(plain(sb.calls[0].row), { status: 'angenommen' });
  assert.deepEqual(plain(sb.calls[0].filters), [['week_id', 'w'], ['shift_key', 'k1'], ['user_id', 'u3']]);
  assert.equal(vm.runInContext('_ordCtx.interest[0].status', ctx), 'angenommen');
  sb = decideClient(true); ctx.supabaseClient = sb;
  await ctx.ordDecideShift('w', 'k1', 'u3', 'abgelehnt');
  assert.equal(vm.runInContext('_ordCtx.interest[0].status', ctx), 'angenommen');
  assert.equal(toast, 'danger');
});

test('ordCanDecide: Admin or the switch', () => {
  ctx.userRole = 'PL'; ctx.currentUserSeesInterest = false;
  assert.equal(ctx.ordCanDecide(), false);
  ctx.currentUserSeesInterest = true;
  assert.equal(ctx.ordCanDecide(), true);
  ctx.userRole = 'Admin'; ctx.currentUserSeesInterest = false;
  assert.equal(ctx.ordCanDecide(), true);
});

test('ordInboxHtml: open rows with name, hint, ✓ / ✕ wired to the right decide call', () => {
  inboxCtx({ names: { u2: 'Ben <b>', u3: 'Cem' }, avail: { 'u3|2026-11-09': 'notfall' } });
  const html = ctx.ordInboxHtml(ctx.ordInbox([boa()], '2026-11-06'));
  assert.match(html, /ord-inbox/);
  assert.match(html, />Meldungen · 2 offen</);
  assert.match(html, /ordDecideShift\('w', 'k1', 'u3', 'angenommen'\)/);
  assert.match(html, /ordDecide\('26-0447\.01', 'setup', 'u2', 'abgelehnt'\)/);
  assert.match(html, /nur im Notfall/);
  assert.match(html, /Ben &lt;b&gt;/);
  assert.match(html, /1 MA fehlt/);         // Daniel's open slot
  assert.match(html, /0 von 2 besetzt/);    // the Auftrag phase
  assert.ok(html.indexOf('Tempodrom') < html.indexOf('Business of Apps'), 'sorted by day');
});

test('ordInboxHtml: accepted section with „Zurücknehmen“', () => {
  inboxCtx({ apps: [], interest: [{ week_id: 'w', shift_key: 'k1', user_id: 'u3', status: 'angenommen' }] });
  const html = ctx.ordInboxHtml(ctx.ordInbox([], '2026-11-06'));
  assert.match(html, /Angenommen, noch nicht in Daniels Plan/);
  assert.match(html, /Zurücknehmen/);
  assert.match(html, /ordDecideShift\('w', 'k1', 'u3', 'offen'\)/);
  assert.match(html, /Keine offenen Meldungen\./);
});

test('ordInboxHtml: empty → „Keine offenen Meldungen.“', () => {
  inboxCtx({ apps: [], interest: [] });
  const html = ctx.ordInboxHtml(ctx.ordInbox([], '2026-11-06'));
  assert.match(html, /Keine offenen Meldungen\./);
  assert.doesNotMatch(html, /Angenommen, noch nicht/);
});

test('ordInboxHtml: nothing for non-deciders', () => {
  inboxCtx();
  ctx.userRole = 'PL'; ctx.currentUserSeesInterest = false;
  assert.doesNotMatch(ctx.ordListHtml({ jobs: [boa()], failed: [] }), /ord-inbox/);
  ctx.currentUserSeesInterest = true;
  const html = ctx.ordListHtml({ jobs: [boa()], failed: [] });
  assert.match(html, /ord-inbox/);
  assert.match(html, /2 neue Meldungen/); // both tables counted
  ctx.currentUserSeesInterest = false;
});

// ── Review fixes ──
test('fix: a PL without the switch sees no Meldungen on the cards (own row from RLS), no „neu“', () => {
  setCtx({ apps: [{ job_no: '26-0415.01', phase: 'setup', user_id: 'u2', status: 'offen' }] });
  ctx.userRole = 'PL';
  vm.runInContext('_ordOpen = {}', ctx);
  assert.doesNotMatch(ctx.ordCardHtml(vx()), /neu/);
  const html = ctx.ordSlotHtml(vx(), 'setup');
  assert.doesNotMatch(html, /Annehmen|Meldungen|Noch keine Meldungen/);
  assert.match(html, /Einen MA mehr/); // PL still sets the number
});

test('fix: accepted ids from order_slots() count for everyone (RLS hides other people’s applications)', () => {
  setCtx({ apps: [], accepted: { '26-0415.01|setup': ['u2', 'u1'] } });
  ctx.userRole = 'PL';
  const html = ctx.ordSlotHtml(vx(), 'setup');
  assert.match(html, /2<\/b> von 2 besetzt/); // u1 from Daniel + u2 accepted, u1 not counted twice
});

test('fix: a viewer without Admin/PL role sees no stepper buttons and no link editor', () => {
  setCtx();
  ctx.userRole = 'AL'; ctx.currentUserSeesInterest = true;
  const html = ctx.ordSlotHtml(vx(), 'setup');
  assert.doesNotMatch(html, /Einen MA mehr|ord-link-edit/);
  assert.match(html, /2<small>MA<\/small>|2 MA/);
});

test('fix: ordSetLink treats 0 changed rows as not saved', async () => {
  setCtx({ links: { '26-0415.01|setup': { plan_date: '2026-11-09', plan_key: 'k1' } } });
  ctx.ordRenderList = () => {}; let toast = null; ctx.showToast = (m, t) => { toast = t; };
  ctx.supabaseClient = { from: () => { const b = { delete: () => b, eq: () => b, select: () => Promise.resolve({ data: [], error: null }) }; return b; } };
  await ctx.ordSetLink({ dataset: { job: '26-0415.01', phase: 'setup' }, value: 'auto' });
  assert.equal(toast, 'danger');
  assert.equal(vm.runInContext('_ordCtx.links["26-0415.01|setup"].plan_key', ctx), 'k1');
});

// ── „Hätten laut Verfügbarkeit Zeit“ ──
const U = (id, extra) => Object.assign({ id, full_name: 'N ' + id, role: 'MA', is_active: true, availability_enabled: true, can_drive: false }, extra || {});
function availCtx(extra) {
  inboxCtx(Object.assign({
    apps: [], interest: [{ week_id: 'w', shift_key: 'k1', user_id: 'u3', status: 'offen' }],
    users: [U('a1'), U('a2'), U('nf'), U('no'), U('busy'), U('u3'), U('off', { availability_enabled: false }),
      U('gone', { is_active: false }), U('gast', { role: 'Gast' })],
    avail: { 'nf|2026-11-09': 'notfall', 'no|2026-11-09': 'nein' },
    plan: [{ id: 'p1', week_id: 'w', date: '2026-11-09', key: 'k1', venue: 'Tempodrom', title: 'Gala', wann: 'Aufbau: 8 Uhr',
      open_slots: [{ role: 'MA', count: 1 }], plan_assignments: [] },
      { id: 'p2', week_id: 'w', date: '2026-11-09', key: 'k2', venue: 'Estrel', title: 'Andere', wann: '', open_slots: [],
        plan_assignments: [{ user_id: 'busy', name: 'Busy' }] }],
  }, extra || {}));
}

test('ordAvailable: free, unlocked people for a Daniel shift with an open slot; „nur im Notfall“ last', () => {
  availCtx();
  const groups = ctx.ordAvailable([], '2026-11-06');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'shift');
  assert.equal(groups[0].shift_key, 'k1');
  assert.deepEqual(plain(groups[0].people.map(p => p.user_id)), ['a1', 'a2', 'nf']); // not: nein, busy that day, already applied, locked, inactive, Gast
  assert.equal(groups[0].people[2].notfall, true);
});

test('ordAvailable: AL slot only for AL/PL/Admin, Fahrer slot only with „Kann Fahrer“', () => {
  availCtx({ users: [U('a1'), U('al', { role: 'AL' }), U('fa', { can_drive: true })] });
  vm.runInContext('_ordCtx.plan[0].open_slots = [{ role: "AL", count: 1 }]', ctx);
  assert.deepEqual(plain(ctx.ordAvailable([], '2026-11-06')[0].people.map(p => p.user_id)), ['al']);
  vm.runInContext('_ordCtx.plan[0].open_slots = [{ role: "Fahrer", count: 1 }]', ctx);
  assert.deepEqual(plain(ctx.ordAvailable([], '2026-11-06')[0].people.map(p => p.user_id)), ['fa']);
});

test('ordAvailable: Auftrag phase with free places is listed, a full one is not; a shift with an Auftrag is not listed twice', () => {
  availCtx({ users: [U('a1')], interest: [], plan: [] });
  let groups = ctx.ordAvailable([boa()], '2026-11-06');
  assert.deepEqual(plain(groups.map(g => [g.kind, g.job_no, g.phaseKey])), [['order', '26-0447.01', 'setup']]);
  vm.runInContext('_ordCtx.accepted = { "26-0447.01|setup": ["x", "y"] }', ctx); // 2 of 2
  assert.equal(ctx.ordAvailable([boa()], '2026-11-06').length, 0);
  availCtx({ users: [U('a1')], interest: [], plan: [{ id: 'p9', week_id: 'w', date: '2026-11-11', key: 'k9', venue: 'Estrel',
    title: 'Business of Apps', location: '', wann: 'Aufbau: 9 Uhr', open_slots: [{ role: 'MA', count: 1 }], plan_assignments: [] }] });
  groups = ctx.ordAvailable([boa()], '2026-11-06');
  assert.deepEqual(plain(groups.map(g => g.kind)), ['order']); // p9 is the Auftrag's entry → only the Auftrag phase
});

test('ordAvailable: past days are left out', () => {
  availCtx();
  assert.equal(ctx.ordAvailable([], '2026-11-10').length, 0);
});

test('ordAcceptAvailable: inserts an accepted Meldung for the person; error keeps everything and toasts', async () => {
  availCtx();
  ctx.ordRenderList = () => {}; let toast = null; ctx.showToast = (m, t) => { toast = t; };
  const calls = [];
  const client = (fail) => ({ from: (t) => { const q = { t }; const b = { insert(row) { q.row = row; return b; },
    select() { calls.push(q); return Promise.resolve(fail ? { data: null, error: { message: 'x' } } : { data: [{ user_id: 'a1' }], error: null }); } }; return b; } });
  ctx.supabaseClient = client(false);
  await ctx.ordAcceptAvailable('shift', 'w', 'k1', 'a1');
  assert.equal(calls[0].t, 'plan_shift_interest');
  assert.deepEqual(plain(calls[0].row), { week_id: 'w', shift_key: 'k1', user_id: 'a1', status: 'angenommen' });
  assert.ok(vm.runInContext('_ordCtx.interest.some(r => r.user_id === "a1" && r.status === "angenommen")', ctx));
  ctx.supabaseClient = client(false);
  await ctx.ordAcceptAvailable('order', '26-0447.01', 'setup', 'a2');
  assert.equal(calls[1].t, 'order_applications');
  assert.deepEqual(plain(calls[1].row), { job_no: '26-0447.01', phase: 'setup', user_id: 'a2', status: 'angenommen' });
  const before = vm.runInContext('_ordCtx.interest.length', ctx);
  ctx.supabaseClient = client(true);
  await ctx.ordAcceptAvailable('shift', 'w', 'k1', 'a2');
  assert.equal(vm.runInContext('_ordCtx.interest.length', ctx), before);
  assert.equal(toast, 'danger');
});

test('ordInboxHtml: „Hätten laut Verfügbarkeit Zeit“ with „Annehmen“, the rest behind „+N weitere“', () => {
  availCtx({ users: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].map(id => U(id)).concat([U('x<y', { full_name: 'X <b>' })]), names: { 'x<y': 'X <b>' } });
  const html = ctx.ordInboxHtml({ open: [], accepted: [] }, ctx.ordAvailable([], '2026-11-06'));
  assert.match(html, /Hätten laut Verfügbarkeit Zeit/);
  assert.match(html, /ordAcceptAvailable\('shift', 'w', 'k1', 'b1'\)/);
  assert.match(html, /\+3 weitere/);
  assert.match(html, /X &lt;b&gt;/);
  assert.doesNotMatch(ctx.ordInboxHtml({ open: [], accepted: [] }, []), /Hätten laut Verfügbarkeit/);
});

test('ordFoldShared: a phase shared with an earlier job of the same file is dropped and remembered; input untouched', () => {
  const T = { start: '2026-11-05T01:00', end: '2026-11-05T06:00' };
  const parsed = { f1: { jobs: [{ jobNo: 'a.01', setup: { start: '2026-11-01T17:00' }, teardown: T }, { jobNo: 'a.02', setup: { start: '2026-11-02T08:00' }, teardown: T }] } };
  const out = plain(ctx.ordFoldShared(parsed));
  assert.deepEqual(out.f1.jobs[0].teardown, T);
  assert.equal(out.f1.jobs[1].teardown, null);
  assert.deepEqual(out.f1.jobs[1].sharedWith, { teardown: 'a.01' });
  assert.deepEqual(parsed.f1.jobs[1].teardown, T);
});
