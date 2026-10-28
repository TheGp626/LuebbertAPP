// Run from the repo root: node --test tests/protokoll.test.js
// Loads formulas.js, utils.js and protokoll.js into one sandbox with a fake Supabase client.
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
  for (const f of ['formulas.js', 'utils.js', 'protokoll.js']) {
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
