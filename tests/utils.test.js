// Run from the repo root: node --test tests/utils.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const src = require('fs').readFileSync(require('path').join(__dirname, '../js/utils.js'), 'utf8');
const grab = name => { const m = src.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\r?\\n}\\r?\\n')); if (!m) throw new Error(name + ' missing'); return m[0]; };
const diffEinsaetze = new Function(grab('diffEinsaetze') + '; return diffEinsaetze;')();
const einsatzStatus = new Function(grab('einsatzStatus') + '; return einsatzStatus;')();

const ex = [
  { id: 'a', folder_id: 'F', date: '2026-10-20', action: 'Aufbau', al_id: 'X', cancelled: false },
  { id: 'b', folder_id: 'F', date: '2026-10-22', action: 'Abbau', al_id: 'X', cancelled: false },
  { id: 'c', folder_id: 'F', date: '2026-10-23', action: 'Abbau', al_id: 'Y', cancelled: false },
];

test('diffEinsaetze: new, changed, removed, unchanged', () => {
  const edited = [
    { id: 'a', date: '2026-10-20', action: 'Aufbau', al_id: 'X', cancelled: false },     // unchanged
    { id: 'b', date: '2026-10-22', action: 'Abbau', al_id: 'Y', cancelled: true },       // changed
    { date: '2026-10-25', action: 'Umbau', al_id: 'X', cancelled: false },               // new
  ];
  const d = diffEinsaetze(ex, edited);
  assert.deepEqual(d.remove, ['c']);
  assert.equal(d.insert.length, 1);
  assert.deepEqual(d.insert[0], { date: '2026-10-25', action: 'Umbau', al_id: 'X', cancelled: false });
  assert.equal(d.update.length, 1);
  assert.deepEqual(d.update[0], { id: 'b', date: '2026-10-22', action: 'Abbau', al_id: 'Y', cancelled: true });
});
test('diffEinsaetze: nothing changed', () => {
  const d = diffEinsaetze(ex, ex.map(e => ({ id: e.id, date: e.date, action: e.action, al_id: e.al_id, cancelled: e.cancelled })));
  assert.deepEqual(d, { insert: [], update: [], remove: [] });
});
test('einsatzStatus', () => {
  const t = '2026-10-26';
  assert.equal(einsatzStatus({ date: '2026-10-20', cancelled: true }, true, t), 'cancelled');
  assert.equal(einsatzStatus({ date: '2026-10-27', cancelled: false }, false, t), 'future');
  assert.equal(einsatzStatus({ date: '2026-10-20', cancelled: false }, true, t), 'done');
  assert.equal(einsatzStatus({ date: '2026-10-26', cancelled: false }, false, t), 'open');
  assert.equal(einsatzStatus({ date: '2026-10-20', cancelled: false }, false, t), 'open');
});
const ratingToSave = new Function(grab('ratingToSave') + '; return ratingToSave;')();
const ratingKeyForShift = new Function(grab('ratingKeyForShift') + '; return ratingKeyForShift;')();
const pdfWrappedRow = new Function(grab('pdfWrappedRow') + '; return pdfWrappedRow;')();

test('ratingToSave: star alone counts as a good rating (rating column is NOT NULL)', () => {
  assert.deepEqual(ratingToSave({ rating: null, isStar: true }), { rating: 'up', is_star: true });
  assert.deepEqual(ratingToSave({ rating: 'down', isStar: false }), { rating: 'down', is_star: false });
  assert.equal(ratingToSave({ rating: null, isStar: false }), null);
});

test('ratingKeyForShift: falls back to the linked employee name', () => {
  assert.equal(ratingKeyForShift({ temp_worker_name: ' Test Zenjobber ' }), 'test zenjobber');
  assert.equal(ratingKeyForShift({ temp_worker_name: null, app_users: { full_name: 'Erika Beispiel' } }), 'erika beispiel');
  assert.equal(ratingKeyForShift({}), '');
});

function fakeDoc() {
  const calls = [];
  return {
    calls, pages: 1,
    // 10 chars per line, ignoring width math
    splitTextToSize: (t) => { const out = []; String(t).split('\n').forEach(p => { for (let i = 0; i < Math.max(p.length, 1); i += 10) out.push(p.slice(i, i + 10)); }); return out; },
    text(t, x, y) { calls.push({ t, x, y, page: this.pages }); },
    setFont() {}, addPage() { this.pages++; },
  };
}

test('pdfWrappedRow: wraps long text and advances y per line', () => {
  const doc = fakeDoc();
  const y = pdfWrappedRow(doc, 'Feedback:', 'a'.repeat(25), 20, 60, 100, 100, 4.5, 280);
  const lines = doc.calls.filter(c => c.x === 60);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map(l => l.y), [100, 104.5, 109]);
  assert.equal(y, 109 + 4.5 + 1.5);
});

test('pdfWrappedRow: keeps line breaks and breaks pages', () => {
  const doc = fakeDoc();
  const y = pdfWrappedRow(doc, 'Mängel:', 'eins\nzwei\ndrei', 20, 60, 100, 275, 4.5, 280);
  const lines = doc.calls.filter(c => c.x === 60);
  assert.deepEqual(lines.map(l => l.t), ['eins', 'zwei', 'drei']);
  assert.ok(doc.pages > 1, 'should have added a page');
  assert.ok(lines.every(l => l.y <= 280));
  assert.ok(y < 280);
});

const fillMissingCategories = new Function(grab('fillMissingCategories') + '; return fillMissingCategories;')();
test('fillMissingCategories: loaded protocol keeps disabled categories disabled', () => {
  const cfg = [{ id: 'stoffe' }, { id: 'moebel' }];
  const loaded = fillMissingCategories({ stoffe: { active: true, status: 'okay', note: 'x' } }, cfg, false);
  assert.deepEqual(loaded.moebel, { active: false, status: 'okay', note: '' });
  assert.equal(loaded.stoffe.note, 'x');
  assert.equal(fillMissingCategories({}, cfg, true).moebel.active, true);
});

test('mergeOpenJobs: folder job wins on the same date, plan rows of one day are merged', () => {
  const mergeOpenJobs = new Function(grab('mergeOpenJobs') + '; return mergeOpenJobs;')();
  const folder = [{ id: 'e1', date: '2026-10-24', action: 'Aufbau', folderName: 'Ordner X' }];
  const plan = [
    { date: '2026-10-24', venue: 'Estrel', action: 'Abbau' },
    { date: '2026-10-25', venue: 'Estrel', action: 'Aufbau' },
    { date: '2026-10-25', venue: 'Messe', action: 'Aufbau' },
  ];
  const r = mergeOpenJobs(folder, plan);
  assert.deepEqual(r, [
    { id: 'e1', date: '2026-10-24', action: 'Aufbau', folderName: 'Ordner X', source: 'folder' },
    { id: null, date: '2026-10-25', action: 'Aufbau', folderName: 'Estrel / Messe', source: 'plan' },
  ]);
  assert.deepEqual(mergeOpenJobs([], []), []);
});

// Billing periods: getBillingKeyForDate is the source of truth, the label must describe exactly its days
const billing = new Function(
  "var MONTHS_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];" +
  grab('pad') + grab('getBillingKeyForDate') + grab('getBillingPeriodLabel') +
  '; return { getBillingKeyForDate, getBillingPeriodLabel };')();
const bk = (iso, c) => billing.getBillingKeyForDate(new Date(iso + 'T12:00:00'), c).key;

test('billing cutoff 20: the 20th starts the next period', () => {
  assert.equal(bk('2026-10-19', 20), '2026-10');
  assert.equal(bk('2026-10-20', 20), '2026-11');
  assert.equal(bk('2026-12-20', 20), '2027-01');
  assert.equal(billing.getBillingPeriodLabel('2026-11', 20), '20.10.2026 – 19.11.2026');
  assert.equal(billing.getBillingPeriodLabel('2027-01', 20), '20.12.2026 – 19.01.2027');
});

test('billing cutoff 1 = calendar month', () => {
  assert.equal(bk('2026-10-01', 1), '2026-10');
  assert.equal(bk('2026-10-31', 1), '2026-10');
  assert.equal(bk('2026-12-31', 1), '2026-12');
  assert.equal(billing.getBillingKeyForDate(new Date(2026, 9, 15, 12), 1).label, 'Oktober 2026');
  assert.equal(billing.getBillingPeriodLabel('2026-10', 1), '01.10.2026 – 31.10.2026');
  assert.equal(billing.getBillingPeriodLabel('2026-02', 1), '01.02.2026 – 28.02.2026');
});

test('billing cutoff 31 = calendar month (label too)', () => {
  assert.equal(bk('2026-10-31', 31), '2026-10');
  assert.equal(billing.getBillingPeriodLabel('2026-10', 31), '01.10.2026 – 31.10.2026');
  assert.equal(billing.getBillingPeriodLabel('2026-09', 31), '01.09.2026 – 30.09.2026');
});

test('billing cutoff 30: label follows the real days around February', () => {
  // Jan 30/31 → Feb period; all of Feb (28 days) stays in Feb; March starts on the 1st
  assert.equal(bk('2026-01-30', 30), '2026-02');
  assert.equal(bk('2026-02-28', 30), '2026-02');
  assert.equal(bk('2026-03-01', 30), '2026-03');
  assert.equal(billing.getBillingPeriodLabel('2026-02', 30), '30.01.2026 – 28.02.2026');
  assert.equal(billing.getBillingPeriodLabel('2026-03', 30), '01.03.2026 – 29.03.2026');
});

test('billing: every day of a year lands in exactly the period whose label covers it (all cutoffs)', () => {
  const parse = s => { const [d, m, y] = s.split('.').map(Number); return new Date(y, m - 1, d, 12); };
  for (let c = 1; c <= 31; c++) {
    for (let t = new Date(2027, 0, 1, 12); t.getFullYear() === 2027; t.setDate(t.getDate() + 1)) {
      const key = billing.getBillingKeyForDate(t, c).key;
      const [from, to] = billing.getBillingPeriodLabel(key, c).split(' – ').map(parse);
      assert.ok(t >= from && t <= to, 'cutoff ' + c + ' day ' + t.toDateString() + ' not in ' + billing.getBillingPeriodLabel(key, c));
    }
  }
});

test('jsAttrArg: safe as a quoted JS string inside an HTML attribute', () => {
  const jsAttrArg = new Function(grab('escapeHtml') + grab('jsAttrArg') + '; return jsAttrArg;')();
  assert.equal(jsAttrArg("2026-W12:AL fest"), '2026-W12:AL fest');
  assert.equal(jsAttrArg("O'Neil"), "O\\&#039;Neil");
  assert.equal(jsAttrArg('a"b<c>\\'), 'a&quot;b&lt;c&gt;\\\\');
});
