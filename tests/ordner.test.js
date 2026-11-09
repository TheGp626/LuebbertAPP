// Run from the repo root: node --test tests/ordner.test.js
// Loads utils.js, ui.js and ordner.js into one sandbox (as in index.html); only pure helpers are tested.
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
  for (const f of ['utils.js', 'ui.js', 'order-parser.js', 'ordner.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  }
});
const plain = v => JSON.parse(JSON.stringify(v));

test('ordnerMenuItems: folder actions only with the right to manage', () => {
  assert.deepEqual(plain(ctx.ordnerMenuItems(false, 'f1')), []);
  const items = plain(ctx.ordnerMenuItems(true, 'f1'));
  assert.deepEqual(items.map(i => i.label), ['Unterordner anlegen', 'PL & Einsätze', 'Ordner löschen']);
  assert.deepEqual(items[1], { label: 'PL & Einsätze', action: 'openOrdnerForm', args: ['f1'] });
  assert.equal(items[2].danger, true);
});

test('ordnerFileKind: image / video / file for the row icon', () => {
  assert.equal(ctx.ordnerFileKind('image/png', 'a.png'), 'image');
  assert.equal(ctx.ordnerFileKind('', 'Plan.JPG'), 'image');
  assert.equal(ctx.ordnerFileKind('video/mp4', 'x'), 'video');
  assert.equal(ctx.ordnerFileKind('application/pdf', 'Hallenplan.pdf'), 'file');
  assert.equal(ctx.ordnerFileKind('', ''), 'file');
});

test('ordnerFolderMenu: "Bearbeiten" opens the full folder form', () => {
  let items = null;
  ctx.openUiMenu = i => { items = i; };
  ctx.ordnerFolderMenu('f1');
  assert.deepEqual(plain(items), [{ label: 'Bearbeiten', action: 'openOrdnerForm', args: ['f1'] }]);
});

test('ordnerAutoDeleteDate: latest non-cancelled job + 7 days', () => {
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-10-01' }, { date: '2026-10-12' }, { date: '2026-10-05' }]), '2026-10-19');
  // cancelled jobs are ignored, even when they are the latest
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-10-01' }, { date: '2026-11-20', cancelled: true }]), '2026-10-08');
  // month and year rollover
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-10-28' }]), '2026-11-04');
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2026-12-28' }]), '2027-01-04');
  // leap day
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '2028-02-25' }]), '2028-03-03');
});

test('ordnerAutoDeleteDate: null without dated, non-cancelled jobs', () => {
  assert.equal(ctx.ordnerAutoDeleteDate([]), null);
  assert.equal(ctx.ordnerAutoDeleteDate(null), null);
  assert.equal(ctx.ordnerAutoDeleteDate([{ date: '' }, { date: null }, { date: '2026-10-01', cancelled: true }]), null);
});

test('ordnerDeleteInfo: date and days until deletion', () => {
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: null }, '2026-10-30'), null);
  assert.equal(ctx.ordnerDeleteInfo(null, '2026-10-30'), null);
  assert.deepEqual(plain(ctx.ordnerDeleteInfo({ ends_on: '2026-11-06' }, '2026-10-30')), { date: '2026-11-06', days: 7 });
  assert.deepEqual(plain(ctx.ordnerDeleteInfo({ ends_on: '2026-10-31' }, '2026-10-30')), { date: '2026-10-31', days: 1 });
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: '2026-10-30' }, '2026-10-30').days, 0);   // today
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: '2026-10-20' }, '2026-10-30').days, 0);   // overdue
  assert.equal(ctx.ordnerDeleteInfo({ ends_on: '2027-01-02' }, '2026-12-30').days, 3);   // year rollover
});

test('ordnerDeleteLabel / ordnerDeleteBadge: German texts', () => {
  assert.equal(ctx.ordnerDeleteLabel('2026-10-05'), 'Löschung am 05.10.2026');
  assert.equal(ctx.ordnerDeleteLabel(null), '');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 8 }), '');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 7 }), 'wird in 7 Tagen gelöscht');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 1 }), 'wird in 1 Tag gelöscht');
  assert.equal(ctx.ordnerDeleteBadge({ date: '2026-11-06', days: 0 }), 'wird heute gelöscht');
  assert.equal(ctx.ordnerDeleteBadge(null), '');
});

test('ordnerNextDeleteValue: the form follows the jobs unless the date was moved by hand', () => {
  // empty or still the old auto value → follows the new auto value
  assert.equal(ctx.ordnerNextDeleteValue('', '', '2026-10-19'), '2026-10-19');
  assert.equal(ctx.ordnerNextDeleteValue('2026-10-19', '2026-10-19', '2026-10-26'), '2026-10-26');
  // last job removed → field empties again
  assert.equal(ctx.ordnerNextDeleteValue('2026-10-19', '2026-10-19', ''), '');
  // moved by hand → kept
  assert.equal(ctx.ordnerNextDeleteValue('2026-12-01', '2026-10-19', '2026-10-26'), '2026-12-01');
  assert.equal(ctx.ordnerNextDeleteValue('2026-12-01', '', '2026-10-26'), '2026-12-01');
});

test('ordnerViewerKind: HEIC/HEIF is download-only, other images/PDFs are viewable', () => {
  assert.equal(ctx.ordnerViewerKind('image/heic', 'https://x/a.heic'), 'file');
  assert.equal(ctx.ordnerViewerKind('image/heif', 'https://x/a'), 'file');
  assert.equal(ctx.ordnerViewerKind('', 'https://x/IMG.HEIC?t=1'), 'file');
  assert.equal(ctx.ordnerViewerKind('image/jpeg', 'https://x/a.jpg'), 'image');
  assert.equal(ctx.ordnerViewerKind('', 'https://x/a.png?x=1'), 'image');
  assert.equal(ctx.ordnerViewerKind('application/pdf', 'https://x/a'), 'pdf');
  assert.equal(ctx.ordnerViewerKind('application/zip', 'https://x/a.zip'), 'file');
});

test('ordnerRemoveFiles: storage { error } counts as failure (remove() does not throw)', async () => {
  const mk = r => ({ storage: { from: () => ({ remove: async () => r }) } });
  ctx.supabaseClient = mk({ data: null, error: { message: 'denied' } });
  assert.equal(await ctx.ordnerRemoveFiles(['a/b.png']), false);
  ctx.supabaseClient = { storage: { from: () => ({ remove: async () => { throw new Error('net'); } }) } };
  assert.equal(await ctx.ordnerRemoveFiles(['a/b.png']), false);
  ctx.supabaseClient = mk({ data: [], error: null });
  assert.equal(await ctx.ordnerRemoveFiles(['a/b.png']), true);
  assert.equal(await ctx.ordnerRemoveFiles([]), true);
});

test('saveOrdner: a second call while the first save runs is ignored (no duplicate folder)', async () => {
  let inserts = 0;
  const els = { 'inp-ordner-name': { value: 'Neu' }, 'inp-ordner-desc': { value: '' }, 'inp-ordner-pl': { value: '' }, 'inp-ordner-ends': { value: '' } };
  ctx.document.getElementById = id => els[id] || null;
  ctx.document.querySelectorAll = () => [];
  ctx.showToast = () => {};
  ctx.closeOrdnerForm = () => {};
  ctx.fetchOrdner = async () => {};
  ctx.supabaseClient = { from: () => ({ insert: () => ({ select: () => ({ single: async () => { inserts++; await new Promise(r => setImmediate(r)); return { data: { id: 'f1' }, error: null }; } }) }) }) };
  await Promise.all([ctx.saveOrdner(), ctx.saveOrdner()]);
  assert.equal(inserts, 1);
});

const BASE = 'https://x.supabase.co/storage/v1/object/public/project-files/';
test('projectFilePath: path after /project-files/, decoded, no query; foreign/empty → null', () => {
  assert.equal(ctx.projectFilePath(BASE + 'f1/plan.pdf'), 'f1/plan.pdf');
  assert.equal(ctx.projectFilePath(BASE + 'f1/Gr%C3%BCn%20Plan.pdf?t=1'), 'f1/Grün Plan.pdf');
  assert.equal(ctx.projectFilePath(BASE + 'f1/100%.pdf'), 'f1/100%.pdf'); // malformed escape: raw path
  assert.equal(ctx.projectFilePath('https://x.supabase.co/storage/v1/object/public/product-images/a.png'), null);
  assert.equal(ctx.projectFilePath(''), null);
  assert.equal(ctx.projectFilePath(null), null);
});
test('openOrdnerFileById: viewer gets the signed link (also used for download)', async () => {
  let asked, shown;
  ctx.supabaseClient = { storage: { from: b => ({ createSignedUrl: async (p, s) => { asked = [b, p, s]; return { data: { signedUrl: 'https://signed/1' }, error: null }; } }) } };
  ctx.ordnerFiles = [{ id: 'a', name: 'Plan.pdf', file_type: 'application/pdf', file_url: BASE + 'f1/plan.pdf' }];
  ctx.openFileViewer = (u, n, t) => { shown = [u, n, t]; };
  await ctx.openOrdnerFileById('a');
  assert.deepEqual(asked, ['project-files', 'f1/plan.pdf', 3600]);
  assert.deepEqual(shown, ['https://signed/1', 'Plan.pdf', 'application/pdf']);
});
test('openOrdnerFileById: signing fails → toast, no viewer', async () => {
  let toast = null, shown = false;
  ctx.supabaseClient = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: new Error('offline') }) }) } };
  ctx.ordnerFiles = [{ id: 'a', name: 'x', file_url: BASE + 'f1/x.jpg' }];
  ctx.openFileViewer = () => { shown = true; };
  ctx.showToast = t => { toast = t; };
  await ctx.openOrdnerFileById('a');
  assert.equal(shown, false);
  assert.equal(toast, 'Datei konnte nicht geöffnet werden');
});
test('openOrdnerFileById: a second tap while signing is ignored', async () => {
  let calls = 0, release;
  ctx.supabaseClient = { storage: { from: () => ({ createSignedUrl: () => { calls++; return new Promise(r => { release = () => r({ data: { signedUrl: 's' }, error: null }); }); } }) } };
  ctx.ordnerFiles = [{ id: 'a', name: 'x', file_url: BASE + 'f1/x.jpg' }];
  let views = 0; ctx.openFileViewer = () => { views++; };
  const p1 = ctx.openOrdnerFileById('a'); const p2 = ctx.openOrdnerFileById('a');
  release(); await p1; await p2;
  assert.equal(calls, 1); assert.equal(views, 1);
});
test('pdfFallbackHtml: when pdf.js fails only a download link is offered — never a third-party viewer', () => {
  const html = ctx.pdfFallbackHtml('https://x/sign/project-files/a.pdf?token=t&x="1"');
  assert.ok(html.includes('Herunterladen'));
  assert.ok(html.includes('token=t&amp;x=&quot;1&quot;'), 'url is escaped');
  assert.ok(!/docs\.google|viewer\?url=/.test(html));
  assert.ok(!/docs\.google\.com/.test(fs.readFileSync(path.join(__dirname, '../js/ordner.js'), 'utf8')));
});

// ── Role RLS task 3 ──
function stubSb(rows) {
  const calls = [];
  const mk = (table) => {
    const b = { select(c) { calls.push({ table, select: c }); return b; }, order() { return b; }, eq() { return b; }, in() { return b; },
      then(res, rej) { return Promise.resolve({ data: rows[table] || [], error: null }).then(res, rej); } };
    return b;
  };
  ctx.supabaseClient = { calls, from: mk, rpc: (fn) => { calls.push({ rpc: fn }); return Promise.resolve({ data: rows.dir || [], error: null }); } };
  return calls;
}

test('loadOrdnerUsers: office role reads app_users incl. role_rates; MA/Gast use user_directory', async () => {
  let calls = stubSb({ app_users: [{ id: 'a', full_name: 'A' }] });
  ctx.userRole = 'AL';
  await ctx.loadOrdnerUsers();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, 'app_users');
  assert.match(calls[0].select, /role_rates/);
  for (const role of ['MA', 'Gast']) {
    vm.runInContext('_ordnerUsers = null', ctx);
    calls = stubSb({ dir: [{ id: 'a', full_name: 'A' }] });
    ctx.userRole = role;
    await ctx.loadOrdnerUsers();
    assert.deepEqual(plain(calls), [{ rpc: 'user_directory' }], role);
  }
});

test('renderOrdnerEinsaetze: AL name from directory; protocols queried for office roles only', async () => {
  const einsaetze = [{ id: 'e1', date: '2026-01-05', action: 'Aufbau', al_id: 'al1', cancelled: false }];
  for (const [role, expectProt] of [['MA', false], ['AL', true]]) {
    vm.runInContext('_ordnerUsers = null', ctx);
    const calls = stubSb({ einsaetze, app_users: [], dir: [{ id: 'al1', full_name: 'Anna AL', role: 'AL', is_active: true }] });
    // office path reads app_users for the directory: provide the same person there
    ctx.supabaseClient.from = (t) => stubFrom(t);
    function stubFrom(t) {
      const bb = { select(c) { calls.push({ table: t, select: c }); return bb; }, order() { return bb; }, eq() { return bb; }, in() { return bb; },
        then(res, rej) { const d = t === 'einsaetze' ? einsaetze : t === 'app_users' ? [{ id: 'al1', full_name: 'Anna AL', role: 'AL' }] : []; return Promise.resolve({ data: d, error: null }).then(res, rej); } };
      return bb;
    }
    ctx.userRole = role;
    const box = { style: {}, innerHTML: '' };
    ctx.document.getElementById = id => (id === 'ordner-einsaetze' ? box : null);
    vm.runInContext('aktuellerOrdner = { id: "f1", pl_id: null }', ctx);
    await ctx.renderOrdnerEinsaetze({ id: 'f1', pl_id: null });
    assert.equal(calls.some(c => c.table === 'protocols'), expectProt, role);
    assert.equal(calls.find(c => c.table === 'einsaetze').select.includes('app_users'), false);
    assert.match(box.innerHTML, /AL Anna AL/, role);
  }
});

// ── Auftragsbestätigung im Ordner-Formular ──
const ALS = [
  { id: 'u1', full_name: 'Max Mustermann', role: 'AL', is_active: true },
  { id: 'u2', full_name: 'Ana Lopez', role: 'MA', role_rates: [{ role: 'AL' }], is_active: true },
  { id: 'u3', full_name: 'Ben Alt', role: 'AL', is_active: false },
  { id: 'u4', full_name: 'Max Muster', role: 'MA', is_active: true },
];
test('ordnerMatchAl: exact name, all words, AL role (also via role_rates), active only, first fitting part', () => {
  assert.equal(ctx.ordnerMatchAl('Max Mustermann', ALS), 'u1');
  assert.equal(ctx.ordnerMatchAl('  ana   LOPEZ ', ALS), 'u2');
  assert.equal(ctx.ordnerMatchAl('Lopez', ALS), 'u2');
  assert.equal(ctx.ordnerMatchAl('Herr Krause, Ana Lopez', ALS), 'u2');
  assert.equal(ctx.ordnerMatchAl('Max Muster', ALS), '');      // u4 is no AL; "Muster" ≠ "Mustermann"
  assert.equal(ctx.ordnerMatchAl('Ben Alt', ALS), '');         // inactive
  assert.equal(ctx.ordnerMatchAl('', ALS), '');
});

test('ordnerAbRows: one Aufbau and one Abbau row per job, skips phases already in the form', () => {
  const parsed = { jobs: [
    { jobNo: '26-0447.01', lead: 'Max Mustermann', setup: { start: '2026-11-11T09:00' }, event: { start: '2026-11-12' }, teardown: { start: '2026-11-13T08:00' } },
    { jobNo: '26-0447.02', lead: '', setup: { start: '2026-11-11' }, teardown: null },
  ] };
  const rows = plain(ctx.ordnerAbRows(parsed, ALS, { '26-0447.01|teardown': true }));
  assert.deepEqual(rows, [
    { date: '2026-11-11', action: 'Aufbau', al_id: 'u1', job_no: '26-0447.01', phase: 'setup' },
    { date: '2026-11-11', action: 'Aufbau', al_id: '', job_no: '26-0447.02', phase: 'setup' },
  ]);
});

test('ordnerStaffRows: MA numbers per job from tagged rows; untagged ignored, empty = null, earliest row wins', () => {
  const rows = plain(ctx.ordnerStaffRows([
    { job_no: '26-0447.01', phase: 'setup', staff: '3', date: '2026-11-11' },
    { job_no: '26-0447.01', phase: 'teardown', staff: '', date: '2026-11-13' },
    { job_no: '26-0447.01', phase: 'setup', staff: '5', date: '2026-11-12' },
    { job_no: null, phase: null, staff: '9', date: '2026-11-01' },
  ]));
  assert.deepEqual(rows, [{ job_no: '26-0447.01', staff_setup: 3, staff_teardown: null }]);
});

test('ordnerAbRows: shared Abbau of several jobs is one row (also_jobs), Umbau from the job name', () => {
  const T = { start: '2026-11-05T01:00', end: '2026-11-05T06:00' };
  const parsed = { jobs: [
    { jobNo: '26-0394.01', name: 'CH II // Aufbau 01.11.', lead: '', setup: { start: '2026-11-01T17:00' }, teardown: T },
    { jobNo: '26-0394.02', name: 'CH II // Deko für 02.11.', lead: '', setup: { start: '2026-11-02T08:00' }, teardown: T },
    { jobNo: '26-0394.03', name: 'CH II // 04.11. Umbau AVA', lead: '', setup: { start: '2026-11-04T16:00' }, teardown: T },
  ] };
  const rows = plain(ctx.ordnerAbRows(parsed, ALS, {}));
  assert.deepEqual(rows.map(r => [r.date, r.action, r.job_no, r.phase, (r.also_jobs || []).join()]), [
    ['2026-11-01', 'Aufbau', '26-0394.01', 'setup', ''],
    ['2026-11-02', 'Aufbau', '26-0394.02', 'setup', ''],
    ['2026-11-04', 'Umbau', '26-0394.03', 'setup', ''],
    ['2026-11-05', 'Abbau', '26-0394.01', 'teardown', '26-0394.02,26-0394.03'],
  ]);
});

test('ordnerStaffRows: jobs that share a phase get 0 MA for it, so it shows up once', () => {
  const rows = plain(ctx.ordnerStaffRows([
    { job_no: '26-0394.01', phase: 'teardown', staff: '4', date: '2026-11-05', also_jobs: ['26-0394.02'] },
    { job_no: '26-0394.02', phase: 'setup', staff: '2', date: '2026-11-02' },
  ]));
  assert.deepEqual(rows, [
    { job_no: '26-0394.02', staff_setup: 2, staff_teardown: 0 },
    { job_no: '26-0394.01', staff_teardown: 4 },
  ]);
});

test('ordnerAbRows: further days of the day plan are plain rows, once; a job phase on the same day covers them', () => {
  const days = [
    { date: '2026-10-11', action: 'Aufbau' }, { date: '2026-10-12', action: 'Aufbau' }, { date: '2026-10-13', action: 'Aufbau' },
    { date: '2026-10-14', action: 'Umbau' }, { date: '2026-10-16', action: 'Abbau' }, { date: '2026-10-18', action: 'Abbau' },
  ];
  const plan = { setup: { start: '2026-10-11', end: null }, teardown: { start: '2026-10-16', end: '2026-10-18' }, days };
  const parsed = { jobs: [
    Object.assign({ jobNo: '26-0193.01', name: 'Rotunde', lead: 'Max Mustermann' }, plan),
    Object.assign({ jobNo: '26-0193.02', name: 'Catering', lead: '' }, plan),
    { jobNo: '26-0193.03', name: 'Lounge', lead: '', setup: { start: '2026-10-12T14:00' }, teardown: { start: '2026-10-16T14:00' } },
  ] };
  const rows = plain(ctx.ordnerAbRows(parsed, ALS, {}));
  assert.deepEqual(rows.map(r => [r.date, r.action, r.job_no || '-']), [
    ['2026-10-11', 'Aufbau', '26-0193.01'],
    ['2026-10-12', 'Aufbau', '26-0193.03'],
    ['2026-10-13', 'Aufbau', '-'],
    ['2026-10-14', 'Umbau', '-'],
    ['2026-10-16', 'Abbau', '26-0193.01'],
    ['2026-10-16', 'Abbau', '26-0193.03'],
    ['2026-10-18', 'Abbau', '-'],
  ]);
  assert.equal(rows[2].al_id, 'u1');
});
