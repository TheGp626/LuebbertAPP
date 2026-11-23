/* ══ Raumplan am Auftrag (testversion): compare a read plan with the Auftragsbestätigung, show it on the job ══
   The plan reader (js/planlesen.js) names the symbols; saved plans live in job_floorplans + project-files/floorplans/.
   On the job (Wochenplan details, Heute card) a "Raumplan" button opens a viewer: tap a symbol → what it is, how many,
   and the product from the Produktdatenbank. Pure part first (tests/planjob.test.js), the DOM part below. */

var PJ_STOP = ['mit', 'und', 'der', 'die', 'das', 'den', 'fuer', 'inkl', 'ca', 'stk', 'stueck', 'cm', 'mm', 'x', 'je', 'von', 'zum', 'zur'];

// Article / symbol name → comparable tokens: lower case, umlauts spelled out, Ø → o, units and filler words out
function pjTokens(s) {
  return String(s || '').toLowerCase()
    .replace(/[øØ⌀]/g, ' ').replace(/×/g, ' x ') // "Ø 80", "Ø80" and "80" are the same size
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2') // "80cm", "180x80"
    .split(/[^a-z0-9]+/).filter(function(t) { return t && PJ_STOP.indexOf(t) === -1; });
}
function pjNorm(s) { return pjTokens(s).join(' '); }

// 0..1: same words = 1; all words of the shorter name inside the longer = 0.8 at least; else word overlap (Jaccard)
function pjSimilar(a, b) {
  var A = pjTokens(a), B = pjTokens(b);
  if (!A.length || !B.length) return 0;
  if (A.join(' ') === B.join(' ')) return 1;
  var inter = A.filter(function(t, i) { return B.indexOf(t) !== -1 && A.indexOf(t) === i; }).length;
  var union = A.concat(B).filter(function(t, i, all) { return all.indexOf(t) === i; }).length;
  var short = A.length <= B.length ? A : B, long = short === A ? B : A;
  var contained = short.every(function(t) { return long.indexOf(t) !== -1; });
  return Math.max(inter / union, contained ? 0.8 : 0);
}

// Articles of one Auftrag (order-parser job.materials) summed by name; billing lines (Rabatt …) stay out
function pjOrderItems(job) {
  var by = {}, order = [];
  ((job && job.materials) || []).forEach(function(g) {
    (g.items || []).forEach(function(it) {
      if (!it || !it.name || /rabatt|nachlass|gutschrift|skonto|transport|personal|anfahrt|pauschale/i.test(it.name)) return;
      var k = pjNorm(it.name);
      if (!k) return;
      if (!by[k]) { by[k] = { name: it.name, qty: 0 }; order.push(k); }
      by[k].qty += Number(it.qty) || 0;
    });
  });
  return order.map(function(k) { return by[k]; });
}

// Plan list [{ name, count }] against the Auftrag's articles [{ name, qty }] → one row per article or plan name.
// Exact names first, then the most similar pairs (≥ min). status: ok | mehr (more on the plan) | weniger | nurPlan | nurAuftrag
function pjCompare(planRows, orderItems, min) {
  min = min || 0.5;
  var plan = (planRows || []).map(function(r) { return { name: r.name, count: r.count, k: pjNorm(r.name), used: false }; });
  var ord = (orderItems || []).map(function(r) { return { name: r.name, qty: r.qty, k: pjNorm(r.name), used: false }; });
  var rows = [];
  var pair = function(o, p, how) {
    o.used = p.used = true;
    var d = p.count - o.qty;
    rows.push({ order: o.name, plan: p.name, orderQty: o.qty, planQty: p.count, diff: d, match: how, status: d === 0 ? 'ok' : d > 0 ? 'mehr' : 'weniger' });
  };
  ord.forEach(function(o) { var p = plan.find(function(x) { return !x.used && x.k === o.k; }); if (p) pair(o, p, 'exakt'); });
  var cands = [];
  ord.forEach(function(o, oi) { if (o.used) return; plan.forEach(function(p, pi) { if (!p.used) { var s = pjSimilar(o.name, p.name); if (s >= min) cands.push([s, oi, pi]); } }); });
  cands.sort(function(a, b) { return b[0] - a[0]; }).forEach(function(c) { var o = ord[c[1]], p = plan[c[2]]; if (!o.used && !p.used) pair(o, p, 'aehnlich'); });
  plan.forEach(function(p) { if (!p.used) rows.push({ order: null, plan: p.name, orderQty: 0, planQty: p.count, diff: p.count, match: null, status: 'nurPlan' }); });
  ord.forEach(function(o) { if (!o.used) rows.push({ order: o.name, plan: null, orderQty: o.qty, planQty: 0, diff: -o.qty, match: null, status: 'nurAuftrag' }); });
  var rank = { weniger: 0, mehr: 1, nurPlan: 2, nurAuftrag: 3, ok: 4 };
  return rows.sort(function(a, b) { return rank[a.status] - rank[b.status] || (a.order || a.plan).localeCompare(b.order || b.plan, 'de'); });
}

// Dates in the plan's text (title block "24.11.2026 - 25.11.2026") → { from, to } as ISO, or nulls
function pjTitleDates(texts) {
  var ds = [];
  (texts || []).forEach(function(t) {
    var re = /\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g, m;
    while ((m = re.exec(String(t)))) {
      var d = +m[1], mo = +m[2];
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) ds.push(m[3] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2));
    }
  });
  ds.sort();
  return { from: ds[0] || null, to: ds[ds.length - 1] || null };
}

function pjAddDays(iso, n) {
  var p = String(iso).split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n, 12));
  return d.toISOString().slice(0, 10);
}

var PJ_WORD_STOP = ['setup', 'plan', 'raumplan', 'kopia', 'kopie', 'luebbert', 'lubbert', 'estrel', 'berlin', 'congress', 'final', 'stand', 'version', 'aufbau', 'abbau'];
function pjWords(s) {
  return pjTokens(s).filter(function(t) { return t.length >= 4 && PJ_WORD_STOP.indexOf(t) === -1 && !/^\d+$/.test(t); });
}

// Does a saved plan belong to this Wochenplan entry? Through an order link (same Auftrag on that day and entry), or by
// date (from 3 days before the event to the day after) plus at least one word of room/title in venue, title or place.
// fp: { job_no, title, room, date_from, date_to }, shift: { date, keys:[], venue, title, location }, links: order_plan_links rows
function pjPlanFits(fp, shift, links) {
  if (!fp || !shift || !shift.date) return false;
  var keys = shift.keys || [];
  if (fp.job_no && (links || []).some(function(l) {
    return l.plan_date === shift.date && keys.indexOf(l.plan_key) !== -1 && l.job_no &&
      (l.job_no.indexOf(fp.job_no) === 0 || fp.job_no.indexOf(l.job_no) === 0);
  })) return true;
  if (!fp.date_from) return false;
  var to = fp.date_to || fp.date_from;
  if (shift.date < pjAddDays(fp.date_from, -3) || shift.date > pjAddDays(to, 1)) return false;
  var mine = pjWords([fp.room, fp.title].join(' ')), theirs = pjWords([shift.venue, shift.title, shift.location].join(' '));
  return mine.some(function(w) { return theirs.indexOf(w) !== -1; });
}

// Best product for a symbol name (≥ min similarity), or null
function pjMatchProduct(name, products, min) {
  min = min || 0.5;
  var best = null, bestS = 0;
  (products || []).forEach(function(p) { var s = pjSimilar(name, p.name); if (s > bestS) { bestS = s; best = p; } });
  return bestS >= min ? best : null;
}

// Tap on the plan (page coordinates) → { gi, bi } of the group and box hit; the smallest box wins (a chair on a table)
function pjHit(groups, x, y, pad) {
  pad = pad || 1.5;
  var hit = null, area = Infinity;
  (groups || []).forEach(function(g, gi) {
    (g.boxes || []).forEach(function(b, bi) {
      if (x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad) {
        var a = (b[2] - b[0]) * (b[3] - b[1]);
        if (a < area) { area = a; hit = { gi: gi, bi: bi }; }
      }
    });
  });
  return hit;
}

// The saved result of a read plan: only named, counted groups, boxes rounded to 0.1 pt
function pjResultOf(groups, names, colors) {
  return {
    groups: (groups || []).map(function(g, i) {
      var a = names[i] || {};
      if (a.ignore || !String(a.name || '').trim()) return null;
      return { sig: g.sig, name: String(a.name).trim(), count: g.count, color: colors ? colors(i) : null,
        boxes: g.members.map(function(m) { return m.bbox.map(function(v) { return Math.round(v * 10) / 10; }); }) };
    }).filter(Boolean)
  };
}

/* ── DOM part (browser only) ── */

var _pj = { index: null, indexAt: 0, links: {}, loading: null, products: null, viewer: null };

function pjCanSave(role) { return role === 'PL' || role === 'Admin'; }

// All saved plans (small columns), cached for a minute; order links per day on demand
async function pjLoadIndex(force) {
  if (typeof supabaseClient === 'undefined' || typeof currentUser === 'undefined' || !currentUser || userRole === 'Gast') return [];
  if (!force && _pj.index && Date.now() - _pj.indexAt < 60000) return _pj.index;
  if (_pj.loading) return _pj.loading;
  _pj.loading = (async function() {
    try {
      var r = await supabaseClient.from('job_floorplans').select('id, job_no, title, room, date_from, date_to, updated_at').order('updated_at', { ascending: false });
      _pj.index = r.error ? [] : (r.data || []); // table missing on an older database → no plans, no error
      _pj.indexAt = Date.now();
    } catch (e) { _pj.index = _pj.index || []; }
    _pj.loading = null;
    return _pj.index;
  })();
  return _pj.loading;
}

async function pjLinksFor(dates) {
  var need = dates.filter(function(d) { return d && !_pj.links[d]; });
  if (need.length && typeof supabaseClient !== 'undefined') {
    try {
      var r = await supabaseClient.from('order_plan_links').select('job_no, phase, plan_date, plan_key').in('plan_date', need);
      need.forEach(function(d) { _pj.links[d] = []; });
      if (!r.error) (r.data || []).forEach(function(l) { (_pj.links[l.plan_date] = _pj.links[l.plan_date] || []).push(l); });
    } catch (e) { /* offline: only date + room matching */ }
  }
  var out = [];
  dates.forEach(function(d) { out = out.concat(_pj.links[d] || []); });
  return out;
}

// Wochenplan details / Heute card leave a placeholder (wpDetails); this fills it with a "Raumplan" button when a plan fits
function pjSlotHtml(s) {
  if (!s || !s.date) return '';
  var keys = (s.keys && s.keys.length ? s.keys : [s.key]).filter(Boolean).join('|');
  return '<div class="pj-slot" data-date="' + escapeHtml(s.date) + '" data-keys="' + escapeHtml(keys) + '" data-words="' +
    escapeHtml([s.venue, s.title, s.location].filter(Boolean).join(' ')) + '"></div>';
}

var _pjFilling = false;
async function pjFillSlots() {
  if (_pjFilling) return;
  var slots = Array.prototype.slice.call(document.querySelectorAll('.pj-slot:not([data-done])'));
  if (!slots.length) return;
  _pjFilling = true;
  try {
    slots.forEach(function(el) { el.setAttribute('data-done', '1'); });
    var idx = await pjLoadIndex();
    if (!idx.length) return;
    var links = await pjLinksFor(slots.map(function(el) { return el.dataset.date; }).filter(function(d, i, a) { return a.indexOf(d) === i; }));
    slots.forEach(function(el) {
      var shift = { date: el.dataset.date, keys: (el.dataset.keys || '').split('|').filter(Boolean), venue: el.dataset.words, title: '', location: '' };
      var fits = idx.filter(function(fp) { return pjPlanFits(fp, shift, links); });
      el.innerHTML = fits.map(function(fp) {
        return '<button type="button" class="w-btn pj-open" onclick="event.stopPropagation(); pjOpenViewer(\'' + fp.id + '\')">' +
          (typeof uiIcon === 'function' ? uiIcon('layout') : '') + '<span>Raumplan' + (fits.length > 1 ? ' · ' + escapeHtml(fp.room || fp.title) : '') + '</span></button>';
      }).join('');
    });
  } finally { _pjFilling = false; }
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  var _pjObsTimer = null;
  new MutationObserver(function() {
    if (_pjObsTimer) return;
    _pjObsTimer = setTimeout(function() { _pjObsTimer = null; if (document.querySelector('.pj-slot:not([data-done])')) pjFillSlots(); }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

async function pjLoadProducts() {
  if (_pj.products) return _pj.products;
  if (typeof alleProdukte !== 'undefined' && alleProdukte.length) return (_pj.products = alleProdukte);
  try {
    var r = await supabaseClient.from('products').select('id, name, description, pdf_url, content_text, created_at, product_images(id, image_url, media_type, sort_order)').order('name');
    if (r.error) return [];
    var list = (r.data || []).map(function(p) { return typeof produktSafeRow === 'function' ? produktSafeRow(p) : p; });
    if (typeof alleProdukte !== 'undefined' && !alleProdukte.length) alleProdukte = list; // so openProduktViewer finds them
    return (_pj.products = list);
  } catch (e) { return []; }
}

// ── Viewer ──

async function pjOpenViewer(id) {
  if (typeof needLib === 'function' && !(await needLib('pdfjs'))) return;
  var m = document.getElementById('pj-viewer');
  if (!m) { m = document.createElement('div'); m.id = 'pj-viewer'; m.className = 'pj-viewer'; document.body.appendChild(m); }
  m.innerHTML = '<div class="pj-head"><div class="pj-head-t"><b>Raumplan</b><small>lädt …</small></div><button type="button" class="pl-hide" onclick="pjCloseViewer()" aria-label="Schließen">×</button></div>' +
    '<div class="pj-stage" id="pj-stage"><canvas id="pj-canvas"></canvas><svg id="pj-svg"></svg></div>' +
    '<div class="pj-zoom"><button type="button" class="w-btn" onclick="pjZoom(-1)" aria-label="Kleiner">−</button><button type="button" class="w-btn" onclick="pjZoom(1)" aria-label="Größer">+</button></div>' +
    '<div class="pj-foot" id="pj-foot"></div>';
  m.classList.add('open');
  document.body.classList.add('pj-noscroll');
  try {
    var r = await supabaseClient.from('job_floorplans').select('*').eq('id', id).maybeSingle();
    if (r.error || !r.data) throw r.error || new Error('not found');
    var fp = r.data;
    var url = (await supabaseClient.storage.from('project-files').createSignedUrl(fp.file_path, 3600)).data;
    if (!url || !url.signedUrl) throw new Error('no url');
    var doc = await pdfjsLib.getDocument(url.signedUrl).promise, page = await doc.getPage(fp.page || 1);
    var stage = document.getElementById('pj-stage'), base = page.getViewport({ scale: 1 });
    var fit = Math.min(stage.clientWidth / base.width, stage.clientHeight / base.height);
    var vp = page.getViewport({ scale: fit }), px = Math.min(fit * Math.min(2, window.devicePixelRatio || 1) * 3, 4200 / base.width);
    var canvas = document.getElementById('pj-canvas'), vpx = page.getViewport({ scale: px });
    canvas.width = vpx.width; canvas.height = vpx.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vpx }).promise;
    _pj.viewer = { fp: fp, vp: vp, zoom: 1, sel: null, groups: (fp.result && fp.result.groups) || [] };
    m.querySelector('.pj-head-t').innerHTML = '<b>' + escapeHtml(fp.title) + '</b><small>' + escapeHtml([fp.room, pjDateRange(fp), fp.job_no].filter(Boolean).join(' · ')) + '</small>';
    pjSetZoom(1);
    document.getElementById('pj-svg').addEventListener('click', pjOnTap);
    pjDrawFoot();
    pjLoadProducts(); // in the background, ready when a symbol is tapped
  } catch (e) {
    console.warn('Raumplan öffnen:', e);
    document.getElementById('pj-foot').innerHTML = '<div class="w-empty"><b>Der Plan konnte nicht geladen werden.</b><p>Prüf die Verbindung und versuch es nochmal.</p></div>';
  }
}

function pjDateRange(fp) {
  var de = function(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' : ''; };
  return fp.date_from ? de(fp.date_from) + (fp.date_to && fp.date_to !== fp.date_from ? '–' + de(fp.date_to) : '') : '';
}

function pjCloseViewer() {
  var m = document.getElementById('pj-viewer');
  if (m) { m.classList.remove('open'); m.innerHTML = ''; }
  document.body.classList.remove('pj-noscroll');
  _pj.viewer = null;
}

function pjZoom(step) {
  var v = _pj.viewer; if (!v) return;
  var stage = document.getElementById('pj-stage');
  var cx = (stage.scrollLeft + stage.clientWidth / 2) / v.zoom, cy = (stage.scrollTop + stage.clientHeight / 2) / v.zoom;
  var z = Math.max(1, Math.min(6, step > 0 ? v.zoom * 1.6 : v.zoom / 1.6));
  if (z < 1.05) z = 1;
  pjSetZoom(z, cx * z - stage.clientWidth / 2, cy * z - stage.clientHeight / 2);
}

function pjSetZoom(z, left, top) {
  var v = _pj.viewer; if (!v) return;
  v.zoom = z;
  var w = v.vp.width * z, h = v.vp.height * z, canvas = document.getElementById('pj-canvas'), svg = document.getElementById('pj-svg'), stage = document.getElementById('pj-stage');
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', '0 0 ' + v.vp.width + ' ' + v.vp.height);
  svg.style.width = w + 'px'; svg.style.height = h + 'px';
  stage.scrollLeft = Math.max(0, left || 0); stage.scrollTop = Math.max(0, top || 0);
  pjDrawBoxes();
}

function pjDrawBoxes() {
  var v = _pj.viewer, svg = document.getElementById('pj-svg');
  if (!v || !svg) return;
  var html = '';
  v.groups.forEach(function(g, gi) {
    var on = v.sel === null || v.sel.gi === gi;
    (g.boxes || []).forEach(function(b, bi) {
      var p = v.vp.convertToViewportRectangle(b), x = Math.min(p[0], p[2]), y = Math.min(p[1], p[3]), w = Math.abs(p[2] - p[0]), h = Math.abs(p[3] - p[1]);
      var picked = v.sel && v.sel.gi === gi && v.sel.bi === bi;
      html += '<rect x="' + (x - 1).toFixed(1) + '" y="' + (y - 1).toFixed(1) + '" width="' + (w + 2).toFixed(1) + '" height="' + (h + 2).toFixed(1) + '" stroke="' + (g.color || '#ff5a1f') + '"' +
        ' class="' + (picked ? 'pj-picked' : on ? '' : 'pj-dim') + '" vector-effect="non-scaling-stroke"/>';
    });
  });
  svg.innerHTML = html;
}

// Tap → page coordinates → the symbol under the finger
function pjOnTap(e) {
  var v = _pj.viewer; if (!v) return;
  var svg = document.getElementById('pj-svg'), r = svg.getBoundingClientRect();
  var pt = v.vp.convertToPdfPoint((e.clientX - r.left) / v.zoom, (e.clientY - r.top) / v.zoom);
  // about 10 screen pixels of tolerance around a symbol, whatever the zoom
  var hit = pjHit(v.groups, pt[0], pt[1], 10 / ((v.vp.scale || 1) * v.zoom));
  v.sel = hit;
  pjDrawBoxes();
  pjDrawFoot();
}

function pjPickGroup(gi) {
  var v = _pj.viewer; if (!v) return;
  v.sel = v.sel && v.sel.gi === gi && v.sel.bi === -1 ? null : { gi: gi, bi: -1 };
  pjDrawBoxes(); pjDrawFoot();
}

// Bottom: legend of everything on the plan, or the card of the tapped symbol with its product
async function pjDrawFoot() {
  var v = _pj.viewer, foot = document.getElementById('pj-foot');
  if (!v || !foot) return;
  if (!v.groups.length) { foot.innerHTML = '<p class="pl-hint">Auf diesem Plan ist noch nichts benannt.</p>'; return; }
  var legend = '<div class="pj-legend">' + v.groups.map(function(g, gi) {
    return '<button type="button" class="pj-chip' + (v.sel && v.sel.gi === gi ? ' on' : '') + '" onclick="pjPickGroup(' + gi + ')"><i style="background:' + (g.color || '#ff5a1f') + '"></i>' +
      escapeHtml(g.name) + ' <b class="w-num">' + g.count + '</b></button>';
  }).join('') + '</div>';
  if (!v.sel) { foot.innerHTML = '<p class="pj-tip">Tippe auf ein Teil im Plan, um zu sehen, was es ist.</p>' + legend; return; }
  var g = v.groups[v.sel.gi];
  foot.innerHTML = '<div class="pj-card"><div class="pj-card-h"><i style="background:' + (g.color || '#ff5a1f') + '"></i><div><b>' + escapeHtml(g.name) + '</b><small class="w-num">' + g.count + '× auf diesem Plan</small></div>' +
    '<button type="button" class="pl-hide" onclick="pjPickGroup(' + v.sel.gi + ')" aria-label="Zurück">×</button></div><div id="pj-prod" class="pj-prod"><p class="pl-hint">Suche in der Produktdatenbank …</p></div></div>' + legend;
  var products = await pjLoadProducts();
  var box = document.getElementById('pj-prod');
  if (!box || !_pj.viewer || _pj.viewer.groups[_pj.viewer.sel && _pj.viewer.sel.gi] !== g) return;
  var p = pjMatchProduct(g.name, products);
  if (!p) { box.innerHTML = '<p class="pl-hint">Nicht in der Produktdatenbank gefunden.</p>'; return; }
  var img = (p.product_images || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order; }).find(function(i) { return i.media_type !== 'video'; });
  var text = String(p.description || p.content_text || '').trim();
  box.innerHTML = (img ? '<img src="' + escapeHtml(img.image_url) + '" alt="" loading="lazy">' : '<div class="pj-noimg">' + (typeof uiIcon === 'function' ? uiIcon('box') : '') + '</div>') +
    '<div class="pj-prod-t"><b>' + escapeHtml(p.name) + '</b>' + (text ? '<small>' + escapeHtml(text.length > 140 ? text.slice(0, 140) + ' …' : text) + '</small>' : '') +
    ((p.product_images || []).length || p.pdf_url || p.content_text ? '<button type="button" class="w-btn" onclick="openProduktViewer(\'' + p.id + '\')">Produkt ansehen</button>' : '') + '</div>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pjTokens: pjTokens, pjNorm: pjNorm, pjSimilar: pjSimilar, pjOrderItems: pjOrderItems, pjCompare: pjCompare, pjTitleDates: pjTitleDates,
    pjPlanFits: pjPlanFits, pjMatchProduct: pjMatchProduct, pjHit: pjHit, pjResultOf: pjResultOf, pjCanSave: pjCanSave, pjAddDays: pjAddDays };
}
