// Run from the repo root: node --test tests/formulas.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/formulas.js'), 'utf8'), ctx);
const calc = (...a) => JSON.parse(JSON.stringify(ctx.calcSplitShiftCosts(...a)));

// 2026-10-28 is a Wednesday, 2026-11-01 a Sunday
test('Zenjob on a holiday is billed with the Zenjob Feiertag rate', () => {
  const r = calc('Zenjob', '2026-10-28', true, 8 * 60, 16 * 60, 0);
  assert.equal(r.length, 1);
  assert.equal(r[0].desc, 'Zenjob Feiertag');
  assert.equal(r[0].rate, ctx.PROT_PERSONNEL_RATES['Zenjob Feiertag']);
  assert.equal(r[0].hrs, 8);
});

test('Rockit on a holiday keeps the Rockit Feiertag rate', () => {
  const r = calc('Rockit', '2026-10-28', true, 8 * 60, 16 * 60, 0);
  assert.deepEqual(r.map(x => x.desc), ['Rockit Feiertag']);
  assert.equal(r[0].rate, 60);
});

test('Zenjob without holiday: day/night split, Sunday bucket', () => {
  const day = calc('Zenjob', '2026-10-28', false, 8 * 60, 16 * 60, 0);
  assert.deepEqual(day.map(x => x.desc), ['Zenjob Tag']);
  const night = calc('Zenjob', '2026-10-28', false, 20 * 60, 24 * 60, 0);
  assert.deepEqual(night.map(x => [x.desc, x.hrs]), [['Zenjob Tag', 2], ['Zenjob Nacht', 2]]);
  const sun = calc('Zenjob', '2026-11-01', false, 8 * 60, 16 * 60, 0);
  assert.deepEqual(sun.map(x => x.desc), ['Zenjob Sonntag']);
});

test('customRate overrides template rates for internal positions only', () => {
  assert.equal(calc('MA frei', '2026-10-28', false, 480, 960, 0, 18)[0].rate, 18);
  assert.equal(calc('MA frei', '2026-10-28', false, 480, 960, 0)[0].rate, 21.5);
  assert.equal(calc('Zenjob', '2026-10-28', false, 480, 960, 0, 99)[0].rate, 23.5);
});

test('calcTransportCost: default rates by weekday (Mo–Fr / Sa / So), admin rates from app settings win', () => {
  const c = (t, d) => vm.runInContext('calcTransportCost(' + JSON.stringify(t) + ', ' + JSON.stringify(d) + ')', ctx);
  assert.equal(c('Bischoff', '2026-11-02'), 750);
  assert.equal(c('Bischoff', '2026-10-31'), 750);
  assert.equal(c('Bischoff', '2026-11-01'), 837.5);
  assert.equal(c('Rainer', '2026-10-31'), 750);
  assert.equal(c('Rainer', null), 700);
  assert.equal(c('Unbekannt', '2026-11-02'), 0);
  vm.runInContext("appSetting = function(k) { return k === 'vehicle_rates' ? { 'Leih LKW': { wk: 120, sa: 130, so: 140 } } : undefined; }", ctx);
  assert.equal(c('Leih LKW', '2026-11-01'), 140);
  assert.equal(c('Bischoff', '2026-11-02'), 0, 'a type removed in Einstellungen costs nothing');
  vm.runInContext('delete appSetting', ctx);
});

test('a break longer than the shift never yields negative hours', () => {
  const r = calc('Zenjob', '2026-10-28', false, 8 * 60, 10 * 60, 180);
  assert.ok(r.every(x => x.hrs >= 0));
  assert.ok(calc('MA frei', '2026-10-28', false, 8 * 60, 10 * 60, 180).every(x => x.hrs >= 0));
});
