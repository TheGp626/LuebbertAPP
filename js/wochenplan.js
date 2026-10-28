/**
 * Wochenplan (experimental): Daniel's weekly plan PDFs as a table.
 * Everyone sees the whole week with their own shifts highlighted ("Meine Schichten").
 * PL/Admin upload a PDF → plan-pdf.js reads it → plan-parser.js builds shifts → preview with name
 * assignment → saved to plan_weeks/plan_shifts/plan_assignments; changes get a push (notify-plan-change).
 * Styles: .wp-* rules in index.html.
 */

var WP_UPLOAD_ROLES = ['Admin', 'PL'];
var WP_WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
var WP_WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
var WP_AGENCY = ['Zenjob', 'ROCKiT'];
var wpUsers = [];        // app_users (also inactive, for names of old assignments)
var wpAliases = {};      // alias (lowercase) → user id
var wpWeeks = [];        // plan_weeks, newest first
var wpWeekId = null;     // week shown in "Ganze Woche"
var wpView = 'mine';
var wpImport = null;     // { parsed, fileName, existing, unresolved, orphanWeekId }
var _wpShiftCache = {};
var _wpRenderSeq = 0;    // bumped per render; a slower earlier render must not overwrite a newer one

var WP_ICON = {
  pin: '<svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>',
  clip: '<svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/></svg>',
  truck: '<svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>',
  bell: '<svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/></svg>',
  upload: '<svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V5M7 10l5-5 5 5M5 19h14"/></svg>',
  chevron: '<svg class="wp-ico wp-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>'
};

function wpEsc(s) { return escapeHtml(s == null ? '' : String(s)); }

function wpParts(iso) {
  var p = iso.split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2], dow: new Date(p[0], p[1] - 1, p[2]).getDay() };
}

function wpDayLabel(iso) {
  var p = wpParts(iso);
  return WP_WEEKDAYS[p.dow] + ' ' + ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '.';
}

function wpAddDays(iso, n) {
  var p = wpParts(iso), d = new Date(p.y, p.m - 1, p.d + n);
  return localDateStr(d);
}

function wpUserName(id) {
  var u = wpUsers.find(function(x) { return x.id === id; });
  return u ? u.full_name : null;
}

function wpInitials(name) {
  var w = String(name || '?').trim().split(/\s+/);
  return ((w[0] || '?')[0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
}

function wpCanUpload() {
  return typeof userRole !== 'undefined' && WP_UPLOAD_ROLES.indexOf(userRole) !== -1;
}

function wpMe() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null; }

function wpMyAssignment(s) {
  var me = wpMe();
  return me ? (s.plan_assignments || []).find(function(a) { return a.user_id === me; }) || null : null;
}

// Time column: real start time, else a word from the plan ("tagsüber"), else a dash
function wpTimeCol(s) {
  var lines = s.wann ? String(s.wann).split('\n') : [];
  var w = planWhen(lines);
  if (w.time) return { big: (w.prefix === 'bis' ? 'bis ' : w.prefix === 'ab' ? 'ab ' : '') + w.time, small: w.label || (w.end ? 'bis ' + w.end : '') };
  var word = (lines[0] || '').split(':').slice(1).join(':').trim() || (lines[0] || '');
  return { big: word && word.length <= 11 ? word : '—', small: w.label || '', fuzzy: true };
}

// Remaining "Wann" lines after the one shown in the time column
function wpWannRest(s) {
  var lines = s.wann ? String(s.wann).split('\n') : [];
  return lines.slice(1);
}

function wpPeopleSummary(s) {
  var me = wpMe(), agency = {}, internal = [];
  (s.plan_assignments || []).forEach(function(a) {
    if (WP_AGENCY.indexOf(a.role) !== -1) { agency[a.role] = (agency[a.role] || 0) + 1; return; }
    internal.push({ label: a.user_id ? (wpUserName(a.user_id) || a.name) : a.name, role: a.role, isMe: a.user_id && a.user_id === me, note: a.note });
  });
  return { internal: internal, agency: agency };
}

function wpOpenPills(s) {
  return (s.open_slots || []).map(function(o) {
    return '<span class="wp-pill wp-warn">' + o.count + ' ' + wpEsc(o.role) + ' ' + (o.count === 1 ? 'fehlt' : 'fehlen') + '</span>';
  }).join('');
}

function wpStatusPill(s) {
  if (!s.change_status) return '';
  return '<span class="wp-pill ' + (s.change_status === 'neu' ? 'wp-new' : 'wp-warn') + '">' + s.change_status + '</span>';
}

function wpAvatars(people, max) {
  var shown = people.slice(0, max);
  return shown.map(function(p) {
    return '<span class="wp-av' + (p.isMe ? ' wp-av-me' : '') + '" title="' + wpEsc(p.label) + '">' + wpEsc(wpInitials(p.label)) + '</span>';
  }).join('') + (people.length > max ? '<span class="wp-av wp-av-more">+' + (people.length - max) + '</span>' : '');
}

function wpTeamLine(s) {
  var t = wpPeopleSummary(s);
  var names = t.internal.map(function(p) { return p.isMe ? 'du' : p.label.split(' ')[0]; });
  var agency = Object.keys(t.agency).map(function(k) { return t.agency[k] + ' ' + k; });
  var text = names.slice(0, 3).join(', ') + (names.length > 3 ? ' +' + (names.length - 3) : '');
  if (agency.length) text += (text ? ' · ' : '') + agency.join(', ');
  if (!t.internal.length && !agency.length && !(s.open_slots || []).length) text = s.notes && /folgt/i.test(s.notes) ? 'Team folgt' : '';
  if (!text && !(s.open_slots || []).length) return '';
  return '<div class="wp-team">' + (t.internal.length ? '<span class="wp-avs">' + wpAvatars(t.internal, 4) + '</span>' : '') +
    (text ? '<span class="wp-team-text">' + wpEsc(text) + '</span>' : '') + wpOpenPills(s) + '</div>';
}

// Full details shown when a row is expanded
function wpDetails(s) {
  var t = wpPeopleSummary(s), lines = function(x) { return x ? wpEsc(x).replace(/\n/g, '<br>') : ''; };
  var people = (s.plan_assignments || []).map(function(a) {
    var label = a.user_id ? (wpUserName(a.user_id) || a.name) : a.name, isMe = a.user_id && a.user_id === wpMe();
    return '<span class="wp-chip' + (isMe ? ' wp-chip-me' : '') + '">' + wpEsc(label) +
      (a.role && a.role !== 'MA' ? ' <span class="wp-chip-role">' + wpEsc(a.role) + '</span>' : '') +
      (a.note ? ' <span class="wp-chip-role">· ' + wpEsc(a.note) + '</span>' : '') + '</span>';
  }).join('');
  var rest = wpWannRest(s);
  return '<div class="wp-details">' +
    (rest.length ? '<div class="wp-d-block"><div class="wp-d-label">Zeiten & Hinweise</div>' + rest.map(wpEsc).join('<br>') + '</div>' : '') +
    (people ? '<div class="wp-d-block"><div class="wp-d-label">Team</div>' + people + '</div>' : '') +
    (s.notes ? '<div class="wp-d-block"><div class="wp-d-label">' + WP_ICON.truck + ' Fahrzeuge & Infos</div>' + lines(s.notes) + '</div>' : '') +
    (s.location ? '<div class="wp-d-block"><div class="wp-d-label">' + WP_ICON.pin + ' Ort</div>' + wpEsc(s.venue || '') + '<br>' + lines(s.location) + '</div>' : '') +
    (s.details ? '<div class="wp-d-block"><div class="wp-d-label">Material</div>' + lines(s.details) + '</div>' : '') +
  '</div>';
}

function wpProtButton(s, cls) {
  var mine = wpMyAssignment(s);
  if (!mine || mine.role !== 'AL') return '';
  return '<button type="button" class="btn ' + (cls || '') + ' wp-prot-btn" onclick="event.stopPropagation(); wpStartProtokoll(\'' + s.id + '\')">' + WP_ICON.clip + ' Protokoll starten</button>';
}

// Compact, expandable shift row (week view and "Danach" list)
function wpRow(s, opts) {
  opts = opts || {};
  var tc = wpTimeCol(s), mine = wpMyAssignment(s);
  var sub = [s.title && s.title !== s.venue ? s.title : null, s.ap ? 'PL ' + s.ap : null].filter(Boolean).join(' · ');
  return '<div class="wp-row' + (mine ? ' wp-row-me' : '') + '" onclick="wpToggle(this)" role="button" tabindex="0" aria-expanded="false">' +
    '<div class="wp-time' + (tc.fuzzy ? ' wp-time-fuzzy' : '') + '"><b>' + wpEsc(tc.big) + '</b><span>' + wpEsc(tc.small) + '</span></div>' +
    '<div class="wp-main">' +
      '<div class="wp-head"><div class="wp-venue">' + (s.color ? '<span class="wp-dot" style="background:' + wpEsc(s.color) + '"></span>' : '') + wpEsc(s.venue || '—') + '</div>' +
        '<div class="wp-badges">' + wpStatusPill(s) + (mine ? '<span class="wp-pill wp-me">Du' + (mine.role && mine.role !== 'MA' ? ' · ' + wpEsc(mine.role) : '') + '</span>' : '') + WP_ICON.chevron + '</div></div>' +
      (opts.showDate ? '<div class="wp-sub">' + wpDayLabel(s.date) + (sub ? ' · ' + wpEsc(sub) : '') + '</div>' : (sub ? '<div class="wp-sub">' + wpEsc(sub) + '</div>' : '')) +
      wpTeamLine(s) +
      wpDetails(s) +
      wpProtButton(s) +
    '</div>' +
  '</div>';
}

function wpToggle(el) {
  var open = el.classList.toggle('wp-open');
  el.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// Large card for the next own shift
function wpHero(s) {
  var tc = wpTimeCol(s), mine = wpMyAssignment(s), p = wpParts(s.date);
  var today = localDateStr(), tomorrow = wpAddDays(today, 1);
  // A bare weekday is only clear within the next 6 days; further out the date is shown
  var when = s.date === today ? 'heute' : s.date === tomorrow ? 'morgen' :
    s.date < wpAddDays(today, 7) ? 'am ' + WP_WEEKDAYS_LONG[p.dow] : 'am ' + ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '.';
  // Room/building line plus the street ("Staatsoper, Unter den Linden 7"); postcode lines are left out
  var loc = s.location ? String(s.location).split('\n') : [];
  var street = loc.find(function(l) { return /\d/.test(l) && !/^\d{5}\b/.test(l); });
  var addr = [loc[0], street].filter(function(x, i, a) { return x && a.indexOf(x) === i; }).join(', ');
  return '<div class="wp-hero-label">Nächster Einsatz · ' + when + '</div>' +
    '<div class="wp-hero" onclick="wpToggle(this)" role="button" tabindex="0" aria-expanded="false">' +
      '<div class="wp-head"><div class="wp-hero-date">' + wpDayLabel(s.date) + '</div><div class="wp-badges">' + wpStatusPill(s) +
        '<span class="wp-pill wp-me">Du' + (mine && mine.role && mine.role !== 'MA' ? ' · ' + wpEsc(mine.role) : '') + '</span></div></div>' +
      '<div class="wp-hero-time">' + wpEsc(tc.big) + (tc.small ? ' <span>' + wpEsc(tc.small) + '</span>' : '') + '</div>' +
      '<div class="wp-hero-venue">' + wpEsc(s.venue || '—') + (s.title && s.title !== s.venue ? ' · ' + wpEsc(s.title) : '') + '</div>' +
      (addr ? '<div class="wp-sub">' + WP_ICON.pin + ' ' + wpEsc(addr) + '</div>' : '') +
      wpTeamLine(s) +
      (s.ap ? '<div class="wp-sub">PL ' + wpEsc(s.ap) + '</div>' : '') +
      '<div class="wp-more">Details ' + WP_ICON.chevron + '</div>' +
      wpDetails(s) +
      wpProtButton(s, 'primary wp-prot-wide') +
    '</div>';
}

async function initWochenplan() {
  document.getElementById('wp-import').style.display = 'none';
  document.getElementById('wp-main').style.display = '';
  document.getElementById('wp-upload-btn').style.display = wpCanUpload() ? '' : 'none';
  var content = document.getElementById('wp-content');
  content.innerHTML = '<div class="wp-empty">Lädt…</div>';
  var [u, a, w] = await Promise.all([
    supabaseClient.from('app_users').select('id, full_name, role, is_active').order('full_name'),
    supabaseClient.from('plan_name_aliases').select('alias, user_id'),
    supabaseClient.from('plan_weeks').select('*').order('week_start', { ascending: false })
  ]);
  if (u.error || a.error || w.error) {
    console.error('Wochenplan laden:', u.error || a.error || w.error);
    content.innerHTML = '<div class="wp-empty">Der Wochenplan konnte nicht geladen werden. Prüf deine Verbindung und öffne ihn erneut.</div>';
    return;
  }
  wpUsers = u.data || [];
  wpAliases = {};
  // Same normalisation as planMatchPerson (older entries were saved with a trailing dot)
  (a.data || []).forEach(function(r) { wpAliases[planAliasKey(r.alias)] = r.user_id; });
  wpWeeks = w.data || [];
  // Default: the week containing today, else the next upcoming one, else the newest
  var today = localDateStr();
  if (!wpWeeks.some(function(x) { return x.id === wpWeekId; })) {
    var cur = wpWeeks.find(function(x) { return x.week_start <= today && x.week_end >= today; }) ||
      wpWeeks.slice().reverse().find(function(x) { return x.week_start > today; }) || wpWeeks[0];
    wpWeekId = cur ? cur.id : null;
  }
  if (typeof syncPushSubscription === 'function') syncPushSubscription();
  await wpRenderPushHint();
  wpSetView(wpView);
}

async function wpRenderPushHint() {
  var box = document.getElementById('wp-push-hint');
  box.innerHTML = '';
  if (typeof pushSupported !== 'function') return;
  if (isIosWithoutHomescreen()) {
    box.innerHTML = '<div class="wp-hint">' + WP_ICON.bell + ' Für Benachrichtigungen bei Planänderungen: Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen.</div>';
  } else if (pushSupported() && Notification.permission !== 'denied' && !(await hasPushSubscription())) {
    box.innerHTML = '<button type="button" class="btn wp-hint-btn" onclick="wpEnablePush()">' + WP_ICON.bell + ' Bei Planänderungen benachrichtigen</button>';
  }
}

async function wpEnablePush() {
  var res = await enablePushReminders();
  if (res === 'granted') { showToast('Benachrichtigungen aktiviert'); wpRenderPushHint(); }
  else if (res === 'denied') showToast('Benachrichtigungen sind blockiert. Du kannst sie in den Browser-Einstellungen erlauben.', 'danger');
  else if (res === 'ios_needs_install') showToast('Füg die App zuerst zum Home-Bildschirm hinzu.', 'info');
  else showToast('Benachrichtigungen werden auf diesem Gerät nicht unterstützt.', 'danger');
}

function wpSetView(v) {
  wpView = v;
  document.getElementById('wp-tab-mine').classList.toggle('active', v === 'mine');
  document.getElementById('wp-tab-all').classList.toggle('active', v === 'all');
  document.getElementById('wp-tab-mine').setAttribute('aria-selected', v === 'mine' ? 'true' : 'false');
  document.getElementById('wp-tab-all').setAttribute('aria-selected', v === 'all' ? 'true' : 'false');
  document.getElementById('wp-week-nav').style.display = v === 'all' ? 'flex' : 'none';
  document.getElementById('wp-days').style.display = v === 'all' ? 'flex' : 'none';
  if (v === 'mine') wpRenderMine(); else wpRenderWeek();
}

function wpStepWeek(dir) {
  // wpWeeks is newest first → "next week" is the previous index
  var i = wpWeeks.findIndex(function(w) { return w.id === wpWeekId; });
  var n = wpWeeks[i - dir];
  if (n) { wpWeekId = n.id; wpRenderWeek(); }
}

async function wpRenderMine() {
  var content = document.getElementById('wp-content');
  if (!wpMe()) return;
  var seq = ++_wpRenderSeq;
  var from = localDateStr();
  var { data, error } = await supabaseClient.from('plan_assignments')
    .select('shift:plan_shifts!inner(*, plan_assignments(*), plan_weeks(kw))')
    .eq('user_id', wpMe())
    .gte('shift.date', from);
  // The user switched tab/week or another render started meanwhile → drop this result
  if (seq !== _wpRenderSeq || wpView !== 'mine') return;
  if (error) { console.error('Meine Schichten:', error); content.innerHTML = '<div class="wp-empty">Deine Schichten konnten nicht geladen werden.</div>'; return; }
  var seen = {};
  var shifts = (data || []).map(function(r) { return r.shift; })
    .filter(function(s) { if (!s || seen[s.id]) return false; seen[s.id] = true; return true; })
    .sort(function(a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sort - b.sort); });
  shifts.forEach(function(s) { _wpShiftCache[s.id] = s; });
  if (!shifts.length) {
    content.innerHTML = '<div class="wp-empty"><div class="wp-empty-title">Keine anstehenden Schichten</div>' +
      'Sobald du im Wochenplan eingeteilt bist, steht dein nächster Einsatz hier.' +
      (wpWeeks.length ? '<br><button type="button" class="btn wp-empty-btn" onclick="wpSetView(\'all\')">Ganze Woche ansehen</button>' : '') + '</div>';
    return;
  }
  content.innerHTML = wpHero(shifts[0]) +
    (shifts.length > 1 ? '<div class="wp-section">Danach</div>' + shifts.slice(1).map(function(s) { return wpRow(s, { showDate: true }); }).join('') : '');
}

function wpRenderDays(week, byDay) {
  var bar = document.getElementById('wp-days');
  var today = localDateStr(), me = wpMe(), html = '';
  for (var d = week.week_start; d <= week.week_end; d = wpAddDays(d, 1)) {
    var list = byDay[d] || [], p = wpParts(d);
    var mine = list.some(function(s) { return (s.plan_assignments || []).some(function(a) { return a.user_id === me; }); });
    var dots = '';
    for (var i = 0; i < Math.min(list.length, 4); i++) dots += '<i></i>';
    html += '<button type="button" class="wp-day' + (d === today ? ' wp-today' : '') + (list.length ? '' : ' wp-day-empty') + (mine ? ' wp-day-mine' : '') + '"' +
      (list.length ? ' onclick="wpJumpTo(\'' + d + '\')"' : ' disabled') + ' aria-label="' + WP_WEEKDAYS_LONG[p.dow] + ', ' + list.length + ' Einsätze">' +
      '<span>' + WP_WEEKDAYS[p.dow] + '</span><b>' + ('0' + p.d).slice(-2) + '</b><em>' + dots + '</em></button>';
  }
  bar.innerHTML = html;
}

function wpJumpTo(date) {
  var el = document.getElementById('wp-day-' + date);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function wpRenderWeek() {
  var content = document.getElementById('wp-content');
  var seq = ++_wpRenderSeq;
  var week = wpWeeks.find(function(w) { return w.id === wpWeekId; });
  var label = document.getElementById('wp-week-label');
  var i = wpWeeks.indexOf(week);
  document.getElementById('wp-prev').disabled = !week || i >= wpWeeks.length - 1;
  document.getElementById('wp-next').disabled = !week || i <= 0;
  if (!week) {
    label.textContent = 'Kein Plan';
    document.getElementById('wp-days').innerHTML = '';
    content.innerHTML = '<div class="wp-empty"><div class="wp-empty-title">Noch kein Wochenplan</div>' +
      (wpCanUpload() ? 'Lade Daniels PDF über „Plan hochladen“ hoch.' : 'Sobald ein Plan hochgeladen ist, erscheint er hier.') + '</div>';
    return;
  }
  var s0 = wpParts(week.week_start), s1 = wpParts(week.week_end);
  label.innerHTML = 'KW ' + week.kw + ' <span>' + s0.d + '.' + (s0.m !== s1.m ? s0.m + '.' : '') + '–' + s1.d + '.' + s1.m + '.' +
    (week.version > 1 ? ' · Stand ' + week.version : '') + '</span>';
  content.innerHTML = '<div class="wp-empty">Lädt…</div>';
  var { data, error } = await supabaseClient.from('plan_shifts').select('*, plan_assignments(*)')
    .eq('week_id', week.id).order('date').order('sort');
  if (seq !== _wpRenderSeq || wpView !== 'all' || wpWeekId !== week.id) return;
  if (error) { console.error('Woche laden:', error); content.innerHTML = '<div class="wp-empty">Die Woche konnte nicht geladen werden.</div>'; return; }
  (data || []).forEach(function(s) { _wpShiftCache[s.id] = s; });
  var byDay = {};
  (data || []).forEach(function(s) { (byDay[s.date] = byDay[s.date] || []).push(s); });
  wpRenderDays(week, byDay);
  var html = '';
  // Entries with kind 'unassigned' only drive the push ("nicht mehr eingeteilt"); that shift still exists
  var gone = (week.removed || []).filter(function(r) { return r.kind !== 'unassigned'; });
  if (gone.length) {
    html += '<div class="wp-removed"><div class="wp-removed-title">Entfallen seit dem letzten Stand</div>' +
      gone.map(function(r) { return '<div>' + wpDayLabel(r.date) + ' · ' + wpEsc(r.venue) + (r.title ? ' – ' + wpEsc(r.title) : '') + '</div>'; }).join('') + '</div>';
  }
  Object.keys(byDay).sort().forEach(function(d) {
    var p = wpParts(d);
    html += '<div class="wp-dayhead" id="wp-day-' + d + '">' + WP_WEEKDAYS_LONG[p.dow] + ' <span>' + ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '. · ' +
      byDay[d].length + (byDay[d].length === 1 ? ' Einsatz' : ' Einsätze') + '</span></div>' +
      byDay[d].map(function(s) { return wpRow(s); }).join('');
  });
  content.innerHTML = html || '<div class="wp-empty">Keine Einsätze in dieser Woche.</div>';
}

function wpStartProtokoll(shiftId) {
  var s = _wpShiftCache[shiftId];
  if (!s) return;
  var parsed = planShiftFromDb(s);
  openProtokollPrefilled({
    event: planEventName(parsed), date: s.date, action: planGuessAction(parsed.wann),
    alId: wpMe(), location: [s.venue].concat(parsed.location.slice(0, 1)).filter(Boolean).join(', ')
  });
}

// ── IMPORT ──

function wpPickFile() {
  if (!wpCanUpload()) { showToast('Nur PL und Admin können Pläne hochladen.', 'danger'); return; }
  var inp = document.getElementById('wp-file');
  inp.value = '';
  inp.click();
}

async function wpFileChosen(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { showToast('Wähl eine PDF-Datei aus.', 'danger'); return; }
  showToast('Plan wird gelesen…', 'info');
  var parsed;
  try {
    parsed = planParse(await readPlanPdf(await file.arrayBuffer()));
  } catch (e) {
    console.error('Plan lesen:', e);
    showToast('Die PDF konnte nicht gelesen werden.', 'danger');
    return;
  }
  if (!parsed.shifts.length) { showToast(parsed.warnings[0] || 'Keine Einsätze erkannt.', 'danger'); return; }
  var { data: ex, error } = await supabaseClient.from('plan_weeks')
    .select('*, plan_shifts(*, plan_assignments(*))').eq('year', parsed.year).eq('kw', parsed.kw).maybeSingle();
  if (error) { console.error('Woche prüfen:', error); showToast('Server nicht erreichbar.', 'danger'); return; }

  // Names that could not be matched automatically (agency workers are never matched)
  var unresolved = {};
  parsed.shifts.forEach(function(s) {
    s.people.forEach(function(p) {
      var m = planMatchPerson(p, wpUsers, wpAliases);
      p.userId = m.userId;
      if (!m.userId && WP_AGENCY.indexOf(p.role) === -1) {
        var k = planAliasKey(p.name);
        if (!unresolved[k]) unresolved[k] = { name: p.name, candidates: m.candidates, count: 0 };
        unresolved[k].count++;
      }
    });
    // The AP column is the PL, needed for the day-6 reminder mail. It gets its own "ap:" alias entry, so
    // choosing the PL for "Sabine" never maps a team member "Sabine" to that PL.
    s.apUserId = null;
    if (s.ap) {
      var pm = planMatchPerson({ name: s.ap, role: 'PL' }, wpUsers, wpAliases);
      s.apUserId = pm.userId;
      if (!pm.userId) {
        var ak = planAliasKey(s.ap, true);
        if (!unresolved[ak]) unresolved[ak] = { name: s.ap, candidates: pm.candidates, count: 0 };
        unresolved[ak].count++;
        unresolved[ak].pl = true;
      }
    }
  });
  wpImport = { parsed: parsed, fileName: file.name, existing: ex || null, unresolved: unresolved };
  wpRenderImport();
}

// Parsed shift → the DB row shape the list renderer expects (preview only, nothing saved)
function wpPreviewShift(s, i, status) {
  return Object.assign(planShiftRow(s, null, status), { id: 'preview-' + i,
    plan_assignments: s.people.map(function(p) { return { name: p.name, role: p.role, note: p.note, user_id: p.userId || null }; }) });
}

function wpRenderImport() {
  var p = wpImport.parsed, ex = wpImport.existing;
  var active = wpUsers.filter(function(u) { return u.is_active !== false && u.role !== 'Gast'; });
  var status = p.shifts.map(function() { return null; }), diffInfo = '';
  if (ex) {
    var d = planDiff((ex.plan_shifts || []).map(planShiftFromDb), p.shifts);
    status = d.status;
    var cnt = function(st) { return d.status.filter(function(x) { return x === st; }).length; };
    diffInfo = '<div class="wp-stats">' +
      '<div><b>' + cnt('geändert') + '</b><span>geändert</span></div>' +
      '<div><b>' + cnt('neu') + '</b><span>neu</span></div>' +
      '<div><b>' + d.removed.length + '</b><span>entfallen</span></div></div>' +
      '<div class="wp-sub">Ersetzt Stand ' + ex.version + ' dieser Woche.</div>';
  }
  var names = Object.keys(wpImport.unresolved).sort(function(a, b) {
    return wpImport.unresolved[a].name.localeCompare(wpImport.unresolved[b].name, 'de') || (a < b ? -1 : 1);
  });
  var nameRows = names.map(function(k) {
    var r = wpImport.unresolved[k];
    // The AP column may only be mapped to PL, Admin or Buchhaltung (planMatchPerson ignores anything else)
    var pool = r.pl ? active.filter(function(u) { return ['PL', 'Admin', 'Buchhaltung'].indexOf(u.role) !== -1; }) : active;
    var cands = r.candidates.map(function(id) { return pool.find(function(u) { return u.id === id; }); }).filter(Boolean);
    var rest = pool.filter(function(u) { return r.candidates.indexOf(u.id) === -1; });
    var opt = function(u) { return '<option value="' + u.id + '">' + wpEsc(u.full_name) + '</option>'; };
    return '<label class="wp-map">' +
      '<span class="wp-map-name">„' + wpEsc(r.name) + '“' + (r.pl ? ' <small>(PL)</small>' : '') + ' <small>' + r.count + '×</small></span>' +
      '<select class="meta-input" data-alias="' + wpEsc(k) + '">' +
        '<option value="">Nicht zuordnen (nur Name)</option>' +
        (cands.length ? '<optgroup label="Vorschläge">' + cands.map(opt).join('') + '</optgroup>' : '') +
        '<optgroup label="Alle">' + rest.map(opt).join('') + '</optgroup>' +
      '</select></label>';
  }).join('');
  var byDay = {};
  p.shifts.forEach(function(s, i) {
    var row = wpPreviewShift(s, i, status[i]);
    _wpShiftCache[row.id] = row;
    (byDay[s.date] = byDay[s.date] || []).push(row);
  });
  var preview = Object.keys(byDay).sort().map(function(d) {
    var dp = wpParts(d);
    return '<div class="wp-dayhead wp-dayhead-static">' + WP_WEEKDAYS_LONG[dp.dow] + ' <span>' + ('0' + dp.d).slice(-2) + '.' + ('0' + dp.m).slice(-2) + '.</span></div>' +
      byDay[d].map(function(s) { return wpRow(s); }).join('');
  }).join('');

  document.getElementById('wp-import-body').innerHTML =
    '<div class="wp-card">' +
      '<div class="wp-hero-date">KW ' + p.kw + ' <span class="wp-sub-inline">' + wpDayLabel(p.weekStart) + ' – ' + wpDayLabel(p.weekEnd) + '</span></div>' +
      '<div class="wp-sub">' + p.shifts.length + ' Einsätze aus „' + wpEsc(wpImport.fileName) + '“. Telefonnummern werden nicht gespeichert.</div>' +
      diffInfo +
      (p.warnings.length ? '<div class="wp-warn-text">' + p.warnings.map(wpEsc).join('<br>') + '</div>' : '') +
    '</div>' +
    (names.length ? '<div class="wp-card"><div class="wp-card-title">Namen zuordnen</div>' +
      '<div class="wp-sub" style="margin-bottom:10px;">Die App merkt sich deine Auswahl für die nächsten Pläne.</div>' + nameRows + '</div>' : '') +
    '<div class="wp-section">Vorschau</div>' + preview;
  document.getElementById('wp-main').style.display = 'none';
  document.getElementById('wp-import').style.display = '';
  document.getElementById('page-wochenplan').scrollTop = 0;
}

function wpCancelImport() {
  wpImport = null;
  document.getElementById('wp-import').style.display = 'none';
  document.getElementById('wp-main').style.display = '';
}

async function wpSaveImport() {
  if (!wpImport) return;
  var btn = document.getElementById('wp-save-btn');
  btn.disabled = true; btn.textContent = 'Speichert…';
  var insertedIds = [], createdWeekId = null, committed = false;
  try {
    var p = wpImport.parsed, ex = wpImport.existing;
    // Names chosen in the preview → remembered as aliases (data-alias already holds planAliasKey)
    var newAliases = [];
    document.querySelectorAll('#wp-import-body select[data-alias]').forEach(function(sel) {
      if (sel.value) { wpAliases[sel.dataset.alias] = sel.value; newAliases.push({ alias: sel.dataset.alias, user_id: sel.value }); }
    });
    p.shifts.forEach(function(s) {
      s.people.forEach(function(x) { if (!x.userId && WP_AGENCY.indexOf(x.role) === -1) x.userId = wpAliases[planAliasKey(x.name)] || null; });
      if (!s.apUserId && s.ap) s.apUserId = wpAliases[planAliasKey(s.ap, true)] || null;
    });

    var oldShifts = ex ? (ex.plan_shifts || []).map(planShiftFromDb) : [];
    var diff = ex ? planDiff(oldShifts, p.shifts) : { status: p.shifts.map(function() { return null; }), matched: [], removed: [] };
    var removed = diff.removed.map(function(r) {
      return { date: r.date, venue: r.venue, title: r.title,
        user_ids: r.people.map(function(x) { return x.userId; }).filter(Boolean) };
    }).concat(planUnassigned(p.shifts, diff)); // people taken off a shift that stays → push only
    var weekRow = { year: p.year, kw: p.kw, week_start: p.weekStart, week_end: p.weekEnd, removed: removed,
      file_name: wpImport.fileName, uploaded_by: wpMe(), uploaded_at: new Date().toISOString() };

    // Order matters: an existing week's row (version, removed) is only touched after all shifts and
    // assignments are in, so a failure leaves the old Stand as it was. A new week needs its row first;
    // on failure it is deleted again, so a retry doesn't run into UNIQUE (year, kw).
    var weekId;
    if (ex) {
      weekId = ex.id;
    } else if (wpImport.orphanWeekId) {
      // An earlier attempt created the row but could not delete it again → reuse it
      weekId = createdWeekId = wpImport.orphanWeekId;
    } else {
      var ins = await supabaseClient.from('plan_weeks').insert(weekRow).select('id').single();
      if (ins.error) throw ins.error;
      weekId = createdWeekId = ins.data.id;
    }

    // New shifts first, old ones deleted afterwards → a failed upload never leaves an empty week
    var rows = p.shifts.map(function(s, i) { return planShiftRow(s, weekId, diff.status[i]); });
    var sh = await supabaseClient.from('plan_shifts').insert(rows).select('id, key');
    if (sh.data) insertedIds = sh.data.map(function(r) { return r.id; });
    if (sh.error || !sh.data || sh.data.length !== rows.length) throw sh.error || new Error('Einsätze nicht gespeichert');
    var idByKey = {};
    sh.data.forEach(function(r) { idByKey[r.key] = r.id; });
    var asg = [];
    p.shifts.forEach(function(s) {
      s.people.forEach(function(x) {
        asg.push({ shift_id: idByKey[s.key], user_id: x.userId || null, name: x.name, role: x.role, note: x.note || null });
      });
    });
    if (asg.length) {
      var as = await supabaseClient.from('plan_assignments').insert(asg).select('id');
      if (as.error || !as.data || as.data.length !== asg.length) throw as.error || new Error('Personal nicht gespeichert');
    }
    if (ex) {
      // Only bump the Stand this preview was based on (a parallel upload of the same week fails here)
      weekRow.version = ex.version + 1;
      var up = await supabaseClient.from('plan_weeks').update(weekRow).eq('id', ex.id).eq('version', ex.version).select('id');
      if (up.error || !up.data || !up.data.length) throw up.error || new Error('Die Woche wurde inzwischen geändert. Lade die PDF erneut hoch.');
    }
    committed = true;
    wpImport.orphanWeekId = null;
    if (oldShifts.length) {
      var del = await supabaseClient.from('plan_shifts').delete().in('id', oldShifts.map(function(s) { return s.id; }));
      if (del.error) console.error('Alte Einsätze löschen:', del.error);
    }
    if (newAliases.length) {
      var al = await supabaseClient.from('plan_name_aliases').upsert(newAliases, { onConflict: 'alias' });
      if (al.error) console.error('Zuordnungen merken:', al.error);
    }

    // Push to everyone affected (the function decides who and sends at most once per version)
    supabaseClient.functions.invoke('notify-plan-change', { body: { week_id: weekId } })
      .then(function(r) { if (r.error) console.error('Plan-Push:', r.error); })
      .catch(function(e) { console.error('Plan-Push:', e); });

    showToast('Wochenplan KW ' + p.kw + ' gespeichert');
    wpImport = null;
    wpWeekId = weekId;
    wpView = 'all';
    await initWochenplan();
  } catch (e) {
    console.error('Plan speichern:', e);
    if (!committed) await wpRollbackImport(insertedIds, createdWeekId);
    showToast('Speichern fehlgeschlagen: ' + (e.message || e), 'danger');
  } finally {
    btn.disabled = false; btn.textContent = 'Übernehmen';
  }
}

// Undoes a failed save: deletes the shifts it inserted (their assignments go by cascade) and a week row
// it created. If that row can't be deleted, the next attempt reuses it (wpImport.orphanWeekId).
async function wpRollbackImport(shiftIds, createdWeekId) {
  if (shiftIds.length) {
    var d = await supabaseClient.from('plan_shifts').delete().in('id', shiftIds);
    if (d.error) console.error('Rückgängig (Einsätze):', d.error);
  }
  if (createdWeekId) {
    var w = await supabaseClient.from('plan_weeks').delete().eq('id', createdWeekId).select('id');
    if (w.error) console.error('Rückgängig (Woche):', w.error);
    if (wpImport) wpImport.orphanWeekId = (!w.error && w.data && w.data.length) ? null : createdWeekId;
  }
}

// Notification tap opens ./index.html?open=wochenplan
function handleWochenplanDeepLink() {
  var params = new URLSearchParams(location.search);
  if (params.get('open') !== 'wochenplan') return;
  history.replaceState(null, '', location.pathname);
  if (typeof currentUser === 'undefined' || !currentUser || userRole === 'Gast') return;
  wpView = 'mine';
  selectMode('wochenplan');
}
