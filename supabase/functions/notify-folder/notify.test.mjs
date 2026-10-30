// Run: node --test supabase/functions/notify-folder/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFolderPushes, pgUuidArray } from './notify.mjs';

const folder = { name: 'Messe Nord', notified_al_ids: [] };

test('one push per AL with the first date and its action', () => {
  const p = buildFolderPushes(folder, [
    { al_id: 'a', date: '2026-11-03', action: 'Aufbau', cancelled: false },
    { al_id: 'b', date: '2026-11-07', action: 'Abbau', cancelled: false },
  ]);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], {
    user_id: 'a', title: 'Neuer Projektordner',
    body: 'Messe Nord – du bist AL am 03.11. (Aufbau). Alle Infos im Projektordner.', url: './index.html?open=ordner',
  });
  assert.match(p[1].body, /am 07\.11\. \(Abbau\)/);
});

test('an AL with several jobs gets one push naming the earliest', () => {
  const p = buildFolderPushes(folder, [
    { al_id: 'a', date: '2026-11-09', action: 'Abbau' },
    { al_id: 'a', date: '2026-11-03', action: 'Aufbau' },
  ]);
  assert.equal(p.length, 1);
  assert.equal(p[0].body, 'Messe Nord – du bist AL an 2 Terminen, der erste am 03.11. (Aufbau). Alle Infos im Projektordner.');
});

test('cancelled jobs, jobs without AL and already notified ALs are skipped', () => {
  const p = buildFolderPushes({ name: 'X', notified_al_ids: ['b'] }, [
    { al_id: 'a', date: '2026-11-03', action: 'Aufbau', cancelled: true },
    { al_id: null, date: '2026-11-03', action: 'Aufbau' },
    { al_id: 'b', date: '2026-11-03', action: 'Aufbau' },
    { al_id: 'c', date: '2026-11-04', action: 'Umbau' },
  ]);
  assert.deepEqual(p.map(x => x.user_id), ['c']);
});

test('no jobs → no pushes', () => {
  assert.deepEqual(buildFolderPushes(folder, []), []);
  assert.deepEqual(buildFolderPushes(folder, null), []);
});

test('pgUuidArray: literal for an equality filter on uuid[]', () => {
  assert.equal(pgUuidArray([]), '{}');
  assert.equal(pgUuidArray(null), '{}');
  assert.equal(pgUuidArray(['a', 'b']), '{a,b}');
});
