// Run from the repo root: node --test tests/planjob.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('../js/planjob.js');
const plain = v => JSON.parse(JSON.stringify(v));

test('pjTokens / pjSimilar: umlauts, Ø, units and word order do not matter', () => {
  assert.deepEqual(plain(J.pjTokens('Stehtisch Ø 80 cm, weiß')), ['stehtisch', '80', 'weiss']);
  assert.deepEqual(plain(J.pjTokens('Stehtisch Ø80')), ['stehtisch', '80']);
  assert.equal(J.pjSimilar('Stehtisch Ø80', 'Stehtisch Ø 80 cm'), 1);
  assert.equal(J.pjSimilar('Stehtisch', 'Stehtisch Ø 80 cm, weiß'), 0.8);       // all words of the short name inside
  assert.ok(J.pjSimilar('Banketttisch 180x80', 'Stehtisch Ø80') < 0.5);
  assert.equal(J.pjSimilar('', 'x'), 0);
});

test('pjOrderItems: articles summed over groups, billing lines out', () => {
  const job = { materials: [
    { group: 'Foyer', items: [{ qty: 20, name: 'Stehtisch Ø 80 cm' }, { qty: 4, name: 'Stehtischhusse weiß' }] },
    { group: 'Galerie', items: [{ qty: 10, name: 'Stehtisch Ø80cm' }, { qty: 1, name: 'Transportpauschale' }, { qty: 1, name: 'Rabatt Personal' }] }] };
  assert.deepEqual(plain(J.pjOrderItems(job)), [{ name: 'Stehtisch Ø 80 cm', qty: 30 }, { name: 'Stehtischhusse weiß', qty: 4 }]);
  assert.deepEqual(plain(J.pjOrderItems(null)), []);
});

test('pjCompare: exact and similar names pair up; more, less, only in plan, only in order', () => {
  const plan = [{ name: 'Stehtisch Ø 80 cm', count: 30 }, { name: 'Stuhl', count: 180 }, { name: 'Bistrotisch', count: 6 }, { name: 'Lounge Sofa', count: 4 }];
  const order = [{ name: 'Stehtisch Ø 80 cm', qty: 24 }, { name: 'Stuhl Modell Berlin schwarz', qty: 189 }, { name: 'Lounge Sofa', qty: 4 }, { name: 'Bühnenpodest 2x1', qty: 8 }];
  const r = J.pjCompare(plan, order);
  const by = Object.fromEntries(r.map(x => [x.order || x.plan, x]));
  assert.equal(by['Stehtisch Ø 80 cm'].status, 'mehr'); assert.equal(by['Stehtisch Ø 80 cm'].diff, 6); assert.equal(by['Stehtisch Ø 80 cm'].match, 'exakt');
  assert.equal(by['Stuhl Modell Berlin schwarz'].status, 'weniger'); assert.equal(by['Stuhl Modell Berlin schwarz'].match, 'aehnlich'); assert.equal(by['Stuhl Modell Berlin schwarz'].plan, 'Stuhl');
  assert.equal(by['Lounge Sofa'].status, 'ok');
  assert.equal(by['Bistrotisch'].status, 'nurPlan'); assert.equal(by['Bistrotisch'].diff, 6);
  assert.equal(by['Bühnenpodest 2x1'].status, 'nurAuftrag'); assert.equal(by['Bühnenpodest 2x1'].diff, -8);
  assert.equal(r[r.length - 1].status, 'ok', 'problems first, matches last');
});

test('pjTitleDates: dates from the title block, earliest and latest; none → nulls', () => {
  assert.deepEqual(plain(J.pjTitleDates(['IPM AG / FBF26', '24.11.2026', '-', '25.11.2026', '2026-11-12 | 09:35'])), { from: '2026-11-24', to: '2026-11-25' });
  assert.deepEqual(plain(J.pjTitleDates(['Datum: 3.2.2027'])), { from: '2027-02-03', to: '2027-02-03' });
  assert.deepEqual(plain(J.pjTitleDates(['nix', '45.13.2026'])), { from: null, to: null });
});

test('pjPlanFits: through the order link, or by date window plus a shared room word', () => {
  const fp = { job_no: '26-0447', title: 'IPM AG FBF26', room: 'Foyer 3', date_from: '2026-11-24', date_to: '2026-11-25' };
  const shift = { date: '2026-11-23', keys: ['k1'], venue: 'Estrel', title: 'IPM Foyer 3', location: 'Sonnenallee 225' };
  assert.equal(J.pjPlanFits(fp, shift, []), true, 'day before, "Foyer" in common');
  assert.equal(J.pjPlanFits(fp, Object.assign({}, shift, { date: '2026-11-19' }), []), false, 'too early');
  assert.equal(J.pjPlanFits(fp, Object.assign({}, shift, { title: 'Gala Saal Europa' }), []), false, 'other room');
  const link = [{ job_no: '26-0447.01', plan_date: '2026-11-19', plan_key: 'k9' }];
  assert.equal(J.pjPlanFits(fp, { date: '2026-11-19', keys: ['k9'], venue: 'x', title: 'y' }, link), true, 'linked Auftrag wins over dates');
  assert.equal(J.pjPlanFits({ title: 'x', room: '', date_from: null }, shift, []), false);
});

test('pjMatchProduct: best similar product, nothing below the threshold', () => {
  const products = [{ id: 1, name: 'Stehtisch Ø80 weiß' }, { id: 2, name: 'Banketttisch 180×80' }, { id: 3, name: 'Theke Rund 120' }];
  assert.equal(J.pjMatchProduct('Stehtisch Ø 80 cm', products).id, 1);
  assert.equal(J.pjMatchProduct('Banketttisch', products).id, 2);
  assert.equal(J.pjMatchProduct('Palme', products), null);
});

test('pjHit: tap inside a box, the smallest box wins, misses return null', () => {
  const groups = [{ boxes: [[0, 0, 100, 50]] }, { boxes: [[10, 10, 14, 14], [40, 10, 44, 14]] }];
  assert.deepEqual(plain(J.pjHit(groups, 12, 12)), { gi: 1, bi: 0 });
  assert.deepEqual(plain(J.pjHit(groups, 60, 30)), { gi: 0, bi: 0 });
  assert.deepEqual(plain(J.pjHit(groups, 45.5, 12, 2)), { gi: 1, bi: 1 }, 'within the tolerance');
  assert.equal(J.pjHit(groups, 300, 300), null);
});

test('pjResultOf: only named, counted groups, rounded boxes', () => {
  const groups = [{ sig: 'a', count: 2, members: [{ bbox: [1.234, 2, 3, 4.56] }, { bbox: [5, 6, 7, 8] }] }, { sig: 'b', count: 3, members: [] }, { sig: 'c', count: 1, members: [] }];
  const r = J.pjResultOf(groups, { 0: { name: ' Stuhl ' }, 1: { name: 'Schild', ignore: true }, 2: { name: '' } }, i => '#c' + i);
  assert.deepEqual(plain(r), { groups: [{ sig: 'a', name: 'Stuhl', count: 2, color: '#c0', boxes: [[1.2, 2, 3, 4.6], [5, 6, 7, 8]] }] });
  assert.equal(J.pjCanSave('PL'), true); assert.equal(J.pjCanSave('AL'), false);
});
