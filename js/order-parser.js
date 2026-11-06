/* Auftragsbestätigungen (easyjob PDF) → jobs for the "Aufträge" tab. Pure functions, no DOM.
 * pages come from readPlanPdf() (plan-pdf.js): positioned text items per page.
 * Phone numbers are never kept (customer and staff contacts stand in the header). */

// Text rows: items on (nearly) the same baseline, left to right
function orderLines(pages) {
  var out = [];
  (pages || []).forEach(function(p) {
    var items = (p.items || []).slice().sort(function(a, b) { return a.y - b.y || a.x - b.x; });
    var row = [], y = null, h = 0;
    var flush = function() {
      if (!row.length) return;
      var t = row.sort(function(a, b) { return a.x - b.x; }).map(function(i) { return i.s.trim(); }).join(' ').replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      row = [];
    };
    items.forEach(function(i) {
      if (y === null || Math.abs(i.y - y) > Math.min(h, i.h || h) / 2) { flush(); y = i.y; h = i.h || 8; }
      row.push(i);
    });
    flush();
  });
  return out;
}

function orderIsAb(name) { return /auftragsbest/i.test(name || ''); }

var ORDER_JOB_RE = /^(\d{2}-\d{4}\.\d{2}) \/ (.+)$/;
var ORDER_LABEL_RE = /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß&.\- ]{0,40}):\s*(.*)$/;
var ORDER_CONTACT_RE = /Projektleitung|Koordination|Ansprechpartner|Ihr Zeichen|Telefon|E-Mail/i;

// Digit runs that look like phone numbers (7+ digits, with spaces, /, -, +) go; dates and "16 - 19 Uhr" stay
function orderStripPhones(s) {
  return s.replace(/\+?\d[\d \/-]*\d/g, function(m) { return m.replace(/\D/g, '').length >= 7 ? '' : m; })
    .replace(/\s*(Tel\.?|Mobil|Handy)\s*:?\s*(?=$|\/\/)/gi, '').replace(/\s*\/\/\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

// "11.11.2026 09:00 - 16:00" | "02.11.2026 08:00 - 05.11.2026 01:00" | "12.11.2026 18:00 - 13.11.2026" → {start, end}
function orderRange(s) {
  var d = '(\\d{2})\\.(\\d{2})\\.(\\d{4})', t = '(\\d{2}):(\\d{2})';
  var m = new RegExp('^' + d + ' ' + t + '(?: - (?:' + d + '(?: ' + t + ')?|' + t + '))?$').exec((s || '').trim());
  if (!m) return null;
  var day = m[3] + '-' + m[2] + '-' + m[1], start = day + 'T' + m[4] + ':' + m[5], end = null;
  if (m[8]) end = m[8] + '-' + m[7] + '-' + m[6] + (m[9] ? 'T' + m[9] + ':' + m[10] : '');
  else if (m[11]) end = day + 'T' + m[11] + ':' + m[12];
  return { start: start, end: end };
}

function orderParse(lines) {
  var res = { project: '', title: '', jobs: [], warnings: [] }, seen = {}, job = null, prev = '', note = false, lead = false;
  var close = function() {
    if (!job) return;
    if (job.setup || job.teardown) res.jobs.push(job);
    job = null;
  };
  (lines || []).forEach(function(raw) {
    var l = raw.trim(), m;
    if (!res.project && (m = /^Auftragsbest\S*\s+\D*(\d{2}-\d{4})\s*\/\s*(.+)$/.exec(l))) {
      res.project = m[1]; res.title = m[2].trim(); return;
    }
    if ((m = ORDER_JOB_RE.exec(l))) {
      close();
      if (/\.{4,}|€/.test(l) || seen[m[1]]) { prev = ''; return; } // summary list at the end repeats every job
      seen[m[1]] = true;
      job = { jobNo: m[1], name: m[2].trim(), address: '', room: '', setup: null, event: null, teardown: null, lead: '', notes: '' };
      prev = 'head'; note = lead = false;
      return;
    }
    if (!job) return;
    if (/^Job(\.|\s|$)/.test(l)) { close(); return; }
    var lab = ORDER_LABEL_RE.exec(l);
    if (!lab) {
      if (prev === 'address') job.room = l;
      else if (lead) { var n = orderStripPhones(l.replace(/\/\/.*$/, '')); if (n) job.lead += (job.lead ? ', ' : '') + n; }
      else if (note) { var c = orderStripPhones(l); if (c) job.notes += '\n' + c; }
      prev = ''; return;
    }
    var key = lab[1].trim(), val = lab[2].trim();
    prev = ''; note = lead = false;
    var field = { 'Aufbau': 'setup', 'Veranstaltung': 'event', 'Abbau': 'teardown' }[key];
    if (key === 'Lieferadresse') { job.address = val; prev = 'address'; }
    else if (field) {
      job[field] = orderRange(val);
      if (!job[field]) res.warnings.push(job.jobNo + ': ' + key + ' nicht lesbar („' + val + '“)');
    } else if (key === 'Auf- & Abbauleitung') {
      job.lead = val === '???' ? '' : orderStripPhones(val.replace(/\/\/.*$/, '').replace(/\?{2,}/g, '')); lead = true;
    } else if (!ORDER_CONTACT_RE.test(key) && key !== 'Zeitraum' && key !== 'Pos.') {
      var t = orderStripPhones(key + ': ' + val);
      job.notes += (job.notes ? '\n' : '') + t; note = true;
    }
  });
  close();
  if (!res.jobs.length && !res.project) res.warnings.push('Keine Auftragsbestätigung erkannt.');
  return res;
}
