/* Besetzungsplaner (test build): the weekly plan is drafted in the app instead of Excel.
 * A draft (plan_draft_weeks / plan_draft_shifts) is only seen by planners ("Plant den Wochenplan", Admin) and PLs.
 * Publishing turns the draft into the object planParse() returns for a PDF and hands it to the existing preview and
 * save of wochenplan.js (wpRenderImport / wpSaveImport), so everything that reads plan_weeks/plan_shifts stays as it is.
 * Rows come from the Auftrag phases of the week (order_slots) or are free entries; every week starts empty.
 * Pure helpers first (node --test tests/planer.test.js); the DOM part follows below. Styles: .pl-* in css/ui.css. */

var PL_DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
var PL_DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
var PL_PHASE = { setup: 'Aufbau', teardown: 'Abbau' };
var PL_ROLES = ['MA', 'AL', 'Fahrer', 'Deko', 'Zenjob', 'ROCKiT'];
var PL_AGENCY = ['Zenjob', 'ROCKiT'];
var PL_NO_CANDIDATE = ['Gast', 'Buchhaltung']; // never offered for a shift
var PL_WEEKS_AHEAD = 5;
// Art eines Einsatzes, mit der Zeilenfarbe aus Daniels Plänen (Jenni): weiß = Auftragsbestätigung, blau = Angebot (kann noch
// wegfallen), gelb = intern und alles weitere, grün = Busfahrt. `color` is what gets published as plan_shifts.color.
var PL_KINDS = {
  auftrag: { label: 'Auftrag', long: 'Auftrag (bestätigt)', color: null },
  angebot: { label: 'Angebot', long: 'Angebot (kann noch wegfallen)', color: '#8db4e2' },
  intern: { label: 'Intern', long: 'Intern oder Sonstiges', color: '#ffff00' },
  bus: { label: 'Busfahrt', long: 'Busfahrt', color: '#00b050' }
};
var PL_KIND_ORDER = ['auftrag', 'angebot', 'intern', 'bus'];

// Row colour of a plan entry → Art. Works on the hue, so Daniel's shades of blue and green are recognised as well;
// no colour (white, grey header) = Auftrag, any other colour (yellow, pink, lilac) = intern.
function plKindOfColor(hex) {
  var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!m) return 'auftrag';
  var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 20) return 'auftrag'; // white and greys
  if (b > r + 30 && b >= g - 10) return 'angebot';
  if (g > r + 30 && g > b + 30) return 'bus';
  return 'intern';
}

// Art of a draft row. Rows loaded before the column exists carry no `kind` key at all: null, nothing is coloured.
// With the column an unset Art is an Auftrag (white, the normal case); everything else is chosen on purpose.
function plKind(row) {
  if (!row || !('kind' in row)) return null;
  return PL_KINDS[row.kind] ? row.kind : 'auftrag';
}

function plUtc(iso) { var p = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); }
function plIso(d) { return d.toISOString().slice(0, 10); }
function plAddDays(iso, n) { var d = plUtc(iso); d.setUTCDate(d.getUTCDate() + n); return plIso(d); }

// Monday of the ISO week a day falls in
function plMonday(iso) {
  var d = plUtc(iso);
  return plAddDays(iso, -((d.getUTCDay() + 6) % 7));
}

function plWeekOf(monday) {
  var w = planIsoWeek(monday);
  return { year: w.year, kw: w.week, weekStart: monday, weekEnd: plAddDays(monday, 6) };
}

// "Mi 11.11."
function plDayShort(iso) {
  var d = plUtc(iso);
  return PL_DAYS_SHORT[d.getUTCDay()] + ' ' + d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.';
}

function plLines(t) { return t ? String(t).split('\n').map(function(s) { return s.trim(); }).filter(Boolean) : []; }
function plText(v) { var s = v == null ? '' : String(v).trim(); return s || null; }

// Name as Daniel writes it: first name, plus the surname initial when two active people share the first name
function plShortName(user, users) {
  var parts = String((user && user.full_name) || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  var twice = (users || []).some(function(u) {
    return u.id !== user.id && u.is_active !== false && u.role !== 'Gast' &&
      String(u.full_name || '').trim().split(/\s+/)[0].toLowerCase() === parts[0].toLowerCase();
  });
  return twice && parts[1] ? parts[0] + ' ' + parts[1].charAt(0).toUpperCase() + '.' : parts[0];
}

// "Aufbau: 09:00 - 16:00 Uhr" (planWhen reads it back); an end on another day is left out
function plWannText(phase, startAt, endAt) {
  var label = PL_PHASE[phase] || '', s = String(startAt || ''), e = String(endAt || '');
  if (s.length <= 10) return label;
  var t = s.slice(11, 16);
  if (e.length > 10 && e.slice(0, 10) === s.slice(0, 10)) t += ' - ' + e.slice(11, 16);
  return (label ? label + ': ' : '') + t + ' Uhr';
}

// One Auftrag phase (order_slots row) → a new draft row; accepted Meldungen are placed right away
function plRowFromSlot(slot, week, users) {
  var title = String(slot.title || ''), event = title.split('_').slice(2).join(' ').trim();
  var people = [];
  (Array.isArray(slot.accepted_ids) ? slot.accepted_ids : []).forEach(function(id) {
    var u = (users || []).find(function(x) { return x.id === id && x.is_active !== false; });
    if (u && !people.some(function(p) { return p.user_id === id; })) people.push({ user_id: id, name: plShortName(u, users), role: 'MA', note: null });
  });
  return {
    year: week.year, kw: week.kw, date: ordSlotDate(slot), sort: 0, job_no: slot.job_no, phase: slot.phase,
    venue: ordVenueLabel(title) || plText(title), location: plText([event, slot.room].filter(Boolean).join('\n')),
    title: plText(slot.name), details: null, wann: plText(plWannText(slot.phase, slot.start_at, slot.end_at)),
    ap: null, ap_user_id: null, notes: null, need: slot.needed == null ? 0 : slot.needed, people: people, kind: 'auftrag'
  };
}

// Draft rows against the Auftrag phases of the week. Existing rows are never removed and keep people and texts;
// only the day and the MA number follow the Auftrag (both are maintained in Aufträge / the project folder).
// slots === null (not loaded) changes nothing.
function plMergeSlots(rows, slots, week, users) {
  var out = { add: [], patch: [], stale: [] };
  if (!slots) return out;
  var inWeek = {}, any = {};
  slots.forEach(function(s) {
    var d = ordSlotDate(s), k = s.job_no + '|' + s.phase;
    any[k] = true;
    if (d >= week.weekStart && d <= week.weekEnd) inWeek[k] = s;
  });
  var have = {};
  (rows || []).forEach(function(r) {
    if (!r.job_no) return;
    var k = r.job_no + '|' + r.phase, s = inWeek[k];
    have[k] = true;
    if (!s) { out.stale.push(r.id); return; }
    var ch = {}, d = ordSlotDate(s);
    if (d !== r.date) ch.date = d;
    if (s.needed != null && s.needed !== r.need) ch.need = s.needed;
    if (Object.keys(ch).length) out.patch.push({ id: r.id, changes: ch });
  });
  Object.keys(inWeek).forEach(function(k) { if (!have[k]) out.add.push(plRowFromSlot(inWeek[k], week, users)); });
  out.add.sort(function(a, b) { return a.date.localeCompare(b.date) || String(a.job_no).localeCompare(String(b.job_no)) || (a.phase === 'setup' ? -1 : 1); });
  return out;
}

function plIsDriver(p) { return !!p && p.role === 'Fahrer'; }

// People on MA places: drivers are on the shift but never fill one (same rule as ordAssignedIds)
function plFilled(row) {
  return ((row && row.people) || []).filter(function(p) { return !plIsDriver(p); }).length;
}

// Open places of a row as the plan stores them: MA places still missing, then the open places of other kinds
// (open_other: a missing driver, "2 x Zenjob" taken over from an uploaded plan)
function plOpenSlots(row) {
  var left = (row && row.need ? row.need : 0) - plFilled(row);
  return (left > 0 ? [{ role: 'MA', count: left, note: null }] : []).concat(plOpenOther(row));
}

function plOpenOther(row) {
  return (Array.isArray(row && row.open_other) ? row.open_other : []).filter(function(o) { return o && o.role && parseInt(o.count, 10) > 0; })
    .map(function(o) { return { role: o.role, count: parseInt(o.count, 10), note: o.note || null }; });
}

// open_other after someone was placed in `role`: one place of that kind is taken (null = nothing to change)
function plTakeOpen(row, role) {
  var list = plOpenOther(row), i = list.findIndex(function(o) { return o.role === role; });
  if (i === -1) return null;
  list[i] = Object.assign({}, list[i], { count: list[i].count - 1 });
  return list.filter(function(o) { return o.count > 0; });
}

// open_other with the number of missing drivers set to n (the sheet's "Fahrer gebraucht")
function plSetOpen(row, role, n) {
  var list = plOpenOther(row).filter(function(o) { return o.role !== role; });
  n = Math.max(0, Math.min(9, parseInt(n, 10) || 0));
  return n ? list.concat([{ role: role, count: n, note: null }]) : list;
}

// Published plan rows (plan_shifts with plan_assignments) → draft rows. Open places count into the need.
function plRowsFromPlan(planShifts, week) {
  return (planShifts || []).map(function(s) {
    var people = (s.plan_assignments || []).map(function(a) {
      return { user_id: a.user_id || null, name: a.name, role: a.role || 'MA', note: a.note || null };
    });
    // MA places count into the need; every other open place (driver, agency) is kept as it is
    var slots = (s.open_slots || []).filter(function(o) { return o && parseInt(o.count, 10) > 0; });
    var open = slots.filter(function(o) { return (o.role || 'MA') === 'MA'; }).reduce(function(n, o) { return n + parseInt(o.count, 10); }, 0);
    var other = slots.filter(function(o) { return (o.role || 'MA') !== 'MA'; })
      .map(function(o) { return { role: o.role, count: parseInt(o.count, 10), note: o.note || null }; });
    return {
      year: week.year, kw: week.kw, date: s.date, sort: s.sort || 0, job_no: null, phase: null,
      venue: plText(s.venue), location: plText(s.location), title: plText(s.title), details: plText(s.details), wann: plText(s.wann),
      ap: plText(s.ap), ap_user_id: s.ap_user_id || null, notes: plText(s.notes),
      need: people.filter(function(p) { return !plIsDriver(p); }).length + open, people: people, kind: plKindOfColor(s.color), open_other: other
    };
  });
}

// First draft of a week: the published plan (if any) with the Auftrag phases laid on the entries they belong to
// (ordAttachSlots: manual link or match by day, place and words); phases without an entry become rows of their own.
function plSeed(planShifts, slots, week, users) {
  var rows = plRowsFromPlan(planShifts, week), used = {};
  var mine = (slots || []).filter(function(s) { var d = ordSlotDate(s); return d >= week.weekStart && d <= week.weekEnd; });
  var att = ordAttachSlots(mine, planShifts || []), rest = att.unlinked.slice();
  (planShifts || []).forEach(function(p, i) {
    (att.bySid[p.id] || []).forEach(function(s, j) {
      var k = s.job_no + '|' + s.phase;
      if (j === 0 && !used[k]) {
        used[k] = true;
        rows[i].job_no = s.job_no; rows[i].phase = s.phase;
        if (s.needed != null) rows[i].need = s.needed;
      } else rest.push(s);
    });
  });
  rest.forEach(function(s) {
    var k = s.job_no + '|' + s.phase;
    if (!used[k]) { used[k] = true; rows.push(plRowFromSlot(s, week, users)); }
  });
  return rows;
}

function plRowTime(row) { return planWhen(plLines(row.wann)).time || '99:99'; }

function plSorted(rows) {
  return (rows || []).map(function(r, i) { return { r: r, i: i }; }).sort(function(a, b) {
    return String(a.r.date).localeCompare(String(b.r.date)) || plRowTime(a.r).localeCompare(plRowTime(b.r)) ||
      ((a.r.sort || 0) - (b.r.sort || 0)) || (a.i - b.i);
  }).map(function(x) { return x.r; });
}

// Draft → { year, kw, weekStart, weekEnd, shifts, warnings } exactly as planParse builds it from a PDF.
// A person keeps the user id only while that user is active; otherwise the stored name is published.
function plToParsed(week, rows, users) {
  var active = {}, seen = {};
  (users || []).forEach(function(u) { if (u.is_active !== false && u.role !== 'Gast') active[u.id] = true; });
  var shifts = plSorted(rows).map(function(r, i) {
    var s = {
      date: r.date, venue: r.venue || '', location: plLines(r.location), title: r.title || '', details: plLines(r.details),
      wann: plLines(r.wann), ap: plText(r.ap), apUserId: r.ap_user_id && active[r.ap_user_id] ? r.ap_user_id : null,
      notes: plLines(r.notes), color: plKind(r) ? PL_KINDS[plKind(r)].color : null, open: plOpenSlots(r), sort: i,
      people: (r.people || []).filter(function(p) { return p && plText(p.name); }).map(function(p) {
        return { name: String(p.name).trim(), role: p.role || 'MA', note: p.note || null, userId: p.user_id && active[p.user_id] ? p.user_id : null };
      }),
      jobNo: r.job_no || null, phase: r.phase || null, rowId: r.id || null
    };
    var key = planShiftKey(s);
    seen[key] = (seen[key] || 0) + 1;
    s.key = seen[key] > 1 ? key + '#' + seen[key] : key;
    return s;
  });
  return { year: week.year, kw: week.kw, weekStart: week.weekStart, weekEnd: week.weekEnd, shifts: shifts, warnings: [] };
}

// Who could still go on a row. avail: 'userId|day' → 'nein' | 'notfall'; applied: userId → status of a Meldung for this row;
// tracked: userId → true for people who keep their Verfügbarkeit (availability_people()), so a day without a block means "hat Zeit".
// Order: people who said "Ich kann", people who have time according to their Verfügbarkeit, everyone we know nothing about,
// "nur im Notfall", already planned that day, "geht nicht".
function plCandidates(row, rows, users, avail, applied, tracked) {
  var on = {}, busy = {};
  ((row && row.people) || []).forEach(function(p) { if (p.user_id) on[p.user_id] = true; });
  (rows || []).forEach(function(r) {
    if (r === row || r.id === row.id || r.date !== row.date) return;
    (r.people || []).forEach(function(p) { if (p.user_id) busy[p.user_id] = true; });
  });
  var list = (users || []).filter(function(u) {
    return u.is_active !== false && PL_NO_CANDIDATE.indexOf(u.role) === -1 && !on[u.id];
  }).map(function(u) {
    var st = applied && applied[u.id];
    var level = (avail && avail[u.id + '|' + row.date]) || null;
    return { id: u.id, name: plShortName(u, users), applied: st === 'offen' || st === 'angenommen' ? st : null,
      level: level, busy: !!busy[u.id], free: !!(tracked && tracked[u.id]) && !level && !busy[u.id] };
  });
  var rank = function(c) { return c.applied ? 0 : c.level === 'nein' ? 5 : c.busy ? 4 : c.level === 'notfall' ? 3 : c.free ? 1 : 2; };
  return list.sort(function(a, b) {
    return rank(a) - rank(b) || (a.applied === b.applied ? 0 : a.applied === 'angenommen' ? -1 : b.applied === 'angenommen' ? 1 : 0) ||
      a.name.localeCompare(b.name, 'de');
  });
}

/* ── Meldungen ("Ich kann") ↔ draft rows ──
 * Two sources: order_applications (Auftrag phase, keyed job_no|phase) and plan_shift_interest (an entry of the published
 * plan with open places, keyed by plan week + shift key). A draft row finds its published entry by the key plToParsed gives it. */

// Draft row id → the key its entry has (or will have) in the published plan
function plRowKeys(week, rows, users) {
  var out = {};
  plToParsed(week, rows, users).shifts.forEach(function(s) { if (s.rowId) out[s.rowId] = s.key; });
  return out;
}

// userId → status of that person's Meldung for a row. apps: 'job_no|phase' → {userId: status}; interest: shift key → {userId: status}.
// With one in each source the stronger answer counts: angenommen, then offen, then abgelehnt.
function plAppliedFor(row, key, apps, interest) {
  var out = {}, rank = { abgelehnt: 1, offen: 2, angenommen: 3 };
  [row && row.job_no ? (apps || {})[row.job_no + '|' + row.phase] : null, key ? (interest || {})[key] : null].forEach(function(m) {
    Object.keys(m || {}).forEach(function(uid) { if (!out[uid] || rank[m[uid]] > rank[out[uid]]) out[uid] = m[uid]; });
  });
  return out;
}

// People waiting for an answer on a row: an open Meldung and not placed yet
function plOpenMeldungen(row, applied) {
  var on = {};
  ((row && row.people) || []).forEach(function(p) { if (p.user_id) on[p.user_id] = true; });
  return Object.keys(applied || {}).filter(function(uid) { return applied[uid] === 'offen' && !on[uid]; }).length;
}

// The Meldung records of one person for a row that currently have status `from` (usually one, both sources when both exist)
function plMeldungTargets(row, key, planWeekId, apps, interest, userId, from) {
  var out = [];
  if (row && row.job_no && ((apps || {})[row.job_no + '|' + row.phase] || {})[userId] === from)
    out.push({ kind: 'order', job_no: row.job_no, phase: row.phase, user_id: userId });
  if (key && planWeekId && ((interest || {})[key] || {})[userId] === from)
    out.push({ kind: 'shift', week_id: planWeekId, shift_key: key, user_id: userId });
  return out;
}

// Search in the picker: every typed word must start a word of the short or full name ("pat st" finds Patryk Stańczyk);
// case and accents do not matter. An empty search matches everyone.
function plNorm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/ß/g, 'ss'); }
function plSearchMatch(query, name, fullName) {
  var words = plNorm(name + ' ' + (fullName || '')).split(/[^a-z0-9]+/).filter(Boolean);
  return plNorm(query).split(/[^a-z0-9]+/).filter(Boolean).every(function(q) {
    return words.some(function(w) { return w.indexOf(q) === 0; });
  });
}

// Role a person gets when placed: the one picked in the list; an app user is never booked as Zenjob/ROCKiT
function plPlaceRole(chosen, isAppUser) {
  if (PL_ROLES.indexOf(chosen) === -1) return 'MA';
  return isAppUser && PL_AGENCY.indexOf(chosen) !== -1 ? 'MA' : chosen;
}

// who = { id, role, plans } (plans = "Plant den Wochenplan"); same rules as the RLS on plan_draft_shifts
function plCanPublish(who) { return !!who && (who.role === 'Admin' || (!!who.plans && who.role !== 'Gast')); }
function plCanOpen(who) { return plCanPublish(who) || (!!who && who.role === 'PL'); }
function plCanEdit(row, who) {
  if (plCanPublish(who)) return true;
  return !!who && who.role === 'PL' && !!row && !!row.job_no && (!row.ap_user_id || row.ap_user_id === who.id);
}

function plPublishProblems(rows) {
  if (!rows || !rows.length) return ['Der Entwurf ist leer. Soll die Woche weg, nimm „Woche löschen“.'];
  return rows.filter(function(r) { return !plText(r.venue) && !plText(r.title); })
    .map(function(r) { return 'Ein Eintrag am ' + plDayShort(r.date) + ' hat weder Ort noch Titel.'; });
}

// The "Was" cell as Daniel writes it: one line per item. The first line is the heading of the entry (plan_shifts.title),
// the rest are its details; the sheet shows and edits them as one field.
function plWasText(row) { return [plText(row && row.title)].concat(plLines(row && row.details)).filter(Boolean).join('\n'); }
function plWasSplit(text) {
  var lines = plLines(text);
  return { title: lines[0] || null, details: lines.length > 1 ? lines.slice(1).join('\n') : null };
}

// A week counts as built in the app while the draft's published Stand is the plan's current one (a PDF upload bumps it)
function plIsAppWeek(draft, planWeek) {
  return !!draft && !!planWeek && draft.published_version != null && draft.published_version === planWeek.version;
}

// Rows as they can be inserted while a newer column does not exist yet (migrations besetzungsplaner_art, plan_change_fields)
function plWithoutKind(rows) { return plWithout(rows, ['kind']); }
function plWithout(rows, keys) {
  return (rows || []).map(function(r) { var c = Object.assign({}, r); (keys || []).forEach(function(k) { delete c[k]; }); return c; });
}

// New people array with the person added; null when the name is empty or the person is already on the row
function plAddPerson(row, person) {
  var name = plText(person && person.name), people = (row.people || []).slice();
  if (!name) return null;
  var dup = people.some(function(p) {
    return (person.user_id && p.user_id === person.user_id) || String(p.name || '').trim().toLowerCase() === name.toLowerCase();
  });
  if (dup) return null;
  people.push({ user_id: person.user_id || null, name: name, role: person.role || 'MA', note: plText(person.note) });
  return people;
}

function plRemovePerson(row, index) {
  return (row.people || []).filter(function(_, i) { return i !== index; });
}

// ── Absagen (plan_cancellations): cancels = { planKey: [userId] } of the open ones ──
// → [{ user_id, index, name }] for one row; index = place on the row, -1 when the person is no longer on it
function plCancelsOnRow(row, key, cancels, users) {
  if (!key || !cancels || !cancels[key]) return [];
  return cancels[key].map(function(uid) {
    var idx = ((row && row.people) || []).findIndex(function(p) { return p.user_id === uid; });
    var u = (users || []).find(function(x) { return x.id === uid; });
    return { user_id: uid, index: idx, name: idx !== -1 ? row.people[idx].name : (u ? u.full_name : 'Jemand') };
  });
}
// The replacement takes the place and the role of the person who cancelled; their time note does not carry over
function plReplacePerson(row, index, person) {
  var people = (row.people || []).slice(), old = people[index], name = plText(person && person.name);
  if (!old || !name) return null;
  if (people.some(function(p, i) { return i !== index && ((person.user_id && p.user_id === person.user_id) || String(p.name || '').trim().toLowerCase() === name.toLowerCase()); })) return null;
  people[index] = { user_id: person.user_id || null, name: name, role: old.role || 'MA', note: null };
  return people;
}
// Open Absagen whose shift is not a row of the draft (renamed or deleted since): listed in the head
function plUnmatchedCancels(keysByRow, cancels) {
  var known = {};
  Object.keys(keysByRow || {}).forEach(function(r) { known[keysByRow[r]] = true; });
  var out = [];
  Object.keys(cancels || {}).forEach(function(k) { if (!known[k]) cancels[k].forEach(function(uid) { out.push({ key: k, user_id: uid }); }); });
  return out;
}

// A save only applies to the row as it was loaded (0 rows back = someone else changed it meanwhile)
function plRowPatch(row, changes) {
  return { match: { id: row.id, updated_at: row.updated_at }, values: changes };
}

// Newest change in the draft (server timestamps); stored as published_at so later edits can be told apart
function plLastChange(rows) {
  var best = null;
  (rows || []).forEach(function(r) { if (r.updated_at && (!best || Date.parse(r.updated_at) > Date.parse(best))) best = r.updated_at; });
  return best;
}

// Rows changed after the draft was published (a deleted row leaves no trace and is not counted)
function plHasUnpublished(rows, publishedAt) {
  if (!publishedAt) return false;
  var t = Date.parse(publishedAt);
  return (rows || []).some(function(r) { return r.updated_at && Date.parse(r.updated_at) > t; });
}

// The "Wer" cell in Daniel's notation, so planParseWer reads an exported PDF back unchanged
function plWerLines(row) {
  var lines = [];
  (row.people || []).forEach(function(p) {
    var name = String(p.name || '').trim();
    if (!name) return;
    if (PL_AGENCY.indexOf(p.role) !== -1) {
      lines.push('1 x ' + p.role + (p.note ? ' (' + p.note + ')' : ''));
      lines.push(name);
    } else if (plIsDriver(p)) {
      lines.push(p.note ? p.note + ' | ' + name : name + ' (Fahrer)');
    } else {
      lines.push(name + (p.role && p.role !== 'MA' ? ' (' + p.role + ')' : '') + (p.note ? ' (' + p.note + ')' : ''));
    }
  });
  plOpenSlots(row).forEach(function(o) { lines.push(o.count + ' ' + o.role); });
  return lines;
}

// Rows of the PDF table: { day: 'Mittwoch 11.11.26' } headings and { cells: [datum, was, wann, wer, ap] } (each a list of lines)
function plPdfTable(week, rows) {
  var out = [], last = null;
  plSorted(rows).forEach(function(r) {
    if (r.date !== last) {
      var d = plUtc(r.date), two = function(n) { return ('0' + n).slice(-2); };
      out.push({ day: PL_DAYS[d.getUTCDay()] + ' ' + two(d.getUTCDate()) + '.' + two(d.getUTCMonth() + 1) + '.' + String(d.getUTCFullYear()).slice(-2) });
      last = r.date;
    }
    out.push({ cells: [
      [r.venue || ''].concat(plLines(r.location)).concat(plKind(r) === 'angebot' ? ['ANGEBOT'] : []).filter(Boolean),
      [r.title || ''].concat(plLines(r.details)).filter(Boolean),
      plLines(r.wann),
      plWerLines(r).concat(plLines(r.notes)),
      plLines(r.ap)
    ] });
  });
  return out;
}

/* ── DOM part (browser only) ── */

var plMondayIso = null;   // week on the board
var plSeq = 0;            // bumped per load; a slower earlier load must not overwrite a newer one
var plState = null;       // { week, draft, rows, planWeek, slots, avail, apps, stale }
var plOpenRow = null;     // row id whose "Person hinzufügen" list is open

function plWho() {
  return { id: (typeof wpMe === 'function') ? wpMe() : null, role: typeof userRole !== 'undefined' ? userRole : null, plans: !!window.currentUserPlansWeek };
}
function plE(s) { return escapeHtml(s == null ? '' : String(s)); }

// "Plant den Wochenplan" of the logged-in person. An error (migration not applied yet) hides the planner for everyone.
async function plLoadFlag() {
  try {
    var r = await supabaseClient.rpc('plans_week');
    window.plReady = !r.error;
    window.currentUserPlansWeek = !r.error && r.data === true;
  } catch (e) { window.plReady = false; window.currentUserPlansWeek = false; }
}

function plTabVisible() { return !!window.plReady && plCanOpen(plWho()); }

function plBounds() {
  var min = plMonday(localDateStr());
  return { min: min, max: plAddDays(min, PL_WEEKS_AHEAD * 7) };
}

function plStepWeek(dir) {
  var b = plBounds(), next = plAddDays(plMondayIso || b.min, dir * 7);
  if (next < b.min || next > b.max) return;
  plMondayIso = next; plOpenRow = null;
  plRender();
}

function plBox() { return document.getElementById('wp-content'); }

function plNavHtml(week, b) {
  var arrow = function(dir, label, off, path) {
    return '<button type="button" aria-label="' + label + '" onclick="plStepWeek(' + dir + ')"' + (off ? ' disabled' : '') +
      '><svg class="wp-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg></button>';
  };
  return '<div class="wp-av-planner-head"><div><div class="ui-label" style="margin:0;">Besetzungsplaner</div>' +
    '<b>KW ' + week.kw + ' · ' + plDayShort(week.weekStart).slice(3) + ' – ' + plDayShort(week.weekEnd).slice(3) + '</b></div>' +
    '<div class="wp-weeknav" style="display:flex;">' + arrow(-1, 'Vorige Woche', week.weekStart <= b.min, 'M14 6l-6 6 6 6') +
    arrow(1, 'Nächste Woche', week.weekStart >= b.max, 'M10 6l6 6-6 6') + '</div></div>';
}

async function plRender() {
  var box = plBox();
  if (!box) return;
  var b = plBounds();
  if (!plMondayIso || plMondayIso < b.min || plMondayIso > b.max) plMondayIso = b.min;
  var week = plWeekOf(plMondayIso), seq = ++plSeq, nav = plNavHtml(week, b);
  if (!plState || plState.week.weekStart !== week.weekStart) box.innerHTML = nav + '<div class="wp-empty">Lädt…</div>';
  var res;
  try {
    res = await Promise.all([
      supabaseClient.from('plan_draft_weeks').select('*').eq('year', week.year).eq('kw', week.kw).maybeSingle(),
      supabaseClient.from('plan_draft_shifts').select('*').eq('year', week.year).eq('kw', week.kw),
      supabaseClient.from('plan_weeks').select('id, version, file_name').eq('year', week.year).eq('kw', week.kw).maybeSingle(),
      wpLoadSlots(),
      supabaseClient.from('availability').select('user_id, day, level').gte('day', week.weekStart).lte('day', week.weekEnd),
      supabaseClient.from('order_applications').select('job_no, phase, user_id, status'),
      supabaseClient.rpc('availability_people'),
      supabaseClient.from('plan_draft_shifts').select('kind').limit(1),
      supabaseClient.from('plan_draft_shifts').select('open_other').limit(1)
    ]);
  } catch (e) { res = [{ error: e }]; }
  if (seq !== plSeq || wpView !== 'plan') return;
  if (res[0].error || res[1].error || res[2].error) {
    console.error('Besetzungsplaner laden:', res[0].error || res[1].error || res[2].error);
    box.innerHTML = nav + '<div class="wp-empty">Der Planer konnte nicht geladen werden. Prüf deine Verbindung.</div>';
    return;
  }
  var avail = {}, apps = {}, tracked = {};
  // All three are extras: without the right to read them the board still works, just without the hints
  ((res[4] && !res[4].error && res[4].data) || []).forEach(function(r) { avail[r.user_id + '|' + r.day] = r.level; });
  ((res[5] && !res[5].error && res[5].data) || []).forEach(function(a) {
    var k = a.job_no + '|' + a.phase;
    (apps[k] = apps[k] || {})[a.user_id] = a.status;
  });
  ((res[6] && !res[6].error && res[6].data) || []).forEach(function(p) { tracked[p.id] = true; });
  plState = { week: week, draft: res[0].data || null, rows: res[1].data || [], planWeek: res[2].data || null, slots: res[3], avail: avail, apps: apps,
    tracked: tracked, interest: {}, keys: {}, stale: [], cancels: null, replace: null, hasKind: !!(res[7] && !res[7].error), hasOpen: !!(res[8] && !res[8].error) };
  if (plState.planWeek) {
    // "Ich kann" on entries of the published plan (free entries with open places); an extra like the hints above
    var pi;
    try { pi = await supabaseClient.from('plan_shift_interest').select('shift_key, user_id, status').eq('week_id', plState.planWeek.id); } catch (e) { pi = { error: e }; }
    if (seq !== plSeq || wpView !== 'plan') return;
    ((pi && !pi.error && pi.data) || []).forEach(function(r) { (plState.interest[r.shift_key] = plState.interest[r.shift_key] || {})[r.user_id] = r.status || 'offen'; });
    // Absagen: without the table (migration absagen not applied yet) or the right to read it, cancels stays null
    var pc;
    try { pc = await supabaseClient.from('plan_cancellations').select('shift_key, user_id').eq('week_id', plState.planWeek.id).eq('status', 'offen'); } catch (e) { pc = { error: e }; }
    if (seq !== plSeq || wpView !== 'plan') return;
    if (pc && !pc.error) {
      plState.cancels = {};
      (pc.data || []).forEach(function(r) { (plState.cancels[r.shift_key] = plState.cancels[r.shift_key] || []).push(r.user_id); });
    }
  }
  if (plState.draft && await plSyncSlots(seq)) return; // rows were added or moved: plSyncSlots rendered the fresh state
  if (seq !== plSeq || wpView !== 'plan') return;
  plPaint();
}

// Brings the Auftrag phases of the week into an existing draft. true = something was written and the board was reloaded.
async function plSyncSlots(seq) {
  var st = plState, m = plMergeSlots(st.rows, st.slots, st.week, wpUsers), wrote = false;
  st.stale = m.stale;
  if (m.add.length) {
    var ins = await supabaseClient.from('plan_draft_shifts').insert(plForInsert(m.add)).select('id');
    if (ins.error) console.error('Aufträge in den Entwurf:', ins.error); else wrote = true;
  }
  for (var i = 0; i < m.patch.length; i++) {
    // A PL may not touch the row of another AP: 0 rows back is fine, the planner's next visit moves it
    var up = await supabaseClient.from('plan_draft_shifts').update(m.patch[i].changes).eq('id', m.patch[i].id).select('id');
    if (up.error) console.error('Auftrag verschoben:', up.error); else if (up.data && up.data.length) wrote = true;
  }
  if (!wrote || seq !== plSeq) return false;
  var re = await supabaseClient.from('plan_draft_shifts').select('*').eq('year', st.week.year).eq('kw', st.week.kw);
  if (seq !== plSeq || wpView !== 'plan') return true;
  if (!re.error) { st.rows = re.data || []; st.stale = plMergeSlots(st.rows, st.slots, st.week, wpUsers).stale; }
  plPaint();
  return true;
}

function plStatusHtml(st) {
  var d = st.draft, pw = st.planWeek;
  if (d.published_version != null && pw && pw.version === d.published_version)
    return '<span class="ui-pill ui-pill-ok">Veröffentlicht · Stand ' + pw.version + '</span>' +
      (plHasUnpublished(st.rows, d.published_at) ? ' <span class="ui-pill ui-pill-warn">Änderungen noch nicht veröffentlicht</span>' : '');
  if (d.published_version != null && pw)
    return '<span class="ui-pill ui-pill-warn">Plan wurde seitdem per PDF ersetzt</span>';
  if (pw) return '<span class="ui-pill ui-pill-warn">Entwurf · es gibt schon einen Plan für diese Woche</span>';
  return '<span class="ui-pill ui-pill-info">Entwurf · noch nicht veröffentlicht</span>';
}

function plPaint() {
  var box = plBox(), st = plState;
  if (!box || !st) return;
  var who = plWho(), b = plBounds(), nav = plNavHtml(st.week, b), planner = plCanPublish(who);
  st.keys = plRowKeys(st.week, st.rows, wpUsers);
  if (!st.draft) {
    var text, btn = '<button type="button" class="ui-btn ui-btn-primary wp-empty-btn" onclick="plStart()">Entwurf anlegen</button>';
    if (st.planWeek && !planner) { text = 'Diese Woche hat schon einen Plan. Einen Entwurf daraus kann nur anlegen, wer den Wochenplan plant.'; btn = ''; }
    else if (st.planWeek) text = 'Der Plan dieser Woche wurde als PDF hochgeladen. Der Entwurf übernimmt alle Einträge daraus, du kannst hier weiterplanen.';
    else text = 'Die Aufträge dieser Woche stehen gleich drin, mit allen, die schon angenommen wurden. Den Rest trägst du frei ein.';
    var nc = plCancelCount(st);
    if (nc && planner) text += ' Es ' + (nc === 1 ? 'gibt 1 offene Absage' : 'gibt ' + nc + ' offene Absagen') + ': Ersatz trägst du im Entwurf ein.';
    box.innerHTML = nav + uiEmptyHtml('Noch kein Entwurf für KW ' + st.week.kw, text, btn);
    return;
  }
  var stalePlan = st.draft.published_version != null && st.planWeek && st.planWeek.version !== st.draft.published_version;
  var nCancel = plCancelCount(st), lost = plUnmatchedCancels(st.keys, st.cancels);
  var head = '<div class="ui-card pl-head">' + plStatusHtml(st) +
    (nCancel ? ' <span class="ui-pill ui-pill-danger">' + nCancel + (nCancel === 1 ? ' Absage offen' : ' Absagen offen') + '</span>' : '') +
    lost.map(function(c) {
      var u = wpUsers.find(function(x) { return x.id === c.user_id; });
      return '<div class="pl-cancel">' + plE(u ? u.full_name : 'Jemand') + ' hat für „' + plE(c.key.split('|').slice(1).join(' · ')) + '“ (' + plDayShort(c.key.slice(0, 10)) +
        ') abgesagt, der Eintrag steht nicht mehr im Entwurf.' + (planner ? ' <button type="button" class="ord-textbtn" onclick="plCancelDone(\'' + jsAttrArg(c.key) + '\', \'' + jsAttrArg(c.user_id) + '\')">Erledigt</button>' : '') + '</div>';
    }).join('') +
    (stalePlan && planner ? '<div class="ui-sub" style="margin-top:8px;">Der Entwurf passt nicht mehr zum veröffentlichten Plan. ' +
      '<button type="button" class="ord-textbtn" onclick="plRestart()">Entwurf aus dem aktuellen Plan neu aufbauen</button></div>' : '') +
    '<div class="pl-actions">' +
      (planner ? '<button type="button" class="ui-btn" onclick="plEditRow(null)">Freier Eintrag</button>' : '') +
      '<button type="button" class="ui-btn" onclick="plExportPdf()">PDF</button>' +
      (planner ? '<button type="button" class="ui-btn ui-btn-primary" onclick="plPublish()">Veröffentlichen</button>' : '') +
    '</div>' +
    (planner ? '<button type="button" class="ord-textbtn pl-delweek" onclick="plDeleteWeek()">Woche löschen</button>' : '') +
    (planner ? '' : '<div class="ui-sub" style="margin-top:8px;">Du kannst deine Aufträge besetzen. Veröffentlicht wird der Plan von der Planung.</div>') +
  '</div>';
  var rows = plSorted(st.rows), days = '';
  for (var i = 0; i < 7; i++) {
    var day = plAddDays(st.week.weekStart, i), d = plUtc(day);
    var list = rows.filter(function(r) { return r.date === day; });
    days += '<div class="wp-dayhead wp-dayhead-static">' + PL_DAYS[d.getUTCDay()] + ' <span>' + ('0' + d.getUTCDate()).slice(-2) + '.' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '.</span></div>' +
      (list.length ? list.map(function(r) { return plRowHtml(r, who); }).join('') : '<div class="pl-none">Kein Eintrag</div>');
  }
  box.innerHTML = nav + head + days;
}

// Tag for the Art of a row; a confirmed Auftrag is the normal case and gets none
function plKindTag(r) {
  var k = plKind(r);
  if (!k || k === 'auftrag') return '';
  if (k === 'angebot') return '<span class="ui-pill ui-pill-info pl-kind"><i style="background:' + PL_KINDS[k].color + '"></i>Angebot</span>';
  return '<span class="pl-kind"><i style="background:' + PL_KINDS[k].color + '"></i>' + PL_KINDS[k].label + '</span>';
}

// Leaves out the columns this database does not have yet
function plForInsert(rows) {
  var st = plState || {};
  return plWithout(rows, (st.hasKind ? [] : ['kind']).concat(st.hasOpen ? [] : ['open_other']));
}

function plApplied(r) { return plAppliedFor(r, plState.keys[r.id], plState.apps, plState.interest); }

function plCancelCount(st) {
  var n = 0;
  Object.keys((st && st.cancels) || {}).forEach(function(k) { n += st.cancels[k].length; });
  return n;
}

// The Absage lines under the people of a row: replace, only take off, or mark done when the person is gone already
function plCancelHtml(r, can) {
  var key = plState.keys[r.id], id = "'" + jsAttrArg(r.id) + "'";
  return plCancelsOnRow(r, key, plState.cancels, wpUsers).map(function(c) {
    var uid = "'" + jsAttrArg(c.user_id) + "'";
    if (c.index === -1)
      return '<div class="pl-cancel"><b>' + plE(c.name) + '</b> hat abgesagt und steht nicht mehr auf dem Eintrag.' +
        (can ? ' <button type="button" class="ord-textbtn" onclick="plCancelDone(\'' + jsAttrArg(key) + '\', ' + uid + ')">Erledigt</button>' : '') + '</div>';
    return '<div class="pl-cancel"><b>' + plE(c.name) + '</b> hat abgesagt.' +
      (can ? '<div class="pl-cancel-actions"><button type="button" class="ui-btn ui-btn-primary dash-small-btn" onclick="plStartReplace(' + id + ', ' + uid + ')">Ersatz suchen</button>' +
        '<button type="button" class="ord-textbtn" onclick="plCancelDrop(' + id + ', ' + uid + ')">Nur austragen</button></div>' : '') + '</div>';
  }).join('');
}

function plRowById(id) { return plState ? plState.rows.find(function(r) { return r.id === id; }) : null; }

function plRowHtml(r, who) {
  var can = plCanEdit(r, who), w = planWhen(plLines(r.wann)), filled = plFilled(r), need = r.need || 0;
  var id = "'" + jsAttrArg(r.id) + "'";
  var count = need ? '<span class="ui-pill ' + (filled >= need ? 'ui-pill-ok' : 'ui-pill-warn') + '">' + filled + ' von ' + need + ' besetzt</span>'
    : (filled ? '<span class="ui-pill ui-pill-info">' + filled + ' eingeplant</span>' : '');
  var gone = {};
  plCancelsOnRow(r, plState.keys[r.id], plState.cancels, wpUsers).forEach(function(c) { if (c.index !== -1) gone[c.index] = true; });
  var chips = (r.people || []).map(function(p, i) {
    var role = '<b>' + plE(p.role || 'MA') + '</b>';
    return '<span class="pl-chip' + (PL_AGENCY.indexOf(p.role) !== -1 ? ' pl-chip-agency' : '') + (gone[i] ? ' pl-chip-cancel' : '') + '">' +
      (can ? '<button type="button" class="pl-chip-role" aria-label="Rolle von ' + plE(p.name) + ' ändern, jetzt ' + plE(p.role || 'MA') + '" onclick="plRoleMenu(' + id + ', ' + i + ')">' + role + '</button>' : role) +
      '<span>' + (gone[i] ? '<s>' + plE(p.name) + '</s>' : plE(p.name)) + (gone[i] ? ' <small>sagt ab</small>' : p.note ? ' <small>' + plE(p.note) + '</small>' : '') + '</span>' +
      (can ? '<button type="button" class="pl-chip-x" aria-label="' + plE(p.name) + ' entfernen" onclick="plRemove(' + id + ', ' + i + ')">×</button>' : '') +
    '</span>';
  }).join('');
  var loc = plLines(r.location), det = plLines(r.details), waiting = plOpenMeldungen(r, plApplied(r));
  return '<div class="ui-card pl-row" id="pl-row-' + plE(r.id) + '">' +
    '<div class="pl-row-top">' +
      '<div class="wp-time"><b>' + plE(w.time || '—') + '</b><span>' + plE(w.label || '') + '</span></div>' +
      '<div class="pl-row-main">' +
        '<div class="pl-row-title">' + plE(r.venue || '—') + (r.title ? ' · ' + plE(r.title) : '') + '</div>' +
        (loc.length ? '<div class="ui-sub">' + loc.map(plE).join(' · ') + '</div>' : '') +
        (det.length ? '<ul class="pl-was">' + det.map(function(t) { return '<li>' + plE(t) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="pl-row-meta">' + (r.job_no ? '<span class="wp-ord-tag">Auftrag</span>' : '') + plKindTag(r) + count +
          plOpenOther(r).map(function(o) { return '<span class="ui-pill ui-pill-warn">' + o.count + ' ' + plE(o.role) + (o.count === 1 ? ' fehlt' : ' fehlen') + '</span>'; }).join('') +
          (waiting ? '<span class="ui-pill ui-pill-info">' + waiting + (waiting === 1 ? ' Meldung' : ' Meldungen') + '</span>' : '') +
          (r.ap ? '<span class="ui-sub">PL ' + plE(r.ap) + '</span>' : '') +
          (plState.stale.indexOf(r.id) !== -1 ? '<span class="ui-pill ui-pill-danger">Auftrag nicht mehr in dieser Woche</span>' : '') + '</div>' +
      '</div>' +
      (can ? '<button type="button" class="ui-icon-btn" aria-label="Eintrag bearbeiten" onclick="plEditRow(' + id + ')">' +
        '<svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/></svg></button>' : '') +
    '</div>' +
    (chips ? '<div class="pl-chips">' + chips + '</div>' : '') +
    plCancelHtml(r, can) +
    (can ? (plOpenRow === r.id ? plPickerHtml(r) :
      '<button type="button" class="ord-textbtn pl-add" onclick="plTogglePicker(' + id + ')">+ Person</button>') : '') +
  '</div>';
}

function plPickerHtml(r) {
  var st = plState, id = "'" + jsAttrArg(r.id) + "'";
  var applied = plApplied(r);
  var list = plCandidates(r, st.rows, wpUsers, st.avail, applied, st.tracked).map(function(c) {
    var u = wpUsers.find(function(x) { return x.id === c.id; });
    var tag = c.applied === 'angenommen' ? '<span class="ord-pill ord-pill-ok">angenommen</span>'
      : c.applied === 'offen' ? '<span class="ord-pill ord-pill-new">hat sich gemeldet</span>' : '';
    if (c.free) tag += '<span class="ord-pill ord-pill-ok">hat Zeit</span>';
    if (c.level === 'nein') tag += '<span class="ord-pill ord-pill-danger">geht nicht</span>';
    else if (c.level === 'notfall') tag += '<span class="ord-pill ord-pill-warn">nur im Notfall</span>';
    if (c.busy) tag += '<span class="ord-pill ord-pill-danger">schon eingeplant</span>';
    return '<button type="button" class="pl-cand" data-name="' + plE(c.name) + '" data-full="' + plE((u && u.full_name) || '') + '" onclick="plPlace(' + id + ', \'' + jsAttrArg(c.id) + '\')">' +
      '<span>' + plE((u && u.full_name) || c.name) + '</span>' + tag + '</button>';
  }).join('');
  return '<div class="pl-picker">' +
    '<div class="pl-picker-head"><span class="ui-label" style="margin:0;">' + plPickerTitle(r) + '</span>' +
      '<button type="button" class="ord-textbtn" onclick="plTogglePicker(' + id + ')">Schließen</button></div>' +
    '<div class="pl-find">' +
      '<input type="search" class="meta-input" id="pl-search" placeholder="Name suchen" aria-label="Name suchen" autocomplete="off" autocapitalize="words" ' +
        'oninput="plFilter()" onkeydown="if (event.key === \'Enter\') { event.preventDefault(); plSearchEnter(' + id + '); }">' +
      '<label class="pl-role"><span>als</span><select class="meta-input" id="pl-role" aria-label="Rolle">' +
        PL_ROLES.map(function(x) { return '<option>' + x + '</option>'; }).join('') + '</select></label>' +
    '</div>' +
    '<div class="pl-cands" id="pl-cands">' + (list || '<div class="ui-sub">Niemand mehr frei.</div>') + '</div>' +
    '<div class="ui-sub" id="pl-nohit" hidden>Niemand mit diesem Namen in der App.</div>' +
    '<button type="button" class="ui-btn ui-btn-block" id="pl-free-btn" hidden onclick="plPlaceFree(' + id + ')"></button>' +
  '</div>';
}

// Filters the list while typing (no repaint, the field keeps its focus) and offers the typed name as a free entry
function plFilter() {
  var inp = document.getElementById('pl-search'), q = inp ? inp.value.trim() : '', hits = 0;
  document.querySelectorAll('#pl-cands .pl-cand').forEach(function(b) {
    var ok = plSearchMatch(q, b.dataset.name, b.dataset.full);
    b.hidden = !ok;
    if (ok) hits++;
  });
  var none = document.getElementById('pl-nohit'), free = document.getElementById('pl-free-btn');
  if (none) none.hidden = !q || hits > 0;
  if (free) {
    free.hidden = !q;
    free.textContent = '„' + q + '“ ohne App-Konto eintragen (z.B. Zenjob)';
  }
}

// Enter in the search field: exactly one hit left → that person goes on the row
function plSearchEnter(id) {
  var left = [].filter.call(document.querySelectorAll('#pl-cands .pl-cand'), function(b) { return !b.hidden; });
  if (left.length === 1) left[0].click();
}

function plPickedRole() { var sel = document.getElementById('pl-role'); return sel ? sel.value : 'MA'; }

function plTogglePicker(id) {
  plOpenRow = plOpenRow === id ? null : id;
  if (plState) plState.replace = null;
  plPaint();
}

// Replacing someone who cancelled: the picker of that row puts the chosen person in their place
function plReplacing(row) {
  var rp = plState && plState.replace;
  if (!rp || !row || rp.rowId !== row.id) return null;
  var idx = (row.people || []).findIndex(function(p) { return p.user_id === rp.userId; });
  return idx === -1 ? null : { index: idx, userId: rp.userId, name: row.people[idx].name };
}
function plPickerTitle(r) { var rp = plReplacing(r); return rp ? 'Ersatz für ' + plE(rp.name) : 'Person hinzufügen'; }

function plStartReplace(id, userId) {
  if (!plState) return;
  plOpenRow = id;
  plState.replace = { rowId: id, userId: userId };
  plPaint();
}

// Marks an Absage done (with the replacement, if any). RLS: planner switch, PL or Admin.
async function plCancelDone(key, userId, replacementId) {
  var st = plState;
  if (!st || !st.planWeek) return false;
  var r;
  try {
    r = await supabaseClient.from('plan_cancellations').update({ status: 'erledigt', replacement_user_id: replacementId || null })
      .eq('week_id', st.planWeek.id).eq('shift_key', key).eq('user_id', userId).select('user_id');
  } catch (e) { r = { error: e }; }
  if (r.error || !r.data || !r.data.length) { console.error('Absage erledigen:', r.error); showToast('Absage nicht als erledigt gespeichert.', 'danger'); return false; }
  if (st.cancels && st.cancels[key]) {
    st.cancels[key] = st.cancels[key].filter(function(u) { return u !== userId; });
    if (!st.cancels[key].length) delete st.cancels[key];
  }
  plPaint();
  return true;
}

// "Nur austragen": the person who cancelled comes off the row, nobody takes the place
async function plCancelDrop(id, userId) {
  var row = plRowById(id), key = plState && plState.keys[id];
  if (!row) return;
  var idx = (row.people || []).findIndex(function(p) { return p.user_id === userId; });
  if (idx === -1 || !await plSave(row, { people: plRemovePerson(row, idx) })) return;
  if (await plCancelDone(key, userId, null)) showToast('Ausgetragen. Mit „Veröffentlichen“ steht es im Plan.', 'success');
}

async function plReplaceWith(row, rp, person) {
  var key = plState.keys[row.id], people = plReplacePerson(row, rp.index, person);
  if (!people) { showToast('Steht schon auf dem Eintrag.', 'danger'); return false; }
  plOpenRow = null;
  plState.replace = null;
  if (!await plSave(row, { people: people })) return false;
  await plCancelDone(key, rp.userId, person.user_id || null);
  showToast('Ersetzt. Mit „Veröffentlichen“ bekommt ' + person.name + ' Bescheid.', 'success');
  return true;
}

// Saves one row. A PL who fills an Auftrag row without AP becomes its AP (the RLS allows nothing else).
async function plSave(row, changes) {
  var who = plWho();
  if (!plCanEdit(row, who)) { showToast('Diesen Eintrag kannst du nicht ändern.', 'danger'); return false; }
  if (!plCanPublish(who) && !row.ap_user_id && !('ap_user_id' in changes)) {
    var me = wpUsers.find(function(u) { return u.id === who.id; });
    changes = Object.assign({}, changes, { ap_user_id: who.id, ap: row.ap || (me ? plShortName(me, wpUsers) : null) });
  }
  var p = plRowPatch(row, changes), r;
  try {
    r = await supabaseClient.from('plan_draft_shifts').update(p.values).eq('id', p.match.id).eq('updated_at', p.match.updated_at).select('*');
  } catch (e) { r = { error: e }; }
  if (r.error) { console.error('Entwurf speichern:', r.error); showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger'); return false; }
  if (!r.data || !r.data.length) {
    showToast('Jemand anderes hat den Eintrag inzwischen geändert. Der Plan wurde neu geladen.', 'info');
    await plRender();
    return false;
  }
  var i = plState.rows.findIndex(function(x) { return x.id === row.id; });
  if (i !== -1) plState.rows[i] = r.data[0];
  plPaint();
  return true;
}

async function plPlace(id, userId) {
  var row = plRowById(id), u = wpUsers.find(function(x) { return x.id === userId; });
  if (!row || !u) return;
  var rp = plReplacing(row);
  if (rp) {
    if (await plReplaceWith(row, rp, { user_id: u.id, name: plShortName(u, wpUsers) })) await plMeldungSet(id, u.id, 'offen', 'angenommen');
    return;
  }
  var role = plPlaceRole(plPickedRole(), true);
  var people = plAddPerson(row, { user_id: u.id, name: plShortName(u, wpUsers), role: role });
  if (people && await plSave(row, plWithOpen(row, role, { people: people }))) await plMeldungSet(id, u.id, 'offen', 'angenommen');
}

async function plPlaceFree(id) {
  var row = plRowById(id), name = document.getElementById('pl-search');
  if (!row || !name) return;
  var rpFree = plReplacing(row);
  if (rpFree) { await plReplaceWith(row, rpFree, { user_id: null, name: planStripPhones(name.value) }); return; }
  var freeRole = plPlaceRole(plPickedRole(), false);
  var people = plAddPerson(row, { user_id: null, name: planStripPhones(name.value), role: freeRole });
  if (!people) { showToast(plText(name.value) ? 'Steht schon auf dem Eintrag.' : 'Bitte einen Namen eintragen.', 'danger'); return; }
  await plSave(row, plWithOpen(row, freeRole, { people: people }));
}

async function plRemove(id, index) {
  var row = plRowById(id), p = row && (row.people || [])[index];
  if (row && await plSave(row, { people: plRemovePerson(row, index) }) && p && p.user_id) await plMeldungSet(id, p.user_id, 'angenommen', 'offen');
}

// Placing someone who said "Ich kann" answers their Meldung (offen → angenommen); taking them off again reopens it.
// Deciding needs "Sieht Bewerbungen" (RLS): without it nothing changes here and the Meldung waits in the Aufträge inbox as before.
async function plMeldungSet(rowId, userId, from, to) {
  var st = plState, row = plRowById(rowId);
  if (!st || !row) return;
  var targets = plMeldungTargets(row, st.keys[row.id], st.planWeek && st.planWeek.id, st.apps, st.interest, userId, from), changed = false;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i], r;
    try {
      r = t.kind === 'order'
        ? await supabaseClient.from('order_applications').update({ status: to }).eq('job_no', t.job_no).eq('phase', t.phase).eq('user_id', userId).eq('status', from).select('user_id')
        : await supabaseClient.from('plan_shift_interest').update({ status: to }).eq('week_id', t.week_id).eq('shift_key', t.shift_key).eq('user_id', userId).eq('status', from).select('user_id');
    } catch (e) { r = { error: e }; }
    if (r.error) { console.error('Meldung beantworten:', r.error); continue; }
    if (!r.data || !r.data.length) continue; // no right to decide, or someone else answered it meanwhile
    if (t.kind === 'order') st.apps[t.job_no + '|' + t.phase][userId] = to; else st.interest[t.shift_key][userId] = to;
    changed = true;
  }
  if (changed && plState === st) plPaint();
}

// Called by the Aufträge inbox after a decision there (auftraege.js): an accepted person goes on the draft row of that
// Auftrag phase or plan entry, a taken-back or declined one comes off it. No draft, or no right to edit it: nothing happens.
// kind 'order': a = job_no, b = phase; kind 'shift': a = plan week id, b = shift key. Never throws.
async function plDraftSync(kind, a, b, userId, on, users) {
  try {
    var rows = [];
    if (kind === 'order') {
      var q = await supabaseClient.from('plan_draft_shifts').select('*').eq('job_no', a).eq('phase', b);
      if (q.error) return false;
      rows = q.data || [];
    } else {
      var w = await supabaseClient.from('plan_weeks').select('year, kw, week_start, week_end').eq('id', a).maybeSingle();
      if (w.error || !w.data) return false;
      var d = await supabaseClient.from('plan_draft_shifts').select('*').eq('year', w.data.year).eq('kw', w.data.kw);
      if (d.error) return false;
      var keys = plRowKeys({ year: w.data.year, kw: w.data.kw, weekStart: w.data.week_start, weekEnd: w.data.week_end }, d.data || [], users);
      rows = (d.data || []).filter(function(r) { return keys[r.id] === b; });
    }
    var done = false;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], people, u = (users || []).find(function(x) { return x.id === userId; });
      if (on) people = u ? plAddPerson(row, { user_id: userId, name: plShortName(u, users), role: 'MA' }) : null;
      else people = (row.people || []).some(function(p) { return p.user_id === userId; }) ? row.people.filter(function(p) { return p.user_id !== userId; }) : null;
      if (!people) continue;
      var up = await supabaseClient.from('plan_draft_shifts').update({ people: people }).eq('id', row.id).eq('updated_at', row.updated_at).select('id');
      if (!up.error && up.data && up.data.length) done = true;
    }
    if (done) plState = null; // the board reloads on its next visit
    return done;
  } catch (e) { console.error('Entwurf nachziehen:', e); return false; }
}

// A person placed as driver (or agency worker) takes the open place of that kind, when the row has one
function plWithOpen(row, role, changes) {
  var open = plState && plState.hasOpen && role !== 'MA' ? plTakeOpen(row, role) : null;
  return open ? Object.assign({}, changes, { open_other: open }) : changes;
}

// Tap on the role of a placed person: pick it from a menu (app users are never Zenjob/ROCKiT)
function plRoleMenu(id, index) {
  var row = plRowById(id), p = row && (row.people || [])[index];
  if (!p) return;
  var labels = { MA: 'MA', AL: 'AL (leitet den Einsatz)', Fahrer: 'Fahrer', Deko: 'Deko', Zenjob: 'Zenjob', ROCKiT: 'ROCKiT' };
  openUiMenu(PL_ROLES.filter(function(x) { return !p.user_id || PL_AGENCY.indexOf(x) === -1; }).map(function(x) {
    return { label: (x === (p.role || 'MA') ? '✓ ' : '') + p.name + ' als ' + labels[x], action: 'plSetRole', args: [id, index, x] };
  }));
}

async function plSetRole(id, index, role) {
  var row = plRowById(id), p = row && (row.people || [])[index];
  if (!p || p.role === role) return;
  var people = row.people.map(function(x, i) { return i === index ? Object.assign({}, x, { role: plPlaceRole(role, !!x.user_id) }) : x; });
  await plSave(row, plWithOpen(row, plPlaceRole(role, !!p.user_id), { people: people }));
}

// First draft of the week (plSeed). Free rows need the planner right, so a PL can only start a week without a plan.
async function plStart() {
  var st = plState, who = plWho();
  if (!st || st.draft) return;
  if (st.planWeek && !plCanPublish(who)) return;
  var shifts = [];
  if (st.planWeek) {
    var ps = await supabaseClient.from('plan_shifts').select('*, plan_assignments(*)').eq('week_id', st.planWeek.id).order('sort');
    if (ps.error) { console.error('Plan lesen:', ps.error); showToast('Der Plan der Woche konnte nicht gelesen werden.', 'danger'); return; }
    shifts = ps.data || [];
  }
  var w = st.week;
  var ins = await supabaseClient.from('plan_draft_weeks').insert({ year: w.year, kw: w.kw, week_start: w.weekStart, week_end: w.weekEnd }).select('*');
  if (ins.error || !ins.data || !ins.data.length) {
    console.error('Entwurf anlegen:', ins.error);
    showToast('Der Entwurf konnte nicht angelegt werden.', 'danger');
    return plRender(); // someone else may have created it a second ago
  }
  var rows = plSeed(shifts, st.slots, w, wpUsers);
  if (rows.length) {
    var r = await supabaseClient.from('plan_draft_shifts').insert(plForInsert(rows)).select('id');
    if (r.error) { console.error('Entwurf füllen:', r.error); showToast('Die Einträge konnten nicht übernommen werden.', 'danger'); }
  }
  await plRender();
}

async function plRestart() {
  var st = plState;
  if (!st || !st.draft || !plCanPublish(plWho())) return;
  if (!confirm('Der jetzige Entwurf für KW ' + st.week.kw + ' wird verworfen und aus dem aktuellen Plan neu aufgebaut. Fortfahren?')) return;
  var d = await supabaseClient.from('plan_draft_weeks').delete().eq('year', st.week.year).eq('kw', st.week.kw).select('year');
  if (d.error || !d.data || !d.data.length) { console.error('Entwurf verwerfen:', d.error); showToast('Der Entwurf konnte nicht verworfen werden.', 'danger'); return; }
  st.draft = null; st.rows = [];
  await plStart();
}

// Removes the week: the draft always; the published plan too when it was built here (a week uploaded as PDF stays, only its draft goes).
// Nobody is notified, so this is for test weeks and mistakes; to take single entries off a real plan, delete them and publish again.
async function plDeleteWeek() {
  var st = plState;
  if (!st || !st.draft || !plCanPublish(plWho())) return;
  var app = plIsAppWeek(st.draft, st.planWeek), kw = st.week.kw;
  var msg = app
    ? 'KW ' + kw + ' komplett löschen?\n\nDer Entwurf und der veröffentlichte Plan dieser Woche verschwinden für alle. Wer eingeplant war, bekommt keine Nachricht. Das lässt sich nicht rückgängig machen.'
    : st.planWeek
      ? 'Entwurf für KW ' + kw + ' löschen?\n\nDer hochgeladene Plan dieser Woche bleibt, wie er ist. Der Entwurf lässt sich nicht zurückholen.'
      : 'Entwurf für KW ' + kw + ' löschen?\n\nEr wurde noch nicht veröffentlicht und lässt sich nicht zurückholen.';
  if (!confirm(msg)) return;
  if (app) {
    var pw = await supabaseClient.from('plan_weeks').delete().eq('id', st.planWeek.id).eq('version', st.planWeek.version).select('id');
    if (pw.error || !pw.data || !pw.data.length) {
      console.error('Plan der Woche löschen:', pw.error);
      showToast(pw.error ? 'Der Plan konnte nicht gelöscht werden.' : 'Der Plan wurde inzwischen geändert. Bitte neu laden.', 'danger');
      return plRender();
    }
  }
  var d = await supabaseClient.from('plan_draft_weeks').delete().eq('year', st.week.year).eq('kw', st.week.kw).select('year');
  if (d.error || !d.data || !d.data.length) { console.error('Entwurf löschen:', d.error); showToast('Der Entwurf konnte nicht gelöscht werden.', 'danger'); return plRender(); }
  showToast(app ? 'KW ' + kw + ' gelöscht' : 'Entwurf für KW ' + kw + ' gelöscht');
  plState = null;
  if (app) await initWochenplan(); else await plRender(); // the week list of the other tabs still held the deleted plan
}

/* ── Edit sheet ── */

function plCloseSheet() { var m = document.getElementById('pl-sheet'); if (m) m.remove(); }

function plEditRow(id) {
  var st = plState, who = plWho(), row = id ? plRowById(id) : null;
  if (!st || (id && !row) || (id ? !plCanEdit(row, who) : !plCanPublish(who))) return;
  var planner = plCanPublish(who), job = !!(row && row.job_no), v = row || { date: st.week.weekStart, need: 0 };
  var field = function(label, html) { return '<label class="ui-field"><span>' + label + '</span>' + html + '</label>'; };
  var inp = function(key, ph) { return '<input type="text" id="pl-f-' + key + '" value="' + plE(v[key] || '') + '" placeholder="' + (ph || '') + '" autocomplete="off">'; };
  var area = function(key, ph, rows) { return '<textarea id="pl-f-' + key + '" rows="' + (rows || 2) + '" placeholder="' + (ph || '') + '">' + plE(v[key] || '') + '</textarea>'; };
  var days = '';
  for (var i = 0; i < 7; i++) {
    var d = plAddDays(st.week.weekStart, i);
    days += '<option value="' + d + '"' + (d === v.date ? ' selected' : '') + '>' + PL_DAYS[plUtc(d).getUTCDay()] + ' ' + plDayShort(d).slice(3) + '</option>';
  }
  var aps = wpUsers.filter(function(u) { return u.is_active !== false && PLAN_PL_ROLES.indexOf(u.role) !== -1; });
  var apOpts = '<option value="">Niemand</option>' + aps.map(function(u) {
    return '<option value="' + plE(u.id) + '"' + (u.id === v.ap_user_id ? ' selected' : '') + '>' + plE(u.full_name) + '</option>';
  }).join('') + (v.ap && !v.ap_user_id ? '<option value="_keep" selected>' + plE(v.ap) + ' (nur Name)</option>' : '');
  var m = document.createElement('div');
  m.id = 'pl-sheet';
  m.className = 'sig-modal ui-sheet open';
  m.style.setProperty('--sheet-w', '520px');
  m.innerHTML = '<div class="sig-modal-inner"><div class="ui-sheet-head"><h3 class="ui-title" style="font-size:18px;">' + (row ? 'Eintrag bearbeiten' : 'Freier Eintrag') + '</h3></div>' +
    (job ? '<div class="ui-sub" style="margin-bottom:12px;">Tag und MA-Zahl kommen aus dem Auftrag ' + plE(row.job_no) + ' und werden dort geändert.</div>'
      : field('Tag', '<select id="pl-f-date">' + days + '</select>')) +
    (st.hasKind ? field('Art', '<select id="pl-f-kind">' + PL_KIND_ORDER.map(function(k) {
      return '<option value="' + k + '"' + (k === (plKind(v) || 'auftrag') ? ' selected' : '') + '>' + PL_KINDS[k].long + '</option>';
    }).join('') + '</select>') : '') +
    field('Ort', inp('venue', 'z.B. Estrel')) +
    field('Raum / Veranstaltung', area('location', 'eine Zeile pro Angabe')) +
    field('Was (Material, eine Zeile pro Position)', '<textarea id="pl-f-was" rows="5" placeholder="4 Loungesofa weiß&#10;2 Stehtische&#10;1 Teppich 3 x 4 m">' + plE(plWasText(v)) + '</textarea>') +
    field('Wann', area('wann', 'z.B. Aufbau: 9 Uhr')) +
    (planner ? field('PL (Projektleitung)', '<select id="pl-f-ap">' + apOpts + '</select>') : '') +
    (job ? '' : field('MA gebraucht', '<input type="number" id="pl-f-need" min="0" max="99" inputmode="numeric" value="' + (v.need || 0) + '">')) +
    (st.hasOpen ? field('Fahrer fehlt noch (0 = keiner)', '<input type="number" id="pl-f-drivers" min="0" max="9" inputmode="numeric" value="' +
      plOpenOther(v).filter(function(o) { return o.role === 'Fahrer'; }).reduce(function(n, o) { return n + o.count; }, 0) + '">') : '') +
    field('Notizen', area('notes', 'z.B. Fahrzeug, Hinweise')) +
    '<div class="ui-sheet-actions">' +
      (row && planner ? '<button type="button" class="ui-btn ui-btn-danger" onclick="plDeleteRow(\'' + jsAttrArg(row.id) + '\')">Löschen</button>' : '') +
      '<button type="button" class="ui-btn" onclick="plCloseSheet()">Abbrechen</button>' +
      '<button type="button" class="ui-btn ui-btn-primary" id="pl-f-save" onclick="plSaveSheet(' + (row ? '\'' + jsAttrArg(row.id) + '\'' : 'null') + ')">Speichern</button>' +
    '</div></div>';
  plCloseSheet();
  document.body.appendChild(m);
}

async function plSaveSheet(id) {
  var st = plState, row = id ? plRowById(id) : null, val = function(k) { var e = document.getElementById('pl-f-' + k); return e ? e.value : undefined; };
  if (!st || (id && !row)) return plCloseSheet();
  // Phone numbers of agency workers never go into the plan (same rule as the PDF import)
  var clean = function(t) { return plText(plLines(t).map(planStripPhones).filter(Boolean).join('\n')); };
  var was = plWasSplit(clean(val('was')));
  var ch = { venue: clean(val('venue')), location: clean(val('location')), title: was.title, details: was.details,
    wann: clean(val('wann')), notes: clean(val('notes')) };
  if (val('date') !== undefined) ch.date = val('date');
  if (val('kind') !== undefined && PL_KINDS[val('kind')]) ch.kind = val('kind');
  if (val('drivers') !== undefined) ch.open_other = plSetOpen(row || {}, 'Fahrer', val('drivers'));
  if (val('need') !== undefined) ch.need = Math.max(0, Math.min(99, parseInt(val('need'), 10) || 0));
  var ap = val('ap');
  if (ap !== undefined && ap !== '_keep') {
    var u = wpUsers.find(function(x) { return x.id === ap; });
    ch.ap_user_id = u ? u.id : null;
    ch.ap = u ? plShortName(u, wpUsers) : null;
  }
  if (!ch.venue && !ch.title) { showToast('Bitte Ort oder „Was“ eintragen.', 'danger'); return; }
  var btn = document.getElementById('pl-f-save');
  if (btn) btn.disabled = true;
  var ok;
  if (row) ok = await plSave(row, ch);
  else {
    var w = st.week, ins;
    try {
      ins = await supabaseClient.from('plan_draft_shifts').insert(Object.assign({ year: w.year, kw: w.kw, people: [], sort: st.rows.length }, ch)).select('*');
    } catch (e) { ins = { error: e }; }
    ok = !ins.error && ins.data && ins.data.length;
    if (ok) { st.rows.push(ins.data[0]); plPaint(); }
    else { console.error('Freier Eintrag:', ins.error); showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger'); }
  }
  if (ok) plCloseSheet(); else if (btn) btn.disabled = false;
}

async function plDeleteRow(id) {
  var row = plRowById(id);
  if (!row || !plCanPublish(plWho())) return;
  if (!confirm(row.job_no ? 'Eintrag löschen? Solange der Auftrag in dieser Woche liegt, kommt er beim nächsten Öffnen leer wieder.' : 'Eintrag löschen?')) return;
  var d = await supabaseClient.from('plan_draft_shifts').delete().eq('id', id).select('id');
  if (d.error || !d.data || !d.data.length) { console.error('Eintrag löschen:', d.error); showToast('Nicht gelöscht.', 'danger'); return; }
  plState.rows = plState.rows.filter(function(r) { return r.id !== id; });
  plCloseSheet();
  plPaint();
}

/* ── Publish: through the import preview of wochenplan.js ── */

async function plPublish() {
  var st = plState;
  if (!st || !st.draft || !plCanPublish(plWho())) return;
  // Fresh rows: someone else may have filled an Auftrag since this board was painted
  var fresh = await supabaseClient.from('plan_draft_shifts').select('*').eq('year', st.week.year).eq('kw', st.week.kw);
  if (fresh.error) { console.error('Entwurf lesen:', fresh.error); showToast('Server nicht erreichbar.', 'danger'); return; }
  st.rows = fresh.data || [];
  var problems = plPublishProblems(st.rows);
  if (problems.length) { showToast(problems[0], 'danger'); plPaint(); return; }
  var parsed = plToParsed(st.week, st.rows, wpUsers), week = st.week, lastChange = plLastChange(st.rows), ex = null;
  // Same lookup as the PDF upload: this KW, or a stored week covering most of the same days (imported under an older KW rule)
  var cand = await supabaseClient.from('plan_weeks').select('id, year, kw, week_start, week_end')
    .or('and(year.eq.' + week.year + ',kw.eq.' + week.kw + '),and(week_start.lte.' + week.weekEnd + ',week_end.gte.' + week.weekStart + ')');
  if (cand.error) { console.error('Woche prüfen:', cand.error); showToast('Server nicht erreichbar.', 'danger'); return; }
  var pick = planPickExistingWeek(cand.data || [], parsed);
  if (pick) {
    var cur = await supabaseClient.from('plan_weeks').select('*, plan_shifts(*, plan_assignments(*))').eq('id', pick.id).maybeSingle();
    if (cur.error) { console.error('Woche prüfen:', cur.error); showToast('Server nicht erreichbar.', 'danger'); return; }
    ex = cur.data || null;
  }
  if (ex && !(st.draft.published_version != null && st.draft.published_version === ex.version))
    parsed.warnings.push('Für diese Woche gibt es einen hochgeladenen Plan (Stand ' + ex.version + '). Mit „Übernehmen“ ersetzt der Entwurf ihn.');
  wpImport = { parsed: parsed, fileName: 'Besetzungsplaner', existing: ex, unresolved: {},
    afterSave: function(weekId) { return plAfterPublish(week, parsed, weekId, lastChange); } };
  wpRenderImport();
}

// After wpSaveImport committed: remember which Stand the draft was published as and pin every Auftrag phase to its plan row
async function plAfterPublish(week, parsed, weekId, lastChange) {
  var v = await supabaseClient.from('plan_weeks').select('version').eq('id', weekId).maybeSingle();
  if (v.error || !v.data) { console.error('Stand lesen:', v.error); return; }
  var up = await supabaseClient.from('plan_draft_weeks')
    .update({ published_version: v.data.version, published_at: lastChange || new Date().toISOString(), published_by: plWho().id })
    .eq('year', week.year).eq('kw', week.kw).select('year');
  if (up.error || !up.data || !up.data.length) console.error('Entwurf als veröffentlicht merken:', up.error);
  var links = parsed.shifts.filter(function(s) { return s.jobNo; })
    .map(function(s) { return { job_no: s.jobNo, phase: s.phase, plan_date: s.date, plan_key: s.key }; });
  if (links.length) {
    var l = await supabaseClient.from('order_plan_links').upsert(links, { onConflict: 'job_no,phase' });
    if (l.error) console.error('Aufträge verknüpfen:', l.error); // the automatic match (ordMatchSlot) still applies
  }
  plState = null;
}

/* ── PDF in Daniel's layout: Datum | Was | Wann | Wer | PL (his column "AP" names the Projektleitung) ── */

function plExportPdf() {
  var st = plState;
  if (!st || !st.rows.length) { showToast('Der Entwurf ist leer.', 'danger'); return; }
  if (!window.jspdf || !window.jspdf.jsPDF) { showToast('PDF-Bibliothek nicht geladen. Prüf deine Verbindung.', 'danger'); return; }
  var doc = pdfPatch(new jspdf.jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' }));
  var ml = 10, top = 12, bottom = 198, lh = 4.2, pad = 1.6;
  var widths = [48, 74, 44, 76, 35], heads = ['Datum', 'Was', 'Wann', 'Wer', 'PL'];
  var xs = widths.map(function(_, i) { return ml + widths.slice(0, i).reduce(function(a, b) { return a + b; }, 0); });
  var total = widths.reduce(function(a, b) { return a + b; }, 0), y = top;
  var line = function(yy) { doc.setDrawColor(120); doc.setLineWidth(0.2); doc.line(ml, yy, ml + total, yy); };
  doc.setFontSize(13); doc.setFont('helvetica', 'bold');
  doc.text('Wochenplan KW ' + st.week.kw + ' (' + plDayShort(st.week.weekStart).slice(3) + ' – ' + plDayShort(st.week.weekEnd).slice(3) + ')' +
    (st.draft && st.draft.published_version != null && st.planWeek && st.planWeek.version === st.draft.published_version ? '' : ' · Entwurf'), ml, y);
  y += 6;
  doc.setFontSize(9);
  heads.forEach(function(h, i) { doc.text(h, xs[i] + pad, y + lh); });
  y += lh + pad * 2; line(y);
  plPdfTable(st.week, st.rows).forEach(function(item) {
    if (item.day) {
      if (y + lh + pad * 2 + lh * 3 > bottom) { doc.addPage(); y = top; }
      doc.setFillColor(192, 192, 192); doc.rect(ml, y, total, lh + pad * 2, 'F');
      doc.setFont('helvetica', 'bold'); doc.text(String(item.day), ml + pad, y + lh + pad * 0.4);
      y += lh + pad * 2; line(y);
      return;
    }
    doc.setFont('helvetica', 'normal');
    var cells = item.cells.map(function(lines, i) {
      var out = [];
      lines.forEach(function(t) { out = out.concat(doc.splitTextToSize(String(t), widths[i] - pad * 2)); });
      return out;
    });
    var h = Math.max.apply(null, cells.map(function(c) { return c.length; }).concat([1])) * lh + pad * 2;
    if (y + h > bottom) { doc.addPage(); y = top; line(y); }
    cells.forEach(function(c, i) {
      c.forEach(function(t, j) {
        doc.setFont('helvetica', j === 0 && i < 2 ? 'bold' : 'normal');
        doc.text(String(t), xs[i] + pad, y + pad + lh * (j + 1) - 1);
      });
    });
    y += h; line(y);
  });
  doc.save('Wochenplan_KW' + st.week.kw + '_' + st.week.year + '.pdf');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { plCancelsOnRow: plCancelsOnRow, plReplacePerson: plReplacePerson, plUnmatchedCancels: plUnmatchedCancels, plMonday: plMonday, plWeekOf: plWeekOf, plShortName: plShortName, plWannText: plWannText, plRowFromSlot: plRowFromSlot,
    plMergeSlots: plMergeSlots, plRowsFromPlan: plRowsFromPlan, plSeed: plSeed, plFilled: plFilled, plOpenSlots: plOpenSlots, plToParsed: plToParsed,
    plCandidates: plCandidates, plSearchMatch: plSearchMatch, plPlaceRole: plPlaceRole, plCanEdit: plCanEdit, plCanPublish: plCanPublish, plCanOpen: plCanOpen, plPublishProblems: plPublishProblems,
    plLastChange: plLastChange, plHasUnpublished: plHasUnpublished, plKindOfColor: plKindOfColor, plKind: plKind, plWithoutKind: plWithoutKind, plWithout: plWithout, plOpenOther: plOpenOther, plTakeOpen: plTakeOpen, plSetOpen: plSetOpen, plRowKeys: plRowKeys, plAppliedFor: plAppliedFor, plOpenMeldungen: plOpenMeldungen, plMeldungTargets: plMeldungTargets, plWasText: plWasText, plWasSplit: plWasSplit, plIsAppWeek: plIsAppWeek, plAddPerson: plAddPerson, plRemovePerson: plRemovePerson, plRowPatch: plRowPatch, plWerLines: plWerLines, plPdfTable: plPdfTable };
}
