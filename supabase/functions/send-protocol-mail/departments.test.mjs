import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departmentFeedback, planDepartmentMails, feedbackHash, buildDepartmentSubject, buildDepartmentBody,
  departmentRecipient, routeOf, DEPARTMENTS } from './departments.mjs';

const p = {
  date: '2026-11-17', action: 'Abbau', job_no: '26-1234.01',
  projects: { name: 'Hagebau', location: 'Estrel' },
  al: { full_name: 'Max Muster' }, pl: { full_name: 'Lena Beispiel' },
  shifts: [{ temp_worker_name: 'ALEX', start_time: '08:00' }], total_cost: 999,
  protocol_equipments: [
    { category_id: 'stoffe', status: 'beschädigt', note: 'Riss', hussen_delivered: 120, hussen_returned: 114 },
    { category_id: 'floristik', status: 'okay', note: 'nein' },
    { category_id: 'mobiliar', status: 'okay', note: '2 Tische mit Kratzern' },
    { category_id: 'tischlerei', status: 'beschädigt', note: 'Bar wackelt' },
    { category_id: 'logistik', status: 'unvollständig', note: '' },
  ],
};

test('feedback: only areas with a problem, a note or missing Hussen, grouped by department', () => {
  const f = departmentFeedback(p);
  assert.deepEqual(f.stoffe, ['Stoffe: beschädigt. Bemerkung: Riss', 'Hussen: 120 geliefert, 114 zurück, 6 fehlen']);
  assert.deepEqual(f.lager, ['Lager / Logistik: unvollständig', 'Mobiliar: okay. Bemerkung: 2 Tische mit Kratzern']);
  assert.equal(f.floristik, undefined);
  // Tischlerei has no route by default (open question to Jenni)
  assert.ok(!JSON.stringify(f).includes('Bar wackelt'));
});

test('feedback: routes from the settings, unknown departments are ignored', () => {
  const f = departmentFeedback(p, { tischlerei: 'lager', mobiliar: '', stoffe: 'x@evil.test' });
  assert.ok(f.lager.includes('Tischlerei: beschädigt. Bemerkung: Bar wackelt'));
  assert.ok(!f.lager.some(l => l.startsWith('Mobiliar')));
  assert.equal(f.stoffe, undefined);
  assert.equal(routeOf('stoffe', { stoffe: 'constructor' }), '');
});

test('feedback: Hussen all back or not counted → no Hussen line', () => {
  const eq = (d, r) => departmentFeedback({ protocol_equipments: [{ category_id: 'stoffe', status: 'okay', hussen_delivered: d, hussen_returned: r }] });
  assert.deepEqual(eq(120, 120), {});
  assert.deepEqual(eq(120, null), {});
  assert.deepEqual(eq(null, null), {});
  assert.deepEqual(eq(10, 0).stoffe, ['Hussen: 10 geliefert, 0 zurück, 10 fehlen']);
});

test('plan: first mail, retry sends nothing, new feedback sends an Ergänzung, removed feedback sends nothing', () => {
  const f = departmentFeedback(p);
  const first = planDepartmentMails(f, []);
  assert.deepEqual(first.map(m => [m.department, m.isSupplement]), [['lager', false], ['stoffe', false]]);
  const log = first.map(m => ({ department: m.department, items: m.lines }));
  assert.deepEqual(planDepartmentMails(f, log), []);
  const more = departmentFeedback({ protocol_equipments: p.protocol_equipments.concat([{ category_id: 'floristik', status: 'unsauber' }]) });
  more.stoffe = [f.stoffe[0]]; // Hussen line gone (corrected)
  const second = planDepartmentMails(more, log);
  assert.deepEqual(second.map(m => [m.department, m.isSupplement]), [['floristik', false]]);
  const worse = { stoffe: f.stoffe.concat(['Stoffe: unsauber']) };
  assert.deepEqual(planDepartmentMails(worse, log).map(m => [m.department, m.isSupplement]), [['stoffe', true]]);
});

test('hash is stable and order independent', () => {
  assert.equal(feedbackHash(['a', 'b']), feedbackHash(['b', 'a']));
  assert.notEqual(feedbackHash(['a']), feedbackHash(['b']));
  assert.match(feedbackHash([]), /^[0-9a-f]{8}$/);
});

test('subject and body: own area only, no staff, times or costs', () => {
  assert.equal(buildDepartmentSubject(p, 'stoffe', false), 'Rückmeldung Stoffe: Hagebau, Estrel, 17.11.2026');
  assert.equal(buildDepartmentSubject(p, 'stoffe', true, true), '[TEST → Stoffe] Ergänzung Rückmeldung Stoffe: Hagebau, Estrel, 17.11.2026');
  const lines = departmentFeedback(p).stoffe;
  const { text, html } = buildDepartmentBody(p, 'stoffe', lines);
  for (const s of ['Projektnummer: 26-1234.01', 'Ort: Estrel', 'Aktion: Abbau', 'AL: Max Muster', 'PL: Lena Beispiel', '6 fehlen']) assert.ok(text.includes(s), s);
  for (const s of ['ALEX', '08:00', '999', 'Personal', 'Mobiliar', '–']) assert.ok(!text.includes(s), s);
  assert.ok(html.includes('Hussen: 120 geliefert'));
  const esc = buildDepartmentBody({ projects: { name: '<b>' } }, 'lager', ['<x>']).html;
  assert.ok(!esc.includes('<b>') && !esc.includes('<x>'));
  assert.ok(!/undefined|null/.test(buildDepartmentBody({}, 'lager', ['a']).text));
});

test('body: a Zusatzauftrag names its main protocol', () => {
  const t = buildDepartmentBody({ ...p, side_of: 'x', main: { projects: { name: 'Breko' } } }, 'lager', ['a']).text;
  assert.match(t, /Zusatzauftrag: im Zuge von Breko/);
});

test('recipient: off, test mode with and without test address, live', () => {
  assert.equal(departmentRecipient('lager', { enabled: false, testMode: false }).reason, 'disabled');
  assert.deepEqual(departmentRecipient('lager', { enabled: true, testMode: true, testRecipient: 't@x.de' }), { to: 't@x.de', reason: null, test: true });
  assert.equal(departmentRecipient('lager', { enabled: true, testMode: true, testRecipient: '' }).reason, 'not_configured');
  const emails = { floristik: 'Florist@peterluebbert.de', lager: 'x@evil.test', logistik: '' };
  assert.equal(departmentRecipient('floristik', { enabled: true, testMode: false, emails }).to, 'Florist@peterluebbert.de');
  assert.equal(departmentRecipient('lager', { enabled: true, testMode: false, emails }).reason, 'no_address');
  assert.equal(departmentRecipient('logistik', { enabled: true, testMode: false, emails }).reason, 'no_address');
  assert.equal(departmentRecipient('stoffe', { enabled: true, testMode: false }).reason, 'no_address');
  assert.ok(DEPARTMENTS.tischlerei && DEPARTMENTS.logistik);
});

test('Fehlmengen from Material abhaken: in the PL mail and to the Lager / Logistik department', async () => {
  const { buildBody, shortageLines } = await import('./mail.mjs');
  const short = [{ name: 'Stuhl Napoleon', soll: 100, ist: 94, fehlt: 6, note: 'Lager prüfen' }, { name: 'Husse', fehlt: null }];
  assert.deepEqual(shortageLines(short), ['Stuhl Napoleon: 6 fehlen (Soll 100, Ist 94). Bemerkung: Lager prüfen', 'Husse: fehlt']);
  assert.match(buildBody({ shortages: short, date: '2026-11-17' }).text, /Fehlmengen laut Auftrag:\n- Stuhl Napoleon: 6 fehlen/);
  const f = departmentFeedback({ protocol_equipments: [], shortages: short });
  assert.deepEqual(f.lager, ['Fehlmenge Stuhl Napoleon: 6 fehlen (Soll 100, Ist 94). Bemerkung: Lager prüfen', 'Fehlmenge Husse: fehlt']);
  assert.deepEqual(departmentFeedback({ protocol_equipments: [], shortages: short }, { logistik: '' }), {});
  assert.deepEqual(Object.keys(departmentFeedback({ protocol_equipments: [], shortages: short }, { logistik: 'logistik' })), ['logistik']);
});

test('PL mail names the attached photos', async () => {
  const { buildBody } = await import('./mail.mjs');
  assert.match(buildBody({ date: '2026-11-17', photos: ['2026-11/a.jpg', '2026-11/b.jpg'] }).text, /Fotos: 2 im Anhang/);
  assert.doesNotMatch(buildBody({ date: '2026-11-17' }).text, /Fotos:/);
});
