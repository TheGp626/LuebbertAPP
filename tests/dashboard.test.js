// Run from the repo root: node --test tests/dashboard.test.js
// Loads formulas.js, utils.js, protokoll.js and dashboard.js into one sandbox (as in index.html).
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
  for (const f of ['formulas.js', 'utils.js', 'protokoll.js', 'dashboard.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx, { filename: f });
  }
});
const run = code => vm.runInContext(code, ctx);
const plain = v => JSON.parse(JSON.stringify(v));

// ── Finding 8: effective personnel rate like the app ──
test('dashShiftCosts uses the employee rate (role_rates / hourly_rate_internal)', () => {
  run(`appUsers = [
    { id: 'u1', role_rates: [{ role: 'MA frei', rate_internal: '19' }] },
    { id: 'u2', hourly_rate_internal: 24 }
  ]`);
  const f = run('dashShiftCosts');
  const s1 = { user_id: 'u1', position_role: 'MA frei', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 0 };
  assert.equal(plain(f('2026-10-28', false, s1))[0].rate, 19);
  const s2 = Object.assign({}, s1, { user_id: 'u2' });
  assert.equal(plain(f('2026-10-28', false, s2))[0].rate, 24);
  const s3 = Object.assign({}, s1, { user_id: null, temp_worker_name: 'X' });
  assert.equal(plain(f('2026-10-28', false, s3))[0].rate, 21.5);
  assert.deepEqual(plain(f('2026-10-28', false, { position_role: 'MA frei', start_time: null })), []);
});

test('calcDashProtTotal matches the app formula (date-dependent transport, holiday, minimum hours)', () => {
  const f = run('calcDashProtTotal');
  // Bischoff on a Sunday costs 837.50; Zenjob 2h on a holiday → 4h minimum × 35.25
  const total = f('2026-11-01', true, [{ type: 'Bischoff' }], [
    { position_role: 'Zenjob', start_time: '10:00', end_time: '12:00', pause_mins: 0 },
  ]);
  assert.equal(total, 837.5 + 4 * 35.25);
});

test('calcDashProtTotal: driver hours count like in the form; old rows without hours do not', () => {
  run("appUsers = [{ id: 'd1', role_rates: [{ role: 'Fahrer frei', rate_internal: '28' }] }]");
  const f = run('calcDashProtTotal');
  const transports = [{ type: 'Sprinter', hours: 5, driverUserId: 'd1', driver: 'Tom' }, { type: 'PKW', hours: null, driver: 'Zoe' }];
  const shifts = [{ position_role: 'MA frei', start_time: '08:00', end_time: '16:00', pause_mins: 0 }];
  const dash = f('2026-10-28', false, transports, shifts);
  assert.equal(dash, 40 + 20 + 5 * 28 + 8 * 21.5);
  const form = run('protCostLines')({ transports, personnel: [{ pos: 'MA', isTemp: true, name: 'X', start: '08:00', end: '16:00', pause: '0' }] }, '2026-10-28', false);
  assert.equal(dash, Math.round(form.total * 100) / 100);
  assert.equal(f('2026-10-28', false, [{ type: 'PKW', driver: 'Zoe' }], []), 20);
});

// ── Finding 10: AL/PL names typed in the edit modal ──
test('dashResolvePerson', () => {
  const f = run('dashResolvePerson');
  const users = [{ id: 'a', full_name: 'Anna Alt' }, { id: 'b', full_name: 'Bert' }, { id: 'c', full_name: 'Bert' }];
  assert.deepEqual(plain(f('Anna Alt', 'Anna Alt', 'a', users)), { id: 'a', fallback: 'Anna Alt' });  // unchanged
  assert.deepEqual(plain(f('anna alt ', 'Bert', 'b', users)), { id: 'a', fallback: 'anna alt' });      // exact match
  assert.deepEqual(plain(f('Bert', 'Anna Alt', 'a', users)), { id: null, fallback: 'Bert' });         // ambiguous
  assert.deepEqual(plain(f('Neu', 'Anna Alt', 'a', users)), { id: null, fallback: 'Neu' });           // unknown
  assert.deepEqual(plain(f('', 'Anna Alt', 'a', users)), { id: null, fallback: null });               // cleared
  assert.deepEqual(plain(f('Anna Alt', 'Anna Alt', 'a', [])), { id: 'a', fallback: 'Anna Alt' });     // list not loaded
});

// ── Finding 7: dashboard PDF reuses the app builder ──
test('dashProtToEntry maps the dashboard row to the archive shape', () => {
  const e = plain(run('dashProtToEntry')({
    id: 'P1', date: '2026-10-28', action: 'Aufbau', is_holiday: true, total_cost: 10,
    projects: { name: 'Gala', location: null }, al_id: 'a', al: { full_name: 'Anna' },
    shifts: [{ id: 's', user_id: 'u1', position_role: 'MA fest', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 0, app_users: { full_name: 'Max' } }],
    protocol_equipments: [{ category_id: 'stoffe', status: 'okay' }],
  }, 'data:image/png;base64,xx'));
  assert.equal(e.holiday, true);
  assert.equal(e.location, '—');
  assert.equal(e.signature, 'data:image/png;base64,xx');
  assert.equal(e.personnel[0].pos, 'MA');
  assert.equal(e.personnel[0].fest, true);
  assert.equal(e.alId, 'a');
});

test('dashMonthStats: protocols and costs of the calendar month of `now`', () => {
  const r = plain(ctx.dashMonthStats([{ date: '2026-10-03', total_cost: 100 }, { date: '2026-10-29', total_cost: 50.5 }, { date: '2026-09-30', total_cost: 9 }, { date: '2025-10-15', total_cost: 7 }], new Date(2026, 9, 29)));
  assert.deepEqual(r, { count: 2, cost: 150.5 });
  assert.deepEqual(plain(ctx.dashMonthStats([], new Date(2026, 9, 29))), { count: 0, cost: 0 });
  assert.deepEqual(plain(ctx.dashMonthStats([{ date: '2026-10-01', total_cost: null }], new Date(2026, 9, 1))), { count: 1, cost: 0 });
});

test('dashWorkerList: people with new hours first, then by name; search by name', () => {
  const w = [{ id: 'a', full_name: 'Zoe', role: 'MA' }, { id: 'b', full_name: 'Anna', role: 'AL' }, { id: 'c', full_name: 'Ben', role: 'MA' }, { id: 'd', full_name: null, role: 'MA' }];
  const all = plain(ctx.dashWorkerList(w, { c: 2 }, ''));
  assert.deepEqual(all.map(x => x.id), ['c', 'b', 'd', 'a']); // 'Unbekannt' sorts by its displayed name
  assert.deepEqual(all.map(x => x.pending), [2, 0, 0, 0]);
  assert.equal(all[2].name, 'Unbekannt');
  assert.deepEqual(plain(ctx.dashWorkerList(w, {}, 'AN')).map(x => x.id), ['b']);
  assert.deepEqual(plain(ctx.dashWorkerList(w, {}, '  ')).length, 4);
});

test('incomeLimitShare: share of the income limit, null without pay or limit', () => {
  assert.deepEqual(plain(ctx.incomeLimitShare(390, 520)), { pct: 75, over: false });
  assert.deepEqual(plain(ctx.incomeLimitShare(600, 520)), { pct: 100, over: true });
  assert.deepEqual(plain(ctx.incomeLimitShare(520, 520)), { pct: 100, over: false });
  assert.deepEqual(plain(ctx.incomeLimitShare(0, 520)), { pct: 0, over: false });
  assert.equal(ctx.incomeLimitShare(null, 520), null);
  assert.equal(ctx.incomeLimitShare(100, null), null);
  assert.equal(ctx.incomeLimitShare(100, 0), null);
});

test('loadDashboardWorkers keeps the selected employee (the list rebuild must not drop the selection)', async () => {
  const sel = {
    _v: 'w1', options: [],
    get value() { return this._v; },
    set value(v) { this._v = this.options.some(o => o.value === v) ? v : ''; },
    set innerHTML(h) { this.options = []; this._v = ''; },
    appendChild(o) { this.options.push(o); }
  };
  ctx.document.getElementById = id => (id === 'dash-worker-select' ? sel : null);
  ctx.document.createElement = () => ({});
  ctx.supabaseClient = { from: t => ({
    select() { return this; },
    eq() { return t === 'app_users' ? this : Promise.resolve({ data: [{ user_id: 'w1' }], error: null }); },
    order() { return Promise.resolve({ data: [{ id: 'w1', full_name: 'A' }, { id: 'w2', full_name: 'B' }], error: null }); }
  }) };
  await ctx.loadDashboardWorkers();
  assert.equal(sel.value, 'w1');
});

test('recalcAllProtocolCosts: a second tap while it runs does nothing', async () => {
  let updates = 0;
  const b = { update() { updates++; return b; }, eq() { return b; }, select() { return Promise.resolve({ data: [{ id: 'p1' }], error: null }); } };
  ctx.supabaseClient = { from: () => b };
  ctx.showToast = () => {};
  run('appUsers = [{ id: "x" }]; dashboardProtocols = [{ id: "p1", date: "2026-10-28", shifts: [], protocol_transports: [] }]');
  await Promise.all([run('recalcAllProtocolCosts()'), run('recalcAllProtocolCosts()')]);
  assert.equal(updates, 1);
  await run('recalcAllProtocolCosts()');
  assert.equal(updates, 2, 'runs again once the first run is done');
});

// ── Protokoll bearbeiten: shifts are edited in place ──
const OLD_SHIFTS = [
  { id: 's1', user_id: 'u1', temp_worker_name: null, position_role: 'AL fest', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 30, status: 'verbucht' },
  { id: 's2', user_id: null, temp_worker_name: 'Zora', position_role: 'Zenjob', start_time: '09:00:00', end_time: '15:00:00', pause_mins: 0, status: 'offen' },
  { id: 's3', user_id: 'u2', temp_worker_name: null, position_role: 'MA', start_time: '10:00:00', end_time: '14:00:00', pause_mins: 0, status: 'verbucht' },
];
const USERS = [{ id: 'u1', full_name: 'Anna Alt', is_fest: true }, { id: 'u2', full_name: 'Max Muster', is_fest: false }, { id: 'u3', full_name: 'Nora Neu', is_fest: true }];
const rowsOf = () => plain(run('(' + JSON.stringify(OLD_SHIFTS) + ').map(dashShiftToRow)'));

test('dashShiftToRow: stored shift becomes an editor row (base position, fest kept, HH:MM)', () => {
  run('appUsers = ' + JSON.stringify(USERS));
  const r = rowsOf();
  assert.deepEqual(r[0], { id: 's1', userId: 'u1', name: 'Anna Alt', pos: 'AL', fest: true, start: '08:00', end: '16:00', pause: 30 });
  assert.deepEqual([r[1].userId, r[1].name, r[1].pos], ['', 'Zora', 'Zenjob']);
});

function changes(mutate, users) {
  const rows = rowsOf();
  mutate(rows);
  ctx.__rows = rows; ctx.__old = OLD_SHIFTS; ctx.__users = users || USERS;
  return plain(run('dashShiftChanges(__old, __rows, __users)'));
}

test('dashShiftChanges: nothing edited → nothing to write (status and ids survive)', () => {
  assert.deepEqual(changes(() => {}), { updates: [], inserts: [], deletes: [] });
});

test('dashShiftChanges: changing only one name is exactly one update with only that name', () => {
  const c = changes(rows => { rows[0].userId = 'u3'; rows[0].name = 'Nora Neu'; rows[0].fest = true; });
  assert.equal(c.updates.length, 1);
  assert.deepEqual(c.updates[0], { id: 's1', patch: { user_id: 'u3', temp_worker_name: null, status: 'offen' } });
  assert.deepEqual([c.inserts.length, c.deletes.length], [0, 0]);
});

test('dashShiftChanges: free text name sets temp_worker_name and clears user_id', () => {
  const c = changes(rows => { rows[2].userId = ''; rows[2].name = 'Gast Person'; });
  assert.deepEqual(c.updates, [{ id: 's3', patch: { user_id: null, temp_worker_name: 'Gast Person', position_role: 'MA frei', status: 'offen' } }]);
});

test('dashShiftChanges: unchanged position keeps the stored role (legacy "MA" without fest/frei)', () => {
  const c = changes(rows => { rows[2].start = '11:00'; });
  assert.deepEqual(c.updates, [{ id: 's3', patch: { start_time: '11:00', status: 'offen' } }]);
});

test('dashShiftChanges: position change recomputes fest/frei, time and pause patch only what changed', () => {
  const c = changes(rows => { rows[0].pos = 'MA'; rows[0].end = '17:00'; rows[0].pause = '45'; });
  assert.deepEqual(c.updates, [{ id: 's1', patch: { position_role: 'MA fest', end_time: '17:00', pause_mins: 45, status: 'offen' } }]);
});

test('dashShiftChanges: removed rows are deleted, new rows are inserted as offen', () => {
  const c = changes(rows => {
    rows.splice(1, 1);
    rows.push({ userId: 'u3', name: 'Nora Neu', pos: 'MA', fest: true, start: '08:00', end: '12:00', pause: 0 });
  });
  assert.deepEqual(c.deletes, ['s2']);
  assert.deepEqual(c.inserts, [{ user_id: 'u3', temp_worker_name: null, position_role: 'MA fest', start_time: '08:00', end_time: '12:00', pause_mins: 0, status: 'offen' }]);
  assert.equal(c.updates.length, 0);
});

test('dashShiftRowToDb: edited rows give the shifts the total is recalculated from', () => {
  run('appUsers = ' + JSON.stringify(USERS));
  const rows = rowsOf();
  rows[1].end = '19:00';
  ctx.__rows = rows;
  const edited = run('__rows.map(function(r) { return dashShiftRowToDb(r, appUsers); })');
  const stale = OLD_SHIFTS;
  const f = run('calcDashProtTotal');
  assert.ok(f('2026-10-28', false, [], edited) > f('2026-10-28', false, [], stale));
});

test('saveDashProtEdit: one renamed person = one shift update; no shift delete/insert, status and created_by untouched', async () => {
  const calls = [];
  const sb = {
    from(table) {
      const q = { table, op: 'select', payload: null, filters: [] };
      const b = {
        select() { return b; }, order() { return b; },
        eq(k, v) { q.filters.push([k, v]); return b; }, in(k, v) { q.filters.push([k, v]); return b; },
        insert(p) { q.op = 'insert'; q.payload = p; return b; }, update(p) { q.op = 'update'; q.payload = p; return b; }, delete() { q.op = 'delete'; return b; },
        then(res, rej) { calls.push(q); return Promise.resolve({ data: [{ id: 'x' }], error: null }).then(res, rej); },
      };
      return b;
    },
  };
  const dom = {
    'pe-date': { value: '2026-10-28' }, 'pe-action': { value: 'Aufbau' }, 'pe-holiday': { checked: false },
    'pe-al': { value: 'Anna Alt' }, 'pe-pl': { value: '' }, 'pe-damages': { value: '' }, 'pe-incidents': { value: '' }, 'pe-feedback': { value: '' },
    'pe-save-btn': { disabled: false },
    'pe-sh-0': { value: 'Nora Neu' }, 'pe-sh-1': { value: 'Zora' }, 'pe-sh-2': { value: 'Max Muster' },
  };
  ctx.document.getElementById = id => dom[id] || null;
  ctx.supabaseClient = sb;
  ctx.showToast = () => {};
  run('appUsers = ' + JSON.stringify(USERS));
  run('ensureRateUsers = async function() {}; refreshDashboard = async function() {}; openDashDetail = function() {}; closeDashProtEdit = function() {};');
  ctx.__p = { id: 'p1', date: '2026-10-28', is_holiday: false, al_id: 'u1', pl_id: null, al: { full_name: 'Anna Alt' }, shifts: OLD_SHIFTS, protocol_transports: [], protocol_equipments: [] };
  run('dashboardProtocols = [__p]; _editProtId = "p1"; _editProtTransports = []; _editProtShifts = __p.shifts.map(dashShiftToRow);');
  await run('saveDashProtEdit()');
  const shiftCalls = calls.filter(c => c.table === 'shifts');
  assert.equal(shiftCalls.length, 1);
  assert.equal(shiftCalls[0].op, 'update');
  assert.deepEqual(plain(shiftCalls[0].payload), { user_id: 'u3', temp_worker_name: null, status: 'offen' }); // booked hours of the old person are not the new person's
  assert.deepEqual(shiftCalls[0].filters, [['id', 's1']]);
  const prot = calls.find(c => c.table === 'protocols');
  assert.ok(!('created_by' in prot.payload));
  assert.equal(prot.payload.al_id, 'u1');
});

test('dashMergePlanPeople: everyone of all plan rows once; other start times become personal notes', () => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/plan-parser.js'), 'utf8'), ctx, { filename: 'plan-parser.js' });
  const main = { wann: ['Aufbau: 8 Uhr'], people: [{ name: 'Anna', role: 'AL', userId: 'u1' }, { name: 'Bert', role: 'MA' }] };
  const other = { wann: ['Aufbau: 14 Uhr'], people: [{ name: 'bert', role: 'MA' }, { name: 'Carla', role: 'MA' }, { name: 'Dino', role: 'MA', note: 'ab 16 Uhr' }] };
  const out = plain(run('dashMergePlanPeople')([main, other], main));
  assert.deepEqual(out.map(p => [p.name, p.note || null]), [['Anna', null], ['Bert', null], ['Carla', 'ab 14:00 Uhr'], ['Dino', 'ab 16 Uhr']]);
});

// ── Bug round 2026-10-30 ──
// Supabase mock: records every query; respond(q) may return { data, error }, default = ok with one id per written row
function mkSb(respond) {
  const calls = [];
  let n = 0;
  return {
    calls,
    from(table) {
      const q = { table, op: 'select', payload: null, filters: [], selected: false };
      const b = {
        select() { q.selected = true; return b; }, order() { return b; },
        eq(k, v) { q.filters.push([k, v]); return b; }, in(k, v) { q.filters.push([k, v]); return b; }, neq() { return b; },
        insert(p) { q.op = 'insert'; q.payload = p; return b; }, update(p) { q.op = 'update'; q.payload = p; return b; }, delete() { q.op = 'delete'; return b; },
        then(res, rej) {
          calls.push(q);
          let r = respond && respond(q);
          if (!r) {
            const rows = q.op === 'insert' ? [].concat(q.payload).map(() => ({ id: 'n' + (++n) })) : [{ id: 'x' }];
            r = { data: rows, error: null };
          }
          return Promise.resolve(r).then(res, rej);
        },
      };
      return b;
    },
  };
}

function setupEdit(sb, p, extraDom) {
  const dom = Object.assign({
    'pe-date': { value: p.date }, 'pe-action': { value: 'Aufbau' }, 'pe-holiday': { checked: !!p.is_holiday },
    'pe-al': { value: '' }, 'pe-pl': { value: '' }, 'pe-damages': { value: '' }, 'pe-incidents': { value: '' }, 'pe-feedback': { value: '' },
    'pe-save-btn': { disabled: false },
  }, ['mobiliar', 'stoffe', 'floristik', 'tischlerei', 'logistik'].reduce((o, c) => { o['pe-st-' + c] = { value: '' }; return o; }, {}), extraDom || {});
  ctx.document.getElementById = id => dom[id] || null;
  ctx.supabaseClient = sb;
  const toasts = [];
  ctx.showToast = (m, t) => toasts.push([m, t]);
  run('appUsers = ' + JSON.stringify(USERS));
  run('ensureRateUsers = async function() {}; refreshDashboard = async function() {}; openDashDetail = function() {}; closeDashProtEdit = function() {};');
  ctx.__p = p;
  run('dashboardProtocols = [__p]; _editProtId = __p.id; _editProtTransports = dashTransportsFromRows(__p.protocol_transports).map(function(t) { return Object.assign({ punctuality: "pünktlich", delay: "" }, t); }); _editProtShifts = (__p.shifts || []).map(dashShiftToRow);');
  return { dom, toasts };
}
const baseProt = (over) => Object.assign({ id: 'p1', date: '2026-10-28', is_holiday: false, total_cost: 123.45, al_id: null, pl_id: null, shifts: [], protocol_transports: [], protocol_equipments: [] }, over);

test('refreshDashboard: a refresh requested while one runs is rerun afterwards (no stale snapshot)', async () => {
  let loads = 0, release;
  const gate = new Promise(r => { release = r; });
  ctx.supabaseClient = { from: () => ({ select() { return this; }, order() { loads++; const n = loads; return n === 1 ? gate.then(() => ({ data: [{ id: 'old' }], error: null })) : Promise.resolve({ data: [{ id: 'new' }], error: null }); } }) };
  ctx.showToast = () => {};
  run('ensureRateUsers = async function() {}');
  const first = run('refreshDashboard()');
  const second = run('refreshDashboard()'); // realtime event during the running refresh
  release();
  await Promise.all([first, second]);
  assert.equal(loads, 2);
  assert.equal(run('dashboardProtocols')[0].id, 'new');
});

test('dashShiftChanges: reassigning a booked shift (or changing its times) sets it back to offen', () => {
  const old = [{ id: 's1', user_id: 'u1', position_role: 'MA frei', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 0, status: 'eingetragen' },
    { id: 's2', user_id: 'u2', position_role: 'MA frei', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 0, status: 'eingetragen' },
    { id: 's3', user_id: 'u1', position_role: 'MA frei', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 0, status: 'eingetragen' }];
  run('appUsers = ' + JSON.stringify(USERS));
  const rows = plain(run('(' + JSON.stringify(old) + ').map(dashShiftToRow)'));
  rows[0].userId = 'u3'; rows[0].name = 'Nora Neu';
  rows[1].end = '18:00';
  ctx.__rows = rows; ctx.__old = old; ctx.__users = USERS;
  const c = plain(run('dashShiftChanges(__old, __rows, __users)'));
  assert.equal(c.updates.find(u => u.id === 's1').patch.status, 'offen');
  assert.equal(c.updates.find(u => u.id === 's2').patch.status, 'offen');
  assert.ok(!c.updates.find(u => u.id === 's3'));
});

test('saveDashProtEdit: ids of inserted rows are kept, a second Speichern after a partial failure does not insert them again', async () => {
  let transportFails = true;
  const sb = mkSb(q => (q.table === 'protocol_transports' && q.op === 'insert' && transportFails) ? { data: null, error: { message: 'boom' } } : null);
  const p = baseProt({ shifts: [OLD_SHIFTS[0]] });
  setupEdit(sb, p, { 'pe-sh-0': { value: 'Anna Alt' }, 'pe-sh-1': { value: 'Nora Neu' } });
  run("_editProtShifts.push({ userId: 'u3', name: 'Nora Neu', pos: 'MA', fest: true, start: '08:00', end: '12:00', pause: 0 }); _editProtTransports = [{ type: 'Sprinter', driver: '', driverUserId: '', hours: 5, punctuality: 'pünktlich', delay: '' }]");
  await run('saveDashProtEdit()');
  const shiftInserts = () => sb.calls.filter(c => c.table === 'shifts' && c.op === 'insert').length;
  assert.equal(shiftInserts(), 1);
  assert.ok(run('_editProtShifts')[1].id, 'row got its id');
  transportFails = false;
  await run('saveDashProtEdit()');
  assert.equal(shiftInserts(), 1, 'not paid twice');
  assert.equal(sb.calls.filter(c => c.table === 'protocol_transports' && c.op === 'insert').length, 2);
});

test('saveDashProtEdit: deletes already done are not repeated on a second Speichern', async () => {
  let fail = true;
  const sb = mkSb(q => (q.table === 'protocol_transports' && q.op === 'insert' && fail) ? { data: null, error: { message: 'boom' } } : null);
  const p = baseProt({ shifts: [OLD_SHIFTS[0], OLD_SHIFTS[1]] });
  setupEdit(sb, p, { 'pe-sh-0': { value: 'Anna Alt' } });
  run("_editProtShifts.splice(1, 1); _editProtTransports = [{ type: 'PKW', driver: '', driverUserId: '', hours: null, punctuality: 'pünktlich', delay: '' }]");
  await run('saveDashProtEdit()');
  fail = false;
  await run('saveDashProtEdit()');
  assert.equal(sb.calls.filter(c => c.table === 'shifts' && c.op === 'delete').length, 1);
});

test('saveDashProtEdit: new transports are inserted before the old ones are deleted (by id, rows counted)', async () => {
  const sb = mkSb();
  const p = baseProt({ protocol_transports: [{ id: 't1', vehicle_type: 'Sprinter', driver_name: null, driver_hours: null, driver_user_id: null }], protocol_equipments: [{ id: 'e1', category_id: 'mobiliar', status: 'okay' }] });
  const { dom } = setupEdit(sb, p);
  dom['pe-st-mobiliar'] = { value: 'okay' }; dom['pe-nt-mobiliar'] = { value: '' };
  run("_editProtTransports[0].type = 'PKW'");
  await run('saveDashProtEdit()');
  const t = sb.calls.filter(c => c.table === 'protocol_transports');
  assert.deepEqual(t.map(c => c.op), ['insert', 'delete']);
  assert.deepEqual(t[1].filters, [['id', ['t1']]]);
  assert.ok(t[1].selected);
  const e = sb.calls.filter(c => c.table === 'protocol_equipments');
  assert.deepEqual(e.map(c => c.op), ['insert', 'delete']);
  assert.deepEqual(e[1].filters, [['id', ['e1']]]);
});

test('saveDashProtEdit: an RLS-blocked transport delete (0 rows) is an error, not a silent duplicate', async () => {
  const sb = mkSb(q => (q.table === 'protocol_transports' && q.op === 'delete') ? { data: [], error: null } : null);
  const p = baseProt({ protocol_transports: [{ id: 't1', vehicle_type: 'Sprinter' }] });
  const { toasts } = setupEdit(sb, p);
  await run('saveDashProtEdit()');
  assert.ok(toasts.some(t => t[1] === 'danger'));
  assert.ok(!toasts.some(t => /gespeichert/.test(t[0])));
});

test('saveDashProtEdit: a note-only edit keeps the stored total_cost; date/holiday/transport/personnel changes recompute it', async () => {
  const payloadOf = async (mutate) => {
    const sb = mkSb();
    const p = baseProt({ protocol_transports: [{ id: 't1', vehicle_type: 'Sprinter', driver_name: 'Tom', driver_hours: 5, driver_user_id: null }], shifts: [OLD_SHIFTS[2]] });
    const { dom } = setupEdit(sb, p, { 'pe-sh-0': { value: 'Max Muster' } });
    mutate(dom);
    await run('saveDashProtEdit()');
    return sb.calls.find(c => c.table === 'protocols').payload;
  };
  assert.ok(!('total_cost' in await payloadOf(d => { d['pe-damages'].value = 'Kratzer'; })));
  assert.ok('total_cost' in await payloadOf(d => { d['pe-holiday'].checked = true; }));
  assert.ok('total_cost' in await payloadOf(d => { d['pe-date'].value = '2026-10-29'; }));
  assert.ok('total_cost' in await payloadOf(() => { run("_editProtTransports[0].hours = '6'"); }));
  assert.ok('total_cost' in await payloadOf(() => { run("_editProtShifts[0].end = '15:00'"); }));
});

test('dashShiftCosts: a deactivated employee (not in appUsers) is still priced with his own rate', () => {
  run("appUsers = []; _dashRateUsers = { u9: { id: 'u9', is_active: false, hourly_rate_internal: 30 } }");
  const s = { user_id: 'u9', position_role: 'MA frei', start_time: '08:00', end_time: '16:00', pause_mins: 0 };
  assert.equal(plain(run('dashShiftCosts')('2026-10-28', false, s))[0].rate, 30);
});

test('toggleShiftBooked: 0 updated rows (RLS) is an error and leaves the local state alone', async () => {
  const sb = mkSb(() => ({ data: [], error: null }));
  ctx.supabaseClient = sb;
  const toasts = [];
  ctx.showToast = (m, t) => toasts.push([m, t]);
  run("dashboardCurrentShifts = [{ id: 's1', status: 'offen' }]; renderWorkerShifts = function() {}; loadDashboardWorkers = function() {}");
  await run("toggleShiftBooked('s1', true)");
  assert.equal(run('dashboardCurrentShifts')[0].status, 'offen');
  assert.ok(sb.calls[0].selected);
  assert.ok(toasts.some(t => t[1] === 'danger'));
});

test('markAllShiftsBooked / deleteShiftFromModal: 0 rows is never reported as success (delete = error, nothing open = info)', async () => {
  const sb = mkSb(() => ({ data: [], error: null }));
  ctx.supabaseClient = sb; ctx.confirm = () => true;
  const toasts = [];
  ctx.showToast = (m, t) => toasts.push([m, t]);
  run("renderWorkerShifts = function() {}; closeShiftEditModal = function() {}; _shiftEditId = 's1'");
  await run("markAllShiftsBooked('u1')");
  await run('deleteShiftFromModal()');
  assert.deepEqual(toasts.map(t => t[1]), ['info', 'danger']);
  assert.ok(!toasts.some(t => /erfolgreich gebucht|gelöscht\./.test(t[0])));
});

test('dashEditPause: manual break survives editing place/role; changed times take the automatic break', () => {
  const f = run('dashEditPause');
  const old = { start_time: '08:00:00', end_time: '16:00:00', pause_mins: 15 };
  assert.equal(f(old, '08:00', '16:00', 30), 15);
  assert.equal(f(old, '08:00', '18:00', 45), 45);
  assert.equal(f(null, '08:00', '16:00', 30), 30);
  assert.equal(f({ start_time: '08:00', end_time: '16:00', pause_mins: null }, '08:00', '16:00', 30), 30);
  assert.equal(f({ start_time: '08:00', end_time: '16:00', pause_mins: 0 }, '08:00', '16:00', 30), 0);
});

test('saveShiftEdit: keeps the stored pause and the legacy role when only the place changed', async () => {
  const sb = mkSb();
  ctx.supabaseClient = sb;
  ctx.showToast = () => {};
  const dom = { 'shift-edit-date': { value: '2026-10-28' }, 'shift-edit-role': { value: 'MA' }, 'shift-edit-start': { value: '08:00' }, 'shift-edit-end': { value: '16:00' }, 'shift-edit-ort': { value: 'Neu' } };
  ctx.document.getElementById = id => dom[id] || null;
  run("dashboardCurrentShifts = [{ id: 's1', position_role: 'MA', start_time: '08:00:00', end_time: '16:00:00', pause_mins: 15 }]; _shiftEditId = 's1'; renderWorkerShifts = function() {}; closeShiftEditModal = function() {}");
  await run('saveShiftEdit()');
  assert.equal(sb.calls[0].payload.pause_mins, 15);
  assert.equal(sb.calls[0].payload.position_role, 'MA');
  assert.ok(sb.calls[0].selected);
});

test('switchDashTab(work) reloads the employees on every entry', () => {
  const el = () => ({ classList: { toggle() {} }, style: {} });
  ctx.document.getElementById = () => el();
  let loads = 0;
  run('dashboardWorkers = [{ id: "a" }]');
  ctx.__count = () => { loads++; };
  run('loadDashboardWorkers = function() { __count(); }');
  run("switchDashTab('work')");
  run("switchDashTab('work')");
  assert.equal(loads, 2);
});

test('deactivateWorker: rows must be touched (RLS), otherwise no success message', async () => {
  const sb = mkSb(() => ({ data: [], error: null }));
  ctx.supabaseClient = sb; ctx.confirm = () => true;
  const toasts = [];
  ctx.showToast = (m, t) => toasts.push([m, t]);
  ctx.document.getElementById = () => null;
  run("dashboardCurrentWorker = { id: 'w1', full_name: 'A' }; closeEditWorker = function() {}; loadDashboardWorkers = async function() {}");
  await run('deactivateWorker()');
  assert.ok(sb.calls[0].selected);
  assert.ok(toasts.some(t => t[1] === 'danger'));
  assert.ok(!toasts.some(t => /deaktiviert\./.test(t[0])));
});

test('renderWorkerShifts: a slower answer for a previously selected employee is dropped', async () => {
  const sel = { value: 'w1' }, cont = { innerHTML: '' };
  ctx.document.getElementById = id => (id === 'dash-worker-select' ? sel : id === 'worker-shifts-container' ? cont : null);
  let release;
  ctx.supabaseClient = { from: () => ({ select() { return this; }, eq() { return new Promise(r => { release = () => r({ data: [{ id: 's1', start_time: '08:00', end_time: '16:00' }], error: null }); }); } }) };
  run("dashboardWorkers = [{ id: 'w1', full_name: 'A' }, { id: 'w2', full_name: 'B' }]; populateDashboardMonthFilter = function() {}");
  const pending = run('renderWorkerShifts()');
  sel.value = 'w2'; // user clicked another person meanwhile
  cont.innerHTML = 'B-DATA';
  release();
  await pending;
  assert.equal(cont.innerHTML, 'B-DATA');
});

test('dashboard menu: PDF only in the Buchhaltung view with a person, recalc only in the Protokoll view', () => {
  const c2 = vm.createContext({ console: { log() {}, warn() {}, error() {} }, localStorage: { getItem: () => null }, document: { addEventListener() {} }, UI_TOPBAR_ITEMS: {}, DASH_VIEW_KEY: 'k', dashViewFromStored: () => 'prot' });
  c2.window = c2;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/dashboard.js'), 'utf8'), c2, { filename: 'dashboard.js' });
  const actions = (view, worker) => {
    vm.runInContext('dashView = ' + JSON.stringify(view) + '; dashboardCurrentWorker = ' + JSON.stringify(worker), c2);
    return vm.runInContext('UI_TOPBAR_ITEMS.dashboard()', c2).map(i => i.action);
  };
  assert.deepEqual(plain(actions('prot', { full_name: 'A' })), ['recalcAllProtocolCosts']);
  assert.deepEqual(plain(actions('work', { full_name: 'A' })), ['exportDashboardMonthlyPDF']);
  assert.deepEqual(plain(actions('work', null)), []);
});
