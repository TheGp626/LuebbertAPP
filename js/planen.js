/* ══ PLANEN: staffing the week (Jenni, 25.11.2026), the section „Planen“ of the Plan tab (wpSetView('plan') → initPlanen).
   The data is the Besetzungsplaner's (planer.js: plState, plSave, plPlace, plPublish …); this file only paints it:
   a week board where every place is a seat, and one sheet per Einsatz with everything needed to fill it.
   New Auftragsbestätigungen are still read in the background (ordParseNew, auftraege.js), so their phases arrive here.
   Pure helpers first (tests/planen.test.js), then the DOM part. Styles: .pn-* in css/ui.css. ══ */

var PN_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
var PN_SEATS_MAX = 12; // more places than this show as "+n"

// Open places of a row: missing MA plus open places of other kinds (driver, agency)
function pnOpenCount(row) {
  return plOpenSlots(row).reduce(function(n, o) { return n + o.count; }, 0);
}

// State of a row for its colour bar: 'full' | 'part' | 'empty' | 'none' (nothing asked for)
function pnRowState(row) {
  var need = (row && row.need) || 0, open = pnOpenCount(row), filled = plFilled(row);
  if (!need && !open) return 'none';
  if (!open) return 'full';
  return filled ? 'part' : 'empty';
}

// One entry per day of the week: { date, rows, open } (open = places still missing that day)
function pnDays(week, rows) {
  var out = [];
  for (var i = 0; i < 7; i++) {
    var d = plAddDays(week.weekStart, i), list = plSorted(rows || []).filter(function(r) { return r.date === d; });
    out.push({ date: d, rows: list, open: list.reduce(function(n, r) { return n + pnOpenCount(r); }, 0) });
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
  var waiting = plOpenMeldungen(r, plApplied(r)), gone = {};
  plCancelsOnRow(r, st.keys[r.id], st.cancels, wpUsers).forEach(function(c) { if (c.index !== -1) gone[c.user_id] = true; });
  var nGone = Object.keys(gone).length;
  var count = need || open ? filled + '/' + (need || filled) : (filled ? String(filled) : '');
  var label = (r.venue || 'Ohne Ort') + (r.title ? ', ' + r.title : '') + (need ? ', ' + filled + ' von ' + need + ' besetzt' : '') +
    (waiting ? ', ' + waiting + (waiting === 1 ? ' Meldung' : ' Meldungen') : '') + (nGone ? ', ' + nGone + ' abgesagt' : '');
  return '<button type="button" class="pn-row pn-' + pnRowState(r) + '" onclick="pnOpen(\'' + jsAttrArg(r.id) + '\')" aria-label="' + pnE(label) + '">' +
    '<span class="pn-time"><b>' + pnE(w.time || '–') + '</b><small>' + pnE(w.label || (r.phase ? PL_PHASE[r.phase] : '')) + '</small></span>' +
    '<span class="pn-main">' +
      '<span class="pn-what"><b>' + pnE(r.venue || 'Ohne Ort') + '</b>' + (r.title ? '<span>' + pnE(r.title) + '</span>' : '') + plKindTag(r) + '</span>' +
      pnSeatsHtml(r, gone) +
      ((waiting || nGone || st.stale.indexOf(r.id) !== -1) ? '<span class="pn-flags">' +
        (waiting ? '<span class="pn-flag pn-flag-new">' + waiting + (waiting === 1 ? ' Meldung' : ' Meldungen') + '</span>' : '') +
        (nGone ? '<span class="pn-flag pn-flag-gone">' + nGone + ' abgesagt</span>' : '') +
        (st.stale.indexOf(r.id) !== -1 ? '<span class="pn-flag pn-flag-gone">Auftrag nicht mehr in dieser Woche</span>' : '') + '</span>' : '') +
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
        (planner ? '<button type="button" class="ui-btn" onclick="plEditRow(null)">Neuer Eintrag</button>' : '') +
        '<button type="button" class="ui-icon-btn" aria-label="Weitere Aktionen" onclick="pnMenu()">' + uiIcon('dots') + '</button>' +
      '</div>' : '') +
  '</header>';
}

function pnMenu() {
  var who = plWho(), st = plState, planner = plCanPublish(who), items = [{ label: 'Als PDF herunterladen', action: 'plExportPdf' }];
  if (planner && st && st.draft && st.draft.published_version != null && st.planWeek && st.planWeek.version !== st.draft.published_version)
    items.push({ label: 'Entwurf aus dem aktuellen Plan neu aufbauen', action: 'plRestart' });
  if (planner) items.push({ label: 'Woche löschen', action: 'plDeleteWeek', danger: true });
  openUiMenu(items);
}

function pnStripHtml(days) {
  var today = localDateStr();
  return '<nav class="pn-strip" aria-label="Tage der Woche">' + days.map(function(d) {
    var dt = plUtc(d.date), mark = !d.rows.length ? '<em class="pn-strip-none">–</em>'
      : d.open ? '<em class="pn-strip-open">' + d.open + '</em>' : '<em class="pn-strip-ok">✓</em>';
    var label = PL_DAYS[dt.getUTCDay()] + ' ' + dt.getUTCDate() + '.: ' + (!d.rows.length ? 'kein Einsatz' : d.open ? d.open + ' offen' : 'alles besetzt');
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
  var canNeed = row.job_no ? ((typeof ordCanEdit === 'function') && ordCanEdit()) : can;
  var stepper = '<div class="pn-need">' +
    '<div><b>' + (need ? filled + ' von ' + need + ' besetzt' : filled ? filled + ' eingeplant' : 'Noch keine MA gebraucht') + '</b>' +
      '<span>' + (row.job_no ? 'MA laut Auftrag ' + pnE(row.job_no) : 'MA für diesen Eintrag') + '</span></div>' +
    (canNeed ? '<div class="ord-step" role="group" aria-label="MA gebraucht">' +
      '<button type="button" aria-label="Einen MA weniger"' + (need ? '' : ' disabled') + ' onclick="pnNeed(' + id + ', -1)">' + ORD_ICON.minus + '</button>' +
      '<output>' + need + '<small>MA</small></output>' +
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
    (can ? '<button type="button" class="ord-textbtn pn-edit" onclick="plEditRow(' + id + ')">Eintrag bearbeiten</button>' : '') +
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
