// Run from the repo root: node --test tests/admin.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/admin.js');

const plain = v => JSON.parse(JSON.stringify(v));

test('adminTabFromHash: #admin opens the Übersicht, known tabs pass, anything else is not the admin page', () => {
  assert.equal(A.adminTabFromHash('#admin'), 'stats');
  assert.equal(A.adminTabFromHash('#admin/settings'), 'settings');
  assert.equal(A.adminTabFromHash('#admin/errors'), 'errors');
  assert.equal(A.adminTabFromHash('#admin/nope'), 'stats');
  assert.equal(A.adminTabFromHash(''), null);
  assert.equal(A.adminTabFromHash('#administrator'), null);
  assert.equal(A.adminTabFromHash('#wochenplan'), null);
  assert.equal(A.adminHashFor('stats'), '#admin');
  assert.equal(A.adminHashFor('errors'), '#admin/errors');
});

test('adminShiftDate: protocol date wins, then shift_date, then the creation day', () => {
  assert.equal(A.adminShiftDate({ protocols: { date: '2026-10-02' }, shift_date: '2026-10-05', created_at: '2026-10-09T10:00:00Z' }), '2026-10-02');
  assert.equal(A.adminShiftDate({ protocols: null, shift_date: '2026-10-05', created_at: '2026-10-09T10:00:00Z' }), '2026-10-05');
  assert.equal(A.adminShiftDate({ created_at: '2026-10-09T10:00:00Z' }), '2026-10-09');
  assert.equal(A.adminShiftDate({}), '');
});

test('adminShiftHours: pause off, over midnight, 3 h minimum, missing times count 0', () => {
  assert.equal(A.adminShiftHours({ start_time: '08:00:00', end_time: '16:30:00', pause_mins: 30 }), 8);
  assert.equal(A.adminShiftHours({ start_time: '22:00:00', end_time: '02:00:00', pause_mins: 0 }), 4);
  assert.equal(A.adminShiftHours({ start_time: '10:00', end_time: '11:00', pause_mins: 0 }), 3);
  assert.equal(A.adminShiftHours({ start_time: null, end_time: '11:00' }), 0);
});

test('adminRoleOf: employment type is dropped, agencies stay, empty is named', () => {
  assert.equal(A.adminRoleOf({ position_role: 'MA Minijob' }), 'MA');
  assert.equal(A.adminRoleOf({ position_role: 'AL fest' }), 'AL');
  assert.equal(A.adminRoleOf({ position_role: 'Zenjob' }), 'Zenjob');
  assert.equal(A.adminRoleOf({ position_role: '' }), 'Ohne Funktion');
});

test('adminDelta: rounded percent, null without a base', () => {
  assert.equal(A.adminDelta(15, 10), 50);
  assert.equal(A.adminDelta(5, 10), -50);
  assert.equal(A.adminDelta(3, 0), null);
});

test('adminStats: totals, this month vs last month, to-date comparison, people and roles', () => {
  const now = new Date(2026, 10, 10, 12); // 10.11.2026
  const sh = (date, extra) => Object.assign({ shift_date: date, start_time: '08:00:00', end_time: '16:00:00', pause_mins: 0, status: 'eingetragen', position_role: 'MA' }, extra);
  const shifts = [
    sh('2026-11-02', { user_id: 'a' }),
    sh('2026-11-03', { user_id: 'a', status: 'offen' }),
    sh('2026-11-09', { user_id: 'b', position_role: 'AL fest' }),
    sh('2026-11-09', { user_id: null, temp_worker_name: 'Zenjob 1', position_role: 'Zenjob' }),
    sh('2026-10-05', { user_id: 'a' }),
    sh('2026-10-25', { user_id: 'c' }),           // after the 10th → not in "bis zum 10."
    Object.assign(sh(null, { user_id: 'b' }), { protocols: { date: '2026-10-08' } }),
    sh('2025-01-01', { user_id: 'a' })            // outside the 12-month chart, still in the total
  ];
  const st = A.adminStats(shifts, [{ date: '2026-11-01' }, { date: '2026-10-01' }, { date: '2026-10-30' }], [{ id: 'a', full_name: 'Anna' }, { id: 'b', full_name: 'Ben' }], now);
  assert.equal(st.total, 8);
  assert.equal(st.thisMonth, 4);
  assert.equal(st.lastMonth, 3);
  assert.equal(st.lastMonthToDate, 2);
  assert.equal(st.deltaToDate, 100);
  assert.equal(st.hoursThis, 32);
  assert.equal(st.peopleThis, 2);
  assert.equal(st.peopleLast, 3);
  assert.equal(st.agencyThis, 1);
  assert.equal(st.protTotal, 3);
  assert.equal(st.protThis, 1);
  assert.equal(st.protLast, 2);
  assert.deepEqual(plain(st.topPeople.map(p => [p.name, p.count])), [['Anna', 2], ['Ben', 1]]);
  assert.deepEqual(plain(st.byRole), [{ role: 'MA', count: 2 }, { role: 'AL', count: 1 }, { role: 'Zenjob', count: 1 }]);
  assert.equal(st.months.length, 12);
  assert.equal(st.months[11].key, '2026-11');
  assert.equal(st.months[11].current, true);
  assert.equal(st.months[11].count, 4);
  assert.equal(st.months[10].count, 3);
  assert.equal(st.months[0].key, '2025-12');
  // 02.11. Mo, 03.11. Di, 09.11. Mo ×2
  assert.deepEqual(plain(st.weekdays), [3, 1, 0, 0, 0, 0, 0]);
});

test('adminStats: January compares with December of the year before; empty data does not break', () => {
  const st = A.adminStats([{ shift_date: '2025-12-03', user_id: 'a', start_time: '08:00', end_time: '12:00' }], [], [], new Date(2026, 0, 5, 12));
  assert.equal(st.lastKey, '2025-12');
  assert.equal(st.lastMonth, 1);
  assert.equal(st.lastMonthToDate, 1);
  assert.equal(st.deltaToDate, -100);
  const empty = A.adminStats(null, null, null, new Date(2026, 0, 5, 12));
  assert.equal(empty.total, 0);
  assert.equal(empty.deltaToDate, null);
  assert.deepEqual(plain(empty.topPeople), []);
});

test('adminStats: more than six roles fold into "Sonstige"', () => {
  const roles = ['MA', 'AL', 'Fahrer', 'Zenjob', 'Rockit', 'Lager', 'Stoffe'];
  const shifts = roles.map(r => ({ shift_date: '2026-11-02', position_role: r, start_time: '08:00', end_time: '12:00' }));
  const st = A.adminStats(shifts, [], [], new Date(2026, 10, 10));
  assert.equal(st.byRole.length, 6);
  assert.deepEqual(plain(st.byRole[5]), { role: 'Sonstige', count: 2 });
});

test('Monster Energy: only Patryk, 1 can per 5 h of his own shifts (rounded down)', () => {
  assert.equal(A.adminIsPatryk({ full_name: 'Patryk Stanczyk' }), true);
  assert.equal(A.adminIsPatryk({ full_name: 'patryk' }), true);
  assert.equal(A.adminIsPatryk({ full_name: 'Patrick Muster' }), false);
  assert.equal(A.adminIsPatryk({ full_name: 'Max Patryk' }), false);
  assert.equal(A.adminIsPatryk(null), false);
  const shifts = [
    { user_id: 'p', start_time: '08:00', end_time: '16:00', pause_mins: 0 },  // 8 h
    { user_id: 'p', start_time: '10:00', end_time: '11:00', pause_mins: 0 },  // 3 h minimum
    { user_id: 'x', start_time: '08:00', end_time: '20:00', pause_mins: 0 }   // someone else
  ];
  assert.deepEqual(plain(A.adminMonsterCans(shifts, 'p')), { cans: 2, hours: 11 });
  assert.deepEqual(plain(A.adminMonsterCans(shifts, null)), { cans: 0, hours: 0 });
});
