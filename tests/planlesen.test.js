// Run from the repo root: node --test tests/planlesen.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/planlesen.js');
const plain = v => JSON.parse(JSON.stringify(v));
const NAMES = { 1: 'save', 2: 'restore', 3: 'transform', 4: 'constructPath', 5: 'stroke', 6: 'fill', 7: 'setFillRGBColor', 8: 'setStrokeRGBColor', 9: 'closeFillStroke', 10: 'endPath' };
const O = P.PL_OP;

// a w×h rectangle at (x,y), rotated by deg around its centre, as a closed lineTo path
function rotRect(x, y, w, h, deg) {
  const r = deg * Math.PI / 180, cx = x + w / 2, cy = y + h / 2;
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [cx + (px - cx) * Math.cos(r) - (py - cy) * Math.sin(r), cy + (px - cx) * Math.sin(r) + (py - cy) * Math.cos(r)]);
  return { ops: [O.moveTo, O.lineTo, O.lineTo, O.lineTo, O.closePath], coords: pts.flat() };
}

test('plParseOps: rectangles, closed paths, transforms and colours; open strokes are dropped', () => {
  const fn = [3, 8, 4, 5, 1, 3, 7, 4, 6, 2, 4, 5];
  const args = [
    [2, 0, 0, 2, 10, 10], [255, 0, 0], [[O.rectangle], [0, 0, 5, 3]], null,
    null, [1, 0, 0, 1, 100, 0], [0, 0, 255], [[O.moveTo, O.lineTo, O.lineTo, O.closePath], [0, 0, 4, 0, 4, 4]], null, null,
    [[O.moveTo, O.lineTo], [0, 0, 50, 0]], null,      // a wall line: open → not a shape
  ];
  const s = P.plParseOps(fn, args, NAMES);
  assert.equal(s.length, 2);
  assert.deepEqual(plain(s[0].pts), [[10, 10], [20, 10], [20, 16], [10, 16]]); // scaled ×2, moved by 10
  assert.equal(s[0].stroke, '#ff0000'); assert.equal(s[0].fill, null);
  assert.equal(s[1].fill, '#0000ff'); assert.equal(s[1].pts[0][0], 210); // save/transform/restore: 2×(0+100)+10
});

test('plGroup: the same symbol in any rotation is one group; different sizes and colours are not', () => {
  const shapes = [];
  for (let i = 0; i < 12; i++) shapes.push({ pts: chunk(rotRect(i * 40, 0, 18, 6, i * 17).coords), curved: false, fill: null, stroke: '#000000' });
  for (let i = 0; i < 5; i++) shapes.push({ pts: chunk(rotRect(i * 40, 100, 9, 9, 0).coords), curved: false, fill: null, stroke: '#ff0000' });
  for (let i = 0; i < 4; i++) shapes.push({ pts: chunk(rotRect(i * 40, 200, 9, 9, 0).coords), curved: false, fill: null, stroke: '#000000' });
  shapes.push({ pts: chunk(rotRect(0, 300, 30, 30, 0).coords), curved: false, fill: null, stroke: '#000000' }); // only once → no group
  const g = P.plGroup(shapes, { minDiag: 2, maxDiag: 80 });
  assert.deepEqual(g.map(x => x.count).sort((a, b) => b - a), [12, 5, 4]);
});

test('plGroup: a symbol drawn from two parts (outline + filled inner square) counts once', () => {
  const shapes = [];
  for (let i = 0; i < 6; i++) {
    shapes.push({ pts: chunk(rotRect(i * 20, 0, 6, 6, 0).coords), curved: false, fill: null, stroke: '#000000' });
    shapes.push({ pts: chunk(rotRect(i * 20 + 1, 1, 4, 4, 0).coords), curved: false, fill: '#000000', stroke: null });
  }
  const g = P.plGroup(shapes, { minDiag: 2, maxDiag: 80 });
  assert.equal(g.length, 1); assert.equal(g[0].count, 6); assert.equal(g[0].parts, 2);
});

test('plGroup: needle-thin outlines (drawn lines) and huge shapes (rooms) are not furniture', () => {
  const shapes = [];
  for (let i = 0; i < 5; i++) shapes.push({ pts: chunk(rotRect(i * 20, 0, 40, 0.3, 0).coords), curved: false, fill: null, stroke: '#000000' });
  for (let i = 0; i < 5; i++) shapes.push({ pts: chunk(rotRect(i * 300, 0, 200, 150, 0).coords), curved: false, fill: null, stroke: '#000000' });
  assert.equal(P.plGroup(shapes, { minDiag: 2, maxDiag: 80 }).length, 0);
});

test('plTitleZone: box around the title-block words; a stray match in the drawing does not stretch it', () => {
  const words = [{ x: 60, y: 127 }, { x: 74, y: 127 }, { x: 88, y: 424 }, { x: 102, y: 84 }, { x: 80, y: 269 }, { x: 600, y: 600 }];
  const z = P.plTitleZone(words, 595, 842);
  assert.ok(z[2] < 200, 'stray word at x=600 ignored');
  assert.equal(P.plTitleZone([{ x: 1, y: 1 }], 595, 842), null);
  const g = [{ count: 3, members: [{ cx: 70, cy: 200 }, { cx: 400, cy: 400 }, { cx: 410, cy: 400 }, { cx: 420, cy: 400 }] }];
  assert.equal(P.plWithoutZone(g, z, 3)[0].count, 3);
});

test('plCleanLabel: drawing words only, doubled CAD text once', () => {
  assert.equal(P.plCleanLabel('Hochtisch'), 'Hochtisch');
  assert.equal(P.plCleanLabel('HochtischHochtisch'), 'Hochtisch');
  assert.equal(P.plCleanLabel('Maßstab'), null);
  assert.equal(P.plCleanLabel('12'), null);
  assert.equal(P.plCleanLabel('Stehtisch Ø80'), 'Stehtisch');
});

test('plSuggestNames: a word written inside the symbols names the group', () => {
  const m = (x, y) => ({ cx: x + 5, cy: y + 2, diag: 11, bbox: [x, y, x + 10, y + 4] });
  const groups = [{ members: [m(0, 0), m(20, 0), m(40, 0)] }, { members: [m(0, 50), m(20, 50), m(40, 50)] }];
  const labels = [{ text: 'Banketttisch', x: 2, y: 1 }, { text: 'Banketttisch', x: 22, y: 1 }, { text: 'Palette', x: 100, y: 100 }];
  assert.deepEqual(plain(P.plSuggestNames(groups, labels)), ['Banketttisch', null]);
});

test('plMaterialList: same name adds up, hidden groups do not count, unnamed are reported', () => {
  const groups = [{ count: 189 }, { count: 30 }, { count: 12 }, { count: 8 }, { count: 4 }];
  const names = { 0: { name: 'Stuhl' }, 1: { name: 'Stehtisch' }, 2: { name: 'Stehtisch' }, 3: { ignore: true, name: 'Schild' }, 4: { name: '' } };
  const ml = P.plMaterialList(groups, names);
  assert.deepEqual(plain(ml.rows), [{ name: 'Stuhl', count: 189 }, { name: 'Stehtisch', count: 42 }]);
  assert.equal(ml.unnamed, 1);
  assert.match(P.plCsv(ml.rows, 'Plan'), /Artikel;Anzahl\r\nStuhl;189\r\nStehtisch;42/);
  assert.match(P.plCsv([{ name: '=HYPERLINK()', count: 1 }]), /'=HYPERLINK/);
});

test('plMatchMemory: a named symbol is found again with a small size difference, not with another size or colour', () => {
  const a = { kind: 'p4|-|#000000', per: 48, area: 108 };
  const mem = { [P.plSymbolKey(a)]: { name: 'Stuhl' }, [P.plSymbolKey({ kind: 'p4|-|#000000', per: 72, area: 243 })]: { name: 'Tisch' } };
  assert.equal(P.plMatchMemory(mem, { kind: 'p4|-|#000000', per: 48.9, area: 110 }).entry.name, 'Stuhl'); // bucket edge case
  assert.equal(P.plMatchMemory(mem, { kind: 'p4|-|#000000', per: 70, area: 236 }).entry.name, 'Tisch');
  assert.equal(P.plMatchMemory(mem, { kind: 'p4|-|#000000', per: 60, area: 170 }), null);
  assert.equal(P.plMatchMemory(mem, { kind: 'p4|-|#ff0000', per: 48, area: 108 }), null);
  assert.equal(P.plMayUse('AL'), true); assert.equal(P.plMayUse('MA'), false);
});

function chunk(flat) { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; }

test('plFitZoom: a small cluster zooms in and is centred, a spread-out group stays at the whole plan', () => {
  const f = P.plFitZoom([100, 100, 140, 120], 360, 300, 6);
  assert.ok(f.zoom > 4 && f.zoom <= 6, 'zoomed in: ' + f.zoom);
  assert.ok(Math.abs((f.left + 180) / f.zoom - 120) < 1 && Math.abs((f.top + 150) / f.zoom - 110) < 1, 'centred');
  assert.equal(P.plFitZoom([0, 0, 360, 260], 360, 300, 6).zoom, 1);
  assert.equal(P.plFitZoom([0, 0, 1, 1], 360, 300, 6).zoom, 6, 'capped');
});

test('plNextOpen: next group without name and not hidden, wrapping around; -1 when all are done', () => {
  const names = { 0: { name: 'Stuhl' }, 1: { name: '' }, 2: { ignore: true }, 3: {} };
  assert.equal(P.plNextOpen(names, 4, 1, 1), 3);
  assert.equal(P.plNextOpen(names, 4, 3, 1), 1);
  assert.equal(P.plNextOpen(names, 4, 3, -1), 1);
  assert.equal(P.plNextOpen({ 0: { name: 'a' }, 1: { ignore: true } }, 2, 0, 1), -1);
  assert.equal(P.plNextOpen(names, 4, -1, 1), 1, 'start before the first');
});

test('plNameOptions: used names first, then plan words, remembered, products; filtered and without duplicates', () => {
  const o = P.plNameOptions('', ['Stuhl Berlin'], ['Stehtisch Ø80', 'stuhl berlin'], ['Banketttisch', 'Stehtisch Ø80'], ['Hochtisch']);
  assert.deepEqual(o.map(x => x.name), ['Stuhl Berlin', 'Hochtisch', 'Stehtisch Ø80', 'Banketttisch']);
  assert.equal(o[0].used, true); assert.equal(o[1].used, false);
  assert.deepEqual(P.plNameOptions('tisch', ['Stuhl Berlin'], ['Stehtisch Ø80'], ['Banketttisch'], []).map(x => x.name), ['Stehtisch Ø80', 'Banketttisch']);
});
