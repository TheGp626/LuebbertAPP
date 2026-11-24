/* ══ "Meine Stunden": the person's hours of one billing period, read from the server ══
   Hours of MA and AL come in by themselves from the protocol of their AL (shifts with protocol_id); typing them in
   (the week editor, stundenzettel.js) is only the fallback for a job without a protocol. So this screen shows what is
   there, what is still missing ("Protokoll kommt noch") and the money/limit — not an empty form.
   Pure helpers first (node --test), the DOM part below. */

var MEINE_DOW = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function meineAddMonths(key, delta) {
  var p = String(key).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 + delta, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function meineShiftDate(s) { return (s.protocols && s.protocols.date) || s.shift_date || null; }

// Net minutes like the dashboard and the Monatsabschluss (dashShiftNetMins when loaded)
function meineNetMins(s) {
  if (typeof dashShiftNetMins === 'function') return dashShiftNetMins(s);
  var st = (s.start_time || '').slice(0, 5), en = (s.end_time || '').slice(0, 5);
  if (!st || !en) return 0;
  var a = st.split(':').map(Number), b = en.split(':').map(Number), s0 = a[0] * 60 + a[1], e0 = b[0] * 60 + b[1];
  if (e0 < s0) e0 += 1440;
  return Math.max(0, e0 - s0 - (s.pause_mins || 0));
}

// shifts: own shift rows (server), planned: own plan shifts [{date, venue, title}], range {from, to}
// → rows newest first: { date, von, bis, pause, mins, place, al, source 'protokoll'|'selbst', booked } and
//   { date, place, pending: true } for planned days up to today that have no hours yet
function meineRows(shifts, planned, range, todayStr) {
  var seen = {}, rows = [], hasDate = {};
  (shifts || []).forEach(function(s) {
    var d = meineShiftDate(s);
    if (!d || d < range.from || d > range.to) return;
    var k = (s.protocol_id || 'manual') + '|' + s.start_time + '|' + s.end_time + '|' + d;
    if (seen[k]) return;
    seen[k] = true; hasDate[d] = true;
    var p = s.protocols || {}, proj = p.projects || {};
    rows.push({
      date: d, von: (s.start_time || '').slice(0, 5), bis: (s.end_time || '').slice(0, 5),
      pause: parseInt(s.pause_mins, 10) || 0, mins: meineNetMins(s),
      place: proj.name || proj.location || s.ort || '', al: p.al_name_fallback || p.pl_name_fallback || '',
      source: s.protocol_id ? 'protokoll' : 'selbst', booked: s.status === 'eingetragen'
    });
  });
  var pend = {};
  (planned || []).forEach(function(p) {
    if (!p || !p.date || p.date < range.from || p.date > range.to || p.date > todayStr || hasDate[p.date] || pend[p.date]) return;
    pend[p.date] = { date: p.date, place: [p.venue, p.title].filter(Boolean).join(' · '), pending: true };
  });
  Object.keys(pend).forEach(function(d) { rows.push(pend[d]); });
  return rows.sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.von || '') < (b.von || '') ? -1 : 1; });
}

function meineHours(mins) { return (Math.round(mins / 6) / 10).toLocaleString('de-DE', { minimumFractionDigits: mins % 60 ? 1 : 0, maximumFractionDigits: 1 }); }
function meineDayLabel(iso) {
  var p = iso.split('-').map(Number);
  return { dow: MEINE_DOW[new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).getUTCDay()], dm: iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' };
}

/* ── DOM part ── */

var _meineKey = null, _meineSeq = 0;

function meineCutoff() { return typeof dashBillingCutoff === 'function' ? dashBillingCutoff() : 20; }

function meineStep(delta) {
  var cur = getBillingKeyForDate(new Date(), meineCutoff()).key;
  var next = meineAddMonths(_meineKey || cur, delta);
  if (next > cur) return; // no future periods
  _meineKey = next;
  renderMeine();
}

function meineEsc(t) { return typeof escapeHtml === 'function' ? escapeHtml(t) : String(t); }

function meineRowHtml(r) {
  var d = meineDayLabel(r.date);
  var day = '<div class="meine-day"><span>' + d.dow + '</span><b>' + d.dm + '</b></div>';
  if (r.pending) {
    return '<div class="meine-row meine-pending">' + day + '<div class="meine-main"><div class="meine-place">' + meineEsc(r.place || 'Einsatz') + '</div>' +
      '<div class="meine-sub">Protokoll kommt noch – die Stunden erscheinen hier, sobald dein AL es schickt</div></div></div>';
  }
  var sub = [r.von && r.bis ? r.von + '–' + r.bis : '', r.pause ? r.pause + ' min Pause' : 'ohne Pause', r.al ? 'AL ' + r.al : ''].filter(Boolean).join(', ');
  return '<div class="meine-row">' + day + '<div class="meine-main"><div class="meine-place">' + meineEsc(r.place || (r.source === 'selbst' ? 'Selbst eingetragen' : 'Einsatz')) + '</div>' +
    '<div class="meine-sub">' + meineEsc(sub) + '</div></div>' +
    '<div class="meine-end"><b>' + meineHours(r.mins) + ' h</b><span class="' + (r.source === 'selbst' ? 'meine-src-self' : 'meine-src-prot') + '">' +
    (r.source === 'selbst' ? 'selbst' : 'Protokoll') + '</span></div></div>';
}

async function renderMeine() {
  var box = document.getElementById('meine-body');
  if (!box || typeof currentUser === 'undefined' || !currentUser) return;
  var cutoff = meineCutoff(), cur = getBillingKeyForDate(new Date(), cutoff);
  var key = _meineKey || cur.key, range = dashBillingRange(key, cutoff), today = localDateStr();
  var label = monthLabelFromKey(key);
  var head = document.getElementById('meine-period');
  if (head) head.innerHTML = '<button type="button" class="ui-icon-btn" onclick="meineStep(-1)" aria-label="Vorige Abrechnung">' + uiIcon('chevron-left') + '</button>' +
    '<div class="meine-period-mid"><b>' + label.split(' ')[0] + '</b><span>' + range.from.slice(8, 10) + '.' + range.from.slice(5, 7) + '.–' + range.to.slice(8, 10) + '.' + range.to.slice(5, 7) + '.' + (key === cur.key ? ' · läuft' : '') + '</span></div>' +
    '<button type="button" class="ui-icon-btn" onclick="meineStep(1)" aria-label="Nächste Abrechnung"' + (key >= cur.key ? ' disabled' : '') + '>' + uiIcon('chevron-right') + '</button>';
  box.innerHTML = '<div class="ui-sub" style="padding:24px 4px;">Stunden werden geladen…</div>';
  if (typeof supabaseClient === 'undefined') return;
  var me = currentUser.id, seq = ++_meineSeq;
  var f = heuteAddDays(range.from, -3), t = heuteAddDays(range.to, 3);
  var cols = 'id, user_id, start_time, end_time, pause_mins, position_role, status, shift_date, protocol_id, ort, created_at, ';
  var rel = 'protocols(date, al_name_fallback, pl_name_fallback, projects(name, location))';
  var res;
  try {
    res = await Promise.all([
      supabaseClient.from('shifts').select(cols + rel).eq('user_id', me).gte('shift_date', f).lte('shift_date', t).range(0, 999),
      supabaseClient.from('shifts').select(cols + rel.replace('protocols(', 'protocols!inner(')).eq('user_id', me).is('shift_date', null).gte('protocols.date', f).lte('protocols.date', t).range(0, 999),
      supabaseClient.from('app_users').select('id, full_name, role, employment_type, is_fest, role_rates, app_user_private(hourly_rate_conni, income_limit)').eq('id', me).maybeSingle(),
      supabaseClient.from('plan_assignments').select('shift:plan_shifts!inner(date, venue, title)').eq('user_id', me).gte('shift.date', range.from).lte('shift.date', range.to)
    ]);
  } catch (e) { res = null; }
  if (seq !== _meineSeq || !currentUser || currentUser.id !== me) return;
  if (!res || res[0].error || res[1].error) {
    box.innerHTML = uiEmptyHtml('Stunden konnten nicht geladen werden', 'Prüf deine Verbindung und öffne die Seite nochmal.');
    return;
  }
  var all = (res[0].data || []).concat(res[1].data || []);
  var planned = res[3] && !res[3].error ? (res[3].data || []).map(function(r) { return r.shift; }).filter(Boolean) : [];
  var rows = meineRows(all, planned, range, today);
  var done = rows.filter(function(r) { return !r.pending; });
  var mins = done.reduce(function(a, r) { return a + r.mins; }, 0);

  // Money and limit: same numbers as "Dein Monat" and the Monatsabschluss
  var money = '';
  if (res[2] && !res[2].error && res[2].data && typeof dashMonthSummary === 'function') {
    var user = typeof flattenPrivate === 'function' ? flattenPrivate(res[2].data) : res[2].data;
    var sum = dashMonthSummary(all, [user], key, cutoff);
    var m = heuteMonthModel(sum.rows[0] || null, typeof mitDefaultLimit === 'function' ? mitDefaultLimit(user) : null, range, today);
    if (m.pay != null) money = '<div class="meine-stat"><b>≈ ' + Math.round(m.pay).toLocaleString('de-DE') + ' €</b><span>Verdienst</span></div>';
    if (m.pct != null) money += '<div class="meine-limit"><div class="w-month-bar w-month-' + m.level + '"><i style="width:' + Math.min(100, m.pct) + '%"></i></div>' +
      '<div class="w-month-limit">' + (m.level === 'over' ? 'Über deiner Verdienstgrenze von ' + heuteEuro(m.limit) + ' – sag bitte im Büro Bescheid.'
        : m.pct + ' % von ' + heuteEuro(m.limit) + ', noch ' + heuteEuro(m.left) + ' frei') + '</div></div>';
  }
  var pending = rows.length - done.length;
  var html = '<div class="meine-sum"><div class="meine-total"><b>' + meineHours(mins) + '</b><span>Stunden</span></div>' +
    '<div class="meine-stat"><b>' + done.length + '</b><span>' + (done.length === 1 ? 'Einsatz' : 'Einsätze') + '</span></div>' + money + '</div>';
  if (!rows.length) {
    html += uiEmptyHtml('Noch keine Stunden', key === cur.key ? 'Sobald dein AL das Protokoll eines Einsatzes schickt, stehen deine Stunden hier.' : 'In dieser Abrechnung hast du keine Einsätze.');
  } else {
    if (pending) html += '<div class="meine-note">' + pending + (pending === 1 ? ' Einsatz wartet' : ' Einsätze warten') + ' noch auf das Protokoll.</div>';
    html += '<div class="meine-list">' + rows.map(meineRowHtml).join('') + '</div>';
  }
  if (done.length) html += '<button type="button" class="ui-btn ui-btn-block meine-pdf" onclick="meinePdf()">' + uiIcon('download') + ' Stundenzettel als PDF</button>';
  html += '<p class="meine-help">Deine Stunden kommen automatisch aus dem Protokoll. Stimmt etwas nicht, sag deinem AL Bescheid. ' +
    'Nur für einen Einsatz ohne Protokoll: <button type="button" class="stunden-link" onclick="navigate(\'home\')">selbst eintragen</button>.</p>';
  box.innerHTML = html;
}

// Same PDF as the live app's monthly export (stundenzettel.js exportMonthlyPDF): overview page + one Stundennachweis
// per week, so the Buchhaltung gets the format it knows. It reads the local week store, which fetchShiftsNow fills
// from the server (protocol shifts included), so the server state is pulled first.
var _meinePdfBusy = false;
async function meinePdf() {
  if (_meinePdfBusy || typeof exportMonthlyPDF !== 'function') return;
  _meinePdfBusy = true;
  try {
    var name = '';
    try { name = localStorage.getItem('stundenzettel_name') || ''; } catch (e) { /* storage blocked */ }
    if (!name && currentUser && currentUser.full_name) {
      try { localStorage.setItem('stundenzettel_name', currentUser.full_name); } catch (e) { /* storage blocked */ }
      var inp = document.getElementById('inp-name');
      if (inp && !inp.value) inp.value = currentUser.full_name;
    }
    showToast('PDF wird erstellt…');
    if (typeof fetchShiftsNow === 'function') await fetchShiftsNow();
    await exportMonthlyPDF(_meineKey || getBillingKeyForDate(new Date(), meineCutoff()).key);
  } catch (e) {
    console.error('Stunden-PDF:', e);
    showToast('PDF konnte nicht erstellt werden.', 'danger');
  } finally { _meinePdfBusy = false; }
}

function openMeine() {
  _meineKey = null;
  if (typeof navigate === 'function') navigate('meine');
  renderMeine();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { meineAddMonths: meineAddMonths, meineRows: meineRows, meineHours: meineHours, meineDayLabel: meineDayLabel };
}
