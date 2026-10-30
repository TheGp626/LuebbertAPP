// ES module copy of planIcs (and everything it needs) from js/plan-parser.js for the Edge Function calendar-feed.
// plan-ics.test.mjs checks that both copies produce the same calendar.

const PLAN_WHEN_LABELS = ['Teilaufbau', 'Teilabbau', 'Aufbau', 'Abbau', 'Umbau', 'Umstellen', 'Anlieferung', 'Abholung', 'Lieferung'];

// "Aufbau: 8 - 9 Uhr" → { time: '08:00', end: '09:00', prefix: null, label: 'Aufbau' }
// The first line with a time wins; without any time only the label (if any) is returned.
export function planWhen(wann) {
  const hm = (h, m) => ('0' + h).slice(-2) + ':' + (m || '00');
  const labelOf = (line) => {
    const l = line.toLowerCase();
    return PLAN_WHEN_LABELS.find(x => l.indexOf(x.toLowerCase()) === 0) || null;
  };
  const re = /(?:\b(ab|bis)\s+)?(\d{1,2})(?:[.:](\d{2}))?(?:\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?)?\s*Uhr/i;
  let firstLabel = null;
  for (const line of wann || []) {
    const label = labelOf(line);
    if (!firstLabel) firstLabel = label;
    const m = re.exec(line);
    if (m && +m[2] <= 24 && (!m[4] || +m[4] <= 24)) {
      // "24 Uhr" is midnight: 00:00
      return { time: hm(+m[2] === 24 ? 0 : m[2], m[3]), end: m[4] ? hm(+m[4] === 24 ? 0 : m[4], m[5]) : null, prefix: m[1] ? m[1].toLowerCase() : null, label };
    }
  }
  return { time: null, end: null, prefix: null, label: firstLabel };
}

const PLAN_ROOM_LINE = /^(?:halle|raum|saal|foyer|stand(?=\s+\d)|auditorium|ch\s+i+|hub\s*\d+|\d+\.\s*og|\S+\s+saal|pl\s+lager)\b/i;

function planLines(x) { return Array.isArray(x) ? x : (x ? String(x).split('\n') : []); }

function planStartsWithStep(line) {
  const l = (line || '').toLowerCase();
  return PLAN_WHEN_LABELS.some(w => l.indexOf(w.toLowerCase()) === 0);
}

function planLocationEvent(location) {
  const loc = planLines(location), i = loc.findIndex(l => /^\d{5}\b/.test(l));
  const last = i < 0 ? '' : (loc.slice(i + 1).filter(Boolean).pop() || '').trim();
  return last && !PLAN_ROOM_LINE.test(last) && !planStartsWithStep(last) && last.indexOf('!') === -1 ? last : '';
}

function planEventName(s) {
  const t = (s.title || '').trim(), material = !t || /^\d/.test(t);
  if (!material && !planStartsWithStep(t) && !PLAN_ROOM_LINE.test(t)) return t;
  return planLocationEvent(s.location) || (material ? s.venue : t);
}

function planIcsText(t) {
  return String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545: lines longer than 75 bytes continue on the next line after a space
function planIcsFold(line) {
  const out = [];
  let cur = '', bytes = 0;
  for (let i = 0; i < line.length; i++) {
    let ch = line[i];
    const code = line.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) ch += line[++i];
    const b = code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xD800 && code <= 0xDBFF ? 4 : 3;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function planIcsDate(date, addDays) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + (addDays || 0));
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function planIcsUid(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return 'plan-' + h.toString(16) + '-' + key.length + '@luebbert-app';
}

// Calendar of a person's plan shifts (DB rows with plan_assignments). Times are floating local times.
export function planIcs(shifts, userId, stamp) {
  let lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Luebbert//Stundenzettel//DE', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Lübbert Schichten', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  (shifts || []).forEach((s) => {
    const wann = planLines(s.wann), when = planWhen(wann);
    const loc = planLines(s.location), plz = loc.findIndex(l => /^\d{5}\b/.test(l));
    const place = [s.venue].concat(plz < 0 ? loc.slice(0, 1) : loc.slice(0, plz + 1)).filter(Boolean).join(', ');
    const mine = (s.plan_assignments || []).find(a => a.user_id === userId);
    const desc = wann.concat(mine && mine.role ? ['Rolle: ' + mine.role] : []).join('\n');
    const key = s.key || [s.date, s.venue, s.title].join('|').toLowerCase();
    const ev = ['BEGIN:VEVENT', 'UID:' + planIcsUid(key), 'DTSTAMP:' + stamp];
    if (when.time && when.prefix !== 'bis') {
      const mins = (t) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
      const startDay = mins(when.time) < 240 ? 1 : 0, hm = (t) => t.replace(':', '') + '00';
      ev.push('DTSTART:' + planIcsDate(s.date, startDay) + 'T' + hm(when.time));
      if (when.end) ev.push('DTEND:' + planIcsDate(s.date, startDay + (mins(when.end) < mins(when.time) ? 1 : 0)) + 'T' + hm(when.end));
    } else {
      ev.push('DTSTART;VALUE=DATE:' + planIcsDate(s.date), 'DTEND;VALUE=DATE:' + planIcsDate(s.date, 1));
    }
    ev.push('SUMMARY:' + planIcsText((when.label ? when.label + ' – ' : '') + planEventName(s)));
    if (place) ev.push('LOCATION:' + planIcsText(place));
    if (desc) ev.push('DESCRIPTION:' + planIcsText(desc));
    ev.push('END:VEVENT');
    lines = lines.concat(ev);
  });
  lines.push('END:VCALENDAR');
  return lines.map(planIcsFold).join('\r\n') + '\r\n';
}
