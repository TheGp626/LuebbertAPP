// Run from the repo root: node --test tests/app-wage.test.js
// getDeptWage: the Lohn from the Stammdaten wins over the wage typed in on the device.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const pick = name => { const m = src.match(new RegExp('(// [^\\n]*\\n)*function ' + name + '\\([\\s\\S]*?\\n}\\n')); return m[0]; };
const ctx = { localStorage: { getItem: () => null } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'formulas.js'), 'utf8'), ctx);
vm.runInContext('var hourlyWage = 12, deptWages = { MA: 15 }, currentUser = null;\n' + pick('ownPayRate') + pick('getDeptWage'), ctx);

test('getDeptWage: Stammdaten first (rate per function, then general Lohn), device wage only without one', () => {
  assert.equal(ctx.getDeptWage('MA Minijob'), 15);
  assert.equal(ctx.getDeptWage('Lager'), 12);
  vm.runInContext("currentUser = { hourly_rate_conni: 14, role_rates: [{ role: 'AL Minijob', rate_conni: 18 }] }", ctx);
  assert.equal(ctx.getDeptWage('AL Minijob'), 18);
  assert.equal(ctx.getDeptWage('MA Minijob'), 14);
  vm.runInContext('currentUser = { hourly_rate_conni: null, role_rates: [] }', ctx);
  assert.equal(ctx.getDeptWage('MA Minijob'), 15);
});
