// Run from the repo root: node --test tests/order-slots.test.js
// Plan entries are shaped like Daniel's real weekly plan (1.–13.11.2026), names left out.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

let ctx;
beforeEach(() => {
  ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/order-slots.js'), 'utf8'), ctx, { filename: 'order-slots.js' });
});

const plan = (id, date, location, title, wann, assigned) => ({ id, date, key: 'k-' + id, venue: 'Estrel',
  location: 'Sonnenallee 225\n12057 Berlin\n' + location, title, wann, plan_assignments: (assigned || []).map(u => ({ user_id: u })) });
const PLAN = [
  plan('gdp-ch', '2026-11-01', 'CH II\nGDP', '32 STB weiß + Kufenfuß', 'Aufbau: 16 Uhr\nLeergut hinter Vorhang!!'),
  plan('gdp-eu', '2026-11-01', 'Saal Europa\nGDP', 'Stand 06 | Uni', 'Aufbau: 16 Uhr'),
  plan('gdp-um', '2026-11-04', 'CH II\nGDP', 'Umstellen:', 'Anlieferung: nach Lkw-Tausch\nSchnellumbau: 16 - 19 Uhr'),
  plan('gdp-eu-ab', '2026-11-04', 'Saal Europa\nGDP', 'Stand 06 | Uni', 'Abbau: ab 17 Uhr nach Schnellumbau'),
  plan('ver-auf', '2026-11-09', 'Vernissage Streletzki', 'Neuköllnspeicher', 'Aufbau: 10 Uhr', ['u1']),
  plan('res', '2026-11-09', 'Auditorium Bühne\nReservisten', '1 STB weiß + Verblendung', 'Abbau: nach Neuköllnspeicher'),
  plan('boa-auf', '2026-11-11', 'Auditorium\nBusiness of Apps', '4 Loungesofa weiß Akustico', 'Aufbau: 11 Uhr'),
  plan('post', '2026-11-11', 'Dt. Post Betriebsräte', 'CH I CD & Foyer 3', 'Aufbau: 10 Uhr'),
  plan('boa-ab', '2026-11-12', 'Auditorium\nBusiness of Apps', '4 Loungesofa weiß Akustico', 'Abbau: ab 19.15 Uhr'),
  plan('ver-deko', '2026-11-12', 'Vernissage Streletzki', 'Neuköllnspeicher', 'Aufbau: bis 16 Uhr'),
  plan('ver-ab', '2026-11-13', 'Vernissage Streletzki', 'Neuköllnspeicher', 'Abbau: 13 Uhr (früher möglich)'),
];
const slot = (job_no, phase, start, title, name, extra) => Object.assign({ job_no, phase, start_at: start, end_at: null, title, name,
  needed: 4, accepted: 0, my_status: null, link_set: false, link_date: null, link_key: null }, extra || {});
const BOA = '261112_Estrel_Business of Apps', VER = '261112_Estrel_Vernissage Kira Streletzki (Sponsoring)', GDP = '261101-05_Estrel_GdP';
const id = s => (s ? s.id : null);

test('ordMatchSlot: Business of Apps setup → 11.11. entry; teardown → 12.11. entry', () => {
  assert.equal(id(ctx.ordMatchSlot(slot('26-0447.01', 'setup', '2026-11-11T09:00', BOA, 'Business of Apps im Auditorium am 12.11.2026'), PLAN)), 'boa-auf');
  assert.equal(id(ctx.ordMatchSlot(slot('26-0447.01', 'teardown', '2026-11-12T19:15', BOA, 'Business of Apps im Auditorium am 12.11.2026'), PLAN)), 'boa-ab');
});

test('ordMatchSlot: Vernissage by event words and job name (9.11. setup, 13.11. teardown)', () => {
  assert.equal(id(ctx.ordMatchSlot(slot('26-0415.01', 'setup', '2026-11-09T10:00', VER, 'Neuköllnspeicher'), PLAN)), 'ver-auf');
  assert.equal(id(ctx.ordMatchSlot(slot('26-0415.01', 'teardown', '2026-11-13T10:00', VER, 'Neuköllnspeicher'), PLAN)), 'ver-ab');
});

test('ordMatchSlot: GdP .01 setup 1.11. → „CH II / GDP“, not „Saal Europa / GDP“; .03 Umbau → 4.11. CH II', () => {
  assert.equal(id(ctx.ordMatchSlot(slot('26-0394.01', 'setup', '2026-11-01T17:00', GDP, 'CH II // Aufbau 01.11.'), PLAN)), 'gdp-ch');
  assert.equal(id(ctx.ordMatchSlot(slot('26-0394.03', 'setup', '2026-11-04T16:00', GDP, 'CH II // 04.11. Umbau AVA'), PLAN)), 'gdp-um');
});

test('ordMatchSlot: two entries with equal score → null', () => {
  const twins = [plan('a', '2026-11-01', 'GDP', 'x', 'Aufbau: 8 Uhr'), plan('b', '2026-11-01', 'GDP', 'y', 'Aufbau: 9 Uhr')];
  assert.equal(ctx.ordMatchSlot(slot('26-0394.02', 'setup', '2026-11-01T08:00', GDP, 'Deko'), twins), null);
});

test('ordMatchSlot: wrong phase → null; other venue → null; no shared word → null', () => {
  assert.equal(ctx.ordMatchSlot(slot('26-0447.01', 'setup', '2026-11-12T19:15', BOA, 'Business of Apps'), PLAN.filter(p => p.id === 'boa-ab')), null);
  const other = PLAN.map(p => Object.assign({}, p, { venue: 'Messe Berlin' }));
  assert.equal(ctx.ordMatchSlot(slot('26-0447.01', 'setup', '2026-11-11T09:00', BOA, 'Business of Apps'), other), null);
  assert.equal(ctx.ordMatchSlot(slot('26-0999.01', 'setup', '2026-11-11T09:00', '261111_Estrel_Zahnärzte', 'Garderobe'), PLAN), null);
});

test('ordAttachSlots: manual link wins; manual unlink → unlinked; link to missing key → unlinked', () => {
  const auto = slot('26-0447.01', 'setup', '2026-11-11T09:00', BOA, 'Business of Apps');
  // manual link to a setup entry of that day
  const manual = slot('26-0500.01', 'setup', '2026-11-11T10:00', '261111_Estrel_Betriebsräteversammlung', 'Foyer', { link_set: true, link_date: '2026-11-11', link_key: 'k-post' });
  const unlink = slot('26-0415.01', 'setup', '2026-11-09T10:00', VER, 'Neuköllnspeicher', { link_set: true });
  const gone = slot('26-0415.01', 'teardown', '2026-11-13T10:00', VER, 'Neuköllnspeicher', { link_set: true, link_date: '2026-11-13', link_key: 'k-weg' });
  const r = ctx.ordAttachSlots([auto, manual, unlink, gone], PLAN);
  assert.deepEqual(JSON.parse(JSON.stringify(Object.keys(r.bySid).sort())), ['boa-auf', 'post']);
  assert.equal(r.bySid['post'][0], manual);
  assert.deepEqual(JSON.parse(JSON.stringify(r.unlinked.map(s => s.job_no + s.phase))), ['26-0415.01setup', '26-0415.01teardown']);
});

test('ordTaken: Daniel + accepted applications, no duplicates; count without application list', () => {
  const s = slot('26-0415.01', 'setup', '2026-11-09T10:00', VER, 'Neuköllnspeicher', { accepted: 2 });
  const p = PLAN.find(x => x.id === 'ver-auf');
  const apps = [{ job_no: '26-0415.01', phase: 'setup', user_id: 'u1', status: 'angenommen' },
    { job_no: '26-0415.01', phase: 'setup', user_id: 'u2', status: 'angenommen' },
    { job_no: '26-0415.01', phase: 'setup', user_id: 'u3', status: 'offen' },
    { job_no: '26-0415.01', phase: 'teardown', user_id: 'u4', status: 'angenommen' }];
  assert.deepEqual([...ctx.ordTaken(s, p, apps)].sort(), ['u1', 'u2']);
  assert.equal(ctx.ordTakenCount(s, p), 3); // MA view: Daniel's 1 + 2 accepted (overlap unknown there)
  assert.equal(ctx.ordTakenCount(s, null), 2);
});

test('ordCanApply: past, already assigned by Daniel, Gast, already applied → false', () => {
  const s = slot('26-0415.01', 'setup', '2026-11-09T10:00', VER, 'Neuköllnspeicher');
  const p = PLAN.find(x => x.id === 'ver-auf');
  assert.equal(ctx.ordCanApply(s, 'u9', '2026-11-06', 'MA', p), true);
  assert.equal(ctx.ordCanApply(s, 'u9', '2026-11-10', 'MA', p), false);
  assert.equal(ctx.ordCanApply(s, 'u1', '2026-11-06', 'MA', p), false);
  assert.equal(ctx.ordCanApply(s, 'u9', '2026-11-06', 'Gast', null), false);
  assert.equal(ctx.ordCanApply(Object.assign({}, s, { my_status: 'offen' }), 'u9', '2026-11-06', 'MA', null), false);
  assert.equal(ctx.ordCanApply(s, null, '2026-11-06', 'MA', null), false);
});

test('ordTakenCount: accepted ids from the RPC are not counted twice when Daniel copied them into his plan', () => {
  const p = { id: 'p', plan_assignments: [{ user_id: 'u1' }, { user_id: 'u2' }] };
  assert.equal(ctx.ordTakenCount({ accepted: 2, accepted_ids: ['u1', 'u3'] }, p), 3);
  assert.equal(ctx.ordTakenCount({ accepted: 2 }, p), 4); // old shape without ids: plain sum
});

test('ordAttachSlots: a manual link to an entry of the other phase (keys shifted by a re-import) → unlinked', () => {
  const s = slot('26-0415.01', 'setup', '2026-11-13T10:00', VER, 'Neuköllnspeicher', { link_set: true, link_date: '2026-11-13', link_key: 'k-ver-ab' });
  const r = ctx.ordAttachSlots([s], PLAN);
  assert.equal(Object.keys(r.bySid).length, 0);
  assert.equal(r.unlinked.length, 1);
});
