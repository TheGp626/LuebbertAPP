import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlinDate, isBerlinNineAm, daysSince, classify, groupPushes, plMail, mergePlanJobs, groupPlanPushes, planWindowStart, buildEveningPushes, berlinHour, planMailLogKeys } from './reminders.mjs';

// ── Plan jobs (Wochenplan → reminders) ──
const row = (o) => Object.assign({ al_id: 'A', date: '2026-10-26', venue: 'Estrel', title: 'CH I', wann: 'Aufbau: 8 Uhr', ap_user_id: 'P1' }, o);

test('mergePlanJobs: same AL twice on one day → one job with both venues', () => {
  const jobs = mergePlanJobs([], [row({}), row({ venue: 'Messe', title: 'Halle 2', wann: 'Abbau: 22 Uhr', ap_user_id: 'P2' })]);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].venues, ['Estrel', 'Messe']);
  assert.deepEqual(jobs[0].titles, ['CH I', 'Halle 2']);
  assert.deepEqual(jobs[0].wann, ['Aufbau: 8 Uhr', 'Abbau: 22 Uhr']);
  assert.deepEqual(jobs[0].pl_ids, ['P1', 'P2']);
  assert.equal(jobs[0].source, 'plan');
});

test('mergePlanJobs: a folder job on the same AL + date wins, a cancelled one does not', () => {
  assert.equal(mergePlanJobs([{ al_id: 'A', date: '2026-10-26', cancelled: false }], [row({})]).length, 0);
  assert.equal(mergePlanJobs([{ al_id: 'A', date: '2026-10-26', cancelled: true }], [row({})]).length, 1);
  assert.equal(mergePlanJobs([{ al_id: 'B', date: '2026-10-26', cancelled: false }], [row({})]).length, 1);
});

test('mergePlanJobs: PL ids distinct, nulls dropped; different days stay separate', () => {
  const jobs = mergePlanJobs([], [row({ ap_user_id: null }), row({ ap_user_id: 'P1' }), row({ ap_user_id: 'P1' }), row({ date: '2026-10-27' })]);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.find(j => j.date === '2026-10-26').pl_ids, ['P1']);
});

test('groupPlanPushes: text, date link, one push per AL', () => {
  const [one] = groupPlanPushes(mergePlanJobs([], [row({ wann: 'Abbau: 0.30 Uhr' })]));
  assert.deepEqual(one, { al_id: 'A', title: 'Protokoll fehlt', body: 'Estrel – Abbau am 26.10.',
    url: './index.html?open=protokoll&datum=2026-10-26', keys: [{ al_id: 'A', date: '2026-10-26' }] });
  const two = groupPlanPushes(mergePlanJobs([], [row({ date: '2026-10-25', venue: 'Messe' }), row({})]));
  assert.equal(two.length, 1);
  assert.equal(two[0].body, '2 offene Protokolle: Messe (25.10.), Estrel (26.10.)');
  assert.equal(two[0].url, './index.html?open=protokoll&datum=2026-10-25');
  assert.equal(two[0].keys.length, 2);
});

test('planWindowStart: plan jobs only count from the day the switch was turned on (Berlin date)', () => {
  assert.equal(planWindowStart('2026-10-17', '2026-10-27T08:00:00Z'), '2026-10-27');
  assert.equal(planWindowStart('2026-10-17', '2026-10-01T08:00:00Z'), '2026-10-17');
  assert.equal(planWindowStart('2026-10-17', '2026-10-26T23:30:00Z'), '2026-10-27'); // 00:30 Berlin
  assert.equal(planWindowStart('2026-10-17', null), '2026-10-17');
});

test('plan jobs go through the same day rules (classify)', () => {
  const [job] = mergePlanJobs([], [row({ date: '2026-10-25' })]);
  assert.equal(classify(job, false, '2026-10-26'), 'push');
  assert.equal(classify(job, true, '2026-10-26'), 'none');
  assert.equal(classify(job, false, '2026-10-31'), 'pl_mail');
});

test('berlinDate around midnight (winter time)', () => {
  assert.equal(berlinDate(new Date('2026-10-26T22:30:00Z')), '2026-10-26'); // 23:30 Berlin
  assert.equal(berlinDate(new Date('2026-10-26T23:30:00Z')), '2026-10-27'); // 00:30 Berlin
});
test('isBerlinNineAm summer and winter', () => {
  assert.equal(isBerlinNineAm(new Date('2026-07-01T07:15:00Z')), true);
  assert.equal(isBerlinNineAm(new Date('2026-12-01T08:15:00Z')), true);
  assert.equal(isBerlinNineAm(new Date('2026-12-01T07:15:00Z')), false);
});
test('daysSince', () => {
  assert.equal(daysSince('2026-10-20', '2026-10-26'), 6);
  assert.equal(daysSince('2026-10-26', '2026-10-26'), 0);
  assert.equal(daysSince('2026-03-28', '2026-03-30'), 2); // across DST start
});
test('classify by day', () => {
  const t = '2026-10-26';
  assert.equal(classify({ date: '2026-10-26', cancelled: false }, false, t), 'none');
  assert.equal(classify({ date: '2026-10-25', cancelled: false }, false, t), 'push');
  assert.equal(classify({ date: '2026-10-21', cancelled: false }, false, t), 'push');
  assert.equal(classify({ date: '2026-10-20', cancelled: false }, false, t), 'pl_mail');
  assert.equal(classify({ date: '2026-10-15', cancelled: false }, false, t), 'none'); // day 11
  assert.equal(classify({ date: '2026-10-24', cancelled: true }, false, t), 'none');
  assert.equal(classify({ date: '2026-10-24', cancelled: false }, true, t), 'none');
  assert.equal(classify({ date: '2026-10-27', cancelled: false }, false, t), 'none');
});
test('groupPushes: one push per AL', () => {
  const items = [
    { einsatz: { id: 'e2', date: '2026-10-21', action: 'Teilaufbau', al_id: 'A' }, folderName: 'BVL' },
    { einsatz: { id: 'e1', date: '2026-10-20', action: 'Aufbau', al_id: 'A' }, folderName: 'BVL' },
    { einsatz: { id: 'e3', date: '2026-10-20', action: 'Aufbau', al_id: 'B' }, folderName: 'BVL' },
  ];
  const g = groupPushes(items);
  assert.equal(g.length, 2);
  const a = g.find(x => x.al_id === 'A');
  assert.equal(a.title, 'Protokoll fehlt');
  assert.equal(a.body, '2 offene Protokolle: BVL (20.10.), BVL (21.10.)');
  assert.ok(a.url.includes('einsatz=e1'));
  assert.ok(a.url.startsWith('./index.html?open=protokoll&einsatz='));
  const b = g.find(x => x.al_id === 'B');
  assert.equal(b.body, 'BVL – Aufbau am 20.10.');
  assert.deepEqual(a.einsatz_ids.sort(), ['e1', 'e2']);
});
test('plMail escapes and formats', () => {
  const m = plMail([{ einsatz: { date: '2026-10-20', action: 'Aufbau' }, folderName: '<b>X</b>', alName: 'Adriano Sorrentino' }]);
  assert.equal(m.subject, 'Protokoll fehlt seit 6 Tagen: <b>X</b> – 20.10.');
  assert.ok(m.html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(!m.html.includes('<b>X</b>'));
  assert.ok(m.text.includes('<b>X</b> – Aufbau am 20.10.2026 (AL: Adriano Sorrentino)'));
  assert.ok(m.text.includes('Automatisch gesendet von der Lübbert App'));
  const m2 = plMail([
    { einsatz: { date: '2026-10-20', action: 'Aufbau' }, folderName: 'A', alName: 'X' },
    { einsatz: { date: '2026-10-20', action: 'Abbau' }, folderName: 'B', alName: 'Y' },
  ]);
  assert.equal(m2.subject, '2 Protokolle fehlen seit 6 Tagen');
});
test('pl_mail is retried on later days until it went out once', () => {
  const t = '2026-10-26';
  assert.equal(classify({ date: '2026-10-20', cancelled: false }, false, t, false), 'pl_mail'); // day 6
  assert.equal(classify({ date: '2026-10-19', cancelled: false }, false, t, false), 'pl_mail'); // day 7, missed yesterday
  assert.equal(classify({ date: '2026-10-16', cancelled: false }, false, t, false), 'pl_mail'); // day 10, last chance
  assert.equal(classify({ date: '2026-10-15', cancelled: false }, false, t, false), 'none');    // day 11: give up
  assert.equal(classify({ date: '2026-10-19', cancelled: false }, false, t, true), 'none');     // already mailed
});

// ── Evening push (ALs, the evening before) ──
const ev = (o) => Object.assign({ al_id: 'A', date: '2026-11-04', source: 'plan', venue: 'VBKI', title: 'Apollo Saal',
  wann: ['Aufbau: 10 Uhr'], team: ['Arina'], open: [{ count: 3, role: 'MA' }], pl: 'Maike' }, o);

test('evening: one plan job → place, time, team, missing people, PL', () => {
  assert.deepEqual(buildEveningPushes([ev({})]), [{ al_id: 'A', title: 'Morgen: VBKI · Apollo Saal',
    body: '10:00 Aufbau · Arina, 3 MA fehlen · PL Maike', url: './index.html?open=wochenplan' }]);
});

test('evening: several jobs sorted by time, jobs without time last', () => {
  const [p] = buildEveningPushes([ev({ venue: 'Messe Berlin', wann: ['Aufbau: 16 Uhr'] }), ev({ venue: 'Ohne Zeit', wann: ['tagsüber'] }), ev({ venue: 'Estrel', wann: ['8 Uhr'] })]);
  assert.equal(p.title, 'Morgen 3 Einsätze');
  assert.equal(p.body, '08:00 Estrel · 16:00 Messe Berlin · Ohne Zeit');
});

test('evening: folder job only', () => {
  assert.deepEqual(buildEveningPushes([{ al_id: 'B', date: '2026-11-04', source: 'folder', folderName: 'Capital Catering', action: 'Aufbau' }]),
    [{ al_id: 'B', title: 'Morgen: Capital Catering – Aufbau', body: '', url: './index.html' }]);
});

test('evening: unknown parts are left out without empty separators', () => {
  const [p] = buildEveningPushes([ev({ title: '', wann: [], team: [], open: [], pl: null })]);
  assert.equal(p.title, 'Morgen: VBKI');
  assert.equal(p.body, '');
  const [q] = buildEveningPushes([ev({ wann: [], team: [], open: [{ count: 1, role: 'AL' }], pl: null })]);
  assert.equal(q.body, '1 AL fehlt');
});

test('evening: one push per AL; plan details win over a folder job of the same AL', () => {
  const pushes = buildEveningPushes([ev({}), ev({ venue: 'Estrel', title: 'CH I', wann: ['Abbau: 22 Uhr'] }),
    { al_id: 'A', date: '2026-11-04', source: 'folder', folderName: 'Ordner', action: 'Aufbau' }, ev({ al_id: 'C' })]);
  assert.equal(pushes.length, 2);
  assert.equal(pushes.find(p => p.al_id === 'A').title, 'Morgen 2 Einsätze');
});

test('berlinHour in summer and winter', () => {
  assert.equal(berlinHour(new Date('2026-07-01T16:00:00Z')), 18);
  assert.equal(berlinHour(new Date('2026-12-01T17:00:00Z')), 18);
});

test('evening: same place at the same time is listed once (several rooms of one event)', () => {
  const [p] = buildEveningPushes([ev({ venue: 'Estrel', title: 'CH I', wann: ['Aufbau: 16 Uhr'] }), ev({ venue: 'Estrel', title: 'CH II', wann: ['Aufbau: 16 Uhr'] }),
    ev({ venue: 'Capital Catering', wann: ['Abbau: 22.30 Uhr'] })]);
  assert.equal(p.title, 'Morgen 3 Einsätze');
  assert.equal(p.body, '16:00 Estrel · 22:30 Capital Catering');
});

test('planMailLogKeys: a plan job counts as mailed only when all of its PL mails are resolved', () => {
  const k1 = { al_id: 'A', date: '2026-10-20' }, k2 = { al_id: 'B', date: '2026-10-20' };
  assert.deepEqual(planMailLogKeys([{ keys: [k1, k2], resolved: true }, { keys: [k1], resolved: false }]), [k2]);
  assert.deepEqual(planMailLogKeys([{ keys: [k1], resolved: true }, { keys: [k1], resolved: true }]), [k1]);
  assert.deepEqual(planMailLogKeys([]), []);
});
