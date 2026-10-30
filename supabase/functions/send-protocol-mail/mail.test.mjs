import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubject, buildBody, attachmentName, formatDateDE, escapeHtml, safePdfBase64 } from './mail.mjs';

const base = {
  date: '2026-10-20', action: 'Aufbau',
  projects: { name: 'BVL 20.10', location: 'ESTREL' },
  al: { full_name: 'Adriano Sorrentino' }, pl: { full_name: 'Jennifer Wolf', email: 'j@x.de' },
  notes_damages: 'nein', notes_incidents: '', notes_feedback: 'Alles <super> & "gut"',
  shifts: [{ position_role: 'Rockit', temp_worker_name: 'ALEX' }, { position_role: 'MA frei', app_users: { full_name: 'Lukas Kozmus' } }],
  protocol_equipments: [{ category_id: 'mobiliar', status: 'okay' }, { category_id: 'stoffe', status: 'beschädigt', note: 'Riss' }],
  worker_ratings: [{ temp_worker_name: 'ALEX', rating: 'up', is_star: true }]
};

test('subject new', () => assert.equal(buildSubject(base, false), 'Neues Protokoll: BVL 20.10 – 20.10.2026 (Aufbau)'));
test('subject update + test prefix', () => assert.equal(buildSubject(base, true, 'Jennifer Wolf'), '[TEST → Jennifer Wolf] Aktualisiert: BVL 20.10 – 20.10.2026 (Aufbau)'));
test('subject without project/action', () => assert.equal(buildSubject({ ...base, projects: null, action: null }, false), 'Neues Protokoll: Protokoll – 20.10.2026'));
test('subject with action dash', () => assert.equal(buildSubject({ ...base, action: '—' }, false), 'Neues Protokoll: BVL 20.10 – 20.10.2026'));
test('body escapes free text', () => {
  const { html } = buildBody(base);
  assert.ok(html.includes('Alles &lt;super&gt; &amp; &quot;gut&quot;'));
  assert.ok(!html.includes('<super>'));
});
test('body lists only non-okay Gewerke', () => {
  const { text } = buildBody(base);
  assert.ok(text.includes('Stoffe & Hussen: beschädigt – Riss'));
  assert.ok(!text.includes('Mobiliar'));
});
test('body skips "nein"/empty notes', () => {
  const { text } = buildBody(base);
  assert.ok(!text.includes('Mängel'));
  assert.ok(!text.includes('Vorkommnisse'));
});
test('body shows ratings + staff count + footer', () => {
  const { text } = buildBody(base);
  assert.ok(text.includes('ALEX: gut + Stern'));
  assert.ok(text.includes('Personal: 2'));
  assert.ok(text.includes('Automatisch gesendet von der Lübbert App'));
});
test('body survives a sparse protocol', () => {
  const { html, text } = buildBody({ date: null });
  assert.ok(!/undefined|null/.test(html + text));
});
test('attachment name', () => assert.equal(attachmentName(base), 'Protokoll_BVL_20_10_2026-10-20.pdf'));
test('helpers', () => {
  assert.equal(formatDateDE(null), '—');
  assert.equal(escapeHtml(null), '');
});
test('safePdfBase64 keeps real PDFs only', () => {
  assert.equal(safePdfBase64('JVBERi0xLjMKJ...'), 'JVBERi0xLjMKJ...'); // base64 of "%PDF-1.3"
  assert.equal(safePdfBase64('TVqQAAMAAAAEAAAA'), null); // "MZ" executable header
  assert.equal(safePdfBase64(''), null);
  assert.equal(safePdfBase64(null), null);
  assert.equal(safePdfBase64(42), null);
});
