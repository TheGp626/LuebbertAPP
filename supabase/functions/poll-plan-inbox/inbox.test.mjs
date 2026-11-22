import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowed, authPassed, pickPlanPdfs, senderAllowed, storagePath } from './inbox.mjs';

const mk = (from, auth, atts) => ({ from: { value: [{ address: from }] }, headers: new Map([['authentication-results', auth]]), attachments: atts });
const pdf = { filename: 'Wochenplan KW48.pdf', contentType: 'application/pdf', size: 1000 };

test('parseAllowed', () => {
  assert.deepEqual(parseAllowed(' Max@X.de, lena@y.de ,'), ['max@x.de', 'lena@y.de']);
  assert.deepEqual(parseAllowed(undefined), []);
});
test('authPassed', () => {
  assert.equal(authPassed('mx.google.com; dkim=pass header.i=@x.de; spf=fail'), true);
  assert.equal(authPassed('mx.google.com; dkim=fail; dmarc=pass'), true);
  assert.equal(authPassed('mx.google.com; dkim=fail; spf=pass'), false);
  assert.equal(authPassed(undefined), false);
});
test('pickPlanPdfs: allowed sender with auth → pdfs only', () => {
  const m = mk('Max@x.de', 'dkim=pass', [pdf, { filename: 'logo.png', contentType: 'image/png', size: 5 }]);
  assert.deepEqual(pickPlanPdfs(m, ['max@x.de']), [pdf]);
});
test('pickPlanPdfs: other sender, bad auth, too big, empty → nothing', () => {
  assert.deepEqual(pickPlanPdfs(mk('evil@x.de', 'dkim=pass', [pdf]), ['max@x.de']), []);
  assert.deepEqual(pickPlanPdfs(mk('max@x.de', 'dkim=fail', [pdf]), ['max@x.de']), []);
  assert.deepEqual(pickPlanPdfs(mk('max@x.de', 'dkim=pass', [{ ...pdf, size: 11 * 1024 * 1024 }]), ['max@x.de']), []);
  assert.deepEqual(pickPlanPdfs(mk('max@x.de', 'dkim=pass', [{ ...pdf, size: 0 }]), ['max@x.de']), []);
  assert.deepEqual(pickPlanPdfs(mk('max@x.de', 'dkim=pass', [pdf]), []), []);
});
test('storagePath is stable, unique per attachment and path-safe', () => {
  const a = storagePath('<id@x>', 0, 'Wochenplan KW48 ../ä.pdf');
  assert.equal(a, storagePath('<id@x>', 0, 'Wochenplan KW48 ../ä.pdf'));
  assert.notEqual(a, storagePath('<id@x>', 1, 'Wochenplan KW48 ../ä.pdf'));
  assert.match(a, /^[0-9a-f]{16}-0-[A-Za-z0-9._-]+$/);
});
test('senderAllowed: address or whole domain', () => {
  assert.equal(senderAllowed('Lena@firma.de', ['@firma.de']), true);
  assert.equal(senderAllowed('x@evilfirma.de', ['@firma.de']), false);
  assert.equal(senderAllowed('max@x.de', ['max@x.de']), true);
  assert.equal(senderAllowed('', ['@firma.de']), false);
});
