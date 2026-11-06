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

// Remaining "Wann" lines after the one shown in the time column (the first line with a time, else the first line);
// a note line before the timed line must not vanish from the details
function wpWannRest(s) {
  var lines = s.wann ? String(s.wann).split('\n') : [];
  var i = lines.findIndex(function(l) { return planWhen([l]).time; });
  if (i < 0) i = 0;
  return lines.filter(function(_, j) { return j !== i; });
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
    return '<span class="ui-pill ui-pill-warn">' + o.count + ' ' + wpEsc(o.role) + ' ' + (o.count === 1 ? 'fehlt' : 'fehlen') + '</span>';
  }).join('');
}

function wpStatusPill(s) {
  if (!s.change_status) return '';
  return '<span class="ui-pill ' + (s.change_status === 'neu' ? 'ui-pill-ok' : 'ui-pill-warn') + '">' + s.change_status + '</span>';
}

function wpAvatars(people, max) {
  var shown = people.slice(0, max);
  return shown.map(function(p) {
    return '<span class="ui-avatar' + (p.isMe ? ' ui-avatar-me' : '') + '" title="' + wpEsc(p.label) + '">' + wpEsc(wpInitials(p.label)) + '</span>';
  }).join('') + (people.length > max ? '<span class="ui-avatar wp-av-more">+' + (people.length - max) + '</span>' : '');
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
  var rest = wpWannRest(s), mat = planMaterialLines(s);
  return '<div class="wp-details">' +
    (rest.length ? '<div class="wp-d-block"><div class="wp-d-label">Zeiten & Hinweise</div>' + rest.map(wpEsc).join('<br>') + '</div>' : '') +
    (people ? '<div class="wp-d-block"><div class="wp-d-label">Team</div>' + people + '</div>' : '') +
    (s.notes ? '<div class="wp-d-block"><div class="wp-d-label">' + WP_ICON.truck + ' Fahrzeuge & Infos</div>' + lines(s.notes) + '</div>' : '') +
    (s.location ? '<div class="wp-d-block"><div class="wp-d-label">' + WP_ICON.pin + ' Ort</div>' + wpEsc(s.venue || '') + '<br>' + lines(s.location) + '</div>' : '') +
    (mat.length ? '<div class="wp-d-block"><div class="wp-d-label">Material</div>' + mat.map(wpEsc).join('<br>') + '</div>' : '') +
  '</div>';
}

function wpProtButton(s, cls) {
  var mine = wpMyAssignment(s);
  if (!mine || mine.role !== 'AL') return '';
  return '<button type="button" class="btn ' + (cls || '') + ' wp-prot-btn" onclick="event.stopPropagation(); wpStartProtokoll(\'' + s.id + '\')">' + WP_ICON.clip + ' Protokoll starten</button>';
}

// Who said "Ich hätte Zeit" and is not on the shift yet; s._interest = user ids (null = not loaded)
function wpInterested(s) {
  var assigned = (s.plan_assignments || []).map(function(a) { return a.user_id; });
  return (s._interest || []).filter(function(id) { return assigned.indexOf(id) === -1; });
}

// Open slot the person may apply for (same rule as public.fits_plan_slot): AL slot for AL/PL/Admin,
// Fahrer slot only with the "Kann Fahrer" switch, MA/Zenjob/ROCKiT/other slots for everyone
function wpSlotFits(role, who) {
  who = who || {};
  if (role === 'AL') return ['AL', 'PL', 'Admin'].indexOf(who.role) !== -1;
  if (role === 'Fahrer') return !!who.canDrive;
  return true;
}

function wpWho() {
  return { role: typeof userRole !== 'undefined' ? userRole : null, canDrive: !!window.currentUserCanDrive };
}

function wpCanApply(s, me, today, who) {
  return !!(me && s._interest && (s.open_slots || []).some(function(o) { return wpSlotFits(o && o.role, who); }) && s.date >= today &&
    !(s.plan_assignments || []).some(function(a) { return a.user_id === me; }));
}

function wpInterestButton(s) {
  if (s._orders && s._orders.length) return '';
  var me = wpMe();
  if (!wpCanApply(s, me, localDateStr(), wpWho())) return '';
  var on = s._interest.indexOf(me) !== -1;
  return '<button type="button" class="btn' + (on ? '' : ' primary') + ' wp-prot-btn" onclick="event.stopPropagation(); wpToggleInterest(this, \'' + s.id + '\')">' +
    (on ? 'Doch keine Zeit' : 'Ich hätte Zeit') + '</button>';
}

// Plan builders (PL/Admin) see who would have time, without opening the row
function wpApplicantChips(s) {
  return wpInterested(s).map(function(id) {
    var n = wpUserName(id) || '?';
    return '<span class="wp-chip wp-chip-me"><span class="ui-avatar">' + wpEsc(wpInitials(n)) + '</span>' + wpEsc(n) + '</span>';
  }).join('');
}

// Admin always, everyone else (PL included) only when "Sieht Bewerbungen" is switched on for them
function wpSeesInterest() { return (typeof userRole !== 'undefined' && userRole === 'Admin') || !!window.currentUserSeesInterest; }

function wpInterestList(s) {
  if (!wpSeesInterest() || !wpInterested(s).length) return '';
  return '<div class="wp-int"><div class="wp-d-label">Hätten Zeit</div>' + wpApplicantChips(s) + '</div>';
}

// Top-of-week card for PL/Admin: every shift with applicants, tap to jump to the row
function wpInterestOverview(shifts) {
  if (!wpSeesInterest()) return '';
  var list = shifts.filter(function(s) { return wpInterested(s).length; });
  if (!list.length) return '';
  var total = list.reduce(function(n, s) { return n + wpInterested(s).length; }, 0);
  return '<div class="wp-apps"><div class="wp-apps-title">Hätten Zeit <span class="ui-pill ui-pill-info">' + total + '</span></div>' +
    list.map(function(s) {
      return '<button type="button" class="wp-app" onclick="wpJumpToShift(\'' + s.id + '\')">' +
        '<div class="wp-app-top"><b>' + wpDayLabel(s.date) + ' · ' + wpEsc(s.venue || '—') + '</b>' + wpOpenPills(s) + '</div>' +
        '<div>' + wpApplicantChips(s) + '</div></button>';
    }).join('') + '</div>';
}

function wpJumpToShift(shiftId) {
  var row = document.querySelector('[data-sid="' + shiftId + '"]');
  if (!row) return;
  row.classList.add('wp-open');
  row.setAttribute('aria-expanded', 'true');
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function wpToggleInterest(btn, shiftId) {
  var s = _wpShiftCache[shiftId], me = wpMe();
  if (!s || !s._interest || !me) return;
  btn.disabled = true;
  var on = s._interest.indexOf(me) !== -1, q = supabaseClient.from('plan_shift_interest');
  // .select(): RLS answers a blocked write with 0 rows and no error
  var r = on ? await q.delete().eq('week_id', s.week_id).eq('shift_key', s.key).eq('user_id', me).select('user_id')
             : await q.insert({ week_id: s.week_id, shift_key: s.key, user_id: me }).select('user_id');
  if (r.error || !r.data || !r.data.length) {
    console.error('Ich hätte Zeit:', r.error);
    showToast('Das hat nicht geklappt. Versuch es nochmal.', 'danger');
    btn.disabled = false;
    return;
  }
  showToast(on ? 'Zurückgezogen' : 'Gemeldet – die Planung sieht, dass du Zeit hättest');
  wpRenderWeek();
}

// ── Verfügbarkeit: unlocked people block days; no row = available (table availability) ──
var WP_AVAIL_LEVELS = { nein: { label: 'geht nicht', mark: '✕' }, notfall: { label: 'nur im Notfall', mark: '!' } };
var WP_AVAIL_WEEKS = 8;

function wpAvailNext(level) { return level === '' || !level ? 'notfall' : level === 'notfall' ? 'nein' : ''; }

// ISO-8601 week number of a YYYY-MM-DD day (the week's Thursday decides the year)
function wpIsoWeek(iso) {
  var p = wpParts(iso), d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7);
  var jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}

// n weeks from the Monday of today's week: [{ monday, kw, days[7] }]
function wpAvailWeeks(today, n) {
  var monday = wpAddDays(today, -((wpParts(today).dow + 6) % 7)), out = [];
  for (var w = 0; w < n; w++) {
    var mon = wpAddDays(monday, w * 7), days = [];
    for (var i = 0; i < 7; i++) days.push(wpAddDays(mon, i));
    out.push({ monday: mon, kw: wpIsoWeek(mon), days: days });
  }
  return out;
}

function wpCanSetAvail(user, forAll) {
  return !!user && user.role !== 'Gast' && (!!user.availability_enabled || !!forAll);
}

// Planner grid: one row per person (by name), cells Mo–So with '' | 'notfall' | 'nein'
function wpAvailGrid(people, rows, monday) {
  var days = [0, 1, 2, 3, 4, 5, 6].map(function(i) { return wpAddDays(monday, i); }), lv = {};
  (rows || []).forEach(function(r) { lv[r.user_id + '|' + r.day] = r.level; });
  return (people || []).map(function(p) {
    return { id: p.id, name: p.full_name || 'Unbekannt', cells: days.map(function(d) { return lv[p.id + '|' + d] || ''; }) };
  }).sort(function(a, b) { return a.name.localeCompare(b.name, 'de'); });
}

var wpAvailRows = {};        // own blocked days: { 'YYYY-MM-DD': 'nein' | 'notfall' }
var _wpAvailChain = {};      // per day: the last pending write, so writes reach the server in tap order
var _wpAvailSaved = {};      // per day: last level the server confirmed (load or successful save)
var wpAvailGridMonday = null; // week shown in the planner grid

function wpAvailMode() {
  var role = typeof userRole !== 'undefined' ? userRole : null;
  var forAll = typeof appSetting === 'function' && appSetting('availability_for_all') === true;
  return {
    own: wpCanSetAvail({ role: role, availability_enabled: !!window.currentUserAvailability }, forAll),
    grid: role !== 'Gast' && wpSeesInterest()
  };
}

function wpAvailDayHtml(day, today) {
  var lv = wpAvailRows[day] || '', meta = WP_AVAIL_LEVELS[lv], p = wpParts(day), past = day < today;
  var label = WP_WEEKDAYS_LONG[p.dow] + ', ' + p.d + '.' + p.m + '.: ' + (meta ? meta.label : 'verfügbar') + (past ? ' (vorbei)' : '');
  return '<button type="button" class="wp-av-day' + (lv ? ' wp-av-' + lv : '') + (day === today ? ' wp-av-today' : '') + '" data-day="' + day + '"' +
    (past ? ' disabled' : ' onclick="wpToggleAvail(\'' + day + '\')"') + ' aria-label="' + wpEsc(label) + '">' +
    '<span class="wp-av-dow">' + WP_WEEKDAYS[p.dow] + '</span><span class="wp-av-num">' + p.d + '</span>' +
    '<span class="wp-av-mark" aria-hidden="true">' + (meta ? meta.mark : '') + '</span></button>';
}

function wpAvailLegendHtml() {
  return '<div class="wp-av-legend" aria-hidden="true"><span><i class="wp-av-sw"></i>verfügbar</span>' +
    '<span><i class="wp-av-sw wp-av-notfall">!</i>nur im Notfall</span><span><i class="wp-av-sw wp-av-nein">✕</i>geht nicht</span></div>';
}

function wpAvailCalendarHtml(today) {
  return '<div class="wp-hint">Trag bitte mindestens 2 Wochen vorher ein, wann du nicht kannst. Nicht markierte Tage = verfügbar. ' +
    'Tippen wechselt: verfügbar → nur im Notfall → geht nicht.</div>' + wpAvailLegendHtml() +
    '<div class="wp-av-cal">' + wpAvailWeeks(today, WP_AVAIL_WEEKS).map(function(w) {
      return '<div class="wp-av-week"><div class="wp-av-kw">KW ' + w.kw + ' · ' + wpDayLabel(w.days[0]).slice(3) + ' – ' + wpDayLabel(w.days[6]).slice(3) + '</div>' +
        '<div class="wp-av-row">' + w.days.map(function(d) { return wpAvailDayHtml(d, today); }).join('') + '</div></div>';
    }).join('') + '</div>';
}

function wpAvailSave(day, level) {
  var me = wpMe(), q = supabaseClient.from('availability');
  // .select(): RLS answers a blocked write with 0 rows and no error
  return level ? q.upsert({ user_id: me, day: day, level: level, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' }).select('day')
               : q.delete().eq('user_id', me).eq('day', day).select('day');
}

// Tap on a day: next level shown at once, saved in tap order; a failed save puts back the last SAVED level
async function wpToggleAvail(day) {
  if (!wpMe() || day < localDateStr()) return;
  var prev = wpAvailRows[day] || '', next = wpAvailNext(prev);
  if (!(day in _wpAvailSaved)) _wpAvailSaved[day] = prev;
  if (next) wpAvailRows[day] = next; else delete wpAvailRows[day];
  wpAvailRepaint(day);
  var run = (_wpAvailChain[day] || Promise.resolve()).then(function() { return wpAvailSave(day, next); });
  _wpAvailChain[day] = run.catch(function() {});
  var r;
  try { r = await run; } catch (e) { r = { error: e }; }
  if (r.error || (next && (!r.data || !r.data.length))) {
    console.error('Verfügbarkeit speichern:', r.error);
    if ((wpAvailRows[day] || '') === next) {
      var saved = _wpAvailSaved[day];
      if (saved) wpAvailRows[day] = saved; else delete wpAvailRows[day];
      wpAvailRepaint(day);
    }
    showToast('Nicht gespeichert. Prüf deine Verbindung und tipp nochmal.', 'danger');
  } else {
    _wpAvailSaved[day] = next;
  }
}

// Planner grid weeks: the current week up to the last week the calendar offers
function wpAvailGridBounds() {
  var weeks = wpAvailWeeks(localDateStr(), WP_AVAIL_WEEKS);
  return { min: weeks[0].monday, max: weeks[weeks.length - 1].monday };
}

function wpAvailGridStep(dir) {
  var b = wpAvailGridBounds(), next = wpAddDays(wpAvailGridMonday || b.min, dir * 7);
  if (next >= b.min && next <= b.max) wpRenderAvailGrid(next);
}

async function wpRenderAvailGrid(monday) {
  var box = document.getElementById('wp-av-planner');
  if (!box) return;
  wpAvailGridMonday = monday;
  var sunday = wpAddDays(monday, 6), b = wpAvailGridBounds();
  var [p, r] = await Promise.all([
    supabaseClient.rpc('availability_people'),
    supabaseClient.from('availability').select('user_id, day, level').gte('day', monday).lte('day', sunday)
  ]);
  if (wpAvailGridMonday !== monday) return; // a newer week was picked meanwhile
  var nav = '<div class="wp-av-planner-head"><div><div class="ui-label" style="margin:0;">Team</div>' +
    '<b>KW ' + wpIsoWeek(monday) + ' · ' + wpDayLabel(monday).slice(3) + ' – ' + wpDayLabel(sunday).slice(3) + '</b></div>' +
    '<div class="wp-weeknav" style="display:flex;">' +
    '<button type="button" aria-label="Vorige Woche" onclick="wpAvailGridStep(-1)"' + (monday <= b.min ? ' disabled' : '') + '><svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg></button>' +
    '<button type="button" aria-label="Nächste Woche" onclick="wpAvailGridStep(1)"' + (monday >= b.max ? ' disabled' : '') + '><svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6l6 6-6 6"/></svg></button></div></div>';
  if (p.error || r.error) {
    console.error('Verfügbarkeit Team:', p.error || r.error);
    box.innerHTML = nav + '<div class="wp-empty">Die Übersicht konnte nicht geladen werden. Prüf deine Verbindung.</div>';
    return;
  }
  var rows = wpAvailGrid(p.data, r.data, monday);
  if (!rows.length) {
    box.innerHTML = nav + uiEmptyHtml('Noch niemand freigeschaltet', 'Im Mitarbeiter-Dialog „Verfügbarkeit eintragen“ anhaken oder in den Einstellungen für alle einschalten.');
    return;
  }
  var days = [0, 1, 2, 3, 4, 5, 6].map(function(i) { return wpAddDays(monday, i); });
  box.innerHTML = nav + '<div class="wp-av-scroll"><table class="wp-av-grid"><caption class="sr-only">Wer an welchem Tag nicht oder nur im Notfall kann</caption>' +
    '<thead><tr><th scope="col"><span class="sr-only">Name</span></th>' + days.map(function(d) {
      var x = wpParts(d);
      return '<th scope="col">' + WP_WEEKDAYS[x.dow] + '<br>' + x.d + '.' + x.m + '.</th>';
    }).join('') + '</tr></thead><tbody>' + rows.map(function(row) {
      return '<tr><th scope="row">' + wpEsc(row.name) + '</th>' + row.cells.map(function(lv) {
        var meta = WP_AVAIL_LEVELS[lv];
        return meta ? '<td class="wp-av-' + lv + '" title="' + meta.label + '"><span aria-hidden="true">' + meta.mark + '</span><span class="sr-only">' + meta.label + '</span></td>'
                    : '<td><span class="sr-only">verfügbar</span></td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>' + wpAvailLegendHtml();
}

function wpAvailRepaint(day) {
  var el = document.querySelector('.wp-av-day[data-day="' + day + '"]');
  if (!el) return;
  el.outerHTML = wpAvailDayHtml(day, localDateStr());
  var again = document.querySelector('.wp-av-day[data-day="' + day + '"]');
  if (again) again.focus(); // keep keyboard focus on the tapped day
}

// Compact, expandable shift row (week view and "Danach" list)
function wpRow(s, opts) {
  opts = opts || {};
  var tc = wpTimeCol(s), mine = wpMyAssignment(s), head = planShiftHeading(s);
  var sub = [head && head !== s.venue ? head : null, s.ap ? 'PL ' + s.ap : null].filter(Boolean).join(' · ');
  return '<div class="ui-row' + (mine ? ' ui-row-me' : '') + '" data-sid="' + s.id + '" onclick="wpToggle(this)" role="button" tabindex="0" aria-expanded="false">' +
    '<div class="wp-time' + (tc.fuzzy ? ' wp-time-fuzzy' : '') + '"><b>' + wpEsc(tc.big) + '</b><span>' + wpEsc(tc.small) + '</span></div>' +
    '<div class="wp-main">' +
      '<div class="wp-head"><div class="wp-venue">' + (s.color ? '<span class="wp-dot" style="background:' + wpEsc(s.color) + '"></span>' : '') + wpEsc(s.venue || '—') + '</div>' +
        '<div class="wp-badges">' + wpStatusPill(s) + (mine ? '<span class="ui-pill ui-pill-info">Du' + (mine.role && mine.role !== 'MA' ? ' · ' + wpEsc(mine.role) : '') + '</span>' : '') + WP_ICON.chevron + '</div></div>' +
      (opts.showDate ? '<div class="wp-sub">' + wpDayLabel(s.date) + (sub ? ' · ' + wpEsc(sub) : '') + '</div>' : (sub ? '<div class="wp-sub">' + wpEsc(sub) + '</div>' : '')) +
      wpTeamLine(s) + wpInterestList(s) +
      wpDetails(s) +
      (s._orders || []).map(function(o) { return wpOrderBlock(o, s); }).join('') +
      wpProtButton(s) + wpInterestButton(s) +
    '</div>' +
  '</div>';
}

function wpToggle(el) {
  var open = el.classList.toggle('wp-open');
  el.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// Large card for the next own shift
function wpHero(s) {
  var tc = wpTimeCol(s), mine = wpMyAssignment(s), p = wpParts(s.date), head = planShiftHeading(s);
  var today = localDateStr(), tomorrow = wpAddDays(today, 1);
  // A bare weekday is only clear within the next 6 days; further out the date is shown
  // Yesterday's date: the night shift (Abbau 0.30 Uhr) that is running right now
  var when = s.date === today ? 'heute' : s.date === wpAddDays(today, -1) ? 'heute Nacht' : s.date === tomorrow ? 'morgen' :
    s.date < wpAddDays(today, 7) ? 'am ' + WP_WEEKDAYS_LONG[p.dow] : 'am ' + ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '.';
  // Room/building line plus the street ("Staatsoper, Unter den Linden 7"); postcode lines are left out
  var loc = s.location ? String(s.location).split('\n') : [];
  var street = loc.find(function(l) { return /\d/.test(l) && !/^\d{5}\b/.test(l); });
  var addr = [loc[0], street].filter(function(x, i, a) { return x && a.indexOf(x) === i; }).join(', ');
  return '<div class="wp-hero-label">Nächster Einsatz · ' + when + '</div>' +
    '<div class="ui-hero" onclick="wpToggle(this)" role="button" tabindex="0" aria-expanded="false">' +
      '<div class="wp-head"><div class="wp-hero-date">' + wpDayLabel(s.date) + '</div><div class="wp-badges">' + wpStatusPill(s) +
        '<span class="ui-pill ui-pill-info">Du' + (mine && mine.role && mine.role !== 'MA' ? ' · ' + wpEsc(mine.role) : '') + '</span></div></div>' +
      '<div class="wp-hero-time">' + wpEsc(tc.big) + (tc.small ? ' <span>' + wpEsc(tc.small) + '</span>' : '') + '</div>' +
      '<div class="wp-hero-venue">' + wpEsc(s.venue || '—') + (head && head !== s.venue ? ' · ' + wpEsc(head) : '') + '</div>' +
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
    supabaseClient.rpc('user_directory'),
    supabaseClient.from('plan_name_aliases').select('alias, user_id'),
    supabaseClient.from('plan_weeks').select('*').order('week_start', { ascending: false })
  ]);
  if (u.error || a.error || w.error) {
    console.error('Wochenplan laden:', u.error || a.error || w.error);
    content.innerHTML = '<div class="wp-empty">Der Wochenplan konnte nicht geladen werden. Prüf deine Verbindung und öffne ihn erneut.</div>';
    return;
  }
  wpUsers = (u.data || []).slice().sort(function(x, y) { return (x.full_name || '').localeCompare(y.full_name || ''); });
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
  var mode = wpAvailMode(), availTab = document.getElementById('wp-tab-avail');
  if (availTab) availTab.hidden = !(mode.own || mode.grid);
  if (v === 'avail' && !(mode.own || mode.grid)) v = 'mine';
  wpView = v;
  ['mine', 'all', 'avail'].forEach(function(t) {
    var b = document.getElementById('wp-tab-' + t);
    if (!b) return;
    b.classList.toggle('active', v === t);
    b.setAttribute('aria-selected', v === t ? 'true' : 'false');
  });
  document.getElementById('wp-week-nav').style.display = v === 'all' ? 'flex' : 'none';
  document.getElementById('wp-days').style.display = v === 'all' ? 'flex' : 'none';
  if (v === 'mine') wpRenderMine(); else if (v === 'avail') wpRenderAvail(); else wpRenderWeek();
}

// Verfügbarkeit tab: own calendar (unlocked people) and/or the planner grid
async function wpRenderAvail() {
  var content = document.getElementById('wp-content'), mode = wpAvailMode(), today = localDateStr(), seq = ++_wpRenderSeq;
  content.innerHTML = '<div class="wp-empty">Lädt…</div>';
  var html = '';
  if (mode.own) {
    var r = await supabaseClient.from('availability').select('day, level').eq('user_id', wpMe()).gte('day', today);
    if (seq !== _wpRenderSeq) return;
    if (r.error) {
      console.error('Verfügbarkeit laden:', r.error);
      content.innerHTML = '<div class="wp-empty">Deine Verfügbarkeit konnte nicht geladen werden. Prüf deine Verbindung und öffne den Tab erneut.</div>';
      return;
    }
    wpAvailRows = {}; _wpAvailSaved = {};
    (r.data || []).forEach(function(x) { wpAvailRows[x.day] = x.level; });
    html += '<section aria-label="Meine Verfügbarkeit">' + wpAvailCalendarHtml(today) + '</section>';
  }
  if (mode.grid) html += '<section class="wp-av-planner" aria-label="Verfügbarkeit im Team" id="wp-av-planner"></section>';
  content.innerHTML = html;
  if (mode.grid) wpRenderAvailGrid(wpAvailGridMonday || wpAvailWeeks(today, 1)[0].monday);
}

function wpStepWeek(dir) {
  // wpWeeks is newest first → "next week" is the previous index
  var i = wpWeeks.findIndex(function(w) { return w.id === wpWeekId; });
  var n = wpWeeks[i - dir];
  if (n) { wpWeekId = n.id; wpRenderWeek(); }
}

// "Meine Schichten": accepted Aufträge not already on one of my plan shifts, then the ones I can still say "Ich kann" to
function wpMineOrdersHtml(slots, myShifts) {
  var me = wpMe(), role = typeof userRole !== 'undefined' ? userRole : null, today = localDateStr();
  var att = ordAttachSlots(slots, myShifts), onMine = {};
  Object.keys(att.bySid).forEach(function(id) { att.bySid[id].forEach(function(sl) { onMine[sl.job_no + sl.phase] = true; }); });
  var accepted = slots.filter(function(sl) { return sl.my_status === 'angenommen' && !onMine[sl.job_no + sl.phase]; });
  var open = slots.filter(function(sl) {
    return !onMine[sl.job_no + sl.phase] && (sl.my_status === 'offen' || ordCanApply(sl, me, today, role, null));
  });
  var card = function(sl) { return wpOrderCard(sl, { showDate: true }); };
  return (accepted.length ? '<div class="ui-label">Angenommen über Auftrag</div>' + accepted.map(card).join('') : '') +
    (open.length ? '<div class="ui-label">Offene Aufträge</div>' + open.map(card).join('') : '');
}

async function wpRenderMine() {
  var content = document.getElementById('wp-content');
  if (!wpMe()) return;
  var seq = ++_wpRenderSeq;
  // From yesterday on: a night shift (Abbau 0.30 Uhr) of the day before is still running after midnight (planShiftOrder filters)
  var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  var from = localDateStr(yesterday);
  var [mineRes, slots] = await Promise.all([
    supabaseClient.from('plan_assignments')
      .select('shift:plan_shifts!inner(*, plan_assignments(*), plan_weeks(kw))')
      .eq('user_id', wpMe())
      .gte('shift.date', from),
    wpLoadSlots()
  ]);
  var data = mineRes.data, error = mineRes.error;
  // The user switched tab/week or another render started meanwhile → drop this result
  if (seq !== _wpRenderSeq || wpView !== 'mine') return;
  if (error) { console.error('Meine Schichten:', error); content.innerHTML = '<div class="wp-empty">Deine Schichten konnten nicht geladen werden.</div>'; return; }
  var seen = {};
  var shifts = planShiftOrder((data || []).map(function(r) { return r.shift; })
    .filter(function(s) { if (!s || seen[s.id]) return false; seen[s.id] = true; return true; }), new Date(), true);
  shifts.forEach(function(s) { _wpShiftCache[s.id] = s; });
  _wpSlots = slots;
  var orderHtml = wpMineOrdersHtml(slots || [], shifts);
  if (!shifts.length) {
    content.innerHTML = '<div class="wp-empty"><div class="wp-empty-title">Keine anstehenden Schichten</div>' +
      'Sobald du im Wochenplan eingeteilt bist, steht dein nächster Einsatz hier.' +
      (wpWeeks.length ? '<br><button type="button" class="btn wp-empty-btn" onclick="wpSetView(\'all\')">Ganze Woche ansehen</button>' : '') + '</div>' + orderHtml;
    return;
  }
  _wpMineShifts = shifts;
  content.innerHTML = wpHero(shifts[0]) +
    (shifts.length > 1 ? '<div class="ui-label">Danach</div>' + shifts.slice(1).map(function(s) { return wpRow(s, { showDate: true }); }).join('') : '') +
    orderHtml +
    '<button type="button" class="ui-btn wp-cal-btn" onclick="wpCalendarSheet()">' + uiIcon('calendar') + ' In Kalender übernehmen</button>' +
    '<div class="ui-sub wp-cal-hint" id="wp-cal-hint">Nach Planänderungen erneut tippen – vorhandene Einträge werden aktualisiert.</div>';
  // With a subscription link the calendar updates itself → say so (hint stays as is without a token)
  wpLoadCalendarToken().then(function(token) {
    var hint = document.getElementById('wp-cal-hint');
    if (token && hint && seq === _wpRenderSeq) hint.textContent = 'Abonniert – Planänderungen kommen automatisch (Android/Google: kann bis zu einem Tag dauern)';
  });
}

// ── Calendar subscription: feed URL of the Edge Function calendar-feed (token = app_users.calendar_token) ──
function wpCalendarUrls(supabaseUrl, token) {
  if (!token) return null;
  var https = supabaseUrl + '/functions/v1/calendar-feed?t=' + token + '.ics';
  var webcal = 'webcal://' + https.replace(/^https?:\/\//, '');
  return { https: https, webcal: webcal, google: 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal) };
}

// iPhone/iPad, also iPadOS with a desktop user agent ("MacIntel" with a touch screen)
function wpIsIos(ua, platform, touchPoints) {
  return /iPad|iPhone|iPod/.test(ua || '') || (platform === 'MacIntel' && touchPoints > 1);
}

function wpCalendarMenuItems(hasToken) {
  var download = { label: 'Datei herunterladen', action: 'wpDownloadCalendar' };
  if (!hasToken) return [{ label: 'In Kalender übernehmen (Datei)', action: 'wpDownloadCalendar' }];
  return [{ label: 'Kalender abonnieren', action: 'wpSubscribeCalendar' }, { label: 'Link kopieren', action: 'wpCopyCalendarLink' },
    download, { label: 'Neuen Link erzeugen', action: 'wpRenewCalendarToken', danger: true }];
}

var _wpCalToken = null; // { userId, token }
// Token of the current user; null when the column doesn't exist yet or the read fails (then only the download is offered)
async function wpLoadCalendarToken(force) {
  var me = wpMe();
  if (!me) return null;
  if (!force && _wpCalToken && _wpCalToken.userId === me) return _wpCalToken.token;
  try {
    var { data, error } = await supabaseClient.from('app_users').select('calendar_token').eq('id', me).maybeSingle();
    if (error || !data || !data.calendar_token) return null;
    _wpCalToken = { userId: me, token: data.calendar_token };
    return data.calendar_token;
  } catch (e) { return null; }
}

async function wpCalendarSheet() {
  var token = await wpLoadCalendarToken();
  openUiMenu(wpCalendarMenuItems(!!token));
}

async function wpCalendarLinks() {
  return wpCalendarUrls(SUPABASE_URL, await wpLoadCalendarToken());
}

async function wpSubscribeCalendar() {
  var urls = await wpCalendarLinks();
  if (!urls) { showToast('Abo-Link nicht verfügbar', 'danger'); return; }
  if (wpIsIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)) location.href = urls.webcal;
  else window.open(urls.google, '_blank');
}

async function wpCopyCalendarLink() {
  var urls = await wpCalendarLinks();
  if (!urls) { showToast('Abo-Link nicht verfügbar', 'danger'); return; }
  try {
    await navigator.clipboard.writeText(urls.https);
    showToast('Link kopiert', 'success');
  } catch (e) {
    prompt('Link zum Abonnieren kopieren:', urls.https);
  }
}

async function wpRenewCalendarToken() {
  if (!confirm('Der alte Link funktioniert dann nicht mehr; abonnierte Kalender müssen neu abonniert werden. Neuen Link erzeugen?')) return;
  var me = wpMe();
  if (!me) return;
  var { data: token, error } = await supabaseClient.rpc('renew_calendar_token');
  if (error || !token) { console.error('Kalender-Link erneuern:', error); showToast('Neuer Link konnte nicht erzeugt werden', 'danger'); return; }
  _wpCalToken = { userId: me, token: token };
  showToast('Neuer Link erzeugt', 'success');
}

// Download of the upcoming own shifts as .ics; re-importing updates entries (UID from the plan key)
var _wpMineShifts = [];
function wpDownloadCalendar() {
  if (!_wpMineShifts.length) return;
  var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  var blob = new Blob([planIcs(_wpMineShifts, wpMe(), stamp)], { type: 'text/calendar;charset=utf-8' });
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'Luebbert-Schichten.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
  showToast(_wpMineShifts.length + (_wpMineShifts.length === 1 ? ' Schicht' : ' Schichten') + ' für den Kalender exportiert', 'success');
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
  var [res, iq, slots] = await Promise.all([
    supabaseClient.from('plan_shifts').select('*, plan_assignments(*)').eq('week_id', week.id).order('date').order('sort'),
    supabaseClient.from('plan_shift_interest').select('shift_key, user_id').eq('week_id', week.id),
    wpLoadSlots()
  ]);
  var data = res.data, error = res.error;
  if (seq !== _wpRenderSeq || wpView !== 'all' || wpWeekId !== week.id) return;
  if (error) { console.error('Woche laden:', error); content.innerHTML = '<div class="wp-empty">Die Woche konnte nicht geladen werden.</div>'; return; }
  if (iq.error) console.error('Interesse laden:', iq.error); // plan still shows, just no buttons/list
  (data || []).forEach(function(s) {
    s._interest = iq.error ? null : (iq.data || []).filter(function(r) { return r.shift_key === s.key; }).map(function(r) { return r.user_id; });
  });
  (data || []).forEach(function(s) { _wpShiftCache[s.id] = s; });
  _wpSlots = slots;
  var att = ordAttachSlots(slots || [], data || []), orderByDay = {};
  (data || []).forEach(function(s) { s._orders = att.bySid[s.id] || []; });
  att.unlinked.forEach(function(sl) {
    var d = ordSlotDate(sl);
    if (d >= week.week_start && d <= week.week_end) (orderByDay[d] = orderByDay[d] || []).push(sl);
  });
  var byDay = {};
  (data || []).forEach(function(s) { (byDay[s.date] = byDay[s.date] || []).push(s); });
  wpRenderDays(week, byDay);
  var html = slots === null ? '<div class="ui-sub wp-ord-fail">Aufträge konnten nicht geladen werden.</div>' : '';
  // Entries with kind 'unassigned' only drive the push ("nicht mehr eingeteilt"); that shift still exists
  var gone = (week.removed || []).filter(function(r) { return r.kind !== 'unassigned'; });
  if (gone.length) {
    html += '<div class="wp-removed"><div class="wp-removed-title">Entfallen seit dem letzten Stand</div>' +
      gone.map(function(r) { return '<div>' + wpDayLabel(r.date) + ' · ' + wpEsc(r.venue) + (planShiftHeading(r) ? ' – ' + wpEsc(planShiftHeading(r)) : '') + '</div>'; }).join('') + '</div>';
  }
  html += wpInterestOverview(data || []);
  Object.keys(Object.assign({}, byDay, orderByDay)).sort().forEach(function(d) {
    var p = wpParts(d), list = byDay[d] || [], orders = orderByDay[d] || [], n = list.length + orders.length;
    html += '<div class="wp-dayhead" id="wp-day-' + d + '">' + WP_WEEKDAYS_LONG[p.dow] + ' <span>' + ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '. · ' +
      n + (n === 1 ? ' Einsatz' : ' Einsätze') + '</span></div>' +
      list.map(function(s) { return wpRow(s); }).join('') + orders.map(function(sl) { return wpOrderCard(sl); }).join('');
  });
  content.innerHTML = html || '<div class="wp-empty">Keine Einsätze in dieser Woche.</div>';
}

function wpStartProtokoll(shiftId) {
  var s = _wpShiftCache[shiftId];
  if (!s) return;
  var parsed = planShiftFromDb(s);
  openProtokollPrefilled({
    event: planEventName(parsed), date: s.date, action: planGuessAction(parsed.wann),
    alId: wpMe(), location: [s.venue].concat(parsed.location.slice(0, 1)).filter(Boolean).join(', '), shift: parsed
  });
}

// ── Aufträge (order_slots): "Ich kann" on phases from the Auftragsbestätigungen; PL accepts in auftraege.js ──
var _wpSlots = null; // last order_slots() result; null = not loaded / failed

async function wpLoadSlots() {
  try {
    var r = await supabaseClient.rpc('order_slots');
    if (r.error) throw r.error;
    return r.data || [];
  } catch (err) {
    console.error('Aufträge laden:', err); // the plan still shows, just without the Auftrag blocks
    return null;
  }
}

var WP_PHASE = { setup: 'Aufbau', teardown: 'Abbau' };

function wpSlotTime(t) { return t && t.length > 10 ? t.slice(11, 16) : ''; }

// Auftrag info and the "Ich kann" button for one phase; planShift = Daniel's linked entry or null
function wpOrderBlock(slot, planShift) {
  var me = wpMe(), role = typeof userRole !== 'undefined' ? userRole : null;
  var free = Math.max(0, slot.needed - ordTakenCount(slot, planShift));
  var mats = slot.materials || [], count = mats.reduce(function(n, g) { return n + (g.items || []).length; }, 0);
  var args = "'" + jsAttrArg(slot.job_no) + "', '" + slot.phase + "'";
  var action = slot.my_status === 'angenommen' ? '<span class="ui-pill ui-pill-ok">Angenommen ✓</span>'
    : slot.my_status === 'abgelehnt' ? '<span class="ui-pill">Abgelehnt</span>'
    : slot.my_status === 'offen' ? '<span class="ui-pill ui-pill-info">Beworben</span> <button type="button" class="btn wp-prot-btn" onclick="event.stopPropagation(); wpOrderApply(' + args + ', false)">Zurückziehen</button>'
    : ordCanApply(slot, me, localDateStr(), role, planShift) ? '<button type="button" class="btn primary wp-prot-btn" onclick="event.stopPropagation(); wpOrderApply(' + args + ', true)">Ich kann</button>' : '';
  return '<div class="wp-ord-block" onclick="event.stopPropagation()">' +
    '<div class="wp-ord-line"><b>Auftrag ' + wpEsc(slot.job_no) + '</b> · ' + WP_PHASE[slot.phase] + ' · ' + slot.needed + ' MA · ' + free + ' offen</div>' +
    (count ? '<details class="wp-ord-more"><summary>Material (' + count + ')</summary>' + mats.map(function(g) {
      return '<div class="wp-ord-group">' + wpEsc(g.group) + '</div><ul>' + (g.items || []).map(function(it) {
        return '<li><b>' + it.qty + '×</b> ' + wpEsc(it.name) + '</li>'; }).join('') + '</ul>';
    }).join('') + '</details>' : '') +
    (slot.notes ? '<details class="wp-ord-more"><summary>Hinweise</summary><div>' + wpEsc(slot.notes).replace(/\n/g, '<br>') + '</div></details>' : '') +
    (action ? '<div class="wp-ord-action">' + action + '</div>' : '') +
  '</div>';
}

// Phase without an entry in Daniel's plan: its own row
function wpOrderCard(slot, opts) {
  var venue = ordSlotVenue(slot.title);
  return '<div class="ui-row wp-ord-row">' +
    '<div class="wp-time"><b>' + wpEsc(wpSlotTime(slot.start_at) || '—') + '</b><span>' + WP_PHASE[slot.phase] + '</span></div>' +
    '<div class="wp-main">' +
      '<div class="wp-head"><div class="wp-venue">' + wpEsc(venue ? venue.charAt(0).toUpperCase() + venue.slice(1) : '—') + '</div>' +
        '<div class="wp-badges"><span class="ui-pill ui-pill-warn">Auftrag</span></div></div>' +
      '<div class="wp-sub">' + (opts && opts.showDate ? wpDayLabel(ordSlotDate(slot)) + ' · ' : '') +
        wpEsc([slot.name, slot.room].filter(Boolean).join(' · ')) + '</div>' +
      wpOrderBlock(slot, null) +
    '</div></div>';
}

async function wpOrderApply(jobNo, phase, on) {
  var me = wpMe(), slot = (_wpSlots || []).find(function(x) { return x.job_no === jobNo && x.phase === phase; });
  if (!me || !slot) return;
  try {
    var q = supabaseClient.from('order_applications');
    var r = on ? await q.insert({ job_no: jobNo, phase: phase, user_id: me }).select('job_no')
      : await q.delete().eq('job_no', jobNo).eq('phase', phase).eq('user_id', me).eq('status', 'offen').select('job_no');
    if (r.error || !r.data || !r.data.length) throw r.error || new Error(on ? 'nicht gespeichert' : 'schon entschieden');
    slot.my_status = on ? 'offen' : null;
    showToast(on ? 'Gemeldet. Die PL meldet sich, wenn du eingeteilt bist.' : 'Zurückgezogen.', 'success');
  } catch (err) {
    console.error('Auftrag melden:', err);
    showToast(on ? 'Nicht gespeichert. Prüf deine Verbindung.' : 'Nicht zurückgezogen – vielleicht hat die PL schon entschieden.', 'danger');
    return;
  }
  if (wpView === 'all') wpRenderWeek(); else if (wpView === 'mine') wpRenderMine();
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
  // Same KW, or a stored week covering most of the same days (imported under an older KW rule)
  var { data: cand, error } = await supabaseClient.from('plan_weeks')
    .select('id, year, kw, week_start, week_end')
    .or('and(year.eq.' + parsed.year + ',kw.eq.' + parsed.kw + '),and(week_start.lte.' + parsed.weekEnd + ',week_end.gte.' + parsed.weekStart + ')');
  var ex = null;
  if (!error) {
    var pick = planPickExistingWeek(cand || [], parsed);
    if (pick) {
      var full = await supabaseClient.from('plan_weeks').select('*, plan_shifts(*, plan_assignments(*))').eq('id', pick.id).maybeSingle();
      error = full.error; ex = full.data || null;
    }
  }
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
    '<div class="ui-card">' +
      '<div class="wp-hero-date">KW ' + p.kw + ' <span class="wp-sub-inline">' + wpDayLabel(p.weekStart) + ' – ' + wpDayLabel(p.weekEnd) + '</span></div>' +
      '<div class="wp-sub">' + p.shifts.length + ' Einsätze aus „' + wpEsc(wpImport.fileName) + '“. Telefonnummern werden nicht gespeichert.</div>' +
      diffInfo +
      (p.warnings.length ? '<div class="wp-warn-text">' + p.warnings.map(wpEsc).join('<br>') + '</div>' : '') +
    '</div>' +
    (names.length ? '<div class="ui-card"><div class="wp-card-title">Namen zuordnen</div>' +
      '<div class="wp-sub" style="margin-bottom:10px;">Die App merkt sich deine Auswahl für die nächsten Pläne.</div>' + nameRows + '</div>' : '') +
    '<div class="ui-label">Vorschau</div>' + preview;
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
  var insertedIds = [], createdWeekId = null, committed = false, oldNotDeleted = false;
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
      // RLS answers a blocked delete with 0 rows and no error: count them, or every shift would exist twice
      var del = await supabaseClient.from('plan_shifts').delete().in('id', oldShifts.map(function(s) { return s.id; })).select('id');
      if (del.error || !del.data || del.data.length !== oldShifts.length) {
        console.error('Alte Einsätze löschen:', del.error || ((del.data ? del.data.length : 0) + ' von ' + oldShifts.length + ' gelöscht'));
        oldNotDeleted = true;
      }
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
    if (oldNotDeleted) showToast('Die alten Einsätze der Woche konnten nicht gelöscht werden – Einsätze erscheinen doppelt. Bitte beim Admin melden.', 'danger');
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
    var d = await supabaseClient.from('plan_shifts').delete().in('id', shiftIds).select('id');
    if (d.error || !d.data || d.data.length !== shiftIds.length) {
      console.error('Rückgängig (Einsätze):', d.error || ((d.data ? d.data.length : 0) + ' von ' + shiftIds.length + ' gelöscht'));
      showToast('Rückgängig machen fehlgeschlagen: Einsätze der Woche sind evtl. doppelt. Bitte beim Admin melden.', 'danger');
    }
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
