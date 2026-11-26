// Run: node --test supabase/functions/notify-attendance/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAttendancePushes } from './notify.mjs';

const prot = { date: '2026-12-08', job_no: '26-0447.01', project: 'Messe Nord' };

test('one push per recipient naming every Ausfall of the protocol; verspätet alone sends nothing', () => {
  const p = buildAttendancePushes([
    { status: 'krank', name: 'Max' }, { status: 'verspaetet', name: 'Eva' }, { status: 'nicht_erschienen', name: 'Zed' },
  ], prot, ['a', 'b', 'a']);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { user_id: 'a', title: '2 Ausfälle im Einsatz',
    body: 'Max krank, Zed nicht erschienen (Messe Nord · 26-0447.01 · 08.12.)', url: './index.html' });
  assert.deepEqual(buildAttendancePushes([{ status: 'verspaetet', name: 'Eva' }], prot, ['a']), []);
  assert.equal(buildAttendancePushes([{ status: 'abgesagt', name: 'Kim' }], {}, ['a'])[0].body, 'Kim kurzfristig abgesagt');
});
