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

test('calcTransportCost: Spedition costs the amount entered in the protocol, nothing without one', () => {
  const c = (t, d, k) => vm.runInContext('calcTransportCost(' + JSON.stringify(t) + ', ' + JSON.stringify(d) + ', ' + JSON.stringify(k) + ')', ctx);
  assert.equal(c('Spedition', '2026-11-02', 480.5), 480.5);
  assert.equal(c('Spedition', '2026-11-01', '390'), 390);
  assert.equal(c('Spedition', '2026-11-02', null), 0);
  assert.equal(c('Spedition', '2026-11-02', ''), 0);
  assert.equal(c('Bischoff', '2026-11-02', 999), 750, 'other vehicles keep their rate');
});

test('positionKey: function + employment type, other departments unchanged, unknown type → Minijob', () => {
  assert.equal(ctx.positionKey('MA', 'Rechnung'), 'MA Rechnung');
  assert.equal(ctx.positionKey('AL', 'Fest'), 'AL Fest');
  assert.equal(ctx.positionKey('MA', undefined), 'MA Minijob');
  assert.equal(ctx.positionKey('Fahrer', 'quatsch'), 'Fahrer Minijob');
  assert.equal(ctx.positionKey('Lager', 'Fest'), 'Lager');
});

test('splitPosition: new keys, legacy frei/fest keys, plain departments', () => {
  const s = k => JSON.parse(JSON.stringify(ctx.splitPosition(k)));
  assert.deepEqual(s('MA Minijob'), { func: 'MA', type: 'Minijob', legacy: false });
  assert.deepEqual(s('AL frei'), { func: 'AL', type: null, legacy: 'frei' });
  assert.deepEqual(s('Fahrer fest'), { func: 'Fahrer', type: null, legacy: 'fest' });
  assert.deepEqual(s('Lager'), { func: 'Lager', type: null, legacy: false });
  assert.deepEqual(s(''), { func: '', type: null, legacy: false });
});

test('personnelRate: per-type defaults, settings win, missing type in settings → default, legacy keys keep old table', () => {
  assert.equal(ctx.personnelRate('AL Fest'), 0);
  assert.equal(ctx.personnelRate('MA Midijob'), 21.5);
  assert.equal(ctx.personnelRate('Fahrer Rechnung'), 30);
  assert.equal(ctx.personnelRate('MA frei'), 21.5);
  assert.equal(ctx.personnelRate('Lager'), 0);
  vm.runInContext("appSetting = function(k) { return k === 'personnel_rates' ? { Rechnung: { MA: 30, AL: 35, Fahrer: 40 } } : undefined; }", ctx);
  assert.equal(ctx.personnelRate('MA Rechnung'), 30);
  assert.equal(ctx.personnelRate('MA Minijob'), 21.5);
  assert.equal(calc('AL Rechnung', '2026-10-28', false, 480, 960, 0)[0].rate, 35);
  vm.runInContext('delete appSetting', ctx);
});

test('roleRateMatches: exact key, or legacy "frei" for paid types and "fest" for Fest', () => {
  assert.equal(ctx.roleRateMatches('MA Rechnung', 'MA Rechnung'), true);
  assert.equal(ctx.roleRateMatches('MA frei', 'MA Minijob'), true);
  assert.equal(ctx.roleRateMatches('MA frei', 'MA Rechnung'), true);
  assert.equal(ctx.roleRateMatches('MA frei', 'MA Fest'), false);
  assert.equal(ctx.roleRateMatches('MA fest', 'MA Fest'), true);
  assert.equal(ctx.roleRateMatches('AL frei', 'MA Minijob'), false);
  assert.equal(ctx.roleRateMatches('Lager', 'Lager'), true);
  assert.equal(ctx.roleRateMatches('MA Minijob', 'MA frei'), false);
});
