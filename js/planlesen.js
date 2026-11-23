/* ══ Plan einlesen (testversion): floor plan PDF → furniture groups → material list ══
   No AI: CAD exports (AutoSTAGE etc.) are vector PDFs. Every chair, table and counter is the same little shape repeated,
   so the drawing commands are grouped by a rotation-proof fingerprint (vertices, perimeter, area, colours).
   The person names each group once (or picks a product); the names are remembered per symbol for the next plan.
   Pure part first (tests/planlesen.test.js), the page (pdf.js, canvas, list) below. */

// pdf.js path op codes inside constructPath (OPS.moveTo … OPS.rectangle in pdf.js 3.x)
var PL_OP = { moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19 };

function plMul(m, n) { // 2D affine [a b c d e f]
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
}
function plApply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

function plHex(c) {
  if (!c) return null;
  if (typeof c === 'string') return c.toLowerCase();
  var h = function(v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); };
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}

// Operator list → closed shapes in page space: [{ pts: [[x,y]…], curved, fill, stroke }]
// names: { fnId: 'opName' } (from pdfjsLib.OPS). Open strokes (walls, hatching, dimension lines) are dropped.
function plParseOps(fnArray, argsArray, names) {
  var shapes = [], ctm = [1, 0, 0, 1, 0, 0], stack = [], fill = '#000000', stroke = '#000000', pending = [];
  var PAINT = { stroke: 's', closeStroke: 's', fill: 'f', eoFill: 'f', fillStroke: 'fs', eoFillStroke: 'fs', closeFillStroke: 'fs', closeEOFillStroke: 'fs', endPath: null };
  for (var i = 0; i < fnArray.length; i++) {
    var n = names[fnArray[i]], a = argsArray[i];
    if (n === 'save') stack.push([ctm, fill, stroke]);
    else if (n === 'restore') { var s = stack.pop(); if (s) { ctm = s[0]; fill = s[1]; stroke = s[2]; } }
    else if (n === 'transform') ctm = plMul(ctm, a);
    else if (n === 'setFillRGBColor') fill = plHex(a);
    else if (n === 'setStrokeRGBColor') stroke = plHex(a);
    else if (n === 'constructPath') pending = pending.concat(plSubpaths(a[0], a[1], ctm));
    else if (n in PAINT) {
      var mode = PAINT[n];
      if (mode) pending.forEach(function(p) {
        // a stroked subpath counts when it is closed (closePath or back at its start); a filled one always is
        if (mode === 's' && !p.closed) return;
        shapes.push({ pts: p.pts, curved: p.curved, fill: mode.indexOf('f') !== -1 ? fill : null, stroke: mode.indexOf('s') !== -1 ? stroke : null });
      });
      pending = [];
    }
  }
  return shapes;
}

function plSubpaths(ops, coords, ctm) {
  var out = [], cur = null, j = 0;
  var start = function(x, y) { if (cur && cur.pts.length > 2) out.push(cur); cur = { pts: [plApply(ctm, x, y)], curved: false, closed: false }; };
  for (var k = 0; k < ops.length; k++) {
    var op = ops[k];
    if (op === PL_OP.moveTo) { start(coords[j], coords[j + 1]); j += 2; }
    else if (op === PL_OP.lineTo) { if (!cur) start(coords[j], coords[j + 1]); else cur.pts.push(plApply(ctm, coords[j], coords[j + 1])); j += 2; }
    else if (op === PL_OP.curveTo) { if (cur) { cur.pts.push(plApply(ctm, coords[j + 4], coords[j + 5])); cur.curved = true; } j += 6; }
    else if (op === PL_OP.curveTo2 || op === PL_OP.curveTo3) { if (cur) { cur.pts.push(plApply(ctm, coords[j + 2], coords[j + 3])); cur.curved = true; } j += 4; }
    else if (op === PL_OP.closePath) { if (cur) cur.closed = true; }
    else if (op === PL_OP.rectangle) {
      if (cur && cur.pts.length > 2) out.push(cur);
      var x = coords[j], y = coords[j + 1], w = coords[j + 2], h = coords[j + 3]; j += 4;
      out.push({ pts: [plApply(ctm, x, y), plApply(ctm, x + w, y), plApply(ctm, x + w, y + h), plApply(ctm, x, y + h)], curved: false, closed: true });
      cur = null;
    }
  }
  if (cur && cur.pts.length > 2) out.push(cur);
  out.forEach(function(p) { // ends where it started → closed
    var a = p.pts[0], b = p.pts[p.pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01) { p.closed = true; if (p.pts.length > 3) p.pts.pop(); }
  });
  return out;
}

// Size and shape of one closed shape; translation and rotation do not change perimeter, area or the vertex count
function plMeasure(sh) {
  var pts = sh.pts, n = pts.length, per = 0, area = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
  for (var i = 0; i < n; i++) {
    var p = pts[i], q = pts[(i + 1) % n];
    per += Math.hypot(q[0] - p[0], q[1] - p[1]);
    area += p[0] * q[1] - q[0] * p[1];
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    cx += p[0]; cy += p[1];
  }
  return { n: n, per: per, area: Math.abs(area) / 2, bbox: [x0, y0, x1, y1], cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, diag: Math.hypot(x1 - x0, y1 - y0) };
}

// Shapes → groups of identical symbols. opts: { minDiag, maxDiag, minCount, tol }
// Within the same vertex count and colours, shapes whose perimeter and area differ by less than tol (relative) are one group.
function plGroup(shapes, opts) {
  opts = opts || {};
  var minDiag = opts.minDiag || 2.5, maxDiag = opts.maxDiag || 80, minCount = opts.minCount || 3, tol = opts.tol || 0.04;
  var buckets = {};
  (shapes || []).forEach(function(sh) {
    var m = plMeasure(sh);
    if (m.diag < minDiag || m.diag > maxDiag || m.per <= 0) return;
    // needle-thin outlines are drawn lines, not furniture
    if (m.area < m.per * m.per / 400) return;
    var k = (sh.curved ? 'c' : 'p') + m.n + '|' + (sh.fill || '-') + '|' + (sh.stroke || '-');
    (buckets[k] = buckets[k] || []).push(m);
  });
  var groups = [];
  Object.keys(buckets).forEach(function(k) {
    var list = buckets[k].sort(function(a, b) { return a.per - b.per; });
    var cur = null;
    list.forEach(function(m) {
      if (cur && m.per <= cur.per * (1 + tol) && Math.abs(m.area - cur.area) <= cur.area * tol * 2.5) cur.members.push(m);
      else { cur = { kind: k, per: m.per, area: m.area, members: [m] }; groups.push(cur); }
    });
  });
  groups = groups.filter(function(g) { return g.members.length >= minCount; });
  return plMergeParts(groups);
}

// A symbol drawn from several parts (filled square + outline, table top + legs) yields groups at the same spots:
// keep the biggest part as the group, drop parts whose centres coincide with it
function plMergeParts(groups) {
  groups.sort(function(a, b) { return b.area - a.area || b.members.length - a.members.length; });
  var kept = [];
  groups.forEach(function(g) {
    var host = kept.find(function(h) { return plOverlapShare(g, h) >= 0.8; });
    if (host) { host.parts = (host.parts || 1) + 1; return; }
    kept.push(g);
  });
  return kept.map(function(g) {
    var d = g.members[0].diag;
    return { kind: g.kind, per: g.per, area: g.area, diag: d, count: g.members.length, parts: g.parts || 1, members: g.members };
  });
}

// Share of g's members whose centre lies inside a member of h
function plOverlapShare(g, h) {
  var cell = 20, grid = {};
  h.members.forEach(function(m) {
    for (var gx = Math.floor(m.bbox[0] / cell); gx <= Math.floor(m.bbox[2] / cell); gx++)
      for (var gy = Math.floor(m.bbox[1] / cell); gy <= Math.floor(m.bbox[3] / cell); gy++) (grid[gx + ',' + gy] = grid[gx + ',' + gy] || []).push(m);
  });
  var hit = 0;
  g.members.forEach(function(m) {
    var c = grid[Math.floor(m.cx / cell) + ',' + Math.floor(m.cy / cell)] || [];
    if (c.some(function(o) { return m.cx >= o.bbox[0] - 0.3 && m.cx <= o.bbox[2] + 0.3 && m.cy >= o.bbox[1] - 0.3 && m.cy <= o.bbox[3] + 0.3; })) hit++;
  });
  return g.members.length ? hit / g.members.length : 0;
}

// Remembered name per symbol: stored under kind + exact size, found again with a tolerance (plMatchMemory)
function plSymbolKey(g) {
  return g.kind + '|' + g.per.toFixed(1) + '|' + g.area.toFixed(1);
}

// The remembered entry for a group: same kind, perimeter within tol and area within 2.5×tol; the closest wins
function plMatchMemory(memory, g, tol) {
  tol = tol || 0.05;
  var best = null, bestD = Infinity;
  Object.keys(memory || {}).forEach(function(k) {
    var p = k.split('|');
    if (p.length < 5 || p.slice(0, 3).join('|') !== g.kind) return;
    var per = parseFloat(p[3]), area = parseFloat(p[4]);
    var dp = Math.abs(per - g.per) / g.per, da = Math.abs(area - g.area) / Math.max(g.area, 0.01);
    if (dp <= tol && da <= tol * 2.5 && dp + da < bestD) { bestD = dp + da; best = { key: k, entry: memory[k] }; }
  });
  return best;
}

// Words of the plan that can name furniture: letters only, no title-block vocabulary; rotated text sometimes comes doubled
var PL_STOP = /^(datum|projekt|blatt|position|raumplan|vorabzug|erstellt|genehmigt|maßstab|massstab|alle|rechte|sind|berlin|deutschland|sonnenallee|seite|änderung|beginn|ende|dokumentenart|dokumentenstatus|dateiname|dateinam|prüfen|sämtliche|zeichnungen|congress|estrel|galerie|notausgang|ausgang|n\.t\.s)$/i;
function plCleanLabel(str) {
  var s = String(str || '').replace(/[^A-Za-zÄÖÜäöüß\-\/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || PL_STOP.test(s)) return null;
  // "HochtischHochtisch" (doubled by the CAD export)
  var half = s.length / 2;
  if (s.length % 2 === 0 && s.slice(0, half) === s.slice(half)) s = s.slice(0, half);
  return s.length >= 3 ? s : null;
}

// The title block (Maßstab, Raumplan, Projekt …): its words in page space → a zone to ignore, or null.
// titleWords: [{ x, y }] of the title-block words; the zone is their box plus a margin, only with at least 3 words
function plTitleZone(titleWords, pageW, pageH) {
  if (!titleWords || titleWords.length < 3) return null;
  // a stray match in the drawing ("Position und Höhe tba.") must not stretch the zone: keep the words near the median
  var med = function(a) { var s = a.slice().sort(function(p, q) { return p - q; }); return s[Math.floor(s.length / 2)]; };
  var mx0 = med(titleWords.map(function(w) { return w.x; })), my0 = med(titleWords.map(function(w) { return w.y; }));
  var lim = Math.max(pageW, pageH) * 0.4;
  titleWords = titleWords.filter(function(w) { return Math.abs(w.x - mx0) <= lim && Math.abs(w.y - my0) <= lim; });
  if (titleWords.length < 3) return null;
  var xs = titleWords.map(function(w) { return w.x; }), ys = titleWords.map(function(w) { return w.y; });
  var mx = pageW * 0.08, my = pageH * 0.08;
  return [Math.min.apply(null, xs) - mx, Math.min.apply(null, ys) - my, Math.max.apply(null, xs) + mx, Math.max.apply(null, ys) + my];
}
// whole title-block labels only ("Position:", "Erstellt durch:", "Raumplan"), never a word inside a drawing note
var PL_TITLE_WORDS = /^((maßstab|massstab|projekt( id)?|dokumentenart|dokumentenstatus|datum|blatt|änderung|erstellt durch|genehmigt von|dateiname|position):|raumplan|vorabzug)$/i;

// Drop members inside the zone, then groups that became too small
function plWithoutZone(groups, zone, minCount) {
  if (!zone) return groups;
  return groups.map(function(g) {
    var m = g.members.filter(function(x) { return !(x.cx >= zone[0] && x.cx <= zone[2] && x.cy >= zone[1] && x.cy <= zone[3]); });
    return Object.assign({}, g, { members: m, count: m.length });
  }).filter(function(g) { return g.count >= (minCount || 3); });
}

// labels: [{ text, x, y }] in page space → for each group the label written on or right at its members most often
function plSuggestNames(groups, labels) {
  var votes = groups.map(function() { return {}; });
  (labels || []).forEach(function(l) {
    var best = -1, bestD = Infinity;
    groups.forEach(function(g, gi) {
      g.members.forEach(function(m) {
        // the word has to start inside the symbol (CAD writes "Hochtisch" into the table), not just nearby
        var pad = m.diag * 0.1, inside = l.x >= m.bbox[0] - pad && l.x <= m.bbox[2] + pad && l.y >= m.bbox[1] - pad && l.y <= m.bbox[3] + pad;
        var d = Math.hypot(m.cx - l.x, m.cy - l.y);
        if (inside && d < bestD) { bestD = d; best = gi; }
      });
    });
    if (best >= 0) votes[best][l.text] = (votes[best][l.text] || 0) + 1;
  });
  return votes.map(function(v, gi) {
    var k = Object.keys(v).sort(function(a, b) { return v[b] - v[a]; })[0];
    // one stray word next to a big group is chance, not a name
    return k && (v[k] >= 2 || groups[gi].members.length < 4) ? k : null;
  });
}

// groups + names ({ index: { name, ignore } }) → material list sorted by count, plus how many groups still have no name
function plMaterialList(groups, names) {
  var by = {}, unnamed = 0;
  groups.forEach(function(g, i) {
    var a = names[i] || {};
    if (a.ignore) return;
    var n = String(a.name || '').trim();
    if (!n) { unnamed++; return; }
    by[n] = (by[n] || 0) + g.count;
  });
  var rows = Object.keys(by).map(function(n) { return { name: n, count: by[n] }; })
    .sort(function(a, b) { return b.count - a.count || a.name.localeCompare(b.name, 'de'); });
  return { rows: rows, unnamed: unnamed };
}

// Zoom and scroll so that box ([x0,y0,x1,y1] in unzoomed px) fills the stage with some margin; zoom between 1 and maxZoom
function plFitZoom(box, stageW, stageH, maxZoom) {
  var w = Math.max(1, box[2] - box[0]), h = Math.max(1, box[3] - box[1]), pad = 0.18;
  var z = Math.min(stageW / (w * (1 + pad * 2)), stageH / (h * (1 + pad * 2)));
  z = Math.max(1, Math.min(maxZoom || 6, z));
  var cx = (box[0] + box[2]) / 2 * z, cy = (box[1] + box[3]) / 2 * z;
  return { zoom: z, left: Math.max(0, cx - stageW / 2), top: Math.max(0, cy - stageH / 2) };
}

// Next group (from `from`, direction dir) that still needs a decision: no name and not hidden; -1 when all are done
function plNextOpen(names, count, from, dir) {
  dir = dir || 1;
  for (var k = 1; k <= count; k++) {
    var i = ((from + dir * k) % count + count) % count, a = names[i] || {};
    if (!a.ignore && !String(a.name || '').trim()) return i;
  }
  return -1;
}

// Name choices for the sheet: used in this plan first, then remembered, products, words from the plan; filtered by the query
function plNameOptions(query, used, remembered, products, suggest) {
  var q = String(query || '').trim().toLowerCase(), seen = {}, out = [];
  [used, suggest, remembered, products].forEach(function(list, src) {
    (list || []).forEach(function(n) {
      var s = String(n || '').trim(), k = s.toLowerCase();
      if (!s || seen[k] || (q && k.indexOf(q) === -1)) return;
      seen[k] = true; out.push({ name: s, used: src === 0 });
    });
  });
  return out.slice(0, 60);
}

// "1794984825112_bd6q3_IPM_AG_FBF26_Setup_Foyer_3.pdf" → "IPM AG FBF26 Setup Foyer 3": upload prefixes (timestamp + id) and underscores out
function plPrettyName(file) {
  var s = String(file || '').replace(/\.pdf$/i, '').replace(/^\d{10,}_[a-z0-9]{3,8}_/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s || String(file || 'Plan');
}

function plCsv(rows, title) {
  var cell = function(v) { var t = String(v == null ? '' : v); if (/^[=+\-@]/.test(t)) t = "'" + t; return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  return '﻿' + (title ? cell(title) + '\r\n' : '') + 'Artikel;Anzahl\r\n' + rows.map(function(r) { return cell(r.name) + ';' + r.count; }).join('\r\n') + '\r\n';
}

/* ── Page (browser only) ── */

var PL_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#469990', '#808000', '#000075', '#bfef45'];
var _pl = { doc: null, page: null, pageNo: 1, vp: null, groups: [], names: {}, sel: null, file: '', memory: {}, products: [], busy: false,
  zoom: 1, cur: 0, tab: 'sym' };
function plIsMobile() { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 859px)').matches; }
var PL_MEMORY_KEY = 'luebbert_plan_symbols';

function plMayUse(role) { return ['AL', 'PL', 'Admin'].indexOf(role) !== -1; }

async function initPlanlesen() {
  if (!document.getElementById('pl-file')) plRenderShell(); // a plan already open stays open when coming back
  _pl.memory = await plLoadMemory();
  // Product names as suggestions for the name fields (the Produktdatenbank may not have been opened yet)
  if (typeof supabaseClient !== 'undefined' && (typeof alleProdukte === 'undefined' || !alleProdukte.length)) {
    try {
      var r = await supabaseClient.from('products').select('name').order('name');
      if (!r.error) _pl.products = (r.data || []).map(function(p) { return p.name; });
    } catch (e) { /* offline: suggestions from the plan only */ }
  }
}

// Remembered symbol names: table plan_symbols for everyone, the device as fallback (table missing / offline)
async function plLoadMemory() {
  var mem = {};
  try { mem = JSON.parse(localStorage.getItem(PL_MEMORY_KEY) || '{}') || {}; } catch (e) { mem = {}; }
  if (typeof supabaseClient === 'undefined') return mem;
  try {
    var r = await supabaseClient.from('plan_symbols').select('sig, name, ignore');
    if (!r.error) (r.data || []).forEach(function(row) { mem[row.sig] = { name: row.name, ignore: !!row.ignore }; });
  } catch (e) { /* offline: device memory only */ }
  return mem;
}

async function plRemember(sig, entry) {
  _pl.memory[sig] = entry;
  try { localStorage.setItem(PL_MEMORY_KEY, JSON.stringify(_pl.memory)); } catch (e) { /* storage full */ }
  if (typeof supabaseClient === 'undefined') return;
  try {
    var me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    await supabaseClient.from('plan_symbols').upsert({ sig: sig, name: entry.name || '', ignore: !!entry.ignore, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: 'sig' });
  } catch (e) { /* table missing on an older database: device memory still works */ }
}

function plRenderShell() {
  var box = document.getElementById('pl-root');
  if (!box) return;
  box.innerHTML =
    '<div class="pl-intro">' +
      '<b>Raumplan als PDF</b><p>Die App sucht gleiche Symbole (Stühle, Tische, Stehtische …) und zählt sie. Du benennst jede Gruppe einmal, beim nächsten Plan erkennt sie die Symbole wieder. Der Plan bleibt auf dem Gerät.</p>' +
      '<label class="w-btn w-btn-accent pl-pick"><span class="pl-pick-1">PDF wählen</span><span class="pl-pick-2">Anderer Plan</span><input type="file" accept="application/pdf" id="pl-file" hidden></label>' +
    '</div>' +
    '<div id="pl-work" hidden>' +
      '<div class="pl-head"><div><b id="pl-title"></b><small id="pl-sub"></small></div><div class="pl-head-btns" id="pl-pages"></div></div>' +
      '<div class="pl-layout">' +
        '<div class="pl-stagewrap"><div class="pl-stage" id="pl-stage"><canvas id="pl-canvas"></canvas><svg id="pl-overlay"></svg></div>' +
          '<button type="button" class="w-btn pl-zoom" id="pl-zoom" onclick="plToggleZoom()">Vergrößern</button></div>' +
        '<div class="pl-side"><div class="w-label">Gefundene Symbole</div><div id="pl-groups"></div>' +
          '<div class="w-label">Materialliste</div><div id="pl-list"></div></div>' +
        // phones: one symbol at a time on a card, the material list on its own tab
        '<div class="pl-mob">' +
          '<div class="ui-seg pl-tabs" role="tablist"><button type="button" role="tab" id="pl-tab-sym" class="active" onclick="plSetTab(\'sym\')">Symbole</button>' +
            '<button type="button" role="tab" id="pl-tab-list" onclick="plSetTab(\'list\')">Liste</button></div>' +
          '<div id="pl-card"></div><div id="pl-mlist" hidden></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.getElementById('pl-file').addEventListener('change', function(e) { if (e.target.files[0]) plOpenFile(e.target.files[0]); });
}

async function plOpenFile(file) {
  if (_pl.busy) return;
  if (typeof needLib === 'function' && !(await needLib('pdfjs'))) return;
  _pl.busy = true;
  try {
    var buf = await file.arrayBuffer();
    _pl.doc = await pdfjsLib.getDocument({ data: buf }).promise;
    _pl.file = plPrettyName(file.name);
    await plShowPage(1);
  } catch (e) {
    console.warn('Plan einlesen:', e);
    showToast('Die PDF konnte nicht gelesen werden.', 'danger');
  } finally { _pl.busy = false; }
}

async function plShowPage(no) {
  _pl.pageNo = no;
  var page = await _pl.doc.getPage(no);
  _pl.page = page;
  document.getElementById('pl-work').hidden = false;
  var intro = document.querySelector('.pl-intro');
  if (intro) intro.classList.add('pl-loaded'); // once a plan is open only "Anderer Plan" stays
  document.getElementById('pl-title').textContent = _pl.file;
  document.getElementById('pl-sub').textContent = 'Seite ' + no + ' von ' + _pl.doc.numPages + ' · wird gelesen …';
  document.getElementById('pl-pages').innerHTML = _pl.doc.numPages > 1 ? Array.from({ length: _pl.doc.numPages }, function(_, i) {
    return '<button type="button" class="w-btn' + (i + 1 === no ? ' w-btn-accent' : '') + '" onclick="plShowPage(' + (i + 1) + ')">' + (i + 1) + '</button>';
  }).join('') : '';
  // Render: fit the stage width, sharp on retina
  var stage = document.getElementById('pl-stage'), base = page.getViewport({ scale: 1 });
  _pl.zoom = 1; stage.classList.remove('pl-zoomed');
  var cssW = Math.max(280, stage.clientWidth || 600), scale = cssW / base.width, dpr = Math.min(2, window.devicePixelRatio || 1);
  _pl.vp = page.getViewport({ scale: scale });
  // rendered with headroom for the 2.5× zoom, capped so a phone does not run out of canvas memory
  var px = Math.min(scale * dpr * 2.5, 4200 / base.width);
  var canvas = document.getElementById('pl-canvas'), vpx = page.getViewport({ scale: px });
  canvas.width = vpx.width; canvas.height = vpx.height; canvas.style.width = _pl.vp.width + 'px'; canvas.style.height = _pl.vp.height + 'px';
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: vpx }).promise;
  // Shapes and words
  var ol = await page.getOperatorList(), names = {};
  Object.keys(pdfjsLib.OPS).forEach(function(k) { names[pdfjsLib.OPS[k]] = k; });
  var shapes = plParseOps(ol.fnArray, ol.argsArray, names);
  var pageDiag = Math.hypot(base.width, base.height);
  var tc = await page.getTextContent(), labels = [], title = [];
  tc.items.forEach(function(t) {
    if (PL_TITLE_WORDS.test(String(t.str).trim())) title.push({ x: t.transform[4], y: t.transform[5] });
    var w = plCleanLabel(t.str); if (w) labels.push({ text: w, x: t.transform[4], y: t.transform[5] });
  });
  var view = page.view, zone = plTitleZone(title, view[2] - view[0], view[3] - view[1]);
  var groups = plWithoutZone(plGroup(shapes, { minDiag: pageDiag * 0.0025, maxDiag: pageDiag * 0.09 }), zone, 3);
  var suggest = plSuggestNames(groups, labels);
  // Most interesting first: many and not tiny
  var order = groups.map(function(g, i) { return i; }).sort(function(a, b) { return groups[b].count * Math.sqrt(groups[b].diag) - groups[a].count * Math.sqrt(groups[a].diag); });
  _pl.groups = order.map(function(i) { return Object.assign(groups[i], { suggest: suggest[i], sig: plSymbolKey(groups[i]) }); }).slice(0, 30);
  _pl.names = {};
  _pl.groups.forEach(function(g, i) {
    var hit = plMatchMemory(_pl.memory, g);
    if (hit) g.sig = hit.key; // keep updating the entry it was recognised by
    _pl.names[i] = hit ? { name: hit.entry.name, ignore: hit.entry.ignore, known: true } : { name: '', ignore: false };
  });
  _pl.sel = null; _pl.tab = 'sym';
  var first = plNextOpen(_pl.names, _pl.groups.length, -1, 1);
  _pl.cur = first === -1 ? 0 : first;
  document.getElementById('pl-sub').textContent = 'Seite ' + no + ' von ' + _pl.doc.numPages + ' · ' + _pl.groups.length + ' Symbolgruppen, ' +
    _pl.groups.reduce(function(n, g) { return n + g.count; }, 0) + ' Teile';
  plSetTab('sym', true);
  plDraw();
  if (plIsMobile() && _pl.groups.length) plFocus(_pl.cur);
}

function plColor(i) { return PL_COLORS[i % PL_COLORS.length]; }

// Pinch-zoom is off app-wide, so the plan zooms inside a scrolling box
function plSetZoom(z, left, top) {
  var stage = document.getElementById('pl-stage'), canvas = document.getElementById('pl-canvas'), svg = document.getElementById('pl-overlay'), vp = _pl.vp;
  if (!stage || !vp) return;
  _pl.zoom = z;
  var w = vp.width * z, h = vp.height * z;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  svg.style.width = w + 'px'; svg.style.height = h + 'px';
  svg.setAttribute('width', w); svg.setAttribute('height', h);
  stage.classList.toggle('pl-zoomed', z !== 1);
  stage.scrollLeft = left || 0; stage.scrollTop = top || 0;
  var btn = document.getElementById('pl-zoom');
  if (btn) btn.textContent = z === 1 ? (plIsMobile() && _pl.groups.length ? 'Zum Symbol' : 'Vergrößern') : 'Ganzer Plan';
}

function plToggleZoom() {
  if (_pl.zoom !== 1) { plSetZoom(1); return; }
  if (plIsMobile() && _pl.groups[_pl.cur]) plFocus(_pl.cur);
  else plSetZoom(2.5, 0, 0);
}

// The plan zooms to where the group's symbols are (all of them in view)
function plFocus(i) {
  var g = _pl.groups[i], vp = _pl.vp, stage = document.getElementById('pl-stage');
  if (!g || !vp || !stage) return;
  var box = [Infinity, Infinity, -Infinity, -Infinity];
  g.members.forEach(function(m) {
    var p = vp.convertToViewportRectangle(m.bbox);
    box[0] = Math.min(box[0], p[0], p[2]); box[1] = Math.min(box[1], p[1], p[3]);
    box[2] = Math.max(box[2], p[0], p[2]); box[3] = Math.max(box[3], p[1], p[3]);
  });
  var f = plFitZoom(box, stage.clientWidth, stage.clientHeight, 6);
  plSetZoom(f.zoom, f.left, f.top);
}

function plDraw() {
  var svg = document.getElementById('pl-overlay'), vp = _pl.vp, z = _pl.zoom || 1;
  svg.setAttribute('width', vp.width * z); svg.setAttribute('height', vp.height * z);
  svg.setAttribute('viewBox', '0 0 ' + vp.width + ' ' + vp.height);
  var html = '';
  _pl.groups.forEach(function(g, i) {
    var a = _pl.names[i];
    if (a.ignore) return;
    var only = plIsMobile() ? (_pl.tab === 'sym' ? _pl.cur : null) : _pl.sel;
    if (only !== null && only !== i) return;
    g.members.forEach(function(m) {
      var p = vp.convertToViewportRectangle(m.bbox);
      var x = Math.min(p[0], p[2]), y = Math.min(p[1], p[3]), w = Math.abs(p[2] - p[0]), h = Math.abs(p[3] - p[1]);
      html += '<rect x="' + (x - 1.5).toFixed(1) + '" y="' + (y - 1.5).toFixed(1) + '" width="' + (w + 3).toFixed(1) + '" height="' + (h + 3).toFixed(1) +
        '" stroke="' + plColor(i) + '" vector-effect="non-scaling-stroke" />';
    });
  });
  svg.innerHTML = html;
  plDrawGroups();
  plDrawList();
  plDrawCard();
}

function plPreview(g, size) {
  var canvas = document.getElementById('pl-canvas'), vp = _pl.vp, dpr = canvas.width / vp.width;
  var p = vp.convertToViewportRectangle(g.members[0].bbox);
  var x = Math.min(p[0], p[2]), y = Math.min(p[1], p[3]), w = Math.abs(p[2] - p[0]), h = Math.abs(p[3] - p[1]), pad = Math.max(w, h) * 0.35 + 2;
  var c = document.createElement('canvas'), side = (size || 44) * 2;
  c.width = side; c.height = side;
  var ctx = c.getContext('2d'), sw = (Math.max(w, h) + pad * 2) * dpr;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, side, side);
  ctx.drawImage(canvas, (x + w / 2) * dpr - sw / 2, (y + h / 2) * dpr - sw / 2, sw, sw, 0, 0, side, side);
  return c.toDataURL();
}

function plDrawGroups() {
  var box = document.getElementById('pl-groups');
  if (!_pl.groups.length) { box.innerHTML = '<div class="w-empty"><b>Keine Symbole gefunden</b><p>Ist das ein gescannter Plan? Dann geht es nur mit einer PDF aus dem CAD-Programm.</p></div>'; return; }
  box.innerHTML = _pl.groups.map(function(g, i) {
    var a = _pl.names[i];
    return '<div class="pl-group' + (a.ignore ? ' pl-off' : '') + (_pl.sel === i ? ' pl-sel' : '') + '">' +
      '<button type="button" class="pl-thumb" style="--c:' + plColor(i) + '" onclick="plSelect(' + i + ')" aria-label="Auf dem Plan zeigen"><img alt="" src="' + plPreview(g) + '"></button>' +
      '<div class="pl-gbody"><div class="pl-gcount"><b class="w-num">' + g.count + '×</b>' + (a.known ? '<span class="pl-known">erkannt</span>' : '') + '</div>' +
      '<input type="text" class="pl-name" list="pl-products" placeholder="' + escapeHtml(g.suggest ? 'z. B. ' + g.suggest : 'Name, z. B. Stehtisch') + '" value="' + escapeHtml(a.name || '') + '"' +
        ' onchange="plSetName(' + i + ', this.value)"' + (a.ignore ? ' disabled' : '') + '></div>' +
      '<button type="button" class="pl-hide" onclick="plToggleIgnore(' + i + ')" aria-label="' + (a.ignore ? 'Wieder zählen' : 'Nicht zählen') + '">' + (a.ignore ? '↺' : '×') + '</button>' +
    '</div>';
  }).join('') + plProductList();
}

// Product names from the Produktdatenbank as suggestions for the name field
function plProductList() {
  var list = (typeof alleProdukte !== 'undefined' && Array.isArray(alleProdukte) && alleProdukte.length) ? alleProdukte.map(function(p) { return p.name; }) : (_pl.products || []);
  var sug = _pl.groups.map(function(g) { return g.suggest; }).filter(Boolean);
  var known = Object.keys(_pl.memory || {}).map(function(k) { return _pl.memory[k].name; });
  var all = list.concat(sug, known).filter(function(v, i, a) { return v && a.indexOf(v) === i; });
  return '<datalist id="pl-products">' + all.map(function(n) { return '<option value="' + escapeHtml(n) + '">'; }).join('') + '</datalist>';
}

function plSelect(i) {
  _pl.sel = _pl.sel === i ? null : i;
  plDraw();
  // phones: the plan is above the list, bring it into view so the highlighted symbols are seen
  var st = document.getElementById('pl-stage');
  if (_pl.sel !== null && st && window.innerWidth < 860 && st.scrollIntoView) st.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function plSetName(i, v, advance) {
  var a = _pl.names[i];
  a.name = String(v || '').trim().slice(0, 80);
  a.known = false;
  if (a.name) a.ignore = false;
  plRemember(_pl.groups[i].sig, { name: a.name, ignore: false });
  if (advance) plAdvance(i); else { plDrawList(); plDrawCard(); }
}

function plToggleIgnore(i, advance) {
  var a = _pl.names[i];
  a.ignore = !a.ignore;
  plRemember(_pl.groups[i].sig, { name: a.name || '', ignore: a.ignore });
  if (_pl.sel === i) _pl.sel = null;
  if (advance && a.ignore) { plAdvance(i); return; }
  plDraw();
}

// Phones: after a decision on to the next open symbol (or stay when everything is done)
function plAdvance(i) {
  var next = plNextOpen(_pl.names, _pl.groups.length, i, 1);
  if (next === -1) { plDraw(); showToast('Alle Symbole erledigt. Die Liste steht unter „Liste“.'); return; }
  plGo(next);
}

function plGo(i) {
  var n = _pl.groups.length;
  if (!n) return;
  _pl.cur = ((i % n) + n) % n;
  plDraw();
  plFocus(_pl.cur);
}

function plSetTab(t, quiet) {
  _pl.tab = t;
  var a = document.getElementById('pl-tab-sym'), b = document.getElementById('pl-tab-list');
  if (a) a.classList.toggle('active', t === 'sym');
  if (b) b.classList.toggle('active', t === 'list');
  var card = document.getElementById('pl-card'), ml = document.getElementById('pl-mlist');
  if (card) card.hidden = t !== 'sym';
  if (ml) ml.hidden = t !== 'list';
  var lay = document.querySelector('.pl-layout');
  if (lay) lay.classList.toggle('pl-list-tab', t === 'list'); // phones: the list gets the whole screen
  if (quiet) return;
  plDraw();
  if (t === 'list') plSetZoom(1); else plFocus(_pl.cur);
}

// Phone card: one symbol, big thumbnail, quick names, ‹ Nicht zählen ›; swipe left/right to move on
function plDrawCard() {
  var box = document.getElementById('pl-card');
  if (!box) return;
  var ml = plMaterialList(_pl.groups, _pl.names), tabList = document.getElementById('pl-tab-list');
  if (tabList) tabList.innerHTML = 'Liste' + (ml.rows.length ? ' <span class="pl-tab-n">' + ml.rows.length + '</span>' : '');
  var mlist = document.getElementById('pl-mlist');
  if (mlist) mlist.innerHTML = document.getElementById('pl-list').innerHTML;
  var g = _pl.groups[_pl.cur];
  if (!g) { box.innerHTML = '<div class="w-empty"><b>Keine Symbole gefunden</b><p>Ist das ein gescannter Plan? Dann geht es nur mit einer PDF aus dem CAD-Programm.</p></div>'; return; }
  var i = _pl.cur, a = _pl.names[i], open = 0;
  _pl.groups.forEach(function(x, k) { var b = _pl.names[k]; if (!b.ignore && !String(b.name || '').trim()) open++; });
  var chips = plNameOptions('', plUsedNames(i), [], [], g.suggest ? [g.suggest] : []).slice(0, 4);
  box.innerHTML = '<div class="pl-card" id="pl-card-inner" style="--c:' + plColor(i) + '">' +
    '<div class="pl-card-top"><span class="w-num">' + (i + 1) + ' / ' + _pl.groups.length + '</span>' +
      (a.known ? '<span class="pl-known">erkannt</span>' : '') + '<span class="pl-card-open">' + (open ? open + ' offen' : 'alles erledigt ✓') + '</span></div>' +
    '<div class="pl-card-main"><img alt="" src="' + plPreview(g, 72) + '"><div><b class="w-num">' + g.count + '×</b><small>auf dem Plan markiert</small></div></div>' +
    (a.ignore ? '<div class="pl-card-ignored">Wird nicht gezählt</div>'
      : '<button type="button" class="pl-card-name' + (a.name ? ' pl-has' : '') + '" onclick="plOpenNameSheet(' + i + ')">' +
          (a.name ? escapeHtml(a.name) : 'Benennen …') + '<span aria-hidden="true">✎</span></button>' +
        (chips.length && !a.name ? '<div class="pl-chips">' + chips.map(function(c) {
          return '<button type="button" class="pl-chip" data-n="' + escapeHtml(c.name) + '" onclick="plSetName(' + i + ', this.dataset.n, true)">' + escapeHtml(c.name) + '</button>';
        }).join('') + '</div>' : '')) +
    '<div class="pl-card-nav"><button type="button" class="w-btn" onclick="plGo(' + (i - 1) + ')" aria-label="Vorheriges Symbol">‹</button>' +
      '<button type="button" class="w-btn pl-card-skip" onclick="plToggleIgnore(' + i + ', true)">' + (a.ignore ? 'Doch zählen' : 'Nicht zählen') + '</button>' +
      '<button type="button" class="w-btn" onclick="plGo(' + (i + 1) + ')" aria-label="Nächstes Symbol">›</button></div>' +
  '</div>';
  plBindSwipe(document.getElementById('pl-card-inner'));
}

function plUsedNames(except) {
  var out = [];
  Object.keys(_pl.names).forEach(function(k) { var n = _pl.names[k] && _pl.names[k].name; if (+k !== except && n && !_pl.names[k].ignore) out.push(n); });
  return out;
}

function plBindSwipe(el) {
  if (!el) return;
  var x0 = null, y0 = null;
  el.addEventListener('pointerdown', function(e) { x0 = e.clientX; y0 = e.clientY; });
  el.addEventListener('pointerup', function(e) {
    if (x0 === null) return;
    var dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) plGo(_pl.cur + (dx < 0 ? 1 : -1));
  });
}

// Full-screen name picker: search, names already used in this plan first, then remembered names and products
function plOpenNameSheet(i) {
  var g = _pl.groups[i];
  if (!g) return;
  var m = document.getElementById('pl-sheet');
  if (!m) { m = document.createElement('div'); m.id = 'pl-sheet'; m.className = 'pl-sheet'; document.body.appendChild(m); }
  m.innerHTML = '<div class="pl-sheet-head"><img alt="" src="' + plPreview(g, 44) + '"><div><b>Wie heißt das?</b><small class="w-num">' + g.count + '× auf dem Plan</small></div>' +
      '<button type="button" class="pl-hide" onclick="plCloseNameSheet()" aria-label="Schließen">×</button></div>' +
    '<input type="search" id="pl-sheet-q" class="pl-sheet-q" placeholder="Suchen oder neuen Namen tippen" autocomplete="off" enterkeyhint="done" value="' + escapeHtml(_pl.names[i].name || '') + '">' +
    '<div class="pl-sheet-list" id="pl-sheet-list"></div>';
  m.dataset.i = i;
  m.classList.add('open');
  var q = document.getElementById('pl-sheet-q');
  q.addEventListener('input', plDrawNameOptions);
  q.addEventListener('keydown', function(e) { if (e.key === 'Enter' && q.value.trim()) plPickName(q.value); });
  plDrawNameOptions();
  setTimeout(function() { q.focus(); q.select(); }, 50);
}

function plDrawNameOptions() {
  var m = document.getElementById('pl-sheet'), i = +m.dataset.i, q = document.getElementById('pl-sheet-q').value;
  var remembered = Object.keys(_pl.memory || {}).map(function(k) { return _pl.memory[k].name; });
  var products = (typeof alleProdukte !== 'undefined' && Array.isArray(alleProdukte) && alleProdukte.length) ? alleProdukte.map(function(p) { return p.name; }) : (_pl.products || []);
  var opts = plNameOptions(q, plUsedNames(i), remembered, products, _pl.groups[i].suggest ? [_pl.groups[i].suggest] : []);
  var exact = opts.some(function(o) { return o.name.toLowerCase() === q.trim().toLowerCase(); });
  document.getElementById('pl-sheet-list').innerHTML =
    (q.trim() && !exact ? '<button type="button" class="pl-opt pl-opt-new" data-n="' + escapeHtml(q.trim()) + '" onclick="plPickName(this.dataset.n)">„' + escapeHtml(q.trim()) + '“ übernehmen</button>' : '') +
    opts.map(function(o) { return '<button type="button" class="pl-opt" data-n="' + escapeHtml(o.name) + '" onclick="plPickName(this.dataset.n)">' + escapeHtml(o.name) +
      (o.used ? '<small>schon in diesem Plan</small>' : '') + '</button>'; }).join('') +
    (!opts.length && !q.trim() ? '<p class="pl-hint">Tippe einen Namen, z. B. „Stehtisch Ø80“. Beim nächsten Plan wird er wieder vorgeschlagen.</p>' : '');
}

function plPickName(n) {
  var m = document.getElementById('pl-sheet'), i = +m.dataset.i;
  plCloseNameSheet();
  plSetName(i, n, plIsMobile());
}

function plCloseNameSheet() {
  var m = document.getElementById('pl-sheet');
  if (m) m.classList.remove('open');
}

function plDrawList() {
  var box = document.getElementById('pl-list'), ml = plMaterialList(_pl.groups, _pl.names);
  box.innerHTML = (ml.rows.length ? '<div class="pl-ml">' + ml.rows.map(function(r) {
      return '<div class="pl-ml-row"><span>' + escapeHtml(r.name) + '</span><b class="w-num">' + r.count + '</b></div>';
    }).join('') + '</div>' : '<p class="pl-hint">Gib den Gruppen oben einen Namen, dann entsteht hier die Liste.</p>') +
    (ml.unnamed ? '<p class="pl-hint">' + ml.unnamed + (ml.unnamed === 1 ? ' Gruppe hat' : ' Gruppen haben') + ' noch keinen Namen. Was nicht zählt (Schilder, Säulen …): ×.</p>' : '') +
    (ml.rows.length ? '<div class="pl-ml-btns"><button type="button" class="w-btn" onclick="plCopy()">Kopieren</button><button type="button" class="w-btn" onclick="plDownloadCsv()">CSV</button></div>' : '');
}

function plCopy() {
  var ml = plMaterialList(_pl.groups, _pl.names);
  var text = _pl.file + '\n' + ml.rows.map(function(r) { return r.count + '× ' + r.name; }).join('\n');
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(function() { showToast('Materialliste kopiert'); }, function() { showToast('Kopieren ging nicht', 'danger'); });
}

function plDownloadCsv() {
  var ml = plMaterialList(_pl.groups, _pl.names);
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([plCsv(ml.rows, _pl.file)], { type: 'text/csv;charset=utf-8' }));
  a.download = 'Materialliste_' + _pl.file.replace(/[^\w\-]+/g, '_') + '.csv';
  document.body.appendChild(a); a.click();
  setTimeout(function() { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { plParseOps: plParseOps, plMeasure: plMeasure, plGroup: plGroup, plSymbolKey: plSymbolKey, plMatchMemory: plMatchMemory, plCleanLabel: plCleanLabel,
    plSuggestNames: plSuggestNames, plTitleZone: plTitleZone, plWithoutZone: plWithoutZone, plMaterialList: plMaterialList, plCsv: plCsv, plPrettyName: plPrettyName, plFitZoom: plFitZoom, plNextOpen: plNextOpen, plNameOptions: plNameOptions, plMayUse: plMayUse, PL_OP: PL_OP };
}
