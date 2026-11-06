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

test('ordSaveStaff: saves, error restores saved value and toasts', async () => {
  let toast = null; ctx.showToast = (m, t) => { toast = t; };
  vm.runInContext('_ordSaved = { "26-0447.01": { staff_setup: 3, staff_teardown: null } }', ctx);
  let sb = staffClient(false); ctx.supabaseClient = sb;
  await ctx.ordSaveStaff(staffInput('5'));
  assert.equal(sb.calls[0].row.job_no, '26-0447.01');
  assert.equal(sb.calls[0].row.staff_setup, 5);
  assert.equal(sb.calls[0].row.staff_teardown, undefined); // the other number is left alone
  assert.equal(sb.calls[0].o.onConflict, 'job_no');
  assert.equal(vm.runInContext('_ordSaved["26-0447.01"].staff_setup', ctx), 5);
  sb = staffClient(true); ctx.supabaseClient = sb;
  const inp = staffInput('7');
  await ctx.ordSaveStaff(inp);
  assert.equal(inp.value, '5');
  assert.equal(toast, 'danger');
});

test('ordSaveStaff: empty input saves null, 100 and badInput rejected without request', async () => {
  ctx.showToast = () => {};
  vm.runInContext('_ordSaved = { "26-0447.01": { staff_setup: 2 } }', ctx);
  const sb = staffClient(false); ctx.supabaseClient = sb;
  await ctx.ordSaveStaff(staffInput(''));
  assert.equal(sb.calls[0].row.staff_setup, null);
  const inp = staffInput('100');
  await ctx.ordSaveStaff(inp);
  assert.equal(inp.value, '');
  const bad = Object.assign(staffInput(''), { validity: { badInput: true } });
  await ctx.ordSaveStaff(bad);
  assert.equal(sb.calls.length, 1);
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
  const html = ctx.ordCardHtml({ job: j, file: { id: 'f' }, folderName: 'Ordner', project: '26-0415' });
  assert.match(html, /Material \(2 Positionen\)/);
  assert.match(html, /Bar &lt;b&gt;/);
  assert.ok(html.includes('<b>2×</b> Barelement weiß'));
  assert.match(html, /Stuhl &quot;Clara&quot;/);
});

// ── Bewerbungen (PL) ──
const vjob = () => Object.assign(ordJob('26-0415.01', '2026-11-09T10:00', '2026-11-13T10:00'), { name: 'Neuköllnspeicher' });
const vx = () => ({ job: vjob(), file: { id: 'f' }, folderName: 'O', project: '26-0415', title: '261112_Estrel_Vernissage Streletzki' });
function setCtx(extra) {
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
  assert.match(html, /2 \/ 2 besetzt/);
  assert.match(html, /voll/);
  assert.match(html, /Daniels Plan: Mo 9\.11\. · Neuköllnspeicher/);
  assert.match(html, /Angenommen über Auftrag: Ben &lt;b&gt;/);
  assert.equal(ctx.ordSlotHtml(vx(), 'teardown'), '');
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
  assert.match(html, /1 \/ 2 besetzt/);
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
