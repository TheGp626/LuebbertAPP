import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berlinDate, isBerlinNineAm, daysSince, classify, groupPushes, plMail } from './reminders.mjs';

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
