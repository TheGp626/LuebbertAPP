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
