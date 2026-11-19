// Run: node --test supabase/functions/_shared/debug-input.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripDebug, wantsDebug } from './debug-input.mjs';

test('stripDebug: non-admins lose every debug switch, the rest stays', () => {
  const inp = { mode: 'evening', dry_run: true, force: true, only_user_id: 'x', plan_override: true, folder_id: 'f' };
  assert.deepEqual(stripDebug(inp, false), { mode: 'evening', folder_id: 'f' });
  assert.deepEqual(stripDebug(inp, true), inp);
  assert.deepEqual(stripDebug(null, false), {});
});
test('wantsDebug', () => {
  assert.equal(wantsDebug({}), false);
  assert.equal(wantsDebug({ mode: 'evening' }), false);
  assert.equal(wantsDebug({ dry_run: false }), true);
  assert.equal(wantsDebug(null), false);
});
