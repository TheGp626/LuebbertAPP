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

// Days Monday..yesterday of this week with an own plan shift but no Stundenzettel entry (today is still running).
// runningDate: the date of last night's shift that is still running after midnight (nextOwnShift) → not missing yet
function heuteMissingHourDays(todayStr, planDates, entryDates, runningDate) {
  var mon = heuteMonday(todayStr), entries = entryDates || [], seen = {};
  return (planDates || []).filter(function(d) {
    if (d < mon || d >= todayStr || d === runningDate || seen[d] || entries.indexOf(d) !== -1) return false;
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

// Office hero: today's plan entries, their venues (each once) and the people on them (agency firms do not count)
function heuteTodaySummary(todayShifts, agency) {
  var ag = agency || (typeof WP_AGENCY !== 'undefined' ? WP_AGENCY : []), venues = [], people = {};
  (todayShifts || []).forEach(function(s) {
    if (s.venue && venues.indexOf(s.venue) === -1) venues.push(s.venue);
    (s.plan_assignments || []).forEach(function(a) {
      if (ag.indexOf(a.role) !== -1) return;
      var k = a.user_id || ('n:' + a.name);
      if (k) people[k] = true;
    });
  });
  return { count: (todayShifts || []).length, venues: venues, people: Object.keys(people).length };
}

// Buchhaltung: protocols that still have at least one shift with status "offen" (hours not booked yet)
function heuteUnbookedProtocols(protocols, shifts) {
  var open = {};
  (shifts || []).forEach(function(s) { if (s.status === 'offen') open[s.protocol_id] = true; });
  return (protocols || []).filter(function(p) { return open[p.id]; }).length;
}

// "Dein Monat": one person's billing period. row = dashMonthSummary row (or null: no shifts yet), limit = own limit or the
// default for the Art der Anstellung, range = {from, to}. → what the card shows; warn from 90 % of the limit
function heuteMonthModel(row, limit, range, todayStr) {
  var mins = row ? row.mins : 0, pay = row && row.pay != null ? row.pay : null;
  var lim = row && row.limit ? row.limit : (limit > 0 ? limit : null);
  var pct = pay != null && lim ? Math.round(pay / lim * 100) : null;
  var p = String(range.to).split('-').map(Number), t = String(todayStr).split('-').map(Number);
  var daysLeft = Math.max(0, Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(t[0], t[1] - 1, t[2])) / 86400000));
  return { hours: Math.round(mins / 6) / 10, shifts: row ? row.shifts : 0, pay: pay, limit: lim, pct: pct,
    level: pct == null ? null : pct > 100 ? 'over' : pct >= 90 ? 'warn' : 'ok',
    left: lim && pay != null ? Math.max(0, Math.round((lim - pay) * 100) / 100) : null, daysLeft: daysLeft };
}

// Monster counter (RPC monster_patryk): { cans, hours } → text, null when unknown
function heuteMonsterText(m) {
  if (!m || typeof m.cans !== 'number') return null;
  return 'Patryk hat bisher ' + m.cans.toLocaleString('de-DE') + ' Monster Energy getrunken';
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
  week.innerHTML = heuteWeekHtml(heuteWeekStrip(today, []));
  todo.innerHTML = '';
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
    // Last night's shift still running (the hero's cached next shift is dated yesterday): its hours come later
    var cur = null;
    try { cur = readNextShiftCache(localStorage.getItem(NEXT_SHIFT_KEY), me); } catch (e) { /* storage blocked */ }
    var missing = heuteMissingHourDays(today, ownDates, (res[2].data || []).map(function(r) { return r.shift_date; }),
      cur && cur.date < today ? cur.date : null);
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

// "Dein Monat" card: own shifts of the current billing period, pay with the own rates, share of the earnings limit.
// Uses dashMonthSummary (dashboard.js) so the numbers match the Monatsabschluss. Offline / failed read → no card.
async function renderHeuteMonth(seq) {
  var box = document.getElementById('heute-month');
  if (!box) return;
  box.innerHTML = '';
  if (typeof supabaseClient === 'undefined' || typeof dashMonthSummary !== 'function' || userRole === 'Gast') return;
  var me = currentUser.id, cutoff = typeof dashBillingCutoff === 'function' ? dashBillingCutoff() : 20;
  var bk = getBillingKeyForDate(new Date(), cutoff), range = dashBillingRange(bk.key, cutoff);
  // Same fetch as the Monatsabschluss: by work date (a few days margin, dashMonthSummary cuts exactly); shifts without their own date carry the protocol's
  var f = heuteAddDays(range.from, -3), t = heuteAddDays(range.to, 3);
  var cols = 'id, user_id, start_time, end_time, pause_mins, position_role, status, shift_date, created_at, ';
  var res;
  try {
    res = await Promise.all([
      supabaseClient.from('shifts').select(cols + 'protocols(date)').eq('user_id', me).gte('shift_date', f).lte('shift_date', t).range(0, 999),
      supabaseClient.from('shifts').select(cols + 'protocols!inner(date)').eq('user_id', me).is('shift_date', null).gte('protocols.date', f).lte('protocols.date', t).range(0, 999),
      supabaseClient.from('app_users').select('id, full_name, role, employment_type, is_fest, role_rates, app_user_private(hourly_rate_conni, income_limit)').eq('id', me).maybeSingle()
    ]);
  } catch (e) { return; }
  if (seq !== _heuteSeq || !currentUser || currentUser.id !== me || res[0].error || res[1].error || res[2].error || !res[2].data) return;
  var user = typeof flattenPrivate === 'function' ? flattenPrivate(res[2].data) : res[2].data;
  var seen = {}, own = (res[0].data || []).concat(res[1].data || []).filter(function(s) { if (seen[s.id]) return false; seen[s.id] = true; return true; });
  var sum = dashMonthSummary(own, [user], bk.key, cutoff);
  var fallback = typeof mitDefaultLimit === 'function' ? mitDefaultLimit(user) : null;
  var m = heuteMonthModel(sum.rows[0] || null, fallback, range, localDateStr());
  var bar = m.pct != null ? '<div class="w-month-bar w-month-' + m.level + '"><i style="width:' + Math.min(100, m.pct) + '%"></i></div>' +
    '<div class="w-month-limit">' + (m.level === 'over' ? 'Über deiner Verdienstgrenze von ' + heuteEuro(m.limit) + ' — sag bitte im Büro Bescheid.'
      : m.pct + ' % von ' + heuteEuro(m.limit) + ' · noch ' + heuteEuro(m.left) + ' frei') + '</div>' : '';
  box.innerHTML = '<div class="w-label">Dein Monat</div><div class="w-month" role="button" tabindex="0" onclick="selectMode(\'stunden\'); if (typeof navigate === \'function\') navigate(\'history\')">' +
    '<div class="w-month-top"><span class="w-tag">Abrechnung ' + escapeHtml(bk.label.split(' ')[0]) + ' · ' + heuteDm(range.from) + '–' + heuteDm(range.to) + '</span>' +
    '<span class="w-month-days">' + (m.daysLeft ? 'noch ' + m.daysLeft + (m.daysLeft === 1 ? ' Tag' : ' Tage') : 'letzter Tag') + '</span></div>' +
    '<div class="w-month-stats"><div><b class="w-num">' + String(m.hours).replace('.', ',') + '</b><span>Stunden</span></div>' +
    '<div><b class="w-num">' + m.shifts + '</b><span>' + (m.shifts === 1 ? 'Schicht' : 'Schichten') + '</span></div>' +
    (m.pay != null ? '<div><b class="w-num">≈ ' + Math.round(m.pay).toLocaleString('de-DE') + ' €</b><span>Verdienst</span></div>' : '') + '</div>' + bar + '</div>';
}

async function renderHeuteMonster(seq) {
  var box = document.getElementById('heute-monster');
  if (!box) return;
  if (typeof supabaseClient === 'undefined' || userRole === 'Gast') { box.innerHTML = ''; return; }
  var r;
  try { r = await supabaseClient.rpc('monster_patryk'); } catch (e) { return; }
  if (seq !== _heuteSeq) return;
  var text = r && !r.error ? heuteMonsterText(r.data) : null; // RPC missing on an older database → nothing
  box.innerHTML = text ? '<div class="w-monster"><img src="icons/monsta_can.png" alt="" width="18" height="18"><span>' + escapeHtml(text) +
    '</span><small>1 Dose pro 5 Stunden Arbeit</small></div>' : '';
}

function heuteCount(res) { return res && !res.error && typeof res.count === 'number' ? res.count : 0; }
function heuteEuro(n) { return (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
function heuteDm(iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.'; }

// Office part: PL/Admin see today's plan and what waits for them; Buchhaltung sees the current billing period.
// Offline or a failed query → nothing is shown, never an error.
async function renderHeuteOffice(seq) {
  var box = document.getElementById('heute-office');
  var week = document.getElementById('heute-week'), todo = document.getElementById('heute-todo');
  if (week) week.innerHTML = '';
  if (todo) todo.innerHTML = '';
  if (!box || typeof supabaseClient === 'undefined') return;
  var me = currentUser.id, today = localDateStr(), head = { count: 'exact', head: true }, html = '', rows = '';
  try {
    if (userRole === 'Buchhaltung') {
      var cutoff = typeof dashBillingCutoff === 'function' ? dashBillingCutoff() : 20;
      var bk = getBillingKeyForDate(new Date(), cutoff), range = dashBillingRange(bk.key, cutoff);
      var b = await Promise.all([
        supabaseClient.from('protocols').select('id, total_cost').gte('date', range.from).lte('date', range.to).range(0, 4999),
        supabaseClient.from('shifts').select('protocol_id, status, protocols!inner(date)').eq('status', 'offen')
          .gte('protocols.date', range.from).lte('protocols.date', range.to).range(0, 4999)
      ]);
      if (seq !== _heuteSeq || !currentUser || currentUser.id !== me || b[0].error) return;
      var prots = b[0].data || [], sum = prots.reduce(function(t, p) { return t + (Number(p.total_cost) || 0); }, 0);
      html = '<div class="w-hero"><span class="w-tag">Abrechnung ' + heuteDm(range.from) + '–' + heuteDm(range.to) + '</span>' +
        '<div class="w-hero-title w-num">' + heuteEuro(sum) + '</div>' +
        '<div class="w-hero-sub">' + prots.length + (prots.length === 1 ? ' Protokoll' : ' Protokolle') + ' in diesem Zeitraum</div>' +
        '<div class="w-hero-foot"><span></span><button type="button" class="w-btn w-btn-accent" onclick="selectMode(\'dashboard\', \'prot\')">Protokolle</button></div></div>';
      var unbooked = b[1].error ? 0 : heuteUnbookedProtocols(prots, b[1].data);
      if (unbooked) rows += heuteRow('selectMode(\'dashboard\', \'prot\')', 'Stunden nicht gebucht', 'Protokolle mit offenen Schichten', unbooked);
    } else {
      var sees = !!window.currentUserSeesInterest;
      var r = await Promise.all([
        supabaseClient.from('plan_shifts').select('id, venue, plan_assignments(user_id, name, role)').eq('date', today),
        sees ? supabaseClient.from('order_applications').select('*', head).eq('status', 'offen') : null,
        sees ? supabaseClient.from('plan_shift_interest').select('*', head).eq('status', 'offen') : null,
        supabaseClient.from('protocols').select('*', head).eq('date', today).is('mailed_at', null),
        supabaseClient.from('plan_inbox').select('*', head).eq('status', 'neu')
      ]);
      if (seq !== _heuteSeq || !currentUser || currentUser.id !== me) return;
      if (!r[0].error) {
        var t = heuteTodaySummary(r[0].data || []);
        html = t.count ? '<div class="w-hero" role="button" tabindex="0" onclick="selectMode(\'wochenplan\')">' +
            '<span class="w-tag">' + t.count + (t.count === 1 ? ' Einsatz' : ' Einsätze') + ' heute</span>' +
            '<div class="w-hero-title">' + escapeHtml(t.venues[0] || '—') + '</div>' +
            (t.venues.length > 1 ? '<div class="w-hero-sub">+ ' + escapeHtml(t.venues.slice(1).join(', ')) + '</div>' : '') +
            '<div class="w-hero-foot"><span>' + t.people + (t.people === 1 ? ' Person' : ' Leute') + ' eingeteilt</span><span>Plan →</span></div></div>'
          : '<div class="w-empty"><b>Heute keine Einsätze</b><p>Im Plan siehst du die nächsten Tage.</p>' +
            '<button type="button" class="w-btn" onclick="selectMode(\'wochenplan\')">Zum Plan</button></div>';
      }
      var apps = heuteCount(r[1]) + heuteCount(r[2]), prot = heuteCount(r[3]), inbox = heuteCount(r[4]);
      if (apps) rows += heuteRow('selectMode(\'' + (allowed('auftraege') ? 'auftraege' : 'wochenplan') + '\')', 'Bewerbungen', 'Warten auf deine Entscheidung', apps);
      if (prot) rows += heuteRow('selectMode(\'dashboard\', \'prot\')', 'Protokolle', 'Heute, noch nicht verschickt', prot);
      if (inbox) rows += heuteRow('selectMode(\'wochenplan\')', 'Plan-Postfach', 'Neue Pläne zum Einlesen', inbox);
    }
  } catch (e) { return; }
  box.innerHTML = html + (rows ? '<div class="w-label">Braucht dich</div>' + rows : '');
  function allowed(m) { return typeof moduleAllowedForRole === 'function' && moduleAllowedForRole(m, userRole); }
}

async function renderHeute() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  var seq = ++_heuteSeq;
  var office = document.getElementById('heute-office');
  if (office) office.innerHTML = '';
  renderHeuteMonth(seq);
  renderHeuteMonster(seq);
  if (userRole === 'MA' || userRole === 'AL') return renderHeuteCrew(seq);
  return renderHeuteOffice(seq); // PL, Admin, Buchhaltung
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { heuteWeekStrip: heuteWeekStrip, heuteMissingHourDays: heuteMissingHourDays, heuteOpenSlotCount: heuteOpenSlotCount,
    heuteAddDays: heuteAddDays, heuteMonday: heuteMonday, heuteTodaySummary: heuteTodaySummary, heuteUnbookedProtocols: heuteUnbookedProtocols,
    heuteMonthModel: heuteMonthModel, heuteMonsterText: heuteMonsterText };
}
