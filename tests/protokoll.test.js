// Run from the repo root: node --test tests/protokoll.test.js
// Loads formulas.js, utils.js, protokoll.js and plan-parser.js into one sandbox with a fake Supabase client.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function fakeSupabase() {
  const fb = { calls: [], fail: {}, rows: {}, nextId: 1 };
  fb.from = table => {
    const q = { table, op: 'select', payload: null, filters: [] };
    const b = {
      select() { return b; }, order() { return b; }, limit() { return b; }, or() { return b; },
      eq(k, v) { q.filters.push([k, v]); return b; },
      in(k, v) { q.filters.push([k + ' in', v]); return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      delete() { q.op = 'delete'; return b; },
      maybeSingle() { q.single = true; return b; }, single() { q.single = true; return b; },
      then(res, rej) {
        fb.calls.push(q);
        const err = fb.fail[table + '.' + q.op];
        let data = null;
        if (!err) {
          if (q.op === 'insert') {
            const arr = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(x => Object.assign({ id: table + '-' + fb.nextId++ }, x));
            data = q.single ? arr[0] : arr;
          } else if (q.op === 'update') {
            data = fb.rows[table + '.update'] !== undefined ? fb.rows[table + '.update'] : [{ id: q.filters[0] && q.filters[0][1] }];
          } else if (q.op === 'select') {
            data = fb.rows[table] !== undefined ? fb.rows[table] : (q.single ? null : []);
          }
        }
        return Promise.resolve({ data, error: err || null }).then(res, rej);
      },
    };
    return b;
  };
  fb.functions = { invoke: async () => ({ data: { sent: true }, error: null }) };
  return fb;
}

let ctx, sb, store, dom;
function load() {
  store = {};
  dom = {};
  sb = fakeSupabase();
  ctx = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    document: { getElementById: id => dom[id] || null, querySelector: () => null },
    navigator: { onLine: true },
    setTimeout: () => 0,
    supabaseClient: sb,
    currentUser: { id: 'u-me' },
  });
  for (const f of ['formulas.js', 'utils.js', 'protokoll.js', 'plan-parser.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  }
  // UI helpers the module calls; not under test
  vm.runInContext('showToast = function(){}; updateTopBarSub = function(){}; sendMailForEntry = async function(){ return true; }; renderProtHistory = function(){};', ctx);
}
beforeEach(load);
const run = code => vm.runInContext(code, ctx);
const plain = v => JSON.parse(JSON.stringify(v));

function protData(extra) {
  return Object.assign({
    event: 'Gala', location: 'Estrel', date: '2026-10-28', action: 'Aufbau',
    alId: 'u-al', plId: 'u-pl', al: 'Anna', pl: 'Paul',
    damages: 'nein', incidents: 'nein', feedback: '—',
    transports: [{ type: 'Sprinter', driver: 'Tom', punctuality: 'pünktlich', delay: '' }],
    personnel: [{ pos: 'MA', userId: 'u-ma', name: 'Max', start: '08:00', end: '16:00', pause: '30' }],
    categories: { mobiliar: { active: true, status: 'okay', note: '' } },
    totalCost: '100,00 €',
  }, extra || {});
}

// ── Finding 1: child insert failures must fail the sync ──
test('sync: failed shift insert returns null and reports the created row id', async () => {
  sb.rows.projects = { id: 'proj-1' };
  sb.fail['shifts.insert'] = { message: 'boom' };
  ctx.__data = protData();
  const out = {};
  ctx.__out = out;
  const res = await run('syncProtokollToSupabase(__data, null, __out)');
  assert.equal(res, null);
  assert.ok(out.protId, 'row id of the inserted protocol is reported');
});

for (const t of ['protocol_transports', 'protocol_equipments', 'worker_ratings']) {
  test('sync: failed ' + t + ' insert fails the sync', async () => {
    sb.rows.projects = { id: 'proj-1' };
    sb.fail[t + '.insert'] = { message: 'boom' };
    ctx.__data = protData({ personnel: [{ pos: 'Zenjob', isTemp: true, tempName: 'Zed', name: 'Zed', start: '08:00', end: '16:00', pause: '0', rating: 'up' }] });
    assert.equal(await run('syncProtokollToSupabase(__data, null)'), null);
  });
}

test('sync: failed ratings delete on edit fails the sync', async () => {
  sb.rows.projects = { id: 'proj-1' };
  sb.fail['worker_ratings.delete'] = { message: 'boom' };
  ctx.__data = protData();
  assert.equal(await run('syncProtokollToSupabase(__data, "prot-9")'), null);
});

test('retry: a partially inserted protocol is updated on the next try, not inserted twice', async () => {
  sb.rows.projects = { id: 'proj-1' };
  const entry = Object.assign(protData(), { id: 'L1', supabaseId: null, synced: false, isUpdate: false });
  store.luebbert_protokoll_history = JSON.stringify([entry]);
  sb.fail['shifts.insert'] = { message: 'offline' };
  await run('retrySyncAllProtocols()');
  let arch = JSON.parse(store.luebbert_protokoll_history);
  assert.equal(arch[0].synced, false);
  assert.ok(arch[0].supabaseId, 'partial row id is remembered');
  assert.equal(arch[0].isUpdate, false, 'still mailed as a new protocol');
  delete sb.fail['shifts.insert'];
  sb.calls.length = 0;
  await run('retrySyncAllProtocols()');
  arch = JSON.parse(store.luebbert_protokoll_history);
  assert.equal(arch[0].synced, true);
  assert.equal(sb.calls.filter(c => c.table === 'protocols' && c.op === 'insert').length, 0);
  assert.equal(sb.calls.filter(c => c.table === 'protocols' && c.op === 'update').length, 1);
  assert.equal(sb.calls.filter(c => c.table === 'shifts' && c.op === 'insert').length, 1);
});

// ── Finding 3: holiday flag ──
test('sync: is_holiday comes from the data, not from an unset protState.holiday', async () => {
  sb.rows.projects = { id: 'proj-1' };
  ctx.__data = protData({ holiday: true });
  await run('syncProtokollToSupabase(__data, null)');
  const ins = sb.calls.find(c => c.table === 'protocols' && c.op === 'insert');
  assert.equal(ins.payload.is_holiday, true);
});

// ── Finding 13: fest flag survives an offline start ──
test('sync: fest flag on the personnel row is used when the user list is empty', async () => {
  sb.rows.projects = { id: 'proj-1' };
  ctx.__data = protData({ personnel: [{ pos: 'MA', userId: 'u-ma', name: 'Max', fest: true, start: '08:00', end: '16:00', pause: '0' }] });
  await run('syncProtokollToSupabase(__data, null)');
  const sh = sb.calls.find(c => c.table === 'shifts' && c.op === 'insert');
  assert.equal(sh.payload[0].position_role, 'MA fest');
});

test('protBasePos', () => {
  const users = [{ id: 'f', is_fest: true }, { id: 'x', is_fest: false }];
  assert.equal(run('protBasePos')({ pos: 'MA', userId: 'f' }, users), 'MA fest');
  assert.equal(run('protBasePos')({ pos: 'MA', userId: 'x' }, users), 'MA frei');
  assert.equal(run('protBasePos')({ pos: 'MA', userId: 'f', fest: true }, []), 'MA fest');
  assert.equal(run('protBasePos')({ pos: 'AL', userId: 'f', isTemp: true }, users), 'AL frei');
  assert.equal(run('protBasePos')({ pos: 'Fahrer', userId: '' }, users), 'Fahrer frei');
  assert.equal(run('protBasePos')({ pos: 'Zenjob', userId: 'f' }, users), 'Zenjob');
});

test('protSelectedId keeps the known id until the user list has loaded', () => {
  const f = run('protSelectedId');
  assert.equal(f('', 'u1', false), 'u1');
  assert.equal(f('', 'u1', true), null);
  assert.equal(f('u2', 'u1', false), 'u2');
  assert.equal(f('', null, false), null);
});

// ── Finding 12: draft owner ──
test('protDraftBelongsTo', () => {
  const f = run('protDraftBelongsTo');
  assert.equal(f({ ownerId: 'a' }, 'a'), true);
  assert.equal(f({ ownerId: 'a' }, 'b'), false);
  assert.equal(f({}, 'b'), true);
  assert.equal(f({ ownerId: 'a' }, null), true);
});

test('loadProtDraft discards a draft of another user', () => {
  store.luebbert_protokoll_draft = JSON.stringify({ ownerId: 'u-other', editingId: 'prot-x', personnel: [{ pos: 'MA' }] });
  assert.equal(run('loadProtDraft()'), false);
  assert.equal(store.luebbert_protokoll_draft, undefined);
  assert.equal(run('protState.editingId'), null);
});

test('loadProtDraft keeps own and legacy drafts', () => {
  store.luebbert_protokoll_draft = JSON.stringify({ ownerId: 'u-me', editingId: 'prot-x' });
  assert.equal(run('loadProtDraft()'), true);
  assert.equal(run('protState.editingId'), 'prot-x');
  store.luebbert_protokoll_draft = JSON.stringify({ editingId: 'prot-y' });
  assert.equal(run('loadProtDraft()'), true);
  assert.equal(run('protState.editingId'), 'prot-y');
});

test('saveProtDraft stores the owner and keeps the AL id while the select is empty', () => {
  dom['prot-al'] = { value: '' };
  run('protState.alId = "u-al"; saveProtDraft()');
  const d = JSON.parse(store.luebbert_protokoll_draft);
  assert.equal(d.ownerId, 'u-me');
  assert.equal(d.alId, 'u-al');
});

// ── Finding 2: re-sync keeps unsynced local edits ──
test('mergeProtHistory keeps an unsynced local edit', () => {
  const archive = [{ id: 'L1', supabaseId: 'S1', event: 'local edit', synced: false }, { id: 'S2', supabaseId: 'S2', event: 'old', synced: true, mailed: false, signature: 'sig' }];
  const out = plain(run('mergeProtHistory')(archive, [
    { id: 'S1', supabaseId: 'S1', event: 'server', synced: true },
    { id: 'S2', supabaseId: 'S2', event: 'server2', synced: true },
    { id: 'S3', supabaseId: 'S3', event: 'new', synced: true },
  ]));
  assert.equal(out[0].event, 'local edit');
  assert.equal(out[0].synced, false);
  assert.equal(out[1].event, 'server2');
  assert.equal(out[1].signature, 'sig');
  assert.equal(out[1].mailed, false);
  assert.equal(out[2].mailed, true);
  assert.equal(out[2].signature, null);
});

// ── Shared row mapper (history + dashboard PDF) ──
test('protRowToEntry maps a server row with null location and numbers', () => {
  const e = plain(run('protRowToEntry')({
    id: 'S1', date: '2026-10-28', action: 'Abbau', is_holiday: true, total_cost: 12.5,
    projects: { name: 'Gala', location: null }, al: null, al_name_fallback: 'Anna', signature_text: 'data:sig',
    shifts: [{ id: 'sh1', user_id: 'u1', position_role: 'MA fest', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 30, app_users: { full_name: 'Max' } }],
    protocol_equipments: [{ category_id: 'stoffe', status: 'okay', hussen_delivered: 5, hussen_returned: 4 }],
    protocol_transports: [{ vehicle_type: 'Solo', driver_name: null, punctuality: null, delay_mins: 0 }],
  }));
  assert.equal(e.location, '—');
  assert.equal(e.holiday, true);
  assert.equal(e.totalCost, '12,50 €');
  assert.equal(e.al, 'Anna');
  assert.equal(e.signature, 'data:sig');
  assert.deepEqual([e.personnel[0].pos, e.personnel[0].fest, e.personnel[0].start], ['MA', true, '08:00']);
});

// ── Finding 5: PDF builder stringifies values ──
function fakeDoc() {
  const texts = [];
  const doc = new Proxy({}, { get: (_, k) => {
    if (k === 'text') return (t) => { if (typeof t !== 'string' && !Array.isArray(t)) throw new Error('Invalid arguments passed to jsPDF.text: ' + JSON.stringify(t)); texts.push(t); };
    if (k === 'getTextWidth') return s => String(s).length;
    if (k === 'splitTextToSize') return s => [String(s)];
    return () => {};
  } });
  return { doc, texts };
}

test('buildProtPdfDoc survives numbers and nulls from a re-synced entry', () => {
  const fd = fakeDoc();
  ctx.jspdf = { jsPDF: function() { return fd.doc; } };
  ctx.__e = {
    event: 'Gala', location: null, date: '2026-10-28', action: 'Aufbau', al: 'Anna', pl: null, holiday: false,
    transports: [{ type: 'Solo', driver: null, punctuality: null, delay: 0 }],
    personnel: [{ pos: 'MA', userId: 'u1', fest: true, name: 'Max', start: '08:00', end: '16:00', pause: 30 }],
    categories: { stoffe: { active: true, status: 'okay', note: '', hussenDelivered: 5, hussenReturned: 4 } },
    totalCost: '0,00 €',
  };
  run('buildProtPdfDoc(__e)');
  assert.ok(fd.texts.includes('5') && fd.texts.includes('4'));
  // Finding 14: position label from the fest flag
  assert.ok(fd.texts.includes('MA fest'));
});

test('pdfStr', () => {
  const f = run('pdfStr');
  assert.equal(f(5), '5');
  assert.equal(f(null, '—'), '—');
  assert.equal(f('', '0'), '0');
  assert.equal(f(0, '—'), '0');
});

test('protSectionStatus: check marks per section (hints only)', () => {
  const protSectionStatus = (...a) => plain(ctx.protSectionStatus(...a));
  const st = { transports: [], personnel: [{ start: '08:00', end: '' }], categories: { a: { active: true, status: '' }, b: { active: false } }, signature: null };
  assert.deepEqual(protSectionStatus(st, { event: 'X', date: '2026-10-29', alId: 'u1' }, { transport: false }),
    { basis: true, transport: false, equipment: false, personal: false, vorkommnisse: true, unterschrift: false });
  st.categories.a.status = 'okay'; st.personnel[0].end = '16:00'; st.signature = 'data:';
  assert.deepEqual(protSectionStatus(st, { event: 'X', date: '', alId: 'u1' }, { transport: true }),
    { basis: false, transport: true, equipment: true, personal: true, vorkommnisse: true, unterschrift: true });
  // no categories at all counts as complete, a transport makes the section complete without opening it
  assert.equal(protSectionStatus({ transports: [{}], personnel: [], categories: {}, signature: null }, {}, {}).transport, true);
  assert.equal(protSectionStatus({ transports: [], personnel: [], categories: {}, signature: null }, {}, {}).equipment, true);
});

test('protTransportSummary / protPersonSummary: one-line row summaries', () => {
  assert.equal(ctx.protTransportSummary({ type: 'Sprinter', driver: 'Max', punctuality: 'pünktlich' }), 'Sprinter · Max · pünktlich');
  assert.equal(ctx.protTransportSummary({ type: 'LKW', driver: '', punctuality: 'verspätet', delay: '20' }), 'LKW · ohne Fahrer · 20 min Verspätung');
  assert.equal(ctx.protTransportSummary({ type: 'LKW', driver: ' ', punctuality: 'verspätet', delay: '' }), 'LKW · ohne Fahrer · Verspätung');
  assert.equal(ctx.protPersonSummary({ start: '08:00', end: '16:30', pause: '30' }), '08:00–16:30 · 30 min');
  assert.equal(ctx.protPersonSummary({ start: '08:00', end: '16:30', pause: '0' }), '08:00–16:30');
  assert.equal(ctx.protPersonSummary({ start: '', end: '', pause: '0' }), 'Zeiten fehlen');
  assert.equal(ctx.protPersonSummary({ start: '08:00', end: '', pause: '0' }), 'ab 08:00 · Ende fehlt');
});

test('protShiftOpenRows: removing a row moves the open state of the rows after it', () => {
  run("protOpenRows = { t0: true, t2: true, p1: true }; protShiftOpenRows('t', 1);");
  assert.deepEqual(plain(ctx.protOpenRows), { t0: true, t1: true, p1: true });
});

// Characterization: the total of the unchanged calcProtCosts for a fixed protocol (Sprinter + AL + 2 MA, 28.10.2026, no holiday)
const COST_FIXTURE = {
  transports: [{ type: 'Sprinter', driver: 'Tom', punctuality: 'pünktlich', delay: '' }],
  personnel: [
    { pos: 'AL', isTemp: true, tempName: 'Anna', name: 'Anna', start: '08:00', end: '16:30', pause: '30' },
    { pos: 'MA', isTemp: true, tempName: 'Max', name: 'Max', start: '08:00', end: '16:30', pause: '30' },
    { pos: 'Zenjob', isTemp: true, tempName: 'Z1', name: 'Z1', start: '22:00', end: '02:00', pause: '0' }
  ],
  categories: {}, signature: null
};

test('calcProtCosts total is pinned (characterization before extracting protCostLines)', () => {
  dom['prot-date'] = { value: '2026-10-28' };
  dom['prot-isholiday'] = { checked: false };
  dom['prot-total-cost'] = { textContent: '' };
  run('protState = ' + JSON.stringify(COST_FIXTURE) + '; calcProtCosts();');
  assert.equal(dom['prot-total-cost'].textContent, '529,52');
});

test('protCostLines: same total as calcProtCosts, one line per transport and person', () => {
  const r = plain(ctx.protCostLines(JSON.parse(JSON.stringify(COST_FIXTURE)), '2026-10-28', false));
  assert.equal(r.total.toFixed(2), '529.52');
  assert.equal(r.lines.length, 4);
  assert.equal(r.lines[0].label, 'Sprinter');
  assert.equal(r.lines[1].label, 'Anna (AL)');
  assert.equal(r.lines.reduce((s, l) => s + l.amount, 0).toFixed(2), '529.52');
  // a person without end time costs nothing and gets no line
  const r2 = plain(ctx.protCostLines({ transports: [], personnel: [{ pos: 'MA', isTemp: true, name: 'X', start: '08:00', end: '' }] }, '2026-10-28', false));
  assert.deepEqual(r2, { lines: [], total: 0 });
});

// ── Driver hours (cost only) ──
const withDriver = (t, extra) => Object.assign(JSON.parse(JSON.stringify(COST_FIXTURE)), { transports: [Object.assign({ type: 'Sprinter', driver: 'Tom', punctuality: 'pünktlich', delay: '' }, t)] }, extra || {});

test('protCostLines: driver with hours adds a line, unregistered driver is billed as Fahrer frei', () => {
  const r = plain(ctx.protCostLines(withDriver({ hours: 5 }), '2026-10-28', false));
  assert.equal(r.lines.length, 5);
  assert.deepEqual(r.lines[1], { label: 'Fahrer Tom', amount: 150 });
  assert.equal(r.total.toFixed(2), (529.52 + 150).toFixed(2));
  // hours typed into the field arrive as strings
  assert.equal(plain(ctx.protCostLines(withDriver({ hours: '2.5' }), '2026-10-28', false)).lines[1].amount, 75);
});

test('protCostLines: no hours (old draft / row), zero hours or no driver → no driver line, fixture total unchanged', () => {
  [{}, { hours: 0 }, { hours: null }, { hours: '' }, { hours: 5, driver: '' }].forEach(t => {
    const r = plain(ctx.protCostLines(withDriver(t), '2026-10-28', false));
    assert.equal(r.lines.length, 4);
    assert.equal(r.total.toFixed(2), '529.52');
  });
});

test('protCostLines: registered driver uses fest/frei and the personal rate', () => {
  run("appUsers = [{ id: 'd-fest', is_fest: true }, { id: 'd-frei', role_rates: [{ role: 'Fahrer frei', rate_internal: '28' }] }, { id: 'd-std' }]");
  const amount = id => plain(ctx.protCostLines(withDriver({ hours: 5, driverUserId: id }), '2026-10-28', false)).lines[1].amount;
  assert.equal(amount('d-fest'), 0);
  assert.equal(amount('d-frei'), 140);
  assert.equal(amount('d-std'), 150);
});

test('protDriverBusyCount / protDriverHint: same driver by id, else by name, in the form and on other protocols', () => {
  const form = [{ driver: 'Tom', driverUserId: 'u1' }, { driver: 'tom ', driverUserId: '' }, { driver: 'Zoe' }, { driver: '' }];
  const others = [{ driver_name: 'Tom', driver_user_id: 'u1' }, { driver_name: 'Zoe', driver_user_id: null }, { driver_name: 'Tom', driver_user_id: 'u2' }];
  // id match: other form row has no id → compared by name; db row with other id doesn't count
  assert.equal(ctx.protDriverBusyCount(form, 0, others), 2);
  assert.equal(ctx.protDriverBusyCount(form, 2, others), 1);
  assert.equal(ctx.protDriverBusyCount(form, 3, others), 0);
  assert.equal(ctx.protDriverHint('Tom', 1), 'Tom hat an diesem Tag schon 1 weitere Tour – Stunden ggf. aufteilen.');
  assert.equal(ctx.protDriverHint('Tom', 2), 'Tom hat an diesem Tag schon 2 weitere Touren – Stunden ggf. aufteilen.');
  assert.equal(ctx.protDriverHint('Tom', 0), '');
});

test('protTransportSummary shows the driver hours', () => {
  assert.equal(ctx.protTransportSummary({ type: 'Sprinter', driver: 'Marcin', hours: 5, punctuality: 'pünktlich' }), 'Sprinter · Marcin · 5 h · pünktlich');
  assert.equal(ctx.protTransportSummary({ type: 'Sprinter', driver: 'Marcin', punctuality: 'pünktlich' }), 'Sprinter · Marcin · pünktlich');
});

test('sync: driver hours and user id are saved on the transport row', async () => {
  sb.rows.projects = { id: 'proj-1' };
  ctx.__data = protData({ transports: [{ type: 'Sprinter', driver: 'Tom', driverUserId: 'u-tom', hours: '5', punctuality: 'pünktlich', delay: '' }, { type: 'PKW', driver: '', punctuality: 'pünktlich', delay: '' }] });
  await run('syncProtokollToSupabase(__data, null)');
  const ins = plain(sb.calls.find(c => c.table === 'protocol_transports' && c.op === 'insert').payload);
  assert.equal(ins[0].driver_hours, 5);
  assert.equal(ins[0].driver_user_id, 'u-tom');
  assert.equal(ins[1].driver_hours, null);
  assert.equal(ins[1].driver_user_id, null);
});

test('protRowToEntry maps driver hours and user id back; old rows stay without hours', () => {
  const e = plain(ctx.protRowToEntry({ id: 'x', protocol_transports: [
    { vehicle_type: 'Sprinter', driver_name: 'Tom', driver_hours: 5, driver_user_id: 'u1', punctuality: 'pünktlich', delay_mins: 0 },
    { vehicle_type: 'PKW', driver_name: 'Zoe', driver_hours: null, driver_user_id: null, punctuality: 'pünktlich', delay_mins: 0 }] }));
  assert.equal(e.transports[0].hours, 5);
  assert.equal(e.transports[0].driverUserId, 'u1');
  assert.equal(e.transports[1].hours, null);
  assert.equal(e.transports[1].driverUserId, '');
});

// ── Personnel prefill from a Wochenplan shift ──
const planShift = extra => Object.assign({ date: '2026-10-30', wann: ['Aufbau: 8 Uhr'], people: [] }, extra);
const users = [{ id: 'u-anna', full_name: 'Anna Albers', is_fest: true }, { id: 'u-bert', full_name: 'Bert Brandt', is_fest: false }];

test('protPlanPersonnel: one row per named person, AL first, start from Wann, end empty', () => {
  const rows = plain(run('protPlanPersonnel')(planShift({ people: [
    { name: 'Bert', role: 'MA', note: null, userId: 'u-bert' },
    { name: 'Anna', role: 'AL', note: null, userId: 'u-anna' },
  ] }), users));
  assert.deepEqual(rows.map(r => [r.pos, r.name, r.userId, r.start, r.end]), [
    ['AL', 'Anna Albers', 'u-anna', '08:00', ''],
    ['MA', 'Bert Brandt', 'u-bert', '08:00', ''],
  ]);
  assert.equal(rows[0].fest, true);
  assert.equal(rows[0].isTemp, false);
  assert.equal(rows[0].pause, '0');
});

test('protPlanPersonnel: personal and agency times win over the shift time', () => {
  const rows = plain(run('protPlanPersonnel')(planShift({ people: [
    { name: 'Milan', role: 'MA', note: 'ab 14 Uhr', userId: null },
    { name: 'Feli', role: 'Deko', note: 'bis 13 Uhr', userId: null },
    { name: 'Carla Muster', role: 'Zenjob', note: '8.30 - 16.30 Uhr', userId: null },
  ] }), users));
  assert.deepEqual(rows.map(r => [r.name, r.start, r.end, r.pause]), [
    ['Milan', '14:00', '', '0'],
    ['Feli', '08:00', '13:00', '0'],
    ['Carla Muster', '08:30', '16:30', '30'],
  ]);
});

test('protPlanPersonnel: roles map to the protocol positions; agency people are Aushilfen', () => {
  const rows = plain(run('protPlanPersonnel')(planShift({ people: [
    { name: 'Dino', role: 'ROCKiT', note: null, userId: null },
    { name: 'Hanna', role: 'Deko', note: null, userId: null },
    { name: 'Fritz', role: 'Fahrer', note: 'BAR PL 50', userId: null },
  ] }), users));
  assert.deepEqual(rows.map(r => r.pos), ['Rockit', 'MA', 'Fahrer']);
  assert.equal(rows[0].isTemp, true);
  assert.equal(rows[0].tempName, 'Dino');
  // Unmatched internal names stay as typed names (shown as "nicht registriert")
  assert.equal(rows[1].isTemp, false);
  assert.equal(rows[1].userId, '');
  assert.equal(rows[1].name, 'Hanna');
  assert.equal(rows[2].start, '08:00');
});

test('protPlanPersonnel: no people → no rows; "bis" in Wann is no start time', () => {
  assert.deepEqual(plain(run('protPlanPersonnel')(planShift({}), users)), []);
  const rows = plain(run('protPlanPersonnel')(planShift({ wann: ['Abbau bis 18 Uhr'], people: [{ name: 'Bert', role: 'MA', note: null, userId: 'u-bert' }] }), users));
  assert.equal(rows[0].start, '');
});

test('protApplyPlanPersonnel: fills only an untouched list, keeps entered rows', () => {
  const rows = [{ pos: 'AL', name: 'Anna Albers', start: '08:00', end: '' }];
  run('protState.personnel = [{ pos: "MA", name: "", tempName: "", start: "", end: "", pause: "0" }]');
  assert.equal(run('protApplyPlanPersonnel')(rows), true);
  assert.deepEqual(plain(run('protState.personnel')).map(r => r.name), ['Anna Albers']);
  run('protState.personnel = [{ pos: "MA", name: "Max", start: "07:00", end: "", pause: "0" }]');
  assert.equal(run('protApplyPlanPersonnel')(rows), false);
  assert.deepEqual(plain(run('protState.personnel')).map(r => r.name), ['Max']);
  assert.equal(run('protApplyPlanPersonnel')([]), false);
});

test('protIncompleteNames: named people without start or end; blank rows are ignored', () => {
  const names = plain(run('protIncompleteNames')([
    { name: 'Anna', start: '08:00', end: '16:00' },
    { name: 'Bert', start: '08:00', end: '' },
    { isTemp: true, tempName: 'Carla', name: '', start: '', end: '17:00' },
    { name: '', tempName: '', start: '', end: '' },
    { name: '', tempName: '', start: '09:00', end: '' },
  ]));
  assert.deepEqual(names, ['Bert', 'Carla', 'Ohne Name']);
});

test('saveProtokoll: incomplete rows → asks first; "Abbrechen" sends nothing', async () => {
  let asked = '';
  ctx.confirm = msg => { asked = msg; return false; };
  dom['prot-total-cost'] = { textContent: '0,00' };
  run('protState.personnel = [{ pos: "MA", name: "Bert", start: "08:00", end: "", pause: "0" }]');
  await run('saveProtokoll()');
  assert.match(asked, /Bert/);
  assert.equal(sb.calls.length, 0);
});

test('loading another protocol or resetting the form closes all rows (no stale open state)', () => {
  store['luebbert_protokoll_history'] = JSON.stringify([{ id: 'h1', event: 'Gala', personnel: [{ pos: 'MA', name: 'Max', start: '08:00', end: '16:00' }], transports: [] }]);
  ctx.confirm = () => true;
  run('protOpenRows = { p3: true, t1: true }');
  run('loadProtFromHistory("h1")');
  assert.deepEqual(plain(run('protOpenRows')), {});
  run('protOpenRows = { p0: true }');
  run('resetProtFormState()');
  assert.deepEqual(plain(run('protOpenRows')), {});
  store['luebbert_protokoll_draft'] = JSON.stringify({ ownerId: 'u-me', personnel: [{ name: 'A' }, { name: 'B' }] });
  run('protOpenRows = { p1: true }');
  run('loadProtDraft()');
  assert.deepEqual(plain(run('protOpenRows')), {});
});

test('typing an Aushilfe name updates the row title right away', () => {
  run('protState.personnel = [{ pos: "Zenjob", isTemp: true, tempName: "", name: "", start: "", end: "", pause: "0" }]');
  dom['prot-pname-0'] = { textContent: 'Ohne Name' };
  run('updateProtPersonnel(0, "tempName", "Zoe")');
  assert.equal(dom['prot-pname-0'].textContent, 'Zoe');
});

// ── "Meine Protokolle" ──
test('protIsMine: creator, AL or PL counts; old rows without created_by count via AL/PL', () => {
  const f = run('protIsMine');
  assert.equal(f({ createdBy: 'u-me' }, 'u-me'), true);
  assert.equal(f({ created_by: 'u-me' }, 'u-me'), true);
  assert.equal(f({ alId: 'u-me' }, 'u-me'), true);
  assert.equal(f({ al_id: 'u-x', pl_id: 'u-me' }, 'u-me'), true);
  assert.equal(f({ createdBy: null, alId: 'u-x', plId: null }, 'u-me'), false);
  assert.equal(f({}, 'u-me'), false);
  assert.equal(f({ alId: 'u-me' }, ''), false);
});

test('protFilterScope: "mine" filters, "all" keeps everything', () => {
  const list = [{ id: 1, alId: 'u-me' }, { id: 2, alId: 'u-x' }, { id: 3, created_by: 'u-me' }];
  ctx.__l = list;
  assert.deepEqual(plain(run('protFilterScope(__l, "mine", "u-me")')).map(x => x.id), [1, 3]);
  assert.equal(run('protFilterScope(__l, "all", "u-me")').length, 3);
});

test('protScopeGet/Set: default mine, remembered per key, survives a broken storage', () => {
  assert.equal(run('protScopeGet("k1")'), 'mine');
  run('protScopeSet("k1", "all")');
  assert.equal(run('protScopeGet("k1")'), 'all');
  assert.equal(run('protScopeGet("k2")'), 'mine');
  store.k3 = 'bogus';
  assert.equal(run('protScopeGet("k3")'), 'mine');
  ctx.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(run('protScopeGet("k1")'), 'mine');
  run('protScopeSet("k1", "all")');
});

test('protRowToEntry maps created_by to createdBy', () => {
  assert.equal(run('protRowToEntry({ id: "p1", created_by: "u-me" })').createdBy, 'u-me');
  assert.equal(run('protRowToEntry({ id: "p1" })').createdBy, null);
});

test('sync: INSERT sets created_by to the current user, UPDATE never touches it', async () => {
  sb.rows.projects = { id: 'proj-1' };
  ctx.__data = protData();
  await run('syncProtokollToSupabase(__data, null)');
  const ins = sb.calls.find(c => c.table === 'protocols' && c.op === 'insert');
  assert.equal(ins.payload.created_by, 'u-me');
  sb.calls.length = 0;
  await run('syncProtokollToSupabase(__data, "prot-9")');
  const up = sb.calls.find(c => c.table === 'protocols' && c.op === 'update');
  assert.ok(!('created_by' in up.payload));
});

test('sync: before the migration (no created_by column) the insert is retried without it', async () => {
  sb.rows.projects = { id: 'proj-1' };
  let n = 0;
  const orig = sb.from;
  sb.from = t => {
    const b = orig(t);
    if (t !== 'protocols') return b;
    const ins = b.insert;
    b.insert = p => { n++; if (n === 1) sb.fail['protocols.insert'] = { message: 'column "created_by" of relation "protocols" does not exist' }; else delete sb.fail['protocols.insert']; return ins(p); };
    return b;
  };
  ctx.__data = protData();
  assert.ok(await run('syncProtokollToSupabase(__data, null)'));
  const inserts = sb.calls.filter(c => c.table === 'protocols' && c.op === 'insert');
  assert.equal(inserts.length, 2);
  assert.ok(!('created_by' in inserts[1].payload));
});

// ── Bug round 2026-10-30 ──
const shRow = (id, status, extra) => Object.assign({ id, user_id: 'u-ma', temp_worker_name: null, position_role: 'MA frei', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 30, status, shift_date: '2026-10-28' }, extra || {});

test('sync edit: shifts are updated in place; booked rows keep their id (changed hours go back to offen), only open rows are deleted', async () => {
  sb.rows.projects = { id: 'proj-1' };
  sb.rows.shifts = [shRow('sh1', 'eingetragen'), shRow('sh2', 'offen', { user_id: 'u-b' }), shRow('sh3', 'eingetragen', { user_id: 'u-c' })];
  ctx.__data = protData({ personnel: [
    { shiftId: 'sh1', pos: 'MA', userId: 'u-ma', name: 'Max', start: '08:00', end: '17:00', pause: '30' },
    { pos: 'MA', userId: 'u-new', name: 'Neu', start: '09:00', end: '15:00', pause: '0' },
  ] });
  assert.equal(await run('syncProtokollToSupabase(__data, "prot-9")'), 'prot-9');
  const sh = sb.calls.filter(c => c.table === 'shifts');
  assert.equal(sh.filter(c => c.op === 'delete' && !c.filters.some(f => f[0] === 'id in')).length, 0, 'no delete of all shifts of the protocol');
  const upd = sh.filter(c => c.op === 'update');
  assert.equal(upd.length, 1);
  assert.deepEqual(plain(upd[0].payload), { end_time: '17:00', status: 'offen' });
  assert.deepEqual(plain(upd[0].filters), [['id', 'sh1']]);
  const ins = sh.filter(c => c.op === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0].payload[0].user_id, 'u-new');
  assert.equal(ins[0].payload[0].status, 'offen');
  assert.deepEqual(plain(sh.find(c => c.op === 'delete').filters), [['id in', ['sh2']]]);
  assert.ok(ctx.__data.personnel[1].shiftId, 'id of the inserted shift is remembered on the row');
});

test('sync edit: a row without shiftId that equals a stored shift is matched, not duplicated', async () => {
  sb.rows.projects = { id: 'proj-1' };
  sb.rows.shifts = [shRow('sh1', 'eingetragen')];
  ctx.__data = protData({ personnel: [{ pos: 'MA', userId: 'u-ma', name: 'Max', start: '08:00', end: '16:00', pause: '30' }] });
  await run('syncProtokollToSupabase(__data, "prot-9")');
  const sh = sb.calls.filter(c => c.table === 'shifts');
  assert.equal(sh.filter(c => c.op !== 'select').length, 0);
  assert.equal(ctx.__data.personnel[0].shiftId, 'sh1');
});

test('sync edit: a rejected shift update (0 rows) fails the sync', async () => {
  sb.rows.projects = { id: 'proj-1' };
  sb.rows.shifts = [shRow('sh1', 'offen')];
  const orig = sb.from;
  // protocols.update must still answer with a row → only shifts answer with 0 rows
  sb.from = t => {
    const b = orig(t);
    if (t === 'shifts') { const u = b.update; b.update = p => { sb.rows['shifts.update'] = []; return u(p); }; }
    return b;
  };
  sb.rows['protocols.update'] = [{ id: 'prot-9' }];
  ctx.__data = protData({ personnel: [{ shiftId: 'sh1', pos: 'MA', userId: 'u-ma', name: 'Max', start: '08:00', end: '17:00', pause: '30' }] });
  assert.equal(await run('syncProtokollToSupabase(__data, "prot-9")'), null);
});

test('AL/PL select keeps a stored person who is no longer in the list', () => {
  dom['prot-al'] = { innerHTML: '', value: '' };
  dom['prot-pl'] = { innerHTML: '', value: '' };
  run('protState.alId = "u-gone"; protState.alName = "Gerd Alt"; protState.plId = null');
  run('populateAlPlSelects()');
  assert.match(dom['prot-al'].innerHTML, /value="u-gone"[^>]*>Gerd Alt</);
  assert.equal(dom['prot-al'].value, 'u-gone');
  assert.doesNotMatch(dom['prot-pl'].innerHTML, /u-gone/);
});

test('loadProtFromHistory remembers the stored AL name for a deactivated AL', () => {
  store['luebbert_protokoll_history'] = JSON.stringify([{ id: 'h1', event: 'Gala', al: 'Gerd Alt', alId: 'u-gone', pl: 'Paul', plId: 'u-pl', personnel: [], transports: [] }]);
  ctx.confirm = () => true;
  dom['prot-al'] = { innerHTML: '', value: '' };
  dom['prot-pl'] = { innerHTML: '', value: '' };
  run('appUsers = [{ id: "u-pl", full_name: "Paul", role: "Admin" }]');
  run('loadProtFromHistory("h1")');
  assert.equal(run('protState.alName'), 'Gerd Alt');
  assert.equal(dom['prot-al'].value, 'u-gone');
  assert.equal(dom['prot-pl'].value, 'u-pl');
});

test('fetchAppUsers recalculates the costs with the personal rates once the users are there', async () => {
  dom['prot-date'] = { value: '2026-10-28' };
  dom['prot-isholiday'] = { checked: false };
  dom['prot-total-cost'] = { textContent: '' };
  run('protState.transports = []; protState.personnel = [{ pos: "MA", userId: "u-ma", name: "Max", start: "08:00", end: "16:00", pause: "0" }]; calcProtCosts();');
  const before = dom['prot-total-cost'].textContent;
  sb.rows.app_users = [{ id: 'u-ma', full_name: 'Max', role: 'MA', hourly_rate_internal: 77, is_fest: false }];
  await run('fetchAppUsers()');
  assert.notEqual(dom['prot-total-cost'].textContent, before);
});

test('saveProtokoll recalculates before it reads the total (stale restored-draft total)', async () => {
  sb.rows.projects = { id: 'proj-1' };
  dom['prot-date'] = { value: '2026-10-28' };
  dom['prot-isholiday'] = { checked: false };
  dom['prot-total-cost'] = { textContent: '0,00' };
  dom['prot-event'] = { value: 'Gala' };
  run('clearProtForm = function() {}; appUsers = [{ id: "u-ma", hourly_rate_internal: 40, is_fest: false }];');
  run('protState.transports = []; protState.personnel = [{ pos: "MA", userId: "u-ma", name: "Max", start: "08:00", end: "16:00", pause: "0" }]');
  const expected = run('protCostLines(protState, "2026-10-28", false).total');
  assert.ok(expected > 0);
  await run('saveProtokoll()');
  const ins = sb.calls.find(c => c.table === 'protocols' && c.op === 'insert');
  assert.equal(ins.payload.total_cost, Number(expected.toFixed(2)));
});

test('saveProtokoll resets the driver-hint cache', async () => {
  run('clearProtForm = function() {}; protDayDrivers.key = "2026-10-28|prot-1"');
  dom['prot-total-cost'] = { textContent: '0,00' };
  await run('saveProtokoll()');
  assert.equal(run('protDayDrivers.key'), null);
});

test('clearProtSig stores the cleared signature in the draft', () => {
  run('protState.signature = "data:sig"; saveProtDraft()');
  assert.equal(JSON.parse(store.luebbert_protokoll_draft).signature, 'data:sig');
  run('clearProtSig()');
  assert.equal(JSON.parse(store.luebbert_protokoll_draft).signature, null);
});

test('retry: concurrent taps insert the protocol only once', async () => {
  sb.rows.projects = { id: 'proj-1' };
  store.luebbert_protokoll_history = JSON.stringify([Object.assign(protData(), { id: 'L1', supabaseId: null, synced: false, isUpdate: false })]);
  await Promise.all([run('retrySyncAllProtocols()'), run('retrySyncAllProtocols()')]);
  assert.equal(sb.calls.filter(c => c.table === 'protocols' && c.op === 'insert').length, 1);
});

test('retry: an entry saved while the retry is running is not lost', async () => {
  sb.rows.projects = { id: 'proj-1' };
  store.luebbert_protokoll_history = JSON.stringify([Object.assign(protData(), { id: 'L1', supabaseId: null, synced: false, isUpdate: false, savedAt: 'a' })]);
  const orig = sb.from;
  sb.from = t => {
    const b = orig(t);
    if (t === 'protocols') {
      const ins = b.insert;
      b.insert = p => {
        const arch = JSON.parse(store.luebbert_protokoll_history);
        arch.unshift({ id: 'L2', event: 'new one', synced: false, savedAt: 'b' });
        store.luebbert_protokoll_history = JSON.stringify(arch);
        return ins(p);
      };
    }
    return b;
  };
  await run('retrySyncAllProtocols()');
  const arch = JSON.parse(store.luebbert_protokoll_history);
  assert.deepEqual(arch.map(e => e.id).sort(), ['L1', 'L2']);
  assert.equal(arch.find(e => e.id === 'L1').synced, true);
  assert.equal(arch.find(e => e.id === 'L2').synced, false);
});

test('retry: the entry author (createdBy) is used, not the current user', async () => {
  sb.rows.projects = { id: 'proj-1' };
  const p = protData({ personnel: [{ pos: 'Zenjob', isTemp: true, tempName: 'Zed', name: 'Zed', start: '08:00', end: '16:00', pause: '0', rating: 'up' }] });
  store.luebbert_protokoll_history = JSON.stringify([Object.assign(p, { id: 'L1', supabaseId: null, synced: false, isUpdate: false, createdBy: 'u-author' })]);
  await run('retrySyncAllProtocols()');
  assert.equal(sb.calls.find(c => c.table === 'protocols' && c.op === 'insert').payload.created_by, 'u-author');
  assert.equal(sb.calls.find(c => c.table === 'worker_ratings' && c.op === 'insert').payload[0].rated_by, 'u-author');
});

test('mergeProtHistory drops synced entries the server no longer has (inside the fetched window), never unsynced ones', () => {
  const mk = () => [
    { id: 'A', supabaseId: 'S1', date: '2026-10-20', synced: true },
    { id: 'B', supabaseId: 'S9', date: '2026-10-25', synced: true },
    { id: 'C', supabaseId: 'S8', date: '2026-01-01', synced: true },
    { id: 'D', supabaseId: 'S7', date: '2026-10-26', synced: false },
    { id: 'E', supabaseId: null, date: '2026-10-26', synced: false },
  ];
  const fresh = [{ id: 'S1', supabaseId: 'S1', date: '2026-10-20', synced: true }, { id: 'S2', supabaseId: 'S2', date: '2026-10-28', synced: true }];
  const ids = out => plain(out).map(e => e.id).sort();
  // window full (limit reached): only entries newer than the oldest fetched date can be judged
  assert.deepEqual(ids(run('mergeProtHistory')(mk(), JSON.parse(JSON.stringify(fresh)), 2)), ['C', 'D', 'E', 'S1', 'S2']);
  // fewer rows than the limit: the server returned everything
  assert.deepEqual(ids(run('mergeProtHistory')(mk(), JSON.parse(JSON.stringify(fresh)), 60)), ['D', 'E', 'S1', 'S2']);
});

test('sync: a failed project lookup or insert aborts instead of saving without / duplicating the project', async () => {
  sb.fail['projects.select'] = { message: 'offline' };
  ctx.__data = protData();
  assert.equal(await run('syncProtokollToSupabase(__data, null)'), null);
  assert.equal(sb.calls.filter(c => c.table === 'projects' && c.op === 'insert').length, 0);
  assert.equal(sb.calls.filter(c => c.table === 'protocols').length, 0);
  delete sb.fail['projects.select'];
  sb.fail['projects.insert'] = { message: 'rls' };
  assert.equal(await run('syncProtokollToSupabase(__data, null)'), null);
  assert.equal(sb.calls.filter(c => c.table === 'protocols').length, 0);
});

test('loadProtFromHistory: a missing action (server null → "—") becomes Aufbau', () => {
  store['luebbert_protokoll_history'] = JSON.stringify([{ id: 'h1', event: 'Gala', action: '—', personnel: [], transports: [] }]);
  ctx.confirm = () => true;
  dom['prot-action'] = { value: 'x' };
  run('loadProtFromHistory("h1")');
  assert.equal(dom['prot-action'].value, 'Aufbau');
});

test('AL time sync: a changed AL end does not hit rows whose START equals the old end', () => {
  run('protState.personnel = [{ pos: "AL", start: "08:00", end: "16:00", pause: "0" }, { pos: "MA", start: "16:00", end: "20:00", pause: "0" }, { pos: "MA", start: "08:00", end: "16:00", pause: "0" }]');
  run('updateProtPersonnel(0, "end", "17:00")');
  const p = plain(run('protState.personnel'));
  assert.deepEqual([p[1].start, p[1].end], ['16:00', '20:00']);
  assert.deepEqual([p[2].start, p[2].end], ['08:00', '17:00']);
});

test('onProtPersonnelName: unchanged name → no re-render; changed → row updated in place', () => {
  run('appUsers = [{ id: "u1", full_name: "Max Muster", is_fest: false }]');
  run('protState.personnel = [{ pos: "MA", userId: "u1", name: "Max Muster", fest: false, start: "", end: "", pause: "0" }]');
  dom['prot-personnel-list'] = { innerHTML: 'orig' };
  dom['prot-pname-0'] = { textContent: 'Max Muster' };
  dom['prot-punreg-0'] = { style: { display: 'none' } };
  run('onProtPersonnelName(0, "Max Muster")');
  assert.equal(dom['prot-personnel-list'].innerHTML, 'orig');
  run('onProtPersonnelName(0, "Zed Fremd")');
  assert.equal(dom['prot-personnel-list'].innerHTML, 'orig', 'list is not rebuilt');
  assert.equal(dom['prot-pname-0'].textContent, 'Zed Fremd');
  assert.equal(dom['prot-punreg-0'].style.display, '');
  assert.equal(run('protState.personnel[0].userId'), '');
  run('onProtPersonnelName(0, "Max Muster")');
  assert.equal(dom['prot-punreg-0'].style.display, 'none');
  assert.equal(run('protState.personnel[0].userId'), 'u1');
});

test('protShiftChanges: a booked shift whose times change goes back to offen; an unchanged one keeps its status', () => {
  const old = [
    { id: 's1', user_id: 'u1', temp_worker_name: null, position_role: 'MA frei', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 30, shift_date: '2026-10-28', status: 'eingetragen' },
    { id: 's2', user_id: 'u2', temp_worker_name: null, position_role: 'MA frei', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 30, shift_date: '2026-10-28', status: 'eingetragen' }
  ];
  const personnel = [
    { pos: 'MA', userId: 'u1', name: 'A', start: '08:00', end: '17:00', pause: '30', shiftId: 's1' },
    { pos: 'MA', userId: 'u2', name: 'B', start: '08:00', end: '16:00', pause: '30', shiftId: 's2' }
  ];
  const ch = plain(run('protShiftChanges')(old, personnel, [], '2026-10-28'));
  assert.deepEqual(ch.updates.map(u => [u.id, u.patch.end_time, u.patch.status]), [['s1', '17:00', 'offen']]);
});
