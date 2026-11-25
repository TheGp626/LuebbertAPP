/* ══ PLANEN: staffing the week (Jenni, 25.11.2026), the section „Planen“ of the Plan tab (wpSetView('plan') → initPlanen).
   The data is the Besetzungsplaner's (planer.js: plState, plSave, plPlace, plPublish …); this file only paints it:
   a week board where every place is a seat, and one sheet per Einsatz with everything needed to fill it.
   New Auftragsbestätigungen are still read in the background (ordParseNew, auftraege.js), so their phases arrive here.
   „Plant den Wochenplan“ and „Sieht Bewerbungen“ are one switch „Planung“ (migration planung_ein_schalter).
   Pure helpers first (tests/planen.test.js), then the DOM part. Styles: .pn-* in css/ui.css. ══ */

var PN_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
var PN_SEATS_MAX = 12; // more places than this show as "+n"

// Open places of a row: missing MA plus open places of other kinds (driver, agency)
function pnOpenCount(row) {
  return plOpenSlots(row).reduce(function(n, o) { return n + o.count; }, 0);
}

// State of a row for its colour bar: 'full' | 'part' | 'empty' | 'none' (nothing asked for) | 'unknown' (no MA number yet)
function pnRowState(row) {
  if (row && row.need == null) return 'unknown';
  var need = row.need || 0, open = pnOpenCount(row), filled = plFilled(row);
  if (!need && !open) return 'none';
  if (!open) return 'full';
  return filled ? 'part' : 'empty';
}

// One entry per day of the week: { date, rows, open, unknown } (open = places still missing, unknown = rows without MA number)
function pnDays(week, rows) {
  var out = [];
  for (var i = 0; i < 7; i++) {
    var d = plAddDays(week.weekStart, i), list = plSorted(rows || []).filter(function(r) { return r.date === d; });
    out.push({ date: d, rows: list, open: list.reduce(function(n, r) { return n + pnOpenCount(r); }, 0),
      unknown: list.filter(function(r) { return r.need == null; }).length });
  }
  return out;
}

// Seats of a row: the people on MA places, then one empty seat per missing MA place; drivers come last, marked.
// [{ kind: 'person'|'open'|'driver', p? }]
function pnSeats(row) {
  var people = (row && row.people) || [], seats = [];
  people.forEach(function(p) { if (!plIsDriver(p)) seats.push({ kind: 'person', p: p }); });
  var missing = Math.max(0, ((row && row.need) || 0) - plFilled(row));
  for (var i = 0; i < missing; i++) seats.push({ kind: 'open' });
  plOpenOther(row).forEach(function(o) { for (var j = 0; j < o.count; j++) seats.push({ kind: 'open', role: o.role }); });
  people.forEach(function(p) { if (plIsDriver(p)) seats.push({ kind: 'driver', p: p }); });
  return seats;
}

// Changes a revised Bestätigung made (auftrag_changes) that nobody has looked at yet, as readable lines
var PN_FIELD_LABELS = { date: 'Tag', wann: 'Zeit', location: 'Raum / Veranstaltung', title: 'Name' };
function pnChangeLines(row) {
  var show = function(field, v) {
    if (v == null || v === '') return '–';
    return field === 'date' ? plDayShort(v) : String(v).replace(/\n/g, ', ');
  };
  return (Array.isArray(row && row.auftrag_changes) ? row.auftrag_changes : []).filter(function(c) { return c && !c.seen; }).map(function(c) {
    var label = PN_FIELD_LABELS[c.field] || c.field;
    return c.kept ? label + ': laut Auftrag jetzt ' + show(c.field, c.to) + ', von Hand ' + show(c.field, c.from) + ' behalten'
      : label + ': ' + show(c.field, c.from) + ' → ' + show(c.field, c.to);
  });
}

// "07:00" → "7", "22:30" → "22.30" (the way the plan writes times)
function pnPlanTime(t) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return '';
  return String(parseInt(m[1], 10)) + (m[2] === '00' ? '' : '.' + m[2]);
}

// Quick Einsatz without a Bestätigung: one row for the Aufbau and, when its day is filled, one for the Abbau, linked by
// pair_id. form = { venue, was, kind, need, setupDate, setupTime, teardownDate, teardownTime }. → { rows } | { error }
function pnQuickRows(form, week, pairId) {
  var venue = plText(form.venue), was = plText(form.was);
  if (!venue && !was) return { error: 'Bitte Ort oder „Was“ eintragen.' };
  var inWeek = function(d) { return !!d && d >= week.weekStart && d <= week.weekEnd; };
  if (!inWeek(form.setupDate)) return { error: 'Der Aufbau muss in KW ' + week.kw + ' liegen.' };
  if (form.teardownDate && form.teardownDate < form.setupDate) return { error: 'Der Abbau liegt vor dem Aufbau.' };
  if (form.teardownDate && !inWeek(form.teardownDate)) return { error: 'Der Abbau muss in KW ' + week.kw + ' liegen. Einen späteren Abbau trägst du in seiner Woche ein.' };
  var need = Math.max(0, Math.min(99, parseInt(form.need, 10) || 0)), kind = PL_KINDS[form.kind] ? form.kind : 'auftrag';
  var make = function(date, label, time) {
    var t = pnPlanTime(time);
    return { year: week.year, kw: week.kw, date: date, sort: 0, job_no: null, phase: null, venue: venue, location: null, title: was, details: null,
      wann: label + (t ? ': ' + t + ' Uhr' : ''), ap: null, ap_user_id: null, notes: null, need: need, people: [], kind: kind,
      pair_id: form.teardownDate ? pairId : null };
  };
  var rows = [make(form.setupDate, 'Aufbau', form.setupTime)];
  if (form.teardownDate) rows.push(make(form.teardownDate, 'Abbau', form.teardownTime));
  return { rows: rows };
}

// „Woche vorbereiten“: free entries (no Auftrag) of another week → copies on the same weekdays of `toWeek`, without people;
// a copied pair gets a new pair_id. newId() makes ids (crypto.randomUUID in the browser).
function pnCopyRows(rows, fromWeek, toWeek, newId) {
  var shift = Math.round((plUtc(toWeek.weekStart) - plUtc(fromWeek.weekStart)) / 864e5), pairs = {};
  var keep = ['sort', 'venue', 'location', 'title', 'details', 'wann', 'ap', 'ap_user_id', 'notes', 'need', 'kind', 'open_other'];
  return (rows || []).filter(function(r) { return !r.job_no; }).map(function(r) {
    var out = { year: toWeek.year, kw: toWeek.kw, date: plAddDays(r.date, shift), people: [] };
    keep.forEach(function(k) { if (k in r) out[k] = r[k]; });
    if (r.pair_id) out.pair_id = pairs[r.pair_id] || (pairs[r.pair_id] = newId ? newId() : null);
    return out;
  });
}

// "PB" for "Piotr B.", "K" for "Konrad"
function pnInitials(name) {
  var w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase();
}

// "1.–7. Dezember" / "29. Dezember – 4. Januar"
function pnWeekRange(week) {
  var a = plUtc(week.weekStart), b = plUtc(week.weekEnd);
  return a.getUTCMonth() === b.getUTCMonth()
    ? a.getUTCDate() + '.–' + b.getUTCDate() + '. ' + PN_MONTHS[b.getUTCMonth()]
    : a.getUTCDate() + '. ' + PN_MONTHS[a.getUTCMonth()] + ' – ' + b.getUTCDate() + '. ' + PN_MONTHS[b.getUTCMonth()];
}

/* ── DOM ── */

var _pnJobs = {};       // job no → { job, file } from the Auftragsbestätigungen (material, notes, PDF)
var _pnQuery = '';      // search text in the sheet, kept across repaints
var _pnParsedOnce = false;
var _pnAutoStarted = {}; // 'year-kw' → draft creation already tried this session

// Entry point of the tab (app.js selectMode, auth.js after login)
async function initPlanen() {
  var box = plBox();
  if (!box) return;
  if (typeof plLoadFlag === 'function' && window.plReady === undefined) await plLoadFlag();
  if (!(typeof plTabVisible === 'function' && plTabVisible())) return; // wpSetView only offers „Planen“ to who may plan
  if (typeof mitLoadPhotos === 'function') mitLoadPhotos().then(function() { if (plState) pnPaint(); });
  if (!_pnParsedOnce) {
    _pnParsedOnce = true;
    // New Bestätigungen are read in the background; when one was new, the board reloads with its phases
    ordParseNew().then(function(r) { _pnJobs = (r && r.jobs) || _pnJobs; if (r && r.fresh && plActive()) plRender(); else if (plState) pnPaint(); });
  }
  await plRender();
}

function pnE(s) { return escapeHtml(s == null ? '' : String(s)); }

function pnSeatHtml(seat) {
  if (seat.kind === 'open') return '<i class="pn-seat pn-seat-open"' + (seat.role ? ' data-role="' + pnE(seat.role.charAt(0)) + '"' : '') + '></i>';
  var p = seat.p, inner = pnE(pnInitials(p.name));
  if (p.user_id && typeof mitAvatarInner === 'function') inner = mitAvatarInner(p.user_id, inner);
  return '<i class="pn-seat' + (seat.kind === 'driver' ? ' pn-seat-driver' : '') + (seat.gone ? ' pn-seat-gone' : '') + '">' + inner + '</i>';
}

function pnSeatsHtml(row, gone) {
  var seats = pnSeats(row);
  seats.forEach(function(s) { if (s.p && s.p.user_id && gone[s.p.user_id]) s.gone = true; });
  var shown = seats.slice(0, PN_SEATS_MAX), more = seats.length - shown.length;
  return '<span class="pn-seats" aria-hidden="true">' + shown.map(pnSeatHtml).join('') + (more > 0 ? '<i class="pn-seat pn-seat-more">+' + more + '</i>' : '') + '</span>';
}

function pnRowHtml(r) {
  var st = plState, w = planWhen(plLines(r.wann)), need = r.need || 0, filled = plFilled(r), open = pnOpenCount(r);
  var waiting = plOpenMeldungen(r, plApplied(r)), gone = {}, changed = pnChangeLines(r).length;
  plCancelsOnRow(r, st.keys[r.id], st.cancels, wpUsers).forEach(function(c) { if (c.index !== -1) gone[c.user_id] = true; });
  var nGone = Object.keys(gone).length;
  var count = r.need == null ? 'MA?' : need || open ? filled + '/' + (need || filled) : (filled ? String(filled) : '');
  var label = (r.venue || 'Ohne Ort') + (r.title ? ', ' + r.title : '') + (r.need == null ? ', MA-Zahl fehlt noch' : need ? ', ' + filled + ' von ' + need + ' besetzt' : '') +
    (waiting ? ', ' + waiting + (waiting === 1 ? ' Meldung' : ' Meldungen') : '') + (nGone ? ', ' + nGone + ' abgesagt' : '');
  return '<button type="button" class="pn-row pn-' + pnRowState(r) + '" onclick="pnOpen(\'' + jsAttrArg(r.id) + '\')" aria-label="' + pnE(label) + '">' +
    '<span class="pn-time"><b>' + pnE(w.time || '–') + '</b><small>' + pnE(w.label || (r.phase ? PL_PHASE[r.phase] : '')) + '</small></span>' +
    '<span class="pn-main">' +
      '<span class="pn-what"><b>' + pnE(r.venue || 'Ohne Ort') + '</b>' + (r.title ? '<span>' + pnE(r.title) + '</span>' : '') + plKindTag(r) + '</span>' +
      pnSeatsHtml(r, gone) +
      ((waiting || nGone || changed || st.stale.indexOf(r.id) !== -1) ? '<span class="pn-flags">' +
        (changed ? '<span class="pn-flag pn-flag-changed">Auftrag geändert</span>' : '') +
        (waiting ? '<span class="pn-flag pn-flag-new">' + waiting + (waiting === 1 ? ' Meldung' : ' Meldungen') + '</span>' : '') +
        (nGone ? '<span class="pn-flag pn-flag-gone">' + nGone + ' abgesagt</span>' : '') +
        (st.stale.indexOf(r.id) !== -1 ? '<span class="pn-flag pn-flag-gone">Auftrag nicht mehr gültig</span>' : '') + '</span>' : '') +
    '</span>' +
    '<span class="pn-count">' + pnE(count) + '</span>' +
  '</button>';
}

function pnHeadHtml(st, who) {
  var b = plBounds(), planner = plCanPublish(who);
  var arrow = function(dir, label, off, path) {
    return '<button type="button" class="ui-icon-btn" aria-label="' + label + '" onclick="plStepWeek(' + dir + ')"' + (off ? ' disabled' : '') +
      '><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg></button>';
  };
  var status = '';
  if (st.draft) {
    var d = st.draft, pw = st.planWeek;
    if (d.published_version != null && pw && pw.version === d.published_version)
      status = plHasUnpublished(st.rows, d.published_at) ? 'Veröffentlicht, mit Änderungen, die noch keiner sieht' : 'Veröffentlicht, alle sehen den Plan';
    else if (d.published_version != null && pw) status = 'Der Plan wurde seitdem per PDF ersetzt';
    else if (pw) status = 'Entwurf, es gibt schon einen hochgeladenen Plan';
    else status = 'Entwurf, noch nicht veröffentlicht';
  }
  return '<header class="pn-head">' +
    '<div class="pn-weeknav">' + arrow(-1, 'Vorige Woche', st.week.weekStart <= b.min, 'M14 6l-6 6 6 6') +
      '<div class="pn-weektitle"><b>KW ' + st.week.kw + '</b><span>' + pnWeekRange(st.week) + '</span></div>' +
      arrow(1, 'Nächste Woche', st.week.weekStart >= b.max, 'M10 6l6 6-6 6') + '</div>' +
    (st.draft ? '<div class="pn-status">' + pnE(status) + '</div>' +
      '<div class="pn-actions">' +
        (planner ? '<button type="button" class="ui-btn ui-btn-primary" onclick="plPublish()">Veröffentlichen</button>' : '') +
        (planner ? '<button type="button" class="ui-btn" onclick="pnQuickOpen()">Neuer Eintrag</button>' : '') +
        '<button type="button" class="ui-icon-btn" aria-label="Weitere Aktionen" onclick="pnMenu()">' + uiIcon('dots') + '</button>' +
      '</div>' : '') +
  '</header>';
}

function pnMenu() {
  var who = plWho(), st = plState, planner = plCanPublish(who), items = [{ label: 'Als PDF herunterladen', action: 'plExportPdf' }];
  if (planner && st && st.draft && st.draft.published_version != null && st.planWeek && st.planWeek.version !== st.draft.published_version)
    items.push({ label: 'Entwurf aus dem aktuellen Plan neu aufbauen', action: 'plRestart' });
  if (planner) items.push({ label: 'Woche vorbereiten (aus der Vorwoche)', action: 'pnPrepareOpen' });
  if (planner) items.push({ label: 'Woche löschen', action: 'plDeleteWeek', danger: true });
  openUiMenu(items);
}

function pnStripHtml(days) {
  var today = localDateStr();
  return '<nav class="pn-strip" aria-label="Tage der Woche">' + days.map(function(d) {
    var dt = plUtc(d.date), mark = !d.rows.length ? '<em class="pn-strip-none">–</em>'
      : d.open ? '<em class="pn-strip-open">' + d.open + '</em>' : d.unknown ? '<em class="pn-strip-unknown">?</em>' : '<em class="pn-strip-ok">✓</em>';
    var label = PL_DAYS[dt.getUTCDay()] + ' ' + dt.getUTCDate() + '.: ' + (!d.rows.length ? 'kein Einsatz' : d.open ? d.open + ' offen' : d.unknown ? 'MA-Zahl fehlt' : 'alles besetzt') +
      (d.open && d.unknown ? ', bei ' + d.unknown + ' fehlt die MA-Zahl' : '');
    return '<button type="button" class="pn-strip-day' + (d.date === today ? ' pn-today' : '') + '" aria-label="' + pnE(label) + '" onclick="pnJump(\'' + d.date + '\')">' +
      '<span>' + PL_DAYS_SHORT[dt.getUTCDay()] + '</span><b>' + dt.getUTCDate() + '</b>' + mark + '</button>';
  }).join('') + '</nav>';
}

function pnJump(date) {
  var el = document.getElementById('pn-day-' + date);
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

// Meldungen and Absagen across the week: a line each, tapping opens the first Einsatz concerned
function pnAlertsHtml(st, rows, who) {
  var withMeld = rows.filter(function(r) { return plOpenMeldungen(r, plApplied(r)); });
  var nMeld = withMeld.reduce(function(n, r) { return n + plOpenMeldungen(r, plApplied(r)); }, 0);
  var withGone = rows.filter(function(r) { return plCancelsOnRow(r, st.keys[r.id], st.cancels, wpUsers).length; });
  var nGone = plCancelCount(st), lost = plUnmatchedCancels(st.keys, st.cancels), planner = plCanPublish(who);
  var out = '';
  if (nMeld) out += '<button type="button" class="pn-alert pn-alert-new" onclick="pnOpen(\'' + jsAttrArg(withMeld[0].id) + '\')">' +
    (nMeld === 1 ? '1 Meldung wartet auf Antwort' : nMeld + ' Meldungen warten auf Antwort') + '</button>';
  if (nGone && withGone.length) out += '<button type="button" class="pn-alert pn-alert-gone" onclick="pnOpen(\'' + jsAttrArg(withGone[0].id) + '\')">' +
    (nGone === 1 ? '1 Absage braucht Ersatz' : nGone + ' Absagen brauchen Ersatz') + '</button>';
  out += lost.map(function(c) {
    var u = wpUsers.find(function(x) { return x.id === c.user_id; });
    return '<div class="pn-alert pn-alert-gone">' + pnE(u ? u.full_name : 'Jemand') + ' hat für ' + pnE(c.key.split('|').slice(1).join(' ')) + ' (' + plDayShort(c.key.slice(0, 10)) +
      ') abgesagt, der Eintrag steht nicht mehr im Entwurf.' + (planner ? ' <button type="button" class="ord-textbtn" onclick="plCancelDone(\'' + jsAttrArg(c.key) + '\', \'' + jsAttrArg(c.user_id) + '\')">Erledigt</button>' : '') + '</div>';
  }).join('');
  return out ? '<div class="pn-alerts">' + out + '</div>' : '';
}

function pnPaint() {
  var box = plBox(), st = plState;
  if (!box || !st || !plActive()) return;
  var who = plWho(), planner = plCanPublish(who);
  st.keys = plRowKeys(st.week, st.rows, wpUsers);
  if (!st.draft) {
    // Whoever plans gets the draft right away (once per week and session, so a failing insert does not loop);
    // a week with an uploaded PDF plan still asks first, because the draft then takes over that plan's entries
    var key = st.week.year + '-' + st.week.kw;
    if (planner && !st.planWeek && !_pnAutoStarted[key]) {
      _pnAutoStarted[key] = true;
      box.innerHTML = pnHeadHtml(st, who) + '<div class="wp-empty">KW ' + st.week.kw + ' wird angelegt…</div>';
      plStart();
      return;
    }
    var text, btn = '<button type="button" class="ui-btn ui-btn-primary wp-empty-btn" onclick="plStart()">Woche planen</button>';
    if (st.planWeek && !planner) { text = 'Diese Woche hat schon einen hochgeladenen Plan. Weiterplanen kann hier nur, wer den Wochenplan plant.'; btn = ''; }
    else if (st.planWeek) text = 'Der Plan dieser Woche wurde als PDF hochgeladen. Alle Einträge daraus kommen mit, du planst hier weiter.';
    else text = 'Die Aufträge dieser Woche kommen gleich mit, samt allen, die schon angenommen sind. Alles andere trägst du dazu ein.';
    box.innerHTML = pnHeadHtml(st, who) + uiEmptyHtml('KW ' + st.week.kw + ' ist noch nicht geplant', text, btn);
    pnSheetPaint();
    return;
  }
  var days = pnDays(st.week, st.rows), html = '';
  days.forEach(function(d) {
    var dt = plUtc(d.date);
    html += '<section class="pn-day" id="pn-day-' + d.date + '"><h3 class="pn-dayhead">' + PL_DAYS[dt.getUTCDay()] +
      ' <span>' + dt.getUTCDate() + '. ' + PN_MONTHS[dt.getUTCMonth()] + '</span>' +
      (d.open ? '<em class="pn-day-open">' + d.open + ' offen</em>' : '') + '</h3>' +
      (d.rows.length ? d.rows.map(pnRowHtml).join('') : '<div class="pn-none">Kein Einsatz</div>') + '</section>';
  });
  box.innerHTML = pnHeadHtml(st, who) + pnStripHtml(days) + pnAlertsHtml(st, plSorted(st.rows), who) + html +
    (planner ? '' : '<p class="pn-note">Du besetzt deine Aufträge. Veröffentlicht wird der Plan von der Planung.</p>');
  pnSheetPaint();
}

/* ── The Einsatz sheet ── */

function pnOpen(id) {
  plOpenRow = id;
  _pnQuery = '';
  if (plState) plState.replace = null;
  pnSheetPaint();
}

function pnClose() {
  plOpenRow = null;
  if (plState) plState.replace = null;
  var m = document.getElementById('pn-sheet');
  if (m) m.remove();
}

function pnPersonHint(uid, date, rowId) {
  var st = plState, h = [], lvl = st.avail[uid + '|' + date];
  if (lvl === 'nein') h.push('<span class="ord-pill ord-pill-danger">geht nicht</span>');
  else if (lvl === 'notfall') h.push('<span class="ord-pill ord-pill-warn">nur im Notfall</span>');
  if (st.rows.some(function(r) { return r.id !== rowId && r.date === date && (r.people || []).some(function(p) { return p.user_id === uid; }); }))
    h.push('<span class="ord-pill ord-pill-danger">schon eingeplant</span>');
  return h.join('');
}

function pnAvatar(uid, name) {
  var inner = pnE(pnInitials(name));
  return '<i class="pn-seat">' + (uid && typeof mitAvatarInner === 'function' ? mitAvatarInner(uid, inner) : inner) + '</i>';
}

// Who may be asked by push about this row: an Auftrag phase, or a published plan entry
function pnAskTarget(row) {
  var st = plState;
  if (row.job_no) return { kind: 'order', a: row.job_no, b: row.phase };
  if (st.planWeek && st.keys[row.id]) return { kind: 'shift', a: st.planWeek.id, b: st.keys[row.id] };
  return null;
}

function pnSheetPaint() {
  var row = plOpenRow ? plRowById(plOpenRow) : null, old = document.getElementById('pn-sheet');
  if (!row || !plActive()) { if (old) old.remove(); return; }
  var st = plState, who = plWho(), can = plCanEdit(row, who), id = "'" + jsAttrArg(row.id) + "'";
  var w = planWhen(plLines(row.wann)), dt = plUtc(row.date), applied = plApplied(row), rp = plReplacing(row);
  var need = row.need || 0, filled = plFilled(row);
  var job = row.job_no ? _pnJobs[row.job_no] : null;
  var decide = (typeof ordCanDecide === 'function') && ordCanDecide();
  var ask = pnAskTarget(row);
  var askLabel = [PL_DAYS_SHORT[dt.getUTCDay()] + ' ' + dt.getUTCDate() + '.' + (dt.getUTCMonth() + 1) + '.' + (w.time ? ' ' + w.time : ''), row.venue, row.title, w.label].filter(Boolean).join(', ');
  var askBtn = function(uid, name) {
    return ask && decide ? '<button type="button" class="ord-textbtn" onclick="ordAsk(\'' + ask.kind + '\', \'' + jsAttrArg(ask.a) + '\', \'' + jsAttrArg(ask.b) + '\', \'' +
      jsAttrArg(uid) + '\', \'' + jsAttrArg(askLabel) + '\', \'' + jsAttrArg(name) + '\')">Fragen</button>' : '';
  };
  var placeBtn = function(uid, label) { return can ? '<button type="button" class="ui-btn ui-btn-primary pn-small" onclick="plPlace(' + id + ', \'' + jsAttrArg(uid) + '\')">' + (label || 'Einplanen') + '</button>' : ''; };

  // Places: the stepper (an Auftrag's number is the PL's, written to order_staffing; a free entry's is the planner's)
  // Auftrag numbers: PL, Admin and Planung (RLS on order_staffing, migration planen_flow); a free entry's: whoever edits it
  var canNeed = row.job_no ? (((typeof ordCanEdit === 'function') && ordCanEdit()) || plCanPublish(who)) : can;
  var stepper = '<div class="pn-need">' +
    '<div><b>' + (row.need == null ? 'Wie viele MA? Noch nicht eingetragen' : need ? filled + ' von ' + need + ' besetzt' : filled ? filled + ' eingeplant' : 'Noch keine MA gebraucht') + '</b>' +
      '<span>' + (row.job_no ? 'MA laut Auftrag ' + pnE(row.job_no) : 'MA für diesen Eintrag') + '</span></div>' +
    (canNeed ? '<div class="ord-step" role="group" aria-label="MA gebraucht">' +
      '<button type="button" aria-label="Einen MA weniger"' + (need ? '' : ' disabled') + ' onclick="pnNeed(' + id + ', -1)">' + ORD_ICON.minus + '</button>' +
      '<output>' + (row.need == null ? '–' : need) + '<small>MA</small></output>' +
      '<button type="button" aria-label="Einen MA mehr"' + (need >= 99 ? ' disabled' : '') + ' onclick="pnNeed(' + id + ', 1)">' + ORD_ICON.plus + '</button></div>' : '') +
  '</div>';

  // On the Einsatz, Absagen inline
  var cancels = plCancelsOnRow(row, st.keys[row.id], st.cancels, wpUsers), goneIdx = {};
  cancels.forEach(function(c) { if (c.index !== -1) goneIdx[c.index] = c; });
  var people = (row.people || []).map(function(p, i) {
    var c = goneIdx[i], vb = p.user_id ? plVorbehalt(row, p.user_id) : '';
    return '<li class="pn-person' + (c ? ' pn-person-gone' : '') + '">' + pnAvatar(p.user_id, p.name) +
      '<span class="pn-person-main"><b>' + pnE(p.name) + '</b>' +
        '<span>' + (can ? '<button type="button" class="ord-textbtn" onclick="plRoleMenu(' + id + ', ' + i + ')" aria-label="Rolle von ' + pnE(p.name) + ' ändern">' + pnE(p.role || 'MA') + '</button>' : pnE(p.role || 'MA')) +
          (vb ? ' ' + pnE(vb) : '') + (p.note ? ' ' + pnE(p.note) : '') + (c ? ' hat abgesagt' : '') + '</span></span>' +
      (c && can ? '<span class="pn-person-acts"><button type="button" class="ui-btn ui-btn-primary pn-small" onclick="plStartReplace(' + id + ', \'' + jsAttrArg(c.user_id) + '\')">Ersatz suchen</button>' +
        '<button type="button" class="ord-textbtn" onclick="plCancelDrop(' + id + ', \'' + jsAttrArg(c.user_id) + '\')">Nur austragen</button></span>'
        : can ? '<button type="button" class="ui-icon-btn" aria-label="' + pnE(p.name) + ' austragen" onclick="plRemove(' + id + ', ' + i + ')">' + ORD_ICON.x + '</button>' : '') +
    '</li>';
  }).join('') + cancels.filter(function(c) { return c.index === -1; }).map(function(c) {
    return '<li class="pn-person pn-person-gone"><span class="pn-person-main"><b>' + pnE(c.name) + '</b><span>hat abgesagt und steht nicht mehr drauf</span></span>' +
      (can ? '<button type="button" class="ord-textbtn" onclick="plCancelDone(\'' + jsAttrArg(st.keys[row.id]) + '\', \'' + jsAttrArg(c.user_id) + '\')">Erledigt</button>' : '') + '</li>';
  }).join('');

  // Candidates, in three groups: they asked (Meldung), they have time, everyone else (searchable)
  var cands = plCandidates(row, st.rows, wpUsers, st.avail, applied, st.tracked);
  var meld = cands.filter(function(c) { return c.applied === 'offen'; });
  var free = cands.filter(function(c) { return !c.applied && c.free; });
  var rest = cands.filter(function(c) { return !(c.applied === 'offen') && !(!c.applied && c.free); });
  var uName = function(c) { var u = wpUsers.find(function(x) { return x.id === c.id; }); return (u && u.full_name) || c.name; };
  var meldHtml = meld.map(function(c) {
    var vb = plVorbehalt(row, c.id);
    return '<li class="pn-person">' + pnAvatar(c.id, uName(c)) +
      '<span class="pn-person-main"><b>' + pnE(uName(c)) + '</b><span>' + (vb ? '<span class="ord-pill ord-pill-warn">' + pnE(vb) + '</span>' : 'hat sich gemeldet') + pnPersonHint(c.id, row.date, row.id) + '</span></span>' +
      '<span class="pn-person-acts">' + placeBtn(c.id) +
        (decide ? '<button type="button" class="ui-icon-btn" aria-label="' + pnE(uName(c)) + ' absagen" onclick="plMeldungSet(' + id + ', \'' + jsAttrArg(c.id) + '\', \'offen\', \'abgelehnt\')">' + ORD_ICON.x + '</button>' : '') +
      '</span></li>';
  }).join('');
  var freeHtml = free.map(function(c) {
    return '<li class="pn-person">' + pnAvatar(c.id, uName(c)) + '<span class="pn-person-main"><b>' + pnE(uName(c)) + '</b><span>hat Zeit</span></span>' +
      '<span class="pn-person-acts">' + askBtn(c.id, uName(c)) + placeBtn(c.id) + '</span></li>';
  }).join('');
  var restHtml = rest.map(function(c) {
    var u = wpUsers.find(function(x) { return x.id === c.id; });
    return '<li class="pn-person pn-cand" data-name="' + pnE(c.name) + '" data-full="' + pnE((u && u.full_name) || '') + '">' + pnAvatar(c.id, uName(c)) +
      '<span class="pn-person-main"><b>' + pnE(uName(c)) + '</b><span>' + (pnPersonHint(c.id, row.date, row.id) || (c.applied === 'angenommen' ? 'angenommen' : '')) + '</span></span>' +
      '<span class="pn-person-acts">' + askBtn(c.id, uName(c)) + placeBtn(c.id) + '</span></li>';
  }).join('');

  var details = '';
  if (job) {
    var mats = job.job.materials || [], n = mats.reduce(function(k, g) { return k + g.items.length; }, 0);
    details = '<div class="pn-docs">' +
      (n ? '<details class="ord-chip-d"><summary class="ord-chip">Material <b>' + n + '</b></summary><div class="ord-chip-body">' + mats.map(function(g) {
        return '<div class="ord-group">' + pnE(g.group) + '</div><ul class="ord-items">' + g.items.map(function(it) { return '<li><b>' + pnE(it.qty) + '×</b> ' + pnE(it.name) + '</li>'; }).join('') + '</ul>';
      }).join('') + '</div></details>' : '') +
      (job.job.notes ? '<details class="ord-chip-d"><summary class="ord-chip">Hinweise</summary><div class="ord-chip-body">' + pnE(job.job.notes).replace(/\n/g, '<br>') + '</div></details>' : '') +
      '<button type="button" class="ord-chip" onclick="ordOpenPdf(\'' + jsAttrArg(job.file.id) + '\')">' + ORD_ICON.file + 'Auftragsbestätigung</button></div>';
  } else if (plLines(row.details).length) {
    details = '<ul class="pl-was">' + plLines(row.details).map(function(t) { return '<li>' + pnE(t) + '</li>'; }).join('') + '</ul>';
  }

  var html = '<div class="sig-modal-inner pn-sheet-inner">' +
    '<div class="ui-sheet-head"><div class="pn-sheet-when">' + PL_DAYS[dt.getUTCDay()] + ', ' + dt.getUTCDate() + '. ' + PN_MONTHS[dt.getUTCMonth()] +
      (w.time ? '<span>' + pnE([w.prefix, w.time, w.label].filter(Boolean).join(' ')) + '</span>' : '') + '</div>' +
      '<button type="button" class="ui-icon-btn" onclick="pnClose()" aria-label="Schließen"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
    '<h3 class="pn-sheet-title">' + pnE(row.venue || 'Ohne Ort') + (row.title ? '<span>' + pnE(row.title) + '</span>' : '') + '</h3>' +
    (plLines(row.location).length || row.ap ? '<p class="pn-sheet-sub">' + pnE(plLines(row.location).join(', ')) + (row.ap ? (plLines(row.location).length ? '<br>' : '') + 'PL ' + pnE(row.ap) : '') + '</p>' : '') +
    details +
    (can ? '<div class="pn-edit"><button type="button" class="ord-textbtn" onclick="plEditRow(' + id + ')">Eintrag bearbeiten</button>' +
      (!row.job_no && plCanPublish(who) ? '<button type="button" class="ord-textbtn" onclick="pnDuplicateMenu(' + id + ')">Duplizieren</button>' : '') + '</div>' : '') +
    pnChangesHtml(row, can) + pnStaleHtml(row) +
    stepper +
    (rp ? '<div class="pn-replace">Ersatz für <b>' + pnE(rp.name) + '</b> wählen <button type="button" class="ord-textbtn" onclick="pnStopReplace()">Abbrechen</button></div>' : '') +
    (people ? '<h4 class="pn-h">Eingeplant</h4><ul class="pn-list">' + people + '</ul>' : '') +
    (meldHtml ? '<h4 class="pn-h">Haben sich gemeldet</h4><ul class="pn-list">' + meldHtml + '</ul>' : '') +
    (can || decide ? (freeHtml ? '<h4 class="pn-h">Haben an dem Tag Zeit</h4><ul class="pn-list">' + freeHtml + '</ul>' : '') +
      '<h4 class="pn-h">' + (meldHtml || freeHtml ? 'Alle anderen' : 'Person einplanen') + '</h4>' +
      '<div class="pl-find">' +
        '<input type="search" class="meta-input" id="pl-search" placeholder="Name suchen" aria-label="Name suchen" autocomplete="off" autocapitalize="words" value="' + pnE(_pnQuery) + '" ' +
          'oninput="pnFilter()" onkeydown="if (event.key === \'Enter\') { event.preventDefault(); pnSearchEnter(); }">' +
        (can ? '<label class="pl-role"><span>als</span><select class="meta-input" id="pl-role" aria-label="Rolle beim Einplanen">' +
          PL_ROLES.map(function(x) { return '<option>' + x + '</option>'; }).join('') + '</select></label>' : '') +
      '</div>' +
      '<ul class="pn-list pn-rest" id="pn-rest">' + (restHtml || '<li class="pn-none">Niemand mehr frei.</li>') + '</ul>' +
      '<p class="pn-none" id="pl-nohit" hidden>Niemand mit diesem Namen in der App.</p>' +
      (can ? '<button type="button" class="ui-btn ui-btn-block" id="pl-free-btn" hidden onclick="plPlaceFree(' + id + ')"></button>' : '') : '') +
  '</div>';

  var m = old;
  if (!m) {
    m = document.createElement('div');
    m.id = 'pn-sheet';
    m.className = 'sig-modal ui-sheet open';
    m.style.setProperty('--sheet-w', '560px');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-label', (row.venue || 'Einsatz') + ' besetzen');
    m.addEventListener('click', function(e) { if (e.target === m) pnClose(); });
    document.body.appendChild(m);
  }
  var scroll = m.firstChild ? m.firstChild.scrollTop : 0, role = (document.getElementById('pl-role') || {}).value;
  m.innerHTML = html;
  m.firstChild.scrollTop = scroll;
  if (role && document.getElementById('pl-role')) document.getElementById('pl-role').value = role;
  if (_pnQuery) pnFilter();
}

function pnChangesHtml(row, can) {
  var lines = pnChangeLines(row);
  if (!lines.length) return '';
  return '<div class="pn-changed"><b>Die Auftragsbestätigung hat sich geändert</b><ul>' + lines.map(function(l) { return '<li>' + pnE(l) + '</li>'; }).join('') + '</ul>' +
    (can ? '<button type="button" class="ui-btn pn-small" onclick="pnSeen(\'' + jsAttrArg(row.id) + '\')">Gesehen</button>' : '') + '</div>';
}

async function pnSeen(id) {
  var row = plRowById(id);
  if (!row) return;
  await plSave(row, { auftrag_changes: (row.auftrag_changes || []).map(function(c) { return Object.assign({}, c, { seen: true }); }) });
}

// An Auftrag that left the week or vanished: delete the entry, or keep it as a free entry (no longer synced)
function pnStaleHtml(row) {
  if (!plState || plState.stale.indexOf(row.id) === -1) return '';
  var planner = plCanPublish(plWho()), id = "'" + jsAttrArg(row.id) + "'";
  return '<div class="pn-stale"><b>Auftrag ' + pnE(row.job_no) + ' ist nicht mehr gültig</b><span>Er ist verschoben, storniert oder nicht mehr in den Projektordnern.</span>' +
    (planner ? '<div class="pn-stale-acts"><button type="button" class="ui-btn ui-btn-danger pn-small" onclick="plDeleteRow(' + id + ')">Eintrag löschen</button>' +
      '<button type="button" class="ui-btn pn-small" onclick="pnKeepStale(' + id + ')">Behalten</button></div>' : '') + '</div>';
}

async function pnKeepStale(id) {
  var row = plRowById(id);
  if (!row) return;
  var note = 'Auftrag ' + row.job_no + ' (nicht mehr gültig)';
  if (await plSave(row, { job_no: null, phase: null, notes: plText([note, row.notes].filter(Boolean).join('\n')) })) {
    plState.stale = plState.stale.filter(function(x) { return x !== id; });
    pnPaint();
  }
}

function pnStopReplace() { if (plState) plState.replace = null; pnSheetPaint(); }

// Filters "Alle anderen" while typing (no repaint: the field keeps its focus) and offers the typed name as a free entry
function pnFilter() {
  var inp = document.getElementById('pl-search'), q = inp ? inp.value.trim() : '', hits = 0;
  _pnQuery = inp ? inp.value : '';
  document.querySelectorAll('#pn-rest .pn-cand').forEach(function(li) {
    var ok = plSearchMatch(q, li.dataset.name, li.dataset.full);
    li.hidden = !ok;
    if (ok) hits++;
  });
  var none = document.getElementById('pl-nohit'), free = document.getElementById('pl-free-btn');
  if (none) none.hidden = !q || hits > 0;
  if (free) { free.hidden = !q; free.textContent = '„' + q + '“ ohne App-Konto eintragen (z. B. Zenjob)'; }
}

function pnSearchEnter() {
  var left = [].filter.call(document.querySelectorAll('#pn-rest .pn-cand'), function(li) { return !li.hidden; });
  var btn = left.length === 1 && left[0].querySelector('.ui-btn-primary');
  if (btn) btn.click();
}

// MA needed: an Auftrag's number is order_staffing (Admin/PL, also read by the Wochenplan „Ich kann“); the draft row follows.
// A free entry's number is only the draft's.
async function pnNeed(id, delta) {
  var row = plRowById(id);
  if (!row) return;
  var v = Math.max(0, Math.min(99, (row.need || 0) + delta));
  if (v === (row.need || 0)) return;
  if (row.job_no) {
    var field = row.phase === 'teardown' ? 'staff_teardown' : 'staff_setup', up = {};
    up.job_no = row.job_no; up[field] = v; up.updated_at = new Date().toISOString();
    var r;
    try { r = await supabaseClient.from('order_staffing').upsert(up, { onConflict: 'job_no' }).select('job_no'); } catch (e) { r = { error: e }; }
    if (r.error || !r.data || !r.data.length) { console.error('MA-Zahl speichern:', r.error); showToast('MA-Zahl nicht gespeichert. Prüf deine Verbindung.', 'danger'); return; }
    if (typeof _ordSaved !== 'undefined') (_ordSaved[row.job_no] = _ordSaved[row.job_no] || {})[field] = v;
    if (!plCanEdit(row, plWho())) { row.need = v; pnPaint(); return; } // the planner's next visit moves the draft row
  }
  await plSave(row, { need: v });
}

/* ── Quick Einsatz, duplicate, Woche vorbereiten ── */

function pnNewId() { return (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null; }

function pnDayOptions(selected, withNone) {
  var st = plState, out = withNone ? '<option value="">kein Abbau</option>' : '';
  for (var i = 0; i < 7; i++) {
    var d = plAddDays(st.week.weekStart, i), dt = plUtc(d);
    out += '<option value="' + d + '"' + (d === selected ? ' selected' : '') + '>' + PL_DAYS[dt.getUTCDay()] + ' ' + dt.getUTCDate() + '.' + (dt.getUTCMonth() + 1) + '.</option>';
  }
  return out;
}

function pnSheetOpen(id, title, body) {
  var old = document.getElementById(id);
  if (old) old.remove();
  var m = document.createElement('div');
  m.id = id;
  m.className = 'sig-modal ui-sheet open';
  m.style.setProperty('--sheet-w', '520px');
  m.setAttribute('role', 'dialog');
  m.setAttribute('aria-label', title);
  m.innerHTML = '<div class="sig-modal-inner"><div class="ui-sheet-head"><h3 class="ui-title" style="font-size:18px;">' + pnE(title) + '</h3>' +
    '<button type="button" class="ui-icon-btn" onclick="document.getElementById(\'' + id + '\').remove()" aria-label="Schließen"><svg class="ui-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' + body + '</div>';
  m.addEventListener('click', function(e) { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  return m;
}

function pnQuickOpen() {
  var st = plState;
  if (!st || !st.draft || !plCanPublish(plWho())) return;
  var today = localDateStr(), first = today >= st.week.weekStart && today <= st.week.weekEnd ? today : st.week.weekStart;
  var field = function(label, html) { return '<label class="ui-field"><span>' + label + '</span>' + html + '</label>'; };
  pnSheetOpen('pn-quick', 'Neuer Einsatz',
    field('Ort', '<input type="text" id="pnq-venue" placeholder="z. B. Estrel" autocomplete="off">') +
    field('Was', '<input type="text" id="pnq-was" placeholder="z. B. Gala, 20 Stehtische" autocomplete="off">') +
    '<div class="pn-quick-grid">' + field('Aufbau', '<select id="pnq-sdate">' + pnDayOptions(first) + '</select>') +
      field('Uhrzeit', '<input type="time" id="pnq-stime" value="07:00">') +
      field('Abbau', '<select id="pnq-tdate">' + pnDayOptions('', true) + '</select>') +
      field('Uhrzeit', '<input type="time" id="pnq-ttime" value="22:00">') + '</div>' +
    '<div class="pn-quick-grid">' + field('MA gebraucht', '<input type="number" id="pnq-need" min="0" max="99" inputmode="numeric" value="2">') +
      (st.hasKind ? field('Art', '<select id="pnq-kind">' + PL_KIND_ORDER.map(function(k) { return '<option value="' + k + '">' + PL_KINDS[k].label + '</option>'; }).join('') + '</select>') : '') + '</div>' +
    '<p class="pn-none">Tag und Uhrzeit für Auf- und Abbau, mehr braucht es nicht. Raum, Material und Notizen gehen über „Alle Felder“ oder später über „Eintrag bearbeiten“.</p>' +
    '<div class="ui-sheet-actions"><button type="button" class="ui-btn" onclick="document.getElementById(\'pn-quick\').remove(); plEditRow(null)">Alle Felder</button>' +
      '<button type="button" class="ui-btn ui-btn-primary" id="pnq-save" onclick="pnQuickSave()">Anlegen</button></div>');
  var v = document.getElementById('pnq-venue');
  if (v) v.focus();
}

async function pnInsertRows(rows) {
  var st = plState, ins;
  try { ins = await supabaseClient.from('plan_draft_shifts').insert(plForInsert(rows)).select('*'); } catch (e) { ins = { error: e }; }
  if (ins.error || !ins.data) { console.error('Einträge anlegen:', ins.error); showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger'); return false; }
  st.rows = st.rows.concat(ins.data);
  pnPaint();
  return true;
}

async function pnQuickSave() {
  var st = plState, val = function(k) { var e = document.getElementById('pnq-' + k); return e ? e.value : ''; };
  if (!st) return;
  var res = pnQuickRows({ venue: val('venue'), was: val('was'), kind: val('kind'), need: val('need'), setupDate: val('sdate'), setupTime: val('stime'),
    teardownDate: val('tdate'), teardownTime: val('ttime') }, st.week, pnNewId());
  if (res.error) { showToast(res.error, 'danger'); return; }
  var btn = document.getElementById('pnq-save');
  if (btn) btn.disabled = true;
  res.rows.forEach(function(r, i) { r.sort = st.rows.length + i; });
  if (await pnInsertRows(res.rows)) {
    var m = document.getElementById('pn-quick');
    if (m) m.remove();
    showToast(res.rows.length === 2 ? 'Aufbau und Abbau angelegt' : 'Einsatz angelegt', 'success');
  } else if (btn) btn.disabled = false;
}

// Duplicate a free entry (with its Abbau or Aufbau, when it is a pair) to another day of the week
function pnDuplicateMenu(id) {
  var st = plState, row = plRowById(id);
  if (!st || !row) return;
  var items = [];
  for (var i = 0; i < 7; i++) {
    var d = plAddDays(st.week.weekStart, i), dt = plUtc(d);
    items.push({ label: 'Kopie am ' + PL_DAYS[dt.getUTCDay()] + ' ' + dt.getUTCDate() + '.' + (dt.getUTCMonth() + 1) + '.', action: 'pnDuplicate', args: [id, d] });
  }
  openUiMenu(items);
}

async function pnDuplicate(id, date) {
  var st = plState, row = plRowById(id);
  if (!st || !row) return;
  var group = row.pair_id ? st.rows.filter(function(r) { return r.pair_id === row.pair_id; }) : [row];
  var copies = pnCopyRows(group, { weekStart: row.date }, { year: st.week.year, kw: st.week.kw, weekStart: date }, pnNewId);
  if (copies.some(function(c) { return c.date < st.week.weekStart || c.date > st.week.weekEnd; })) {
    showToast('Die Kopie läge mit ihrem Auf- oder Abbau außerhalb dieser Woche.', 'danger');
    return;
  }
  if (await pnInsertRows(copies)) showToast(copies.length === 2 ? 'Aufbau und Abbau kopiert' : 'Eintrag kopiert', 'success');
}

// „Woche vorbereiten“: pick free entries of the previous week to copy (regular jobs like Lager days)
var _pnPrepare = null;
async function pnPrepareOpen() {
  var st = plState;
  if (!st || !st.draft || !plCanPublish(plWho())) return;
  var prev = plWeekOf(plAddDays(st.week.weekStart, -7)), r;
  try { r = await supabaseClient.from('plan_draft_shifts').select('*').eq('year', prev.year).eq('kw', prev.kw); } catch (e) { r = { error: e }; }
  if (r.error) { showToast('Die Vorwoche konnte nicht geladen werden.', 'danger'); return; }
  var free = plSorted((r.data || []).filter(function(x) { return !x.job_no; }));
  _pnPrepare = { prev: prev, rows: free };
  pnSheetOpen('pn-prepare', 'Woche vorbereiten', free.length
    ? '<p class="pn-none">Einträge ohne Auftrag aus KW ' + prev.kw + '. Die angehakten kommen auf denselben Wochentag in KW ' + st.week.kw + ', ohne Personal.</p>' +
      '<ul class="pn-list">' + free.map(function(x, i) {
        var dt = plUtc(x.date);
        return '<li class="pn-person"><label class="pn-check"><input type="checkbox" data-i="' + i + '" checked> <span><b>' + pnE(PL_DAYS_SHORT[dt.getUTCDay()] + ' ' + (x.venue || '')) + '</b> ' +
          pnE([x.title, planWhen(plLines(x.wann)).time].filter(Boolean).join(', ')) + '</span></label></li>';
      }).join('') + '</ul>' +
      '<div class="ui-sheet-actions"><button type="button" class="ui-btn ui-btn-primary" onclick="pnPrepareSave()">Übernehmen</button></div>'
    : '<p class="pn-none">KW ' + prev.kw + ' hat keine Einträge ohne Auftrag zum Übernehmen.</p>');
}

async function pnPrepareSave() {
  var st = plState, p = _pnPrepare;
  if (!st || !p) return;
  var pick = [].map.call(document.querySelectorAll('#pn-prepare input[data-i]:checked'), function(c) { return p.rows[+c.dataset.i]; });
  if (!pick.length) { showToast('Nichts angehakt.', 'danger'); return; }
  var copies = pnCopyRows(pick, p.prev, st.week, pnNewId);
  copies.forEach(function(c, i) { c.sort = st.rows.length + i; });
  if (await pnInsertRows(copies)) {
    var m = document.getElementById('pn-prepare');
    if (m) m.remove();
    showToast(copies.length === 1 ? '1 Eintrag übernommen' : copies.length + ' Einträge übernommen', 'success');
  }
}

/* ── Publish inside PLANEN ── */

// What publishing changes, for the confirm sheet. diff = planDiff(old, parsed.shifts) or null for the first Stand.
// people = app users on new or changed entries and on removed ones (an estimate: notify-plan-change decides).
function pnPublishSummary(diff, parsed) {
  var st = diff ? diff.status : parsed.shifts.map(function() { return 'neu'; }), names = {};
  var add = function(s) { (s.people || []).forEach(function(x) { if (x.userId) names[x.name] = true; }); };
  parsed.shifts.forEach(function(s, i) { if (st[i]) add(s); });
  ((diff && diff.removed) || []).forEach(add);
  return { neu: st.filter(function(x) { return x === 'neu'; }).length, geaendert: st.filter(function(x) { return x === 'geändert'; }).length,
    entfernt: ((diff && diff.removed) || []).length, people: Object.keys(names).sort(function(a, b) { return a.localeCompare(b, 'de'); }) };
}

var _pnPublish = null; // { imp, week } while the confirm sheet is open

function pnPublishSheet(imp, week) {
  _pnPublish = { imp: imp, week: week };
  var p = imp.parsed, ex = imp.existing;
  var diff = ex ? planDiff((ex.plan_shifts || []).map(planShiftFromDb), p.shifts) : null;
  var sum = pnPublishSummary(diff, p), checks = [];
  try { checks = planChecks(p.shifts, null); } catch (e) { console.error('Prüfung:', e); }
  var nothing = diff && !sum.neu && !sum.geaendert && !sum.entfernt;
  var stat = function(n, label) { return '<div><b>' + n + '</b><span>' + label + '</span></div>'; };
  pnSheetOpen('pn-publish', 'KW ' + p.kw + ' veröffentlichen',
    (nothing ? '<p class="pn-none">Seit dem letzten Veröffentlichen hat sich nichts geändert.</p>'
      : '<div class="pn-pubstats">' + (diff ? stat(sum.neu, 'neu') + stat(sum.geaendert, 'geändert') + stat(sum.entfernt, 'entfernt') : stat(p.shifts.length, p.shifts.length === 1 ? 'Einsatz' : 'Einsätze')) + '</div>' +
        '<p class="pn-pubpeople">' + (sum.people.length ? '<b>Eine Push-Nachricht bekommen voraussichtlich:</b> ' + pnE(sum.people.join(', ')) : 'Niemand mit App-Konto ist betroffen, es gehen keine Push-Nachrichten raus.') + '</p>') +
    (p.warnings.length ? '<div class="pn-changed">' + p.warnings.map(pnE).join('<br>') + '</div>' : '') +
    (checks.length ? '<div class="pn-changed"><b>Bitte prüfen</b><ul>' + checks.slice(0, 8).map(function(c) { return '<li>' + pnE(c.text) + '</li>'; }).join('') + '</ul>' +
      (checks.length > 8 ? '<span>… und ' + (checks.length - 8) + ' weitere.</span>' : '') + 'Nur Hinweise, veröffentlichen geht trotzdem.</div>' : '') +
    '<div class="ui-sheet-actions"><button type="button" class="ui-btn" onclick="document.getElementById(\'pn-publish\').remove()">Abbrechen</button>' +
      '<button type="button" class="ui-btn ui-btn-primary" id="pn-publish-go" onclick="pnPublishGo()"' + (nothing ? ' disabled' : '') + '>Veröffentlichen</button></div>');
}

async function pnPublishGo() {
  var job = _pnPublish, btn = document.getElementById('pn-publish-go');
  if (!job) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Wird veröffentlicht…'; }
  try {
    var res = await wpCommitPlan(job.imp, []);
    _pnPublish = null;
    var m = document.getElementById('pn-publish');
    if (m) m.remove();
    showToast('KW ' + job.week.kw + ' veröffentlicht', 'success');
    if (res.oldNotDeleted) showToast('Die alten Einsätze der Woche konnten nicht gelöscht werden – Einsätze erscheinen doppelt. Bitte beim Admin melden.', 'danger');
    if (typeof wpWeeks !== 'undefined') wpWeeks = []; // the Wochenplan loads its weeks fresh on its next open
    await plRender();
  } catch (e) {
    console.error('Veröffentlichen:', e);
    showToast('Nicht veröffentlicht: ' + (e.message || e), 'danger');
    if (btn) { btn.disabled = false; btn.textContent = 'Veröffentlichen'; }
  }
}
