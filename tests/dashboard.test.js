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
  assert.deepEqual(c.updates[0], { id: 's1', patch: { user_id: 'u3', temp_worker_name: null } });
  assert.deepEqual([c.inserts.length, c.deletes.length], [0, 0]);
});

test('dashShiftChanges: free text name sets temp_worker_name and clears user_id', () => {
  const c = changes(rows => { rows[2].userId = ''; rows[2].name = 'Gast Person'; });
  assert.deepEqual(c.updates, [{ id: 's3', patch: { user_id: null, temp_worker_name: 'Gast Person', position_role: 'MA frei' } }]);
});

test('dashShiftChanges: unchanged position keeps the stored role (legacy "MA" without fest/frei)', () => {
  const c = changes(rows => { rows[2].start = '11:00'; });
  assert.deepEqual(c.updates, [{ id: 's3', patch: { start_time: '11:00' } }]);
});

test('dashShiftChanges: position change recomputes fest/frei, time and pause patch only what changed', () => {
  const c = changes(rows => { rows[0].pos = 'MA'; rows[0].end = '17:00'; rows[0].pause = '45'; });
  assert.deepEqual(c.updates, [{ id: 's1', patch: { position_role: 'MA fest', end_time: '17:00', pause_mins: 45 } }]);
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
  assert.deepEqual(plain(shiftCalls[0].payload), { user_id: 'u3', temp_worker_name: null });
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
