/* Aufträge ↔ Daniel's weekly plan: pure helpers, no DOM (used by wochenplan.js and auftraege.js).
 * A slot is one phase (setup = Aufbau, teardown = Abbau) of a sub-order, as returned by the RPC order_slots().
 * Daniel's PDF has no order number, so a slot is matched by date, venue, shared words and phase. */

var ORD_STOP = ['und', 'der', 'die', 'das', 'den', 'dem', 'fur', 'mit', 'von', 'the', 'of', 'im', 'am', 'an', 'in', 'zu', 'bei',
  'aufbau', 'abbau', 'berlin', 'gmbh', 'uhr', 'nach', 'ab', 'bis'];

// Lower case, accents off (ö → o, both sides alike), words of 2+ characters, no pure numbers, no stop words
function ordWords(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ß]+/).filter(function(w) { return w.length >= 2 && !/^\d+$/.test(w) && ORD_STOP.indexOf(w) === -1; });
}

// '261112_Estrel_Business of Apps' → 'estrel'
function ordSlotVenue(title) {
  return ordWords(String(title || '').split('_')[1] || '')[0] || '';
}

// For display, as written: '261109_Neuköllnspeicher_Vernissage' → 'Neuköllnspeicher'
function ordVenueLabel(title) { return (String(title || '').split('_')[1] || '').trim(); }

// First line of Daniel's "wann" names the phase; an empty "wann" fits both
function ordPhaseFits(phase, wann) {
  var first = String(wann || '').trim().split('\n')[0];
  if (!first) return true;
  return phase === 'setup' ? /^(aufbau|anlieferung|umbau|schnellumbau)/i.test(first) : /^(abbau|abholung)/i.test(first);
}

function ordSlotDate(slot) { return String(slot.start_at || '').slice(0, 10); }

// Best entry of Daniel's plan for a slot, or null (equal best scores → null: a separate card beats a wrong link)
function ordMatchSlot(slot, planShifts) {
  var venue = ordSlotVenue(slot.title), date = ordSlotDate(slot);
  if (!venue) return null;
  var words = ordWords(String(slot.title || '').split('_').slice(2).join(' ') + ' ' + (slot.name || ''))
    .filter(function(w) { return w !== venue; });
  var best = null, bestScore = 0, tie = false;
  (planShifts || []).forEach(function(p) {
    if (p.date !== date || ordWords(p.venue).indexOf(venue) === -1 || !ordPhaseFits(slot.phase, p.wann)) return;
    var theirs = ordWords((p.location || '') + ' ' + (p.title || ''));
    var score = words.filter(function(w, i) { return words.indexOf(w) === i && theirs.indexOf(w) !== -1; }).length;
    if (score > bestScore) { best = p; bestScore = score; tie = false; } else if (score && score === bestScore) tie = true;
  });
  return bestScore && !tie ? best : null;
}

// Slots on Daniel's entries (by plan shift id) and the rest; a manual link (order_plan_links) beats the automatic match
function ordAttachSlots(slots, planShifts) {
  var bySid = {}, unlinked = [];
  (slots || []).forEach(function(s) {
    var p = null;
    if (s.link_set) {
      if (s.link_date) p = (planShifts || []).find(function(x) { return x.date === s.link_date && x.key === s.link_key; }) || null;
      // Daniel's re-import renumbers equal keys (k, k#2): a link that now points at the other phase is dropped
      if (p && !ordPhaseFits(s.phase, p.wann)) p = null;
    } else p = ordMatchSlot(s, planShifts);
    if (p) (bySid[p.id] = bySid[p.id] || []).push(s); else unlinked.push(s);
  });
  return { bySid: bySid, unlinked: unlinked };
}

// Daniel's people who count as MA: drivers (role 'Fahrer') are on the shift but never fill an MA place
function ordAssignedIds(planShift, withDrivers) {
  return ((planShift && planShift.plan_assignments) || [])
    .filter(function(a) { return withDrivers || a.role !== 'Fahrer'; })
    .map(function(a) { return a.user_id; }).filter(Boolean);
}

function ordDrivers(planShift) {
  return ((planShift && planShift.plan_assignments) || []).filter(function(a) { return a.role === 'Fahrer'; })
    .map(function(a) { return a.user_id; }).filter(Boolean);
}

// PL view: user ids on the slot = Daniel's assignment ∪ accepted applications
function ordTaken(slot, planShift, applications) {
  var ids = ordAssignedIds(planShift);
  (applications || []).forEach(function(a) {
    if (a.job_no === slot.job_no && a.phase === slot.phase && a.status === 'angenommen' && ids.indexOf(a.user_id) === -1) ids.push(a.user_id);
  });
  return ids;
}

// MA view: Daniel's people ∪ accepted ids from order_slots() (the PL copies accepted names into Daniel's plan)
function ordTakenCount(slot, planShift) {
  var ids = ordAssignedIds(planShift);
  if (!Array.isArray(slot.accepted_ids)) return ids.length + (slot.accepted || 0);
  slot.accepted_ids.forEach(function(id) { if (ids.indexOf(id) === -1) ids.push(id); });
  return ids.length;
}

function ordCanApply(slot, me, today, role, planShift) {
  return !!(me && role && role !== 'Gast' && ordSlotDate(slot) >= today && !slot.my_status && ordAssignedIds(planShift, true).indexOf(me) === -1);
}

// ── Einsätze in the project folder (einsaetze.job_no/phase) override day and AL of the Auftragsbestätigung ──
// {start,end} moved to another start day: times stay, a later end moves by the same number of days
function ordShiftRange(r, day) {
  if (!r || !r.start || !day) return r;
  var dd = 864e5, delta = Math.round((Date.parse(day) - Date.parse(r.start.slice(0, 10))) / dd);
  var move = function(s) { return s && new Date(Date.parse(s.slice(0, 10)) + delta * dd).toISOString().slice(0, 10) + s.slice(10); };
  return { start: move(r.start), end: r.end ? move(r.end) : r.end };
}

// Parsed files (file_id → result) with the earliest active tagged Einsatz per job phase applied; same object without any
function ordWithEinsaetze(parsed, rows, names) {
  var ov = {};
  (rows || []).filter(function(e) { return e.job_no && e.phase && !e.cancelled; })
    .sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); })
    .forEach(function(e) {
      var o = ov[e.job_no + '|' + e.phase] = ov[e.job_no + '|' + e.phase] || { date: e.date, al: [] };
      if (e.al_id && o.al.indexOf(e.al_id) === -1) o.al.push(e.al_id);
    });
  if (!Object.keys(ov).length) return parsed;
  var out = {};
  Object.keys(parsed || {}).forEach(function(fid) {
    var p = parsed[fid];
    out[fid] = Object.assign({}, p, { jobs: (p.jobs || []).map(function(j) {
      var s = ov[j.jobNo + '|setup'], t = ov[j.jobNo + '|teardown'];
      if (!s && !t) return j;
      var nj = Object.assign({}, j), al = [];
      if (s) nj.setup = ordShiftRange(j.setup, s.date);
      if (t) nj.teardown = ordShiftRange(j.teardown, t.date);
      (s ? s.al : []).concat(t ? t.al : []).forEach(function(id) { if (names[id] && al.indexOf(names[id]) === -1) al.push(names[id]); });
      if (al.length) nj.lead = al.join(', ');
      return nj;
    }) });
  });
  return out;
}
