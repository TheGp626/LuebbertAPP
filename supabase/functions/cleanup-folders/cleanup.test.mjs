// Run: node --test supabase/functions/cleanup-folders/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueFolderTrees, storagePaths, chunk } from './cleanup.mjs';

const folders = [
  { id: 'a', name: 'Messe Nord', parent_id: null, ends_on: '2026-10-20' },
  { id: 'a1', name: 'Pläne', parent_id: 'a', ends_on: null },
  { id: 'a2', name: 'Fotos', parent_id: 'a1', ends_on: '2026-01-01' },   // own date is ignored
  { id: 'b', name: 'Hallenbau', parent_id: null, ends_on: '2026-10-30' }, // today → not due yet
  { id: 'c', name: 'Ohne Datum', parent_id: null, ends_on: null },
  { id: 'd', name: 'Alt', parent_id: null, ends_on: '2026-09-01' },
  { id: 'e', name: 'Zukunft', parent_id: null, ends_on: '2026-12-01' },
  { id: 'x', name: 'Unterordner mit Datum', parent_id: 'e', ends_on: '2026-01-01' },
];

test('dueFolderTrees: only top-level folders with ends_on before today, with their subtree', () => {
  const due = dueFolderTrees(folders, '2026-10-30');
  assert.deepEqual(due.map(f => f.id), ['d', 'a']);   // oldest date first
  assert.deepEqual(due[1], { id: 'a', name: 'Messe Nord', ends_on: '2026-10-20', treeIds: ['a', 'a1', 'a2'] });
});

test('dueFolderTrees: no date is never due, subfolders never on their own date', () => {
  const ids = dueFolderTrees(folders, '2030-01-01').map(f => f.id);
  assert.equal(ids.includes('c'), false);
  assert.equal(ids.includes('a1'), false);
  assert.equal(ids.includes('a2'), false);
  assert.equal(ids.includes('x'), false);
});

test('dueFolderTrees: cycle in parent_id terminates', () => {
  const loop = [
    { id: 'r', name: 'R', parent_id: null, ends_on: '2026-01-01' },
    { id: 's', name: 'S', parent_id: 'r', ends_on: null },
    { id: 't', name: 'T', parent_id: 's', ends_on: null },
  ];
  loop[0].parent_id = null;
  loop.push({ id: 'u', name: 'U', parent_id: 'u', ends_on: null }); // self-parent, not reachable
  const due = dueFolderTrees(loop, '2026-10-30');
  assert.deepEqual(due[0].treeIds, ['r', 's', 't']);
  // a child pointing back at the root must not duplicate ids
  const back = [
    { id: 'r', name: 'R', parent_id: null, ends_on: '2026-01-01' },
    { id: 's', name: 'S', parent_id: 'r', ends_on: null },
  ];
  assert.deepEqual(dueFolderTrees(back, '2026-10-30')[0].treeIds, ['r', 's']);
});

test('dueFolderTrees: empty or missing input', () => {
  assert.deepEqual(dueFolderTrees(null, '2026-10-30'), []);
  assert.deepEqual(dueFolderTrees([], '2026-10-30'), []);
});

test('storagePaths: part after /project-files/, bad urls dropped, duplicates removed', () => {
  assert.deepEqual(storagePaths([
    'https://x.supabase.co/storage/v1/object/public/project-files/ordner/a.pdf',
    'https://x.supabase.co/storage/v1/object/public/project-files/ordner/a.pdf',
    'https://x.supabase.co/storage/v1/object/public/project-files/b/c d.png',
    'https://elsewhere.example/file.png',
    '', null, undefined,
  ]), ['ordner/a.pdf', 'b/c d.png']);
  assert.deepEqual(storagePaths(null), []);
});

test('storagePaths: query string is cut off and the path is URL-decoded', () => {
  assert.deepEqual(storagePaths(['https://x.supabase.co/storage/v1/object/public/project-files/f/Ma%C3%9Fe.pdf?t=1']), ['f/Maße.pdf']);
});

test('chunk: splits into groups of n', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
});
