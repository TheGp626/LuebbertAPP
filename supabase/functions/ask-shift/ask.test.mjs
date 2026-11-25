import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askRef, askLabel, askPush, mayAsk } from './ask.mjs';

test('askRef: plan entry or Auftrag phase, anything else refused', () => {
  assert.equal(askRef({ kind: 'shift', week_id: '11111111-2222-3333-4444-555555555555', shift_key: 'mo|estrel' }), 'shift:11111111-2222-3333-4444-555555555555|mo|estrel');
  assert.equal(askRef({ kind: 'order', job_no: '26-0415.01', phase: 'setup' }), 'order:26-0415.01|setup');
  assert.equal(askRef({ kind: 'order', job_no: '26-0415', phase: 'setup' }), null);
  assert.equal(askRef({ kind: 'shift', week_id: 'x', shift_key: 'k' }), null);
  assert.equal(askRef({ kind: 'shift', week_id: '11111111-2222-3333-4444-555555555555', shift_key: '' }), null);
  assert.equal(askRef(null), null);
});

test('askLabel / askPush: one clean line, first name of the asker, link to the Wochenplan', () => {
  assert.equal(askLabel(' Fr 28.11.\n07:00 \u0007 Estrel '), 'Fr 28.11. 07:00 Estrel');
  assert.equal(askLabel('x'.repeat(200)).length, 120);
  const p = askPush('Jenni Muster', 'Fr 28.11. · Estrel');
  assert.equal(p.title, 'Hast du Zeit?');
  assert.equal(p.body, 'Jenni fragt: Fr 28.11. · Estrel. Tipp im Wochenplan auf „Ich kann“.');
  assert.equal(p.url, './index.html?open=wochenplan');
});

test('mayAsk: Admin or „Sieht Bewerbungen“, never inactive', () => {
  assert.equal(mayAsk({ role: 'Admin' }), true);
  assert.equal(mayAsk({ role: 'PL', plan_interest_viewer: true }), true);
  assert.equal(mayAsk({ role: 'PL' }), false);
  assert.equal(mayAsk({ role: 'Admin', is_active: false }), false);
  assert.equal(mayAsk(null), false);
});
