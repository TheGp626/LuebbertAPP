// Run from the repo root: node --test tests/produkte.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const P = require('../js/produkte.js');

test('fileExtension: from the name, lowercased', () => {
  assert.equal(P.fileExtension('Anleitung.PDF', 'application/pdf'), 'pdf');
  assert.equal(P.fileExtension('foto.final.JPEG', ''), 'jpeg');
  assert.equal(P.fileExtension('IMG_0001.HEIC', ''), 'heic');
});

test('fileExtension: no or bogus extension falls back to the MIME type', () => {
  assert.equal(P.fileExtension('Aufbau', 'application/pdf'), 'pdf');
  assert.equal(P.fileExtension('Aufbau', 'image/jpeg'), 'jpg');
  assert.equal(P.fileExtension('Aufbau', 'image/heic'), 'heic');
  assert.equal(P.fileExtension('Aufbau', 'image/svg+xml'), 'svg');
  assert.equal(P.fileExtension('scan.', 'image/png'), 'png');
  assert.equal(P.fileExtension('Stehtisch rund.Anleitung lang', 'application/pdf'), 'pdf');
  assert.equal(P.fileExtension('Bühne.pdf ', ''), 'pdf');
});

test('fileExtension: unknown name and type gives empty string', () => {
  assert.equal(P.fileExtension('Aufbau', ''), '');
  assert.equal(P.fileExtension('', 'application/octet-stream'), '');
  assert.equal(P.fileExtension(null, null), '');
});

test('sanitizeStorageName: ASCII only, no spaces or umlauts', () => {
  assert.equal(P.sanitizeStorageName('Bühne groß Äpfel'), 'Buehne_gross_Aepfel');
  assert.equal(P.sanitizeStorageName('Café  (neu)!'), 'Cafe_neu');
  assert.equal(P.sanitizeStorageName('   '), 'datei');
  assert.equal(P.sanitizeStorageName(''), 'datei');
  assert.ok(P.sanitizeStorageName('x'.repeat(200)).length <= 60);
  assert.match(P.sanitizeStorageName('Ünïcødé 🎉 Tisch'), /^[A-Za-z0-9_-]+$/);
});

test('produktFileKey: sanitised base, stamp and safe extension', () => {
  assert.equal(P.produktFileKey({ name: 'Anleitung.PDF', type: 'application/pdf' }, 'Stehtisch rund', 123), 'Stehtisch_rund_123.pdf');
  assert.equal(P.produktFileKey({ name: 'Aufbau', type: 'application/pdf' }, 'Bühne', 5), 'Buehne_5.pdf');
  assert.equal(P.produktFileKey({ name: 'Aufbau', type: '' }, 'Bühne', 5), 'Buehne_5');
  assert.equal(P.produktFileKey({ name: 'a.jpg', type: 'image/jpeg' }, 'Zelt', 7, 'p1/'), 'p1/Zelt_7.jpg');
});

test('contentTypeFor: keeps a real MIME, otherwise derives from the extension', () => {
  assert.equal(P.contentTypeFor('a.pdf', 'application/pdf'), 'application/pdf');
  assert.equal(P.contentTypeFor('a.pdf', ''), 'application/pdf');
  assert.equal(P.contentTypeFor('a.pdf', 'application/octet-stream'), 'application/pdf');
  assert.equal(P.contentTypeFor('a.JPG', ''), 'image/jpeg');
  assert.equal(P.contentTypeFor('a.heic', ''), 'image/heic');
  assert.equal(P.contentTypeFor('a', ''), 'application/octet-stream');
});

test('isPdfMagic: detects the %PDF- header', () => {
  assert.equal(P.isPdfMagic(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
  assert.equal(P.isPdfMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])), false);
  assert.equal(P.isPdfMagic(new Uint8Array([0x25, 0x50])), false);
  assert.equal(P.isPdfMagic(null), false);
});

test('isBucketImageType: only types the product-images bucket accepts', () => {
  ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'].forEach(t => assert.equal(P.isBucketImageType(t), true, t));
  ['image/heic', 'image/heif', 'image/tiff', '', 'application/pdf'].forEach(t => assert.equal(P.isBucketImageType(t), false, t));
});

test('uploadErrorMessage: real reason in German', () => {
  assert.match(P.uploadErrorMessage({ message: 'mime type image/heic is not supported', statusCode: '415' }), /Format nicht unterstützt/);
  assert.match(P.uploadErrorMessage({ message: 'The object exceeded the maximum allowed size', statusCode: '413' }), /zu groß/);
  assert.match(P.uploadErrorMessage(new TypeError('Failed to fetch')), /Verbindung/);
  assert.match(P.uploadErrorMessage({ message: 'new row violates row-level security policy' }), /Keine Berechtigung/);
  assert.match(P.uploadErrorMessage({ message: 'something odd' }), /something odd/);
  assert.equal(typeof P.uploadErrorMessage(null), 'string');
});

test('aufbauFileKind: image, pdf or other from the URL', () => {
  assert.equal(P.aufbauFileKind('https://x/storage/v1/object/public/product-pdfs/A_1.pdf'), 'pdf');
  assert.equal(P.aufbauFileKind('https://x/product-pdfs/A_1.PDF?t=1'), 'pdf');
  assert.equal(P.aufbauFileKind('https://x/product-pdfs/A_1.jpeg'), 'image');
  assert.equal(P.aufbauFileKind('https://x/product-pdfs/A_1.webp'), 'image');
  assert.equal(P.aufbauFileKind('https://x/product-pdfs/A_1.Aufbau'), 'other');
  assert.equal(P.aufbauFileKind(''), 'none');
});

test('storagePathFromUrl: object key after the bucket segment', () => {
  assert.equal(P.storagePathFromUrl('https://x/storage/v1/object/public/product-pdfs/A_1.pdf', 'product-pdfs'), 'A_1.pdf');
  assert.equal(P.storagePathFromUrl('https://x/storage/v1/object/public/product-pdfs/A%201.pdf?t=2', 'product-pdfs'), 'A 1.pdf');
  assert.equal(P.storagePathFromUrl('https://x/other/A_1.pdf', 'product-pdfs'), null);
  assert.equal(P.storagePathFromUrl(null, 'product-pdfs'), null);
});

test('produktCoverOrder: chosen picture first, the rest keep their order, only changed rows returned', () => {
  const imgs = [{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }, { id: 'c', sort_order: 2 }];
  assert.deepEqual(P.produktCoverOrder(imgs, 'c'), [{ id: 'c', sort_order: 0 }, { id: 'a', sort_order: 1 }, { id: 'b', sort_order: 2 }]);
  assert.deepEqual(P.produktCoverOrder(imgs, 'a'), [], 'already the cover');
  // gaps/duplicates from older uploads are normalised too
  assert.deepEqual(P.produktCoverOrder([{ id: 'x', sort_order: 3 }, { id: 'y', sort_order: 3 }], 'y'), [{ id: 'y', sort_order: 0 }, { id: 'x', sort_order: 1 }]);
  assert.deepEqual(P.produktCoverOrder(imgs, 'nope'), []);
});
