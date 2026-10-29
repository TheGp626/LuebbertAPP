// Turns the page data from plan-pdf.js (Daniel's weekly plan, Excel → PDF) into shifts.
// Pure functions without DOM/Supabase → testable with `node --test` (exported via module.exports).
//
// Layout: one table with the columns Datum | Was | Wann | Wer | AP (header on page 1 only).
// Grey rows "Montag … 12.10.26" start a day; every other row (between two full-width
// border lines) is a shift. A row without text in the Datum column continues the row above.

var PLAN_COLUMNS = ['datum', 'was', 'wann', 'wer', 'ap'];
var PLAN_WEEKDAYS = /^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/i;
var PLAN_PLAIN_COLORS = ['#ffffff', '#c0c0c0', '#bfbfbf'];

// "12.10.26" / "18.10.2026" → "2026-10-12"
function planDate(s) {
  var m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s || '');
  if (!m) return null;
  var y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}

// ISO 8601 week number of a "YYYY-MM-DD" date
function planIsoWeek(dateStr) {
  var p = dateStr.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  var day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7), year: d.getUTCFullYear() };
}

// Phone numbers of agency workers must never be stored ("Max Muster, 0170 1234567")
function planStripPhones(s) {
  return String(s || '')
    .replace(/,?\s*(\+\d|\b0)[\d\s\/-]{6,}\d/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Column x boundaries from the header row on page 1
function planFindColumns(page) {
  var want = { Datum: 'datum', Was: 'was', Wann: 'wann', Wer: 'wer', AP: 'ap' }, found = {};
  page.items.forEach(function(it) {
    var k = want[it.s.trim()];
    if (k && !found[k]) found[k] = it;
  });
  if (PLAN_COLUMNS.some(function(c) { return !found[c]; })) return null;
  var y = found.was.y;
  return {
    x: PLAN_COLUMNS.map(function(c) { return found[c].x - 2; }),
    headerBottom: y + found.was.h * 1.5
  };
}

function planColumnOf(cols, x) {
  for (var i = PLAN_COLUMNS.length - 1; i >= 0; i--) if (x >= cols.x[i]) return i;
  return -1;
}

// Groups text items into lines (same baseline) per column
function planCellLines(items) {
  var sorted = items.slice().sort(function(a, b) { return (a.y - b.y) || (a.x - b.x); });
  var lines = [];
  sorted.forEach(function(it) {
    var last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < it.h * 0.5) {
      last.parts.push(it);
    } else lines.push({ y: it.y, parts: [it] });
  });
  // Excel splits a word into pieces where the formatting changes mid-word ("Holz" + bold "hoch" + "tisch"):
  // pieces that touch (no gap, no space at the seam) belong together, everything else gets a space
  return lines.map(function(l) {
    var parts = l.parts.sort(function(a, b) { return a.x - b.x; });
    var out = '';
    parts.forEach(function(p, i) {
      var prev = parts[i - 1];
      var gap = prev ? p.x - (prev.x + (prev.w || 0)) : 0;
      var touching = prev && gap > -1 && gap < 0.8 && !/\s$/.test(prev.s) && !/^\s/.test(p.s);
      out += (i === 0 || touching ? '' : ' ') + p.s.trim();
    });
    return out.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

function planBandColor(page, cols, y0, y1) {
  var midY = (y0 + y1) / 2, midX = (cols.x[1] + cols.x[2]) / 2, best = null;
  page.fills.forEach(function(f) {
    if (f.x0 <= midX && f.x1 >= midX && f.y0 <= midY && f.y1 >= midY && PLAN_PLAIN_COLORS.indexOf(f.color) === -1) best = f.color;
  });
  return best;
}

// Splits all pages into bands (rows) with their text per column
function planBands(pages) {
  var cols = null, bands = [];
  pages.forEach(function(page, pi) {
    if (!cols) cols = planFindColumns(page);
    if (!cols) return;
    var left = cols.x[0], width = (cols.x[4] + 30) - left;
    // Row borders span (almost) the whole table; short lines are text underlines
    var ys = page.hlines.filter(function(l) { return (l.x1 - l.x0) >= width * 0.5; })
      .map(function(l) { return l.y; }).sort(function(a, b) { return a - b; });
    var uniq = [];
    ys.forEach(function(y) { if (!uniq.length || y - uniq[uniq.length - 1] > 1.5) uniq.push(y); });
    var minY = (pi === 0) ? cols.headerBottom : -Infinity;
    for (var i = 0; i < uniq.length - 1; i++) {
      var y0 = uniq[i], y1 = uniq[i + 1];
      if (y1 <= minY) continue;
      var cells = [[], [], [], [], []];
      page.items.forEach(function(it) {
        var mid = it.y + it.h * 0.6;
        if (mid < y0 || mid >= y1 || mid < minY) return;
        var c = planColumnOf(cols, it.x);
        if (c >= 0) cells[c].push(it);
      });
      var text = cells.map(planCellLines);
      if (!text.some(function(t) { return t.length; })) continue;
      bands.push({ page: pi + 1, y0: y0, y1: y1, cells: text, color: planBandColor(page, cols, y0, y1) });
    }
  });
  return { columnsFound: !!cols, bands: bands };
}

var PLAN_AGENCY = { zenjob: 'Zenjob', rockit: 'ROCKiT' };
var PLAN_NOTE_ONLY = /^(folgt|extern|florist|via\b|team\b|bar pl\b|tba\b|offen\b)/i;

function planRoleFromTag(tag) {
  var t = (tag || '').trim().toLowerCase();
  if (t === 'al') return 'AL';
  if (t === 'ma') return 'MA';
  if (t === 'deko') return 'Deko';
  if (t === 'fahrer') return 'Fahrer';
  return null;
}

// "Kacper (AL)" / "Milan (ab 14 Uhr)" / "Feli bis 13 Uhr" → { name, role, note }
function planPerson(text, defaultRole) {
  var s = planStripPhones(text), role = defaultRole, notes = [];
  s = s.replace(/\(([^)]*)\)/g, function(_, inner) {
    var r = planRoleFromTag(inner);
    if (r) role = r; else notes.push(inner.trim());
    return ' ';
  });
  var m = /\s+((?:ab|bis)\s+\d.*)$/i.exec(s);
  if (m) { notes.push(m[1].trim()); s = s.slice(0, m.index); }
  s = s.replace(/[,;]+$/, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return { name: s, role: role, note: notes.join(', ') || null };
}

// One shift's "Wer" cell → assigned people, open slots and plain notes
function planParseWer(lines) {
  var people = [], open = [], notes = [], group = null, sameAsAbove = false;
  function addPerson(p) {
    if (!p) return;
    var key = p.name.toLowerCase();
    var existing = people.find(function(x) { return x.name.toLowerCase() === key; });
    if (existing) { if (p.role === 'AL') existing.role = 'AL'; return; }
    people.push(p);
  }
  function closeGroup() {
    if (group && group.left > 0) open.push({ role: group.role, count: group.left, note: group.note });
    group = null;
  }
  lines.forEach(function(raw) {
    var line = planStripPhones(raw).trim();
    if (!line) return;
    if (/^siehe oben$/i.test(line)) { sameAsAbove = true; return; }
    // "2 x Zenjob (8.30 - 16.30 Uhr)", "4 x ROCKiT", "1 x Lagercrew"
    var g = /^(\d+)\s*x\s*([A-Za-zÄÖÜäöü]+)\s*(?:\(([^)]*)\))?\s*$/.exec(line);
    if (g) {
      closeGroup();
      var key = g[2].toLowerCase();
      group = { role: PLAN_AGENCY[key] || (key === 'lagercrew' ? 'Lager' : g[2]), left: parseInt(g[1], 10), note: g[3] ? g[3].trim() : null };
      return;
    }
    // "3 MA", "1 AL", "1 MA (AL)"
    var o = /^(\d+)\s*(AL|MA|Fahrer)\b\s*(?:\(([^)]*)\))?\s*$/i.exec(line);
    if (o) {
      closeGroup();
      open.push({ role: planRoleFromTag(o[3]) || planRoleFromTag(o[2]) || o[2], count: parseInt(o[1], 10), note: null });
      return;
    }
    // "BAR PL 550 | Kacper (AL)", "LeihLkw | Marcin", "Barnimer Land | Fahrer"
    if (line.indexOf('|') !== -1) {
      closeGroup();
      var parts = line.split('|'), vehicle = parts[0].trim(), who = parts.slice(1).join('|').trim();
      notes.push(vehicle);
      if (!who || /^fahrer$/i.test(who)) open.push({ role: 'Fahrer', count: 1, note: vehicle });
      else {
        var drv = planPerson(who, 'Fahrer');
        if (drv) { drv.note = [vehicle, drv.note].filter(Boolean).join(', '); addPerson(drv); }
      }
      return;
    }
    // "Deko: Feli & Arina"
    var d = /^([A-Za-zÄÖÜäöü]+):\s*(.+)$/.exec(line);
    if (d) {
      closeGroup();
      var role = planRoleFromTag(d[1]) || d[1];
      d[2].split(/\s*(?:&|,|\bund\b)\s*/).forEach(function(n) { addPerson(planPerson(n, role)); });
      return;
    }
    if (PLAN_NOTE_ONLY.test(line)) { closeGroup(); notes.push(line); return; }
    if (group && group.left > 0) {
      var ap = planPerson(line, group.role);
      if (ap) { if (!ap.note && group.note) ap.note = group.note; addPerson(ap); }
      group.left--;
      if (group.left === 0) group = null;
      return;
    }
    closeGroup();
    addPerson(planPerson(line, 'MA'));
  });
  closeGroup();
  return { people: people, open: open, notes: notes, sameAsAbove: sameAsAbove };
}

function planShiftKey(s) {
  return [s.date, (s.venue || '').toLowerCase(), (s.title || '').toLowerCase()].join('|');
}

// The ISO week most days fall in (a plan starting on Sunday belongs to the following week).
// Ties go to the later week: plans look ahead.
function planMainWeek(dates) {
  var count = {}, best = null;
  dates.forEach(function(d) {
    var w = planIsoWeek(d), k = w.year * 100 + w.week;
    count[k] = (count[k] || 0) + 1;
    if (!best || count[k] > count[best.k] || (count[k] === count[best.k] && k > best.k)) best = { k: k, week: w.week, year: w.year };
  });
  return best;
}

// Whole document → { weekStart, weekEnd, kw, year, shifts, warnings }
function planParse(pages) {
  var res = planBands(pages), warnings = [], shifts = [], date = null, days = [];
  if (!res.columnsFound) return { shifts: [], warnings: ['Spaltenköpfe (Datum | Was | Wann | Wer | AP) nicht gefunden – ist das ein Wochenplan?'] };
  res.bands.forEach(function(b) {
    var datum = b.cells[0], first = datum[0] || '';
    if (PLAN_WEEKDAYS.test(first)) {
      date = planDate(datum.join(' '));
      if (!date) warnings.push('Tag ohne Datum: ' + datum.join(' '));
      else days.push(date);
      return;
    }
    var was = b.cells[1], wann = b.cells[2], wer = b.cells[3], ap = b.cells[4];
    var prev = shifts[shifts.length - 1];
    // Row without location continues the shift above (e.g. a second area or a page break)
    if (!datum.length && prev && prev.date === date) {
      prev.details = prev.details.concat(was);
      prev.wann = prev.wann.concat(wann);
      prev.werLines = prev.werLines.concat(wer);
      if (!prev.ap && ap.length) prev.ap = ap.join(' ');
      return;
    }
    if (!date) { warnings.push('Zeile vor dem ersten Tag übersprungen: ' + (was[0] || first)); return; }
    shifts.push({
      date: date, venue: first, location: datum.slice(1),
      title: was[0] || '', details: was.slice(1), wann: wann, werLines: wer,
      ap: ap.join(' ') || null, color: b.color, page: b.page
    });
  });
  var byDate = {}, seenKeys = {};
  shifts.forEach(function(s, i) {
    s.location = s.location.map(planStripPhones).filter(Boolean);
    s.details = s.details.map(planStripPhones).filter(Boolean);
    s.wann = s.wann.map(planStripPhones).filter(Boolean);
    var w = planParseWer(s.werLines);
    delete s.werLines;
    s.people = w.people; s.open = w.open; s.notes = w.notes;
    // "siehe oben" = same team as the shift above on that day
    if (w.sameAsAbove && byDate[s.date]) {
      var above = byDate[s.date];
      above.people.forEach(function(p) { if (!s.people.some(function(x) { return x.name === p.name; })) s.people.push(Object.assign({}, p)); });
      if (!s.open.length) s.open = above.open.map(function(o) { return Object.assign({}, o); });
    }
    s.sort = i;
    // Same location + title twice on one day (e.g. Aufbau and Abbau rows) → numbered keys
    var key = planShiftKey(s);
    seenKeys[key] = (seenKeys[key] || 0) + 1;
    s.key = seenKeys[key] > 1 ? key + '#' + seenKeys[key] : key;
    byDate[s.date] = s;
  });
  var dates = (days.length ? days : shifts.map(function(s) { return s.date; })).slice().sort();
  var start = dates[0] || null, end = dates[dates.length - 1] || null;
  var wk = planMainWeek(dates);
  if (!shifts.length) warnings.push('Keine Einsätze erkannt.');
  return { weekStart: start, weekEnd: end, kw: wk && wk.week, year: wk && wk.year, shifts: shifts, warnings: warnings };
}

var PLAN_PL_ROLES = ['PL', 'Admin', 'Buchhaltung'];

// Plan name → normalised form used for matching ("  Julian   H. " → "julian h")
function planNormName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
}

// Key of plan_name_aliases, used for saving AND lookup. AP (PL column) names get an "ap:" prefix so
// picking the PL for "Sabine" never maps a team member "Sabine" to that PL. Stored keys keep their prefix.
function planAliasKey(name, isAp) {
  var s = String(name || '').trim();
  if (/^ap:/i.test(s)) { isAp = true; s = s.slice(3); }
  return (isAp ? 'ap:' : '') + planNormName(s);
}

// Plan name → app user. Aliases (remembered from earlier imports) win, then the full name,
// then a unique first name among active users. Agency workers are never matched.
function planMatchPerson(person, users, aliases) {
  if (person.role === 'Zenjob' || person.role === 'ROCKiT') return { userId: null, candidates: [] };
  var n = planNormName(person.name);
  var active = users.filter(function(u) { return u.is_active !== false && u.role !== 'Gast'; });
  // The AP column names the PL: an MA with the same first name must never get the PL's mails
  if (person.role === 'PL') {
    active = active.filter(function(u) { return PLAN_PL_ROLES.indexOf(u.role) !== -1; });
    // AP alias first, then a legacy plain alias - both only if they point to a PL/Admin/Buchhaltung
    var apAlias = [aliases && aliases[planAliasKey(n, true)], aliases && aliases[n]].find(function(id) {
      return id && active.some(function(u) { return u.id === id; });
    });
    if (apAlias) return { userId: apAlias, candidates: [], via: 'alias' };
  } else if (aliases && aliases[n]) return { userId: aliases[n], candidates: [], via: 'alias' };
  var full = active.filter(function(u) { return (u.full_name || '').toLowerCase() === n; });
  if (full.length === 1) return { userId: full[0].id, candidates: [], via: 'name' };
  var words = n.split(' '), rest = words.slice(1).join(' ').replace(/\.$/, '');
  var byFirst = active.filter(function(u) {
    var parts = (u.full_name || '').toLowerCase().split(/\s+/);
    if (parts[0] !== words[0]) return false;
    // "Julian H." must fit the surname's initial
    return !rest || parts.slice(1).join(' ').indexOf(rest) === 0;
  });
  if (byFirst.length === 1) return { userId: byFirst[0].id, candidates: [], via: 'vorname' };
  return { userId: null, candidates: byFirst.map(function(u) { return u.id; }) };
}

// Old vs new shifts of the same week → status per new shift, the matched old shift per new shift
// (null for new ones) and the removed old shifts.
// Same day + location + title twice gets numbered keys (k, k#2); when the first row disappears the
// second becomes k. So shifts are paired within the group of their base key: identical content first,
// then same first "Wann" line, then most shared team names, then the remaining ones in order.
// Stored week this upload replaces: same year+KW, else the stored week sharing most of its days (≥ 4) with the plan
// (weeks imported before the KW rule changed sit under their start-date KW). A week that only touches the plan's
// leading Sunday is a different week and must not be replaced.
function planPickExistingWeek(weeks, parsed) {
  var same = weeks.find(function(w) { return w.year === parsed.year && w.kw === parsed.kw; });
  if (same) return same;
  var day = function(iso) { var p = iso.split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000; };
  var best = null, bestDays = 0;
  weeks.forEach(function(w) {
    var days = Math.min(day(w.week_end), day(parsed.weekEnd)) - Math.max(day(w.week_start), day(parsed.weekStart)) + 1;
    if (days > bestDays) { best = w; bestDays = days; }
  });
  return bestDays >= 4 ? best : null;
}

function planDiff(oldShifts, newShifts) {
  // Field by field, never whole objects: jsonb hands back open slots with its own key order
  var fp = function(s) {
    return JSON.stringify([s.wann, (s.people || []).map(function(p) { return p.name + '/' + p.role; }).sort(),
      (s.open || []).map(function(o) { return o.count + '/' + o.role + '/' + (o.note || ''); }), s.ap || null, s.details,
      s.location || [], s.notes || []]);
  };
  var base = function(k) { return String(k).replace(/#\d+$/, ''); };
  var groups = {};
  oldShifts.forEach(function(s) { (groups[base(s.key)] = groups[base(s.key)] || []).push(s); });
  var matched = newShifts.map(function() { return null; });
  var taken = [];
  var free = function(o) { return taken.indexOf(o) === -1; };
  var pass = function(test) {
    newShifts.forEach(function(s, i) {
      if (matched[i]) return;
      var o = (groups[base(s.key)] || []).find(function(x) { return free(x) && test(x, s); });
      if (o) { matched[i] = o; taken.push(o); }
    });
  };
  var firstWann = function(s) { return (s.wann || [])[0] || ''; };
  var shared = function(a, b) {
    var names = (a.people || []).map(function(p) { return p.name.toLowerCase(); });
    return (b.people || []).filter(function(p) { return names.indexOf(p.name.toLowerCase()) !== -1; }).length;
  };
  pass(function(o, s) { return o.key === s.key && fp(o) === fp(s); });
  pass(function(o, s) { return fp(o) === fp(s); });
  pass(function(o, s) { return firstWann(o) && firstWann(o) === firstWann(s); });
  newShifts.forEach(function(s, i) {
    if (matched[i]) return;
    var best = null, bestN = 0;
    (groups[base(s.key)] || []).forEach(function(o) {
      var n = free(o) ? shared(o, s) : 0;
      if (n > bestN) { best = o; bestN = n; }
    });
    if (best) { matched[i] = best; taken.push(best); }
  });
  pass(function(o, s) { return o.key === s.key; });
  pass(function() { return true; });
  var status = newShifts.map(function(s, i) {
    if (!matched[i]) return 'neu';
    return fp(matched[i]) === fp(s) ? null : 'geändert';
  });
  return { status: status, matched: matched, removed: oldShifts.filter(free) };
}

// Users that were on a matched old shift but are missing on its new version → "nicht mehr eingeteilt".
// diff = planDiff(old, new); people need resolved userIds. Returns [{date, venue, title, user_ids, kind}].
function planUnassigned(newShifts, diff) {
  var out = [];
  newShifts.forEach(function(s, i) {
    var o = diff.matched && diff.matched[i];
    if (!o) return;
    var now = (s.people || []).map(function(p) { return p.userId; }).filter(Boolean);
    var gone = (o.people || []).map(function(p) { return p.userId; })
      .filter(function(id, j, a) { return id && now.indexOf(id) === -1 && a.indexOf(id) === j; });
    if (gone.length) out.push({ date: s.date, venue: s.venue, title: s.title, user_ids: gone, kind: 'unassigned' });
  });
  return out;
}

var PLAN_WHEN_LABELS = ['Teilaufbau', 'Teilabbau', 'Aufbau', 'Abbau', 'Umbau', 'Umstellen', 'Anlieferung', 'Abholung', 'Lieferung'];

// "Aufbau: 8 - 9 Uhr" → { time: '08:00', end: '09:00', prefix: null, label: 'Aufbau' } for the time column.
// The first line with a time wins; without any time only the label (if any) is returned.
function planWhen(wann) {
  var hm = function(h, m) { return ('0' + h).slice(-2) + ':' + (m || '00'); };
  var labelOf = function(line) {
    var l = line.toLowerCase();
    for (var i = 0; i < PLAN_WHEN_LABELS.length; i++) if (l.indexOf(PLAN_WHEN_LABELS[i].toLowerCase()) === 0) return PLAN_WHEN_LABELS[i];
    return null;
  };
  var re = /(?:\b(ab|bis)\s+)?(\d{1,2})(?:[.:](\d{2}))?(?:\s*-\s*(\d{1,2})(?:[.:](\d{2}))?)?\s*Uhr/i;
  var lines = wann || [], firstLabel = null;
  for (var i = 0; i < lines.length; i++) {
    var label = labelOf(lines[i]);
    if (!firstLabel) firstLabel = label;
    var m = re.exec(lines[i]);
    if (m && +m[2] <= 24 && (!m[4] || +m[4] <= 24)) {
      return { time: hm(m[2], m[3]), end: m[4] ? hm(m[4], m[5]) : null, prefix: m[1] ? m[1].toLowerCase() : null, label: label };
    }
  }
  return { time: null, end: null, prefix: null, label: firstLabel };
}

// "Abbau: 0.30 Uhr" → protocol action for the "Protokoll starten" prefill
function planGuessAction(wann) {
  var t = (wann || []).join(' ');
  var has = function(w) { return new RegExp('\\b' + w, 'i').test(t); };
  if (has('Umbau') || has('Umstellen')) return 'Umbau';
  if (has('Abbau') && !has('Aufbau')) return 'Abbau';
  if (has('Teilaufbau')) return 'Teilaufbau';
  return 'Aufbau';
}

// Rooms, halls and booths ("Saal Europa", "CH II", "Stand 20 | …", "Apollo Saal", "2. OG") – never an event name
var PLAN_ROOM_LINE = /^(?:halle|raum|saal|foyer|stand|auditorium|ch\s+i+|hub\s*\d+|\d+\.\s*og|\S+\s+saal|pl\s+lager)\b/i;

function planStartsWithStep(line) {
  var l = (line || '').toLowerCase();
  return PLAN_WHEN_LABELS.some(function(w) { return l.indexOf(w.toLowerCase()) === 0; });
}

// Event line of the location: the last line after the postcode (street, "12057 Berlin", room, event), unless a room
// or a note ("Anlieferung über …!!", "entfällt!")
function planLocationEvent(location) {
  var loc = planLines(location), i = loc.findIndex(function(l) { return /^\d{5}\b/.test(l); });
  var last = i < 0 ? '' : (loc.slice(i + 1).filter(Boolean).pop() || '').trim();
  return last && !PLAN_ROOM_LINE.test(last) && !planStartsWithStep(last) && last.indexOf('!') === -1 ? last : '';
}

// Event name for "Protokoll starten". Equipment ("4 STB weiß"), room ("Saal Europa") and work-step ("Abbau")
// titles are no event names → the location's event line; without one: the title, or the venue for equipment
function planEventName(s) {
  var t = (s.title || '').trim(), material = !t || /^\d/.test(t);
  if (!material && !planStartsWithStep(t) && !PLAN_ROOM_LINE.test(t)) return t;
  return planLocationEvent(s.location) || (material ? s.venue : t);
}

// "7 Loungesessel …" is a quantity line; "1. OG" is a floor and stays a heading
function planIsMaterial(line) { return /^\d+\s+\S/.test(line || ''); }
function planLines(x) { return Array.isArray(x) ? x : (x ? String(x).split('\n') : []); }

// Display heading of a shift. When the Was cell starts straight with equipment, the parser's title is
// that equipment line (it stays in the key so old uploads still match); show the room/customer lines
// after the postcode instead ("Estrel Saal · Kunde")
function planShiftHeading(s) {
  if (s.title && !planIsMaterial(s.title)) return s.title;
  var loc = planLines(s.location), i = loc.findIndex(function(l) { return /^\d{5}\b/.test(l); });
  return i < 0 ? '' : loc.slice(i + 1).filter(Boolean).join(' · ');
}

// Material list incl. an equipment line that the parser took as the title
function planMaterialLines(s) {
  var d = planLines(s.details);
  return planIsMaterial(s.title) ? [s.title].concat(d) : d;
}

// Order of a person's upcoming shifts: by date, same day timed shifts by time, then untimed ones by sort.
// Shifts from earlier days are dropped, and so are today's whose start is more than 2 h behind `now`
// (keepStarted: keep all of today, for the "Meine Schichten" list with its "Protokoll starten" button).
// Times before 4:00 ("Abbau: 0.30 Uhr") are the night after the listed day.
function planShiftOrder(shifts, now, keepStarted) {
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var nowMin = now.getHours() * 60 + now.getMinutes();
  var minutes = function(s) {
    var t = planWhen(s.wann ? String(s.wann).split('\n') : []).time;
    if (!t) return null;
    var m = parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
    return m < 240 ? m + 1440 : m;
  };
  return (shifts || [])
    .map(function(s) { return { s: s, min: minutes(s) }; })
    .filter(function(x) { return x.s.date > today || (x.s.date === today && (keepStarted || x.min === null || nowMin - x.min <= 120)); })
    .sort(function(a, b) {
      if (a.s.date !== b.s.date) return a.s.date < b.s.date ? -1 : 1;
      if ((a.min === null) !== (b.min === null)) return a.min === null ? 1 : -1;
      if (a.min !== b.min) return a.min - b.min;
      return (a.s.sort || 0) - (b.s.sort || 0);
    })
    .map(function(x) { return x.s; });
}

function nextOwnShift(shifts, now) {
  return planShiftOrder(shifts, now)[0] || null;
}

// Parsed shift + resolved user ids → DB rows (assignments without shift_id, added after insert)
function planShiftRow(s, weekId, status) {
  return {
    week_id: weekId, date: s.date, sort: s.sort, key: s.key, venue: s.venue || null,
    location: s.location.join('\n') || null, title: s.title || null, details: s.details.join('\n') || null,
    wann: s.wann.join('\n') || null, ap: s.ap || null, ap_user_id: s.apUserId || null, notes: s.notes.join('\n') || null,
    color: s.color || null, open_slots: s.open, change_status: status || null
  };
}

// DB rows (with plan_assignments) → parser shape, so planDiff can compare old and new uploads
function planShiftFromDb(r) {
  var lines = function(t) { return t ? String(t).split('\n') : []; };
  return {
    id: r.id, key: r.key, date: r.date, venue: r.venue, title: r.title || '', location: lines(r.location),
    details: lines(r.details), wann: lines(r.wann), ap: r.ap, notes: lines(r.notes), color: r.color,
    open: r.open_slots || [], changeStatus: r.change_status,
    people: (r.plan_assignments || []).map(function(a) { return { name: a.name, role: a.role, note: a.note, userId: a.user_id }; })
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { planDate: planDate, planIsoWeek: planIsoWeek, planStripPhones: planStripPhones, planBands: planBands,
    planParseWer: planParseWer, planParse: planParse, planMatchPerson: planMatchPerson, planDiff: planDiff, planShiftKey: planShiftKey,
    planNormName: planNormName, planAliasKey: planAliasKey, planUnassigned: planUnassigned, planMainWeek: planMainWeek, planPickExistingWeek: planPickExistingWeek, planCellLines: planCellLines,
    planWhen: planWhen, planGuessAction: planGuessAction, planEventName: planEventName,
    planShiftOrder: planShiftOrder, nextOwnShift: nextOwnShift, planShiftHeading: planShiftHeading, planMaterialLines: planMaterialLines, planShiftRow: planShiftRow, planShiftFromDb: planShiftFromDb };
}
