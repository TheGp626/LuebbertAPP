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

// Stored parse results (table order_parsed) older than this are parsed again: bump on every parser change
var ORDER_PARSER_VERSION = 5;

var ORDER_JOB_RE = /^(\d{2}-\d{4}\.\d{2}) \/ (.+)$/;
var ORDER_LABEL_RE = /^([A-ZÄÖÜ][A-Za-zÄÖÜäöüß&.\- ]{0,40}):\s*(.*)$/;
var ORDER_CONTACT_RE = /Projektleitung|Koordination|Ansprechpartner|Ihr Zeichen|Telefon|E-Mail|Endabnahme/i;
// "12 55 Stuhl "Clara" transparent 16,00 1,00 880,00" → pos, quantity, name, unit price, factor, total
var ORDER_ITEM_RE = /^\d+ (\d+) (.+?) -?[\d.]+,\d{2} [\d.,]+ -?[\d.]+,\d{2}$/;

// Digit runs that look like phone numbers (7+ digits, with spaces / ( ) . - +) go; dates, times and "16 - 19 Uhr" stay
function orderStripPhones(s) {
  var keep = [];
  var masked = s.replace(/(?<!\d)\d{1,2}\.\d{1,2}\.(\d{4}|\d{2}(?!\d))?|\d{1,2}:\d{2}/g, function(m) { keep.push(m); return '\u0000' + (keep.length - 1) + '\u0000'; });
  return masked.replace(/\+?\(?\d[\d \/().-]*\d\)?/g, function(m) { return m.replace(/\D/g, '').length >= 7 ? '' : m; })
    .replace(/\u0000(\d+)\u0000/g, function(_, i) { return keep[+i]; })
    .replace(/\s+([,;])/g, '$1').replace(/\s*(Tel\.?|Mobil|Handy)\s*:?\s*(?=$|\/\/)/gi, '').replace(/\s*\/\/\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

// "11.11.2026 09:00 - 16:00" | "02.11.2026 08:00 - 05.11.2026 01:00" | "12.11.2026 18:00 - 13.11.2026" | "09.11.2026 - 10.11.2026 12:00"
// → {start, end}; a part without time stays a plain date
function orderRange(s) {
  var D = '(\\d{2}\\.\\d{2}\\.\\d{4})', T = '(\\d{2}:\\d{2})';
  var m = new RegExp('^' + D + '(?: ' + T + ')?(?: - (?:' + D + '(?: ' + T + ')?|' + T + '))?$').exec((s || '').trim());
  if (!m) return null;
  var iso = function(d, t) { var p = d.split('.'); return p[2] + '-' + p[1] + '-' + p[0] + (t ? 'T' + t : ''); };
  return { start: iso(m[1], m[2]), end: m[3] ? iso(m[3], m[4]) : m[5] ? iso(m[1], m[5]) : null };
}

function orderParse(lines) {
  var res = { project: '', title: '', jobs: [], warnings: [] }, all = [], byNo = {}, job = null, prev = '', note = false, lead = false, foot = false;
  var items = false, group = null, plain = ''; // item section after the first "Job" row: groups and article rows
  var park = function() { if (job) { job._items = items; job._group = group; job._note = note || lead; } };
  (lines || []).forEach(function(raw) {
    var l = raw.trim(), m;
    if (!res.project && (m = /^(?:Auftragsbest\S*|(?:Zwischenstand\s+)?Angebot)\s+\D*(\d{2}-\d{4})\s*\/\s*(.+)$/.exec(l))) {
      res.project = m[1]; res.title = m[2].trim(); return;
    }
    // Page footer + header ("Geschäftsführung Bankverbindung" … "Datum:" / "Seite: 2 von 49") is no job text
    if (/^Geschäftsführung\b/.test(l)) { foot = true; return; }
    if (foot) { if (/^Datum:/.test(l)) foot = false; return; }
    if (/^Seite: \d+ von \d+$/.test(l) || /^Pos\. Anzahl Bezeichnung/.test(l)) return;
    if ((m = ORDER_JOB_RE.exec(l))) {
      park();
      if (/\.{4,}|€/.test(l)) { job = null; prev = ''; return; } // summary list at the end repeats every job
      prev = 'head'; note = lead = false; plain = '';
      if (byNo[m[1]]) { job = byNo[m[1]]; items = job._items; group = job._group; note = job._note; prev = ''; return; } // header repeated after a page break
      job = byNo[m[1]] = { jobNo: m[1], name: orderStripPhones(m[2]), address: '', room: '', setup: null, event: null, teardown: null, lead: '', notes: '', materials: [] };
      all.push(job); items = false; group = null;
      return;
    }
    if (!job) return;
    // Angebote have no "Job" / "Job.Gruppe" marker rows: a group is the line before its first article, up to "Zwischensumme"
    var newGroup = function(it) { group = { group: plain, items: [it] }; job.materials.push(group); };
    if (items) {
      if (/^Job\.Gruppe$/.test(l)) { group = { group: plain, items: [] }; job.materials.push(group); }
      else if ((m = ORDER_ITEM_RE.exec(l))) { var it = { qty: +m[1], name: m[2].trim() }; if (group) group.items.push(it); else newGroup(it); }
      else if (/^Zwischensumme\b/.test(l)) group = null;
      if (!/^(\d+\s+)?Job/.test(l)) plain = l;
      return;
    }
    if (/^Job(\.|\s|$)/.test(l)) { items = true; return; }
    if ((m = ORDER_ITEM_RE.exec(l))) {
      items = true;
      if (plain && job.notes.slice(-plain.length) === plain) job.notes = job.notes.slice(0, -plain.length).replace(/\n$/, ''); // group name is no note
      newGroup({ qty: +m[1], name: m[2].trim() });
      return;
    }
    if (/^Auf-? und Abbau (via|durch)\b/i.test(l)) job.external = true; // "Auf- und Abbau via Service Estrel." – not our crew
    var lab = ORDER_LABEL_RE.exec(l);
    plain = lab ? '' : orderStripPhones(l);
    if (!lab) {
      if (prev === 'address') job.room = orderStripPhones(l);
      else if (lead && /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .\-]{0,30}$/.test(orderStripPhones(l.replace(/\/\/.*$/, '')))) {
        job.lead += (job.lead ? ', ' : '') + orderStripPhones(l.replace(/\/\/.*$/, '')); // another lead: a bare name (+ phone)
      } else if (lead || note) {
        lead = false; note = true; // schedule text right under the lead
        var c = orderStripPhones(l); if (c) job.notes += (job.notes ? '\n' : '') + c;
      }
      prev = ''; return;
    }
    var key = lab[1].trim(), val = lab[2].trim();
    // Repeated page header lines keep the text that runs on from the previous page
    if (key === 'Zeitraum') { if (!job.period) job.period = orderRange(val); prev = ''; return; }
    if (key === 'Lieferadresse' && job.address) { prev = ''; return; }
    prev = ''; note = lead = false;
    var field = { 'Aufbau': 'setup', 'Veranstaltung': 'event', 'Abbau': 'teardown' }[key];
    if (key === 'Lieferadresse') { job.address = val; prev = 'address'; }
    else if (field) {
      var r = orderRange(val);
      if (r) { if (!job[field]) job[field] = r; }
      else if (job[field]) { job.notes += (job.notes ? '\n' : '') + orderStripPhones(key + ': ' + val); note = true; } // "Abbau: bis mittags …" under a dated Abbau
      else res.warnings.push(job.jobNo + ': ' + key + ' nicht lesbar („' + val + '“)');
    } else if (key === 'Auf- & Abbauleitung') {
      job.lead = val === '???' ? '' : orderStripPhones(val.replace(/\/\/.*$/, '').replace(/\?{2,}/g, '')); lead = true;
    } else if (!ORDER_CONTACT_RE.test(key) && key !== 'Pos.') {
      var t = orderStripPhones(key + ': ' + val);
      job.notes += (job.notes ? '\n' : '') + t; note = true;
    }
  });
  // The Auf- & Abbauleitung usually stands once, on the first job: it leads the jobs that name none
  var firstLead = (all.filter(function(j) { return j.lead; })[0] || {}).lead || '';
  // Day plan in the notes of a "Zeitraum" job ("Di., 13.10." + "⦁ Foyer 2: Aufbau ganztägig"): it is the project's plan
  var days = [];
  all.some(function(j) { return j.period && (days = orderDays(j.notes, j.period.start)).length; });
  all.forEach(function(j) {
    // Only "Zeitraum" (whole project window): Aufbau / Abbau from the day plan, else the window's first / last day
    if (!j.setup && !j.teardown && j.period && !/personal|transport|rabatt/i.test(j.name)) {
      var up = days.filter(function(d) { return d.action === 'Aufbau'; }), down = days.filter(function(d) { return d.action === 'Abbau'; });
      j.setup = { start: up.length ? up[0].date : j.period.start.slice(0, 10), end: null };
      if (down.length) j.teardown = { start: down[0].date, end: down[down.length - 1].date };
      else if (j.period.end) j.teardown = { start: j.period.end.slice(0, 10), end: j.period.end };
      if (days.length) j.days = days;
      j.fromPeriod = true;
    }
    if (!j.lead) j.lead = firstLead;
    j.materials = j.materials.filter(function(g) { return g.items.length; });
    delete j._items; delete j._group; delete j._note; delete j.period;
    if ((j.setup || j.teardown) && !j.external) res.jobs.push(j);
    delete j.external;
  });
  if (!res.jobs.length && !res.project) res.warnings.push('Keine Auftragsbestätigung erkannt.');
  return res;
}

// Notes day plan → [{date, action}] in order, one per action and day. Day rows "Mo., 12.10."; lines below with
// Aufbau / Umbau / Abbau count, "Hinweis" lines (other firms' work) do not. Year from the Zeitraum start.
function orderDays(notes, periodStart) {
  var y0 = +periodStart.slice(0, 4), m0 = +periodStart.slice(5, 7), day = null, out = [], seen = {};
  (notes || '').split('\n').forEach(function(l) {
    var m = /^(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?,?\s+(\d{1,2})\.(\d{1,2})\./.exec(l);
    if (m) {
      var mo = +m[2], y = mo < m0 ? y0 + 1 : y0;
      day = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + m[1]).slice(-2);
      return;
    }
    if (!day || /^\W*Hinweis/i.test(l)) return;
    var a = /umbau/i.test(l) ? 'Umbau' : /aufbau/i.test(l) ? 'Aufbau' : /\babbau/i.test(l) ? 'Abbau' : null;
    if (a && !seen[day + a]) { seen[day + a] = true; out.push({ date: day, action: a }); }
  });
  return out;
}

// Jobs of one Bestätigung often share a phase (Aufbau, Deko and Umbau jobs all list the same Abbau):
// 'jobNo|phase' → the earlier job with exactly the same time, so that phase is staffed once
function orderSharedPhases(jobs) {
  var first = {}, out = {};
  (jobs || []).forEach(function(j) {
    ['setup', 'teardown'].forEach(function(ph) {
      var r = j[ph];
      if (!r || !r.start) return;
      var k = ph + '|' + r.start + '|' + (r.end || '');
      if (first[k]) out[j.jobNo + '|' + ph] = first[k]; else first[k] = j.jobNo;
    });
  });
  return out;
}

// Einsatz action for a job phase: Umbau / Teilaufbau / Teilabbau when the job name says so
function orderPhaseAction(job, phase) {
  var n = (job && job.name) || '';
  if (phase === 'teardown') return /teilabbau/i.test(n) ? 'Teilabbau' : 'Abbau';
  return /umbau/i.test(n) ? 'Umbau' : /teilaufbau/i.test(n) ? 'Teilaufbau' : 'Aufbau';
}
