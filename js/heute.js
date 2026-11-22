/* ══ Werkstatt "Heute" start page: next shift hero, this week, to-do rows ══
   Pure helpers first (testable with node --test); the DOM part follows below.
   The hero card itself comes from home.js (homeNextHtml), this file adds the week strip and the rows. */

var HEUTE_DOW = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

// Date strings as plain calendar days: UTC noon math never drifts across DST or time zones
function heuteAddDays(iso, n) {
  var p = String(iso).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n, 12));
  return d.toISOString().slice(0, 10);
}
function heuteMonday(iso) {
  var p = String(iso).split('-').map(Number), dow = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).getUTCDay();
  return heuteAddDays(iso, -((dow + 6) % 7));
}

// Mon–Sun of today's week; has = an own plan shift that day
function heuteWeekStrip(todayStr, ownDates) {
  var own = ownDates || [], mon = heuteMonday(todayStr), out = [];
  for (var i = 0; i < 7; i++) {
    var date = heuteAddDays(mon, i);
    out.push({ date: date, dow: HEUTE_DOW[i], day: Number(date.slice(8)), today: date === todayStr, has: own.indexOf(date) !== -1 });
  }
  return out;
}

// Days Monday..yesterday of this week with an own plan shift but no Stundenzettel entry (today is still running)
function heuteMissingHourDays(todayStr, planDates, entryDates) {
  var mon = heuteMonday(todayStr), entries = entryDates || [], seen = {};
  return (planDates || []).filter(function(d) {
    if (d < mon || d >= todayStr || seen[d] || entries.indexOf(d) !== -1) return false;
    seen[d] = true; return true;
  }).sort();
}

// Same rule as ordFitsSlot (auftraege.js): AL places only for AL/PL/Admin, Fahrer only with a licence
function heuteSlotFits(slotRole, role, canDrive) {
  if (slotRole === 'AL') return ['AL', 'PL', 'Admin'].indexOf(role) !== -1;
  if (slotRole === 'Fahrer') return !!canDrive;
  return true;
}

// Plan shifts from today on with a free place that fits, without own assignment and without own Meldung
function heuteOpenSlotCount(shifts, me, role, canDrive, todayStr, myInterestKeys) {
  var applied = myInterestKeys || [];
  return (shifts || []).filter(function(s) {
    if (!s || s.date < todayStr) return false;
    if ((s.plan_assignments || []).some(function(a) { return a.user_id === me; })) return false;
    if (applied.indexOf(s.week_id + '|' + s.key) !== -1) return false;
    return (s.open_slots || []).some(function(o) {
      return o && !(o.count != null && parseInt(o.count, 10) <= 0) && heuteSlotFits(o.role, role, canDrive);
    });
  }).length;
}

/* ── DOM part (browser only) ── */

var _heuteSeq = 0;

function heuteWeekHtml(days) {
  return '<div class="w-label">Diese Woche</div><div class="w-week">' + days.map(function(d) {
    return '<div class="' + (d.today ? 'today' : d.has ? '' : 'off') + '"' + (d.has ? ' title="Einsatz"' : '') + '>' +
      d.dow + '<b>' + d.day + '</b></div>';
  }).join('') + '</div>';
}

function heuteRow(onclick, title, sub, badge) {
  return '<button type="button" class="w-row" onclick="' + onclick + '"><span>' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
    (badge ? '<span class="w-badge">' + badge + '</span>' : '<span class="w-row-arrow" aria-hidden="true">›</span>') + '</button>';
}

// Crew part (MA/AL): week strip and to-do rows. Offline or a failed query → no rows, never an error.
async function renderHeuteCrew(seq) {
  var week = document.getElementById('heute-week'), todo = document.getElementById('heute-todo');
  if (!week || !todo) return;
  var me = currentUser.id, today = localDateStr(), mon = heuteMonday(today);
  if (!week.innerHTML) week.innerHTML = heuteWeekHtml(heuteWeekStrip(today, []));
  if (typeof supabaseClient === 'undefined') return;
  var res;
  try {
    res = await Promise.all([
      supabaseClient.from('plan_shifts').select('id, week_id, key, date, open_slots, plan_assignments(user_id)')
        .gte('date', mon).lte('date', heuteAddDays(mon, 13)),
      supabaseClient.from('plan_shift_interest').select('week_id, shift_key').eq('user_id', me),
      // shortcut: protocol rows without shift_date are not seen here; all current writers set it
      supabaseClient.from('shifts').select('shift_date').eq('user_id', me).gte('shift_date', mon).lte('shift_date', today)
    ]);
  } catch (e) { return; }
  if (seq !== _heuteSeq || !currentUser || currentUser.id !== me) return;
  if (res[0].error) { todo.innerHTML = ''; return; }
  var shifts = res[0].data || [];
  var ownDates = shifts.filter(function(s) { return (s.plan_assignments || []).some(function(a) { return a.user_id === me; }); })
    .map(function(s) { return s.date; });
  week.innerHTML = heuteWeekHtml(heuteWeekStrip(today, ownDates));
  var rows = '';
  if (!res[2].error) {
    var missing = heuteMissingHourDays(today, ownDates, (res[2].data || []).map(function(r) { return r.shift_date; }));
    if (missing.length) {
      var days = heuteWeekStrip(today, []).map(function(x) { return x.date; });
      rows += heuteRow('selectMode(\'stunden\')', 'Stunden KW ' + wpIsoWeek(today),
        missing.map(function(d) { return HEUTE_DOW[days.indexOf(d)]; }).join(', ') + ' fehlt noch');
    }
  }
  var keys = res[1].error ? [] : (res[1].data || []).map(function(r) { return r.week_id + '|' + r.shift_key; });
  var open = heuteOpenSlotCount(shifts, me, userRole, !!window.currentUserCanDrive, today, keys);
  if (open > 0) rows += heuteRow('selectMode(\'wochenplan\')', 'Offene Schichten', 'Du kannst dich melden', open);
  todo.innerHTML = rows ? '<div class="w-label">Zu tun</div>' + rows : '';
}

async function renderHeute() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  var seq = ++_heuteSeq;
  var office = document.getElementById('heute-office');
  if (office) office.innerHTML = '';
  if (userRole === 'MA' || userRole === 'AL') return renderHeuteCrew(seq);
  // Office roles (PL/Admin/Buchhaltung): Task 5
  if (typeof renderHeuteOffice === 'function') return renderHeuteOffice(seq);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { heuteWeekStrip: heuteWeekStrip, heuteMissingHourDays: heuteMissingHourDays, heuteOpenSlotCount: heuteOpenSlotCount,
    heuteAddDays: heuteAddDays, heuteMonday: heuteMonday };
}
