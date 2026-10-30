// Run: node --test supabase/functions/_shared/plan-time.test.mjs
// The Edge Function copy must behave exactly like js/plan-parser.js (browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planWhen, planGuessAction } from './plan-time.mjs';

const browser = createRequire(import.meta.url)('../../../js/plan-parser.js');

const whenCases = [
  ['Aufbau: 8 - 9 Uhr', 'Abbau: 12 Uhr'], ['Aufbau Team 1: 8 Uhr', '@Team: Material bereits vor Ort!!'], ['19.30 - 21 Uhr'],
  ['Abbau: 0.30 Uhr'], ['Aufbau Deko: bis 11 Uhr'], ['Abbau: ab 17 Uhr'], ['Umbau: 16 - 19 Uhr', 'Leergut hinter Vorhang'],
  ['Aufbau Barhocker & Deko : 10 Uhr'], ['KW 45-46'], ['Aufbau: nach Aufbau gedatec'], [],
];
const actionCases = [['Aufbau: 9 - 14 Uhr', 'Abbau: 0.30 Uhr'], ['Abbau: 8 - 11 Uhr'], ['Umbau: 16 - 19 Uhr'], []];

test('planWhen matches the browser parser', () => {
  whenCases.forEach(c => assert.deepEqual(planWhen(c), browser.planWhen(c), JSON.stringify(c)));
});

test('planGuessAction matches the browser parser', () => {
  actionCases.forEach(c => assert.equal(planGuessAction(c), browser.planGuessAction(c), JSON.stringify(c)));
});
