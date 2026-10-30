// Run: node --test supabase/functions/calendar-feed/feed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToken, windowStart, dedupeShifts } from './feed.mjs';

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';
const url = (qs) => 'https://x.supabase.co/functions/v1/calendar-feed' + qs;

test('parseToken: uuid, optional .ics suffix, case-insensitive', () => {
  assert.equal(parseToken(url('?t=' + TOKEN)), TOKEN);
  assert.equal(parseToken(url('?t=' + TOKEN + '.ics')), TOKEN);
  assert.equal(parseToken(url('?t=' + TOKEN.toUpperCase() + '.ICS')), TOKEN);
  assert.equal(parseToken(url('?x=1&t=' + TOKEN)), TOKEN);
});

test('parseToken: x=.ics as extra parameter is fine, trailing .ics path is accepted', () => {
  assert.equal(parseToken(url('?t=' + TOKEN + '&x=.ics')), TOKEN);
  assert.equal(parseToken('https://x.supabase.co/functions/v1/calendar-feed/' + TOKEN + '.ics'), TOKEN);
});

test('parseToken: bad input gives null', () => {
  for (const q of ['', '?t=', '?t=abc', '?t=' + TOKEN + 'x', '?t=' + TOKEN.slice(1), "?t=' or 1=1", '?t=' + TOKEN + '.ics.ics', '?T=' + TOKEN]) {
    assert.equal(parseToken(url(q)), null, q);
  }
  assert.equal(parseToken('not a url'), null);
});

test('windowStart: 14 days before today (month and year borders)', () => {
  assert.equal(windowStart('2026-10-30'), '2026-10-16');
  assert.equal(windowStart('2026-11-05'), '2026-10-22');
  assert.equal(windowStart('2027-01-03'), '2026-12-20');
  assert.equal(windowStart('2028-03-05'), '2028-02-20');
});

test('dedupeShifts: one entry per shift id, first wins, order kept', () => {
  const rows = [{ shift: { id: 'a', t: 1 } }, { shift: { id: 'b' } }, { shift: { id: 'a', t: 2 } }, { shift: null }, {}];
  assert.deepEqual(dedupeShifts(rows), [{ id: 'a', t: 1 }, { id: 'b' }]);
  assert.deepEqual(dedupeShifts(null), []);
});
