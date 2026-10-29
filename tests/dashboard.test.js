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
  const total = f('2026-11-01', true, ['Bischoff'], [
    { position_role: 'Zenjob', start_time: '10:00', end_time: '12:00', pause_mins: 0 },
  ]);
  assert.equal(total, 837.5 + 4 * 35.25);
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
