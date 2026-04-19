/**
 * Stundenzettel Module Logic
 */

// ── DATA STORES ──
var shiftSigCanvases = {};
var shiftSigData = {};
var shiftValues = {};
var shiftCounts = {};
var activeDayIdx = null;
var historyChart = null;

// ── SHIFT HELPERS ──
function saveCurrentDayToCache() {
  var i = activeDayIdx;
  if (i === null) return;
  shiftValues[i] = shiftValues[i] || [];
  for (var s = 0; s < (shiftCounts[i] || 1); s++) {
    var key = i + '-' + s;
    var deptEl = document.getElementById('dept-' + key);
    shiftValues[i][s] = {
      von: (document.getElementById('von-' + key) || {}).value || '',
      bis: (document.getElementById('bis-' + key) || {}).value || '',
      pause: (document.getElementById('pause-' + key) || { value: '0' }).value || '0',
      ort: (document.getElementById('ort-' + key) || {}).value || '',
      al: (document.getElementById('al-' + key) || {}).value || '',
      dept: deptEl ? deptEl.value : (shiftValues[i][s] && shiftValues[i][s].dept) || selectedAbt
    };
  }
}

function getShiftData(dayIdx, shiftIdx) {
  var key = dayIdx + '-' + shiftIdx;
  if (activeDayIdx === dayIdx) {
    var vonEl = document.getElementById('von-' + key);
    if (vonEl) {
      var deptEl = document.getElementById('dept-' + key);
      return {
        von: vonEl.value || '',
        bis: (document.getElementById('bis-' + key) || {}).value || '',
        pause: (document.getElementById('pause-' + key) || { value: '0' }).value || '0',
        ort: (document.getElementById('ort-' + key) || {}).value || '',
        al: (document.getElementById('al-' + key) || {}).value || '',
        dept: deptEl ? deptEl.value : selectedAbt,
        sig: shiftSigData[key] || null
      };
    }
  }
  var sv = (shiftValues[dayIdx] || [])[shiftIdx] || {};
  return { von: sv.von || '', bis: sv.bis || '', pause: sv.pause || '0', ort: sv.ort || '', al: sv.al || '', dept: sv.dept || selectedAbt, sig: shiftSigData[key] || null };
}

function buildDays() {
  shiftSigCanvases = {};
  shiftSigData = {};
  shiftValues = {};
  shiftCounts = {};
  for (var i = 0; i < DAYS.length; i++) {
    shiftCounts[i] = 1;
    shiftValues[i] = [{ von: '', bis: '', ort: '', al: '', pause: '0', dept: selectedAbt }];
  }
  activeDayIdx = null;
  renderWeekStrip();
  renderDayEditorArea();
  calcTotal();
  updateTopBarSub();

  if (typeof currentUser !== 'undefined' && currentUser) {
    fetchSupabaseShifts();
  }
}

async function fetchSupabaseShifts() {
  if (typeof supabaseClient === 'undefined' || !currentUser) return;
  
  try {
    var { data, error } = await supabaseClient
      .from('shifts')
      .select(`
        id, start_time, end_time, pause_mins, position_role, status, shift_date, protocol_id,
        protocols ( date, al_name_fallback, pl_name_fallback, signature_text, projects ( name, location ) )
      `)
      .eq('user_id', currentUser.id)
      .in('status', ['approved', 'pending']);

    if (error) throw error;
    if (!data || data.length === 0) return;

    // Deduplicate: same protocol + same start + same end = one shift
    var seen = {};
    data = data.filter(function(sh) {
      var key = (sh.protocol_id || 'manual') + '|' + sh.start_time + '|' + sh.end_time + '|' + (sh.shift_date || (sh.protocols && sh.protocols.date) || '');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    // Group shifts by week string (e.g. "2026-W12")
    var userWeeks = {};

    data.forEach(function(sh) {
      // Resolve the actual date: protocol date takes priority, fallback to shift_date
      var dStr = (sh.protocols && sh.protocols.date) ? sh.protocols.date : sh.shift_date;
      if (!dStr) return;
      var dObj = new Date(dStr);
      var wStr = getWeekString(dObj); // Need helper to convert Date to "YYYY-Www" format

      if (!userWeeks[wStr]) {
        userWeeks[wStr] = {
          name: localStorage.getItem('stundenzettel_name') || 'Mitarbeiter',
          abt: sh.position_role || 'MA',
          weekStart: wStr,
          weekLabel: 'Woche ' + wStr.split('-W')[1],
          days: [],
          depts: ['Alle'],
          saved: new Date().toISOString(),
          isSupabaseSync: true
        };
        // Initialize 7 days
        var mon = getMondayFromWeekVal(wStr);
        for (var i=0; i<7; i++) {
          var iterD = new Date(mon.getTime() + i*86400000);
          userWeeks[wStr].days.push({
            day: DAYS[i],
            date: fmtDateFull(iterD),
            isoDate: iterD.toISOString().split('T')[0],
            shifts: []
          });
        }
      }

      var dayMatch = userWeeks[wStr].days.find(function(day) { return day.isoDate === dStr; });
      if (dayMatch) {
        var prot = sh.protocols || {};
        dayMatch.shifts.push({
           von: (sh.start_time || '').substring(0,5),
           bis: (sh.end_time || '').substring(0,5),
           pause: sh.pause_mins ? sh.pause_mins.toString() : '0',
           ort: (prot.projects && prot.projects.name) ? prot.projects.name : (sh.protocol_id ? '' : 'Manuell erfasst'),
           al: prot.al_name_fallback || prot.pl_name_fallback || '',
           dept: sh.position_role || 'MA',
           sig: prot.signature_text || null,
           isSynced: true
         });
      }
    });

    // Calculate totals for each week and inject into history
    var allLocal = JSON.parse(localStorage.getItem('stundenzettel') || '{}');
    var changed = false;

    Object.keys(userWeeks).forEach(function(wKey) {
      var weekObj = userWeeks[wKey];
      var wTotal = 0;
      weekObj.days.forEach(function(dd) {
        dd.shifts.forEach(function(sh) {
          var v = timeToMins(sh.von), b = timeToMins(sh.bis), p = parseInt(sh.pause)||0;
          var effB = (b<v) ? b+1440 : b;
          if (v!==null && b!==null && effB>v) {
            wTotal += Math.max(180, effB - v - p) / 60;
          }
        });
      });
      weekObj.total = wTotal % 1 === 0 ? wTotal.toFixed(0) : wTotal.toFixed(2);
      
      // Override local history for this week with DB truth
      allLocal[wKey] = weekObj;
      changed = true;
    });

    if (changed) {
      localStorage.setItem('stundenzettel', JSON.stringify(allLocal));
      if (typeof renderHistory === 'function' && document.getElementById('history-list')) renderHistory();
    }
  } catch(e) { console.error("Error fetching shifts:", e); }
}

function getWeekString(d) {
  var date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  var week1 = new Date(date.getFullYear(), 0, 4);
  var weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  var yr = date.getFullYear();
  return yr + '-W' + (weekNum < 10 ? '0'+weekNum : weekNum);
}

// ── UI RENDERING ──
function renderWeekStrip() {
  var val = document.getElementById('inp-week').value || currentWeekVal();
  var mon = getMondayFromWeekVal(val);
  var sun = new Date(mon.getTime() + 6 * 86400000);
  var parts = val.split('-W');
  var lbl = document.getElementById('week-strip-label');
  if (lbl) lbl.textContent = 'KW ' + parseInt(parts[1]) + '  ·  ' + fmtDate(mon) + ' – ' + fmtDateFull(sun);

  var strip = document.getElementById('week-strip');
  if (!strip) return;
  strip.innerHTML = '';
  for (var i = 0; i < DAYS.length; i++) {
    (function (i) {
      var d = new Date(mon.getTime() + i * 86400000);
      var wrap = document.createElement('div');
      wrap.className = 'day-bubble-wrap';
      wrap.onclick = (function (idx) { return function () { selectDay(idx); }; })(i);
      wrap.innerHTML =
        '<span class="day-bubble-name">' + DAY_SHORT[i] + '</span>' +
        '<div class="day-bubble" id="bubble-' + i + '">—</div>' +
        '<span class="day-bubble-date">' + fmtDate(d) + '</span>';
      strip.appendChild(wrap);
    })(i);
  }
}

function selectDay(i) {
  saveCurrentDayToCache();
  if (activeDayIdx !== null && activeDayIdx !== i) {
    for (var s = 0; s < (shiftCounts[activeDayIdx] || 1); s++) {
      delete shiftSigCanvases[activeDayIdx + '-' + s];
    }
  }
  activeDayIdx = i;
  for (var j = 0; j < DAYS.length; j++) {
    var b = document.getElementById('bubble-' + j);
    if (b) b.classList.toggle('active', j === i);
  }
  renderDayEditorArea();
}

function updateBubble(dayIdx) {
  var bubble = document.getElementById('bubble-' + dayIdx);
  if (!bubble) return;
  var totalMins = 0, hasInput = false;
  for (var s = 0; s < (shiftCounts[dayIdx] || 1); s++) {
    var data = getShiftData(dayIdx, s);
    if (data.von || data.bis) hasInput = true;
    var von = timeToMins(data.von), bis = timeToMins(data.bis);
    var pause = parseInt(data.pause) || 0;
    var effB = (bis < von) ? bis + 1440 : bis;
    if (von !== null && bis !== null && effB > von) totalMins += Math.max(180, effB - von - pause);
  }
  var isActive = (activeDayIdx === dayIdx);
  bubble.className = 'day-bubble' + (isActive ? ' active' : '');
  if (totalMins > 0) {
    var h = totalMins / 60;
    bubble.textContent = (h % 1 === 0 ? h.toFixed(0) : h.toFixed(1)) + 'h';
    bubble.classList.add('done');
  } else if (hasInput) {
    bubble.textContent = '?';
    bubble.classList.add('partial');
  } else {
    bubble.textContent = '—';
  }
}

function renderDayEditorArea() {
  var area = document.getElementById('day-editor-area');
  if (!area) return;
  if (activeDayIdx === null) {
    area.innerHTML = '<div class="day-empty-state"><div class="day-empty-icon">☝️</div><div>Tag im Wochenstreifen antippen,<br/>um Stunden einzutragen.</div></div>';
    return;
  }
  var i = activeDayIdx;
  var val = document.getElementById('inp-week').value || currentWeekVal();
  var mon = getMondayFromWeekVal(val);
  var d = new Date(mon.getTime() + i * 86400000);
  area.innerHTML =
    '<div class="day-editor-head"><div class="day-editor-title">' + DAYS[i] + '</div><div class="day-editor-date">' + fmtDateFull(d) + '</div></div>' +
    '<div id="shifts-' + i + '"></div>' +
    '<button class="add-shift-btn" onclick="addShift(' + i + ')">＋ Schicht hinzufügen</button>';

  for (var s = 0; s < (shiftCounts[i] || 1); s++) renderShift(i, s);

  setTimeout(function () {
    var sv = shiftValues[i] || [];
    var needsCalc = false;
    sv.forEach(function (sh, s) {
      var key = i + '-' + s;
      var vEl = document.getElementById('von-' + key); if (vEl && sh.von) { vEl.value = sh.von; needsCalc = true; }
      var bEl = document.getElementById('bis-' + key); if (bEl && sh.bis) { bEl.value = sh.bis; needsCalc = true; }
      var oEl = document.getElementById('ort-' + key); if (oEl && sh.ort) oEl.value = sh.ort;
      var aEl = document.getElementById('al-' + key); if (aEl && sh.al) aEl.value = sh.al;
      var dEl = document.getElementById('dept-' + key); if (dEl && sh.dept) dEl.value = sh.dept;
    });
    if (needsCalc) calcDay(i);
    for (var s2 = 0; s2 < (shiftCounts[i] || 1); s2++) {
      initShiftSig(i, s2);
      redrawShiftSig(i + '-' + s2);
    }
  }, 0);
}

function renderShift(dayIdx, shiftIdx) {
  var container = document.getElementById('shifts-' + dayIdx);
  if (!container) return;
  var block = document.createElement('div');
  block.className = 'shift-block';
  block.id = 'shift-' + dayIdx + '-' + shiftIdx;
  var removeBtn = shiftIdx > 0 ? '<button class="shift-remove" onclick="removeShift(' + dayIdx + ',' + shiftIdx + ')">×</button>' : '';
  // Build dept options
  var deptOpts = (typeof departments !== 'undefined' ? departments : []).map(function(d) {
    return '<option value="' + d.replace(/"/g,'&quot;') + '">' + d + '</option>';
  }).join('');
  block.innerHTML =
    '<div class="shift-label">Schicht ' + (shiftIdx + 1) + removeBtn + '</div>' +
    '<div class="field"><label>Abteilung (diese Schicht)</label>' +
    '<select id="dept-' + dayIdx + '-' + shiftIdx + '" class="meta-input" style="margin-bottom:0" onchange="calcTotal()">' + deptOpts + '</select></div>' +
    '<div class="time-pair">' +
    ' <div class="field"><label>Von</label><input type="time" id="von-' + dayIdx + '-' + shiftIdx + '" oninput="calcDay(' + dayIdx + ')"/></div>' +
    ' <div class="field"><label>Bis</label><input type="time" id="bis-' + dayIdx + '-' + shiftIdx + '" oninput="calcDay(' + dayIdx + ')"/></div>' +
    '</div>' +
    '<div class="field"><label>Pause</label><div class="pause-badge" id="pbadge-' + dayIdx + '-' + shiftIdx + '">wird automatisch berechnet</div><input type="hidden" id="pause-' + dayIdx + '-' + shiftIdx + '" value="0"/></div>' +
    '<div class="field"><label>Ort</label><input type="text" id="ort-' + dayIdx + '-' + shiftIdx + '" placeholder="Einsatzort"/></div>' +
    '<div class="field"><label>Name AL</label><input type="text" id="al-' + dayIdx + '-' + shiftIdx + '" placeholder="Vorname Nachname"/></div>' +
    '<div class="field"><label>Unterschrift AL</label>' +
    ' <button class="sig-full-btn" type="button" onclick="openSignaturePad(' + dayIdx + ',' + shiftIdx + ')">🖊️ Vollbild-Unterschrift öffnen</button>' +
    ' <div class="sig-wrap" onclick="openSignaturePad(' + dayIdx + ',' + shiftIdx + ')"><canvas id="sigc-' + dayIdx + '-' + shiftIdx + '"></canvas><div class="sig-placeholder" id="sigph-' + dayIdx + '-' + shiftIdx + '">Tippen für Unterschrift</div><button class="sig-clear" type="button" onclick="event.stopPropagation();clearShiftSig(' + dayIdx + ',' + shiftIdx + ')">löschen</button></div>' +
    '</div>';
  container.appendChild(block);
  setTimeout(function () { initShiftSig(dayIdx, shiftIdx); }, 0);
}

function addShift(dayIdx) {
  var idx = shiftCounts[dayIdx];
  shiftCounts[dayIdx]++;
  if (!shiftValues[dayIdx]) shiftValues[dayIdx] = [];
  shiftValues[dayIdx].push({ von: '', bis: '', ort: '', al: '', pause: '0', dept: selectedAbt });
  renderShift(dayIdx, idx);
  calcDay(dayIdx);
}

function removeShift(dayIdx, shiftIdx) {
  saveCurrentDayToCache();
  if (shiftValues[dayIdx]) shiftValues[dayIdx].splice(shiftIdx, 1);
  for (var s = shiftIdx; s < shiftCounts[dayIdx] - 1; s++) {
    var nk = dayIdx + '-' + s, ok = dayIdx + '-' + (s + 1);
    if (shiftSigData[ok]) shiftSigData[nk] = shiftSigData[ok]; else delete shiftSigData[nk];
  }
  delete shiftSigData[dayIdx + '-' + (shiftCounts[dayIdx] - 1)];
  shiftCounts[dayIdx] = Math.max(1, shiftCounts[dayIdx] - 1);
  if (!shiftValues[dayIdx] || shiftValues[dayIdx].length === 0) shiftValues[dayIdx] = [{ von: '', bis: '', ort: '', al: '', pause: '0', dept: selectedAbt }];
  shiftSigCanvases = {};
  renderDayEditorArea();
}

// ── CALC ──
function calcDay(dayIdx) {
  var totalMins = 0;
  for (var s = 0; s < shiftCounts[dayIdx]; s++) {
    var vonEl = document.getElementById('von-' + dayIdx + '-' + s), bisEl = document.getElementById('bis-' + dayIdx + '-' + s);
    var badge = document.getElementById('pbadge-' + dayIdx + '-' + s), pauseEl = document.getElementById('pause-' + dayIdx + '-' + s);
    if (!vonEl || !bisEl) continue;
    var von = timeToMins(vonEl.value), bis = timeToMins(bisEl.value);
    var effB = (bis < von) ? bis + 1440 : bis;
    if (von !== null && bis !== null && effB > von) {
      var raw = effB - von, pause = autoPause(raw), net = Math.max(180, raw - pause);
      if (pauseEl) pauseEl.value = pause;
      if (badge) { badge.textContent = pause > 0 ? pause + ' min (automatisch)' : 'keine Pause'; badge.className = 'pause-badge' + (pause > 0 ? ' auto' : ''); }
      totalMins += net;
    } else {
      if (pauseEl) pauseEl.value = 0;
      if (badge) { badge.textContent = 'wird automatisch berechnet'; badge.className = 'pause-badge'; }
    }
  }
  updateBubble(dayIdx);
  calcTotal();
}

function calcTotal() {
  var total = 0;
  var byDept = {};
  for (var i = 0; i < DAYS.length; i++) {
    for (var s = 0; s < (shiftCounts[i] || 1); s++) {
      var data = getShiftData(i, s);
      var von = timeToMins(data.von), bis = timeToMins(data.bis), pause = parseInt(data.pause) || 0;
      var effB = (bis < von) ? bis + 1440 : bis;
      if (von !== null && bis !== null && effB > von) {
        var hrs = Math.max(180, effB - von - pause) / 60;
        total += hrs;
        var d = data.dept || selectedAbt;
        byDept[d] = (byDept[d] || 0) + hrs;
      }
    }
  }
  var t = document.getElementById('total-hours');
  if (t) t.textContent = total % 1 === 0 ? total.toFixed(0) : total.toFixed(2);
  var e = document.getElementById('total-earnings');
  if (e) {
    var depts = Object.keys(byDept);
    if (depts.length === 0) { e.style.display = 'none'; return; }
    if (depts.length === 1) {
      // Single dept: show simple earnings
      var earn = formatEarnings(total, depts[0]);
      if (earn) { e.innerHTML = earn; e.style.display = 'block'; } else e.style.display = 'none';
    } else {
      // Multiple depts: show per-dept breakdown
      var parts = depts.map(function(d) {
        var earn = formatEarnings(byDept[d], d);
        if (!earn) return null;
        var shortName = d.split(' ')[0]; // e.g. "AL" or "MA"
        return '<span style="font-size:11px;opacity:0.85">' + shortName + ':</span> ' + earn;
      }).filter(Boolean);
      if (parts.length) {
        e.innerHTML = parts.join('<span style="margin:0 6px;opacity:0.4">|</span>');
        e.style.display = 'block';
      } else {
        e.style.display = 'none';
      }
    }
  }
}

// ── SIGNATURE ──
function openSignaturePad(dayIdx, shiftIdx) {
  var key = dayIdx + '-' + shiftIdx;
  document.getElementById('sig-modal').classList.add('open');
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function(){});
  if (screen.orientation && screen.orientation.lock) try { screen.orientation.lock("landscape"); } catch(_){}
  sigModalState.key = key;
  var pad = initSigModalCanvas();
  pad.ctx.clearRect(0, 0, pad.w, pad.h);
  sigModalState.hasInk = false;
  if (shiftSigData[key]) {
      var img = new Image();
      img.onload = function() { pad.ctx.drawImage(img, 0, 0, pad.w, pad.h); sigModalState.hasInk = true; };
      img.src = shiftSigData[key];
  }
}

function initShiftSig(dayIdx, shiftIdx) {
  var key = dayIdx + '-' + shiftIdx;
  var canvas = document.getElementById('sigc-' + key);
  if (!canvas || (shiftSigCanvases[key] && shiftSigCanvases[key]._ready)) return;
  var dpr = window.devicePixelRatio || 1, pw = canvas.parentElement.offsetWidth || 300, ph = 100;
  canvas.width = pw * dpr; canvas.height = ph * dpr;
  canvas.style.width = pw + 'px'; canvas.style.height = ph + 'px';
  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr); ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  shiftSigCanvases[key] = { canvas: canvas, ctx: ctx, w: pw, h: ph, _ready: true };
  redrawShiftSig(key);
}

function redrawShiftSig(key) {
  var sc = shiftSigCanvases[key]; if (!sc) return;
  sc.ctx.clearRect(0, 0, sc.w, sc.h);
  if (shiftSigData[key]) {
    var img = new Image(); img.onload = function () { sc.ctx.drawImage(img, 0, 0, sc.w, sc.h); };
    img.src = shiftSigData[key];
  }
  var ph = document.getElementById('sigph-' + key); if (ph) ph.style.display = shiftSigData[key] ? 'none' : '';
}

function redrawSigModalFromState() {
  var key = sigModalState.key; if (!key) return;
  var pad = initSigModalCanvas();
  var data = (key === 'prot') ? (typeof protState !== 'undefined' ? protState.signature : null) : shiftSigData[key];
  if (data) {
    var img = new Image(); img.onload = function () { pad.ctx.drawImage(img, 0, 0, pad.w, pad.h); };
    img.src = data;
  }
}
function clearShiftSig(d, s) { var key = d + '-' + s; shiftSigData[key] = null; redrawShiftSig(key); }

// ── HISTORY ──
function renderHistory() {
  fetchSupabaseShifts(); // Trigger background sync when entering history
  
  var list = document.getElementById('history-list');
  var all = JSON.parse(localStorage.getItem('stundenzettel') || '{}');
  var keys = Object.keys(all).sort().reverse();
  if (!keys.length) { list.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><div>Noch keine Wochen gespeichert</div></div>'; return; }
  var months = {};
  keys.forEach(function (k) {
    var w = all[k];
    var m = getMonthKeyFromWeek(w.weekStart, billingCutoff);
    if (!months[m.key]) months[m.key] = { label: m.label, weeks: [], totalHours: 0 };
    months[m.key].weeks.push(w);
    months[m.key].totalHours += parseFloat((w.total || '0').replace(',', '.'));
  });
  var html = '';
  Object.keys(months).sort().reverse().forEach(function (mKey) {
    var m = months[mKey];
    var hrs = m.totalHours % 1 === 0 ? m.totalHours.toFixed(0) : m.totalHours.toFixed(2);
    html += '<div class="month-group"><div class="month-header"><div><div class="month-title">' + m.label + '</div><div class="month-stats">' + hrs + ' h gesamt</div></div><button class="month-export-btn" onclick="exportMonthlyPDF(\'' + mKey + '\')">⤵ Monat exportieren</button></div>';
    html += m.weeks.map(function (w) {
      var hKey = w.histKey || w.weekStart;
      var earnW = formatEarnings(parseFloat((w.total || '0').replace(',', '.')), w.abt);
      return '<div class="card" onclick="loadWeek(\'' + hKey + '\')">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
        '<div><div class="history-week">' + w.weekLabel + '</div>' +
        '<div class="history-sub">' + w.name + ' · <span class="badge">' + w.abt + '</span></div></div>' +
        '<div style="text-align:right"><div class="history-hours">' + w.total + 'h</div>' +
        (earnW ? '<div class="history-earnings" style="display:block">' + earnW + '</div>' : '') +
        '<button onclick="deleteWeek(event,\'' + hKey + '\')" style="font-size:11px;color:var(--danger);background:none;border:none;cursor:pointer;margin-top:4px">löschen</button>' +
        '</div></div></div>';
    }).join('') + '</div>';
  });
  list.innerHTML = html;
}

function renderHistoryChart() {
  var ctx = document.getElementById('historyChart'); if (!ctx) return;
  var all = JSON.parse(localStorage.getItem('stundenzettel') || '{}'), keys = Object.keys(all).sort().slice(-10);
  var labels = keys.map(function(k) { return 'KW ' + k.split('-W')[1]; }), data = keys.map(function(k) { return parseFloat((all[k].total || '0').replace(',', '.')); });
  if (historyChart) historyChart.destroy();
  historyChart = new Chart(ctx, {
    type: 'bar', data: { labels: labels, datasets: [{ label: 'Wochenstunden', data: data, backgroundColor: 'rgba(24, 95, 165, 0.4)', borderColor: 'rgba(24, 95, 165, 1)', borderWidth: 1, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }
  });
}

// ── DATA COLLECT / SAVE ──
function collectData() {
  saveCurrentDayToCache();
  var v = document.getElementById('inp-week').value || currentWeekVal(), mon = getMondayFromWeekVal(v);
  var days = DAYS.map(function (day, i) {
    var d = new Date(mon.getTime() + i * 86400000), shifts = [];
    for (var s = 0; s < (shiftCounts[i] || 1); s++) shifts.push(getShiftData(i, s));
    return { day: day, date: fmtDateFull(d), shifts: shifts };
  });
  // Collect all unique depts used in this week's shifts
  var depsUsed = {};
  days.forEach(function(dd) { dd.shifts.forEach(function(sh) { if (sh.von && sh.bis) depsUsed[sh.dept || selectedAbt] = true; }); });
  return { name: document.getElementById('inp-name').value || '', abt: selectedAbt, weekStart: v, weekLabel: weekLabelFromVal(v), days: days, total: document.getElementById('total-hours').textContent, saved: new Date().toISOString(), depts: Object.keys(depsUsed) };
}

function saveWeek() {
  var d = collectData(); if (!d.name) { showToast('Bitte Namen eingeben'); return; }
  var all = JSON.parse(localStorage.getItem('stundenzettel') || '{}');

  var depts = d.depts && d.depts.length ? d.depts : [d.abt];

  if (depts.length > 1) {
    // Mixed week: save separate history entry + separate PDF per dept
    depts.forEach(function(dept) {
      var filteredDays = d.days.map(function(dd) {
        return {
          day: dd.day, date: dd.date,
          shifts: dd.shifts.filter(function(sh) { return (sh.dept || d.abt) === dept && sh.von && sh.bis; })
        };
      });
      var deptTotal = 0;
      filteredDays.forEach(function(dd) {
        dd.shifts.forEach(function(sh) {
          var v = timeToMins(sh.von), b = timeToMins(sh.bis), p = parseInt(sh.pause) || 0;
          var effB = (b < v) ? b + 1440 : b;
          if (v !== null && b !== null && effB > v) deptTotal += Math.max(180, effB - v - p) / 60;
        });
      });
      var shortKey = dept.split(' ')[0]; // 'AL' or 'MA'
      var histKey = d.weekStart + ':' + shortKey;
      var entry = Object.assign({}, d, { abt: dept, days: filteredDays, total: deptTotal % 1 === 0 ? deptTotal.toFixed(0) : deptTotal.toFixed(2), histKey: histKey });
      all[histKey] = entry;
      // Export dept-specific PDF
      (function(e, dk) {
        exportPDF_dept(e, dk);
      })(entry, shortKey);
    });
    localStorage.setItem('stundenzettel', JSON.stringify(all));
    showToast('Gespeichert! ' + depts.length + ' PDFs werden erstellt …');
  } else {
    // Single dept: classic save
    all[d.weekStart] = d;
    localStorage.setItem('stundenzettel', JSON.stringify(all));
    exportPDF();
  }
  
  // ── PUSH TO SUPABASE (Async) ──
  syncWeekToSupabase(d);
}

function isoWeekToDate(weekStr, dayIdx) {
  // weekStr = "YYYY-Www", dayIdx 0=Mon ... 6=Sun
  var parts = weekStr.split('-W');
  var year = parseInt(parts[0]), week = parseInt(parts[1]);
  var jan4 = new Date(year, 0, 4);
  var monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  var d = new Date(monday);
  d.setDate(monday.getDate() + dayIdx);
  return d.toISOString().slice(0, 10);
}

async function syncWeekToSupabase(data) {
  if (typeof supabaseClient === 'undefined' || !currentUser) return;

  try {
    // This is a simplified sync: it pushes shifts that aren't already linked to a protocol
    // primarily to ensure MA-entered shifts are backed up.
    var shiftsToSync = [];
    data.days.forEach(function(dd, dayIdx) {
      dd.shifts.forEach(function(sh) {
        if (!sh.von || !sh.bis || sh.isSynced) return;
        shiftsToSync.push({
          user_id: currentUser.id,
          start_time: sh.von,
          end_time: sh.bis,
          pause_mins: parseInt(sh.pause) || 0,
          position_role: sh.dept || data.abt,
          status: 'pending', // Weeks saved by MA are pending until approved/linked
          temp_worker_name: null,
          shift_date: isoWeekToDate(data.weekStart, dayIdx)
        });
      });
    });

    if (shiftsToSync.length > 0) {
      const { error } = await supabaseClient.from('shifts').insert(shiftsToSync);
      if (error) throw error;
      showToast('✅ Stundenzettel mit Server synchronisiert!');
      
      // Mark as synced locally
      var all = JSON.parse(localStorage.getItem('stundenzettel') || '{}');
      if (all[data.weekStart]) {
        all[data.weekStart].days.forEach(dd => dd.shifts.forEach(sh => sh.isSynced = true));
        localStorage.setItem('stundenzettel', JSON.stringify(all));
      }
    }
  } catch(e) {
    console.error("Week Sync Error:", e);
    showToast("Server-Backup fehlgeschlagen (Offline).", "info");
  }
}

function loadWeek(key) {
  var all = JSON.parse(localStorage.getItem('stundenzettel') || '{}'), w = all[key]; if (!w) return;
  document.getElementById('inp-name').value = w.name;
  document.getElementById('inp-week').value = w.weekStart;
  selectedAbt = w.abt;
  shiftSigCanvases = {}; shiftSigData = {}; shiftValues = {}; shiftCounts = {}; activeDayIdx = null;
  w.days.forEach(function (dd, i) {
    var shs = dd.shifts || [{ von: dd.von || '', bis: dd.bis || '', pause: dd.pause || '0', ort: dd.ort || '', al: dd.al || '', sig: dd.sig || null }];
    shiftCounts[i] = shs.length;
    shiftValues[i] = shs.map(function (sh, s) {
      if (sh.sig) shiftSigData[i + '-' + s] = sh.sig;
      return { von: sh.von || '', bis: sh.bis || '', ort: sh.ort || dd.ort || '', al: sh.al || dd.al || '', pause: sh.pause || '0', dept: sh.dept || w.abt || selectedAbt };
    });
  });
  renderWeekStrip();
  for (var i = 0; i < DAYS.length; i++) updateBubble(i);
  renderDayEditorArea(); calcTotal(); updateTopBarSub(); navigate('home');
  showToast('Backup geladen!');
}

function deleteWeek(e, k) { e.stopPropagation(); if (!confirm('Woche löschen?')) return; var all = JSON.parse(localStorage.getItem('stundenzettel') || '{}'); delete all[k]; localStorage.setItem('stundenzettel', JSON.stringify(all)); renderHistory(); showToast('Gelöscht'); }

// ── PDF ──
async function exportPDF() {
  var data = collectData(), sigP = [];
  data.days.forEach(function (dd) { dd.shifts.forEach(function (sh) { if (sh.sig) sigP.push(new Promise(function (res) { compressSignature(sh.sig, function (c) { sh.sig = c; res(); }); })); }); });
  await Promise.all(sigP);
  var doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
  drawPDFContent(doc, data, ml, cw);
  doc.save('stundennachweis_' + data.weekStart + '.pdf');
  showToast('PDF wurde gespeichert!');
}

async function exportPDF_dept(data, deptShort) {
  var sigP = [];
  data.days.forEach(function (dd) { dd.shifts.forEach(function (sh) { if (sh.sig) sigP.push(new Promise(function (res) { compressSignature(sh.sig, function (c) { sh.sig = c; res(); }); })); }); });
  await Promise.all(sigP);
  var doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
  drawPDFContent(doc, data, ml, cw);
  doc.save('stundennachweis_' + data.weekStart + '_' + deptShort + '.pdf');
}

async function sendToBuchhaltung() {
  var data = collectData(); if (!data.name) { showToast('Bitte Namen eingeben'); return; }
  var doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
  drawPDFContent(doc, data, ml, cw);
  var fileName = 'stundennachweis_' + data.weekStart + '_' + data.name.replace(/\s+/g, '_') + '.pdf';
  var subject = encodeURIComponent('Stundennachweis ' + data.weekLabel + ' – ' + data.name);
  var body = encodeURIComponent('Hallo,\n\nanbei der Stundennachweis für ' + data.weekLabel + ' (' + data.name + ', ' + data.abt + ').\nGesamtstunden: ' + data.total + ' h\n\n(Die PDF-Datei wurde automatisch gespeichert und muss noch manuell als Anhang hinzugefügt werden.)\n\nMit freundlichen Grüßen,\n' + data.name);
  if (navigator.canShare) {
    try {
      var file = new File([doc.output('blob')], fileName, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Stundennachweis ' + data.weekLabel, text: 'Stundennachweis ' + data.weekLabel + ' – ' + data.name + ', ' + data.total + ' h' }); showToast('✅ geteilt!'); return; }
    } catch (e) { }
  }
  doc.save(fileName); setTimeout(function () { window.location.href = 'mailto:buchhaltung@peterluebbert.de?subject=' + subject + '&body=' + body; }, 400); showToast('📧 PDF gespeichert – E-Mail wird geöffnet …');
}

async function exportMonthlyPDF(mKey) {
  var all = JSON.parse(localStorage.getItem('stundenzettel') || '{}');
  var ks = Object.keys(all).sort();
  var monthW = [], mLab = '', mTot = 0, name = '';
  ks.forEach(function (k) {
    var w = all[k], m = getMonthKeyFromWeek(w.weekStart, billingCutoff);
    if (m.key === mKey) { monthW.push(w); mLab = m.label; mTot += parseFloat((w.total || '0').replace(',', '.')); if (!name) name = w.name; }
  });
  if (!monthW.length) return;
  var doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
  if (typeof LOGO_BASE64 !== 'undefined') {
    try { var lw = 30, lh = Math.round(lw * (LOGO_H / LOGO_W) * 100) / 100; doc.addImage(LOGO_BASE64, 'PNG', 160, 10, lw, lh); } catch (e) { }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('Monatsübersicht', ml, 25);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120); doc.text('Lübbert Event Interiors', ml, 32); doc.setTextColor(0);
  doc.setFontSize(11);
  doc.text('Monat:', ml, 48); doc.setFont('helvetica', 'bold'); doc.text(mLab, ml + 25, 48);
  doc.setFont('helvetica', 'normal'); doc.text('Name:', ml, 56); doc.setFont('helvetica', 'bold'); doc.text(name || '—', ml + 25, 56);
  // Table with Abteilung column (cols: KW=35 | Zeitraum=65 | Abteilung=50 | Stunden=20)
  var colKW = ml, colZR = ml + 37, colAbt = ml + 105, colSt = ml + 155;
  var y = 72;
  doc.setFillColor(30, 30, 28); doc.rect(ml, y, cw, 10, 'F'); doc.setTextColor(255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('Kalenderwoche', colKW + 3, y + 6.5);
  doc.text('Zeitraum', colZR, y + 6.5);
  doc.text('Abteilung', colAbt, y + 6.5);
  doc.text('Stunden', colSt, y + 6.5);
  doc.setTextColor(0); y += 10;
  monthW.forEach(function (w, i) {
    if (i % 2 === 0) { doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 10, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.text('KW ' + parseInt(w.weekStart.split('-W')[1]), colKW + 3, y + 6.5);
    doc.setFont('helvetica', 'normal');
    var rangeLabel = (w.weekLabel || '').split('·');
    doc.text((rangeLabel[1] || rangeLabel[0] || '').trim(), colZR, y + 6.5);
    doc.text(w.abt || '—', colAbt, y + 6.5);
    doc.setFont('helvetica', 'bold'); doc.text(w.total + ' h', colSt, y + 6.5);
    doc.setDrawColor(220); doc.line(ml, y + 10, ml + cw, y + 10); y += 10;
  });
  y += 10; doc.setFontSize(14); doc.text('Gesamtstunden:', ml, y);
  doc.setTextColor(24, 95, 165); doc.text((mTot % 1 === 0 ? mTot.toFixed(0) : mTot.toFixed(2)) + ' h', ml + 50, y); doc.setTextColor(0);
  monthW.forEach(function (data) { doc.addPage(); drawPDFContent(doc, data, ml, cw); });
  var fN = 'stundennachweis_' + mKey.replace('-', '_') + '_' + (name || 'Mitarbeiter').replace(/\s+/g, '_') + '.pdf';
  if (navigator.canShare) {
    try {
      var file = new File([doc.output('blob')], fN, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Monatsübersicht ' + mLab, text: 'Stundennachweise für ' + mLab }); showToast('✅ geteilt!'); return; }
    } catch (e) { }
  }
  doc.save(fN); showToast('📄 Monats-PDF gespeichert!');
}

function drawPDFContent(doc, data, ml, cw) {
  if (typeof LOGO_BASE64 !== 'undefined') {
    try {
      var lw = 30, lh = Math.round(lw * (LOGO_H / LOGO_W) * 100) / 100;
      doc.addImage(LOGO_BASE64, 'PNG', 160, 10, lw, lh);
    } catch (e) { }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('Stundennachweis', ml, 20);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120); doc.text('Lübbert Event Interiors', ml, 26); doc.setTextColor(0);
  doc.setFontSize(10); doc.text('Name:', ml, 38); doc.setFont('helvetica', 'bold'); doc.text(data.name || '—', ml + 18, 38);
  doc.setFont('helvetica', 'normal'); doc.text('Abteilung:', ml + 80, 38); doc.setFont('helvetica', 'bold'); doc.text(data.abt, ml + 103, 38);
  doc.setFont('helvetica', 'normal'); doc.text('Woche:', ml, 46); doc.setFont('helvetica', 'bold'); doc.text(data.weekLabel, ml + 18, 46);
  var y = 56, cols = [36, 18, 14, 14, 16, 10, 24, 38], hd = ['Tag / Datum', 'Einsatzort', 'Von', 'Bis', 'Pause', 'Std', 'Name AL', 'Unterschrift AL'];
  doc.setFillColor(30, 30, 28); doc.rect(ml, y, cw, 8, 'F'); doc.setTextColor(255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  var cx = ml + 2; hd.forEach(function (h, i) { doc.text(h, cx, y + 5.5); cx += cols[i]; });
  doc.setTextColor(0); y += 8;
  data.days.forEach(function (dd, idx) {
    var actS = dd.shifts.filter(function (sh) { return sh.von && sh.bis; }); if (!actS.length) return;
    var dNet = 0; actS.forEach(function (sh) { var v = timeToMins(sh.von), b = timeToMins(sh.bis), p = parseInt(sh.pause) || 0; var effB = (b < v) ? b + 1440 : b; if (v !== null && b !== null && effB > v) dNet += Math.max(3, (effB - v - p) / 60); });
    var hStr = dNet % 1 === 0 ? dNet.toFixed(0) : dNet.toFixed(2), dRows = actS.length;
    if (y + dRows * 10 > 268) { doc.addPage(); y = 20; doc.setFillColor(30, 30, 28); doc.rect(ml, y, cw, 8, 'F'); doc.setTextColor(255); doc.setFontSize(8); doc.setFont('helvetica', 'bold'); var hcx = ml + 2; hd.forEach(function (h, i) { doc.text(h, hcx, y + 5.5); hcx += cols[i]; }); doc.setTextColor(0); y += 8; }
    for (var r = 0; r < dRows; r++) {
      if (idx % 2 === 0) { doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 10, 'F'); } cx = ml + 2;
      if (r === 0) { doc.setFont('helvetica', 'bold'); doc.text(dd.day + ' ' + dd.date, cx, y + 5.5); } cx += cols[0]; doc.setFont('helvetica', 'normal'); doc.text((actS[r].ort || ''), cx, y + 5.5); cx += cols[1]; doc.text(actS[r].von + ' – ' + actS[r].bis, cx, y + 5.5); cx += cols[2] + cols[3]; doc.text(parseInt(actS[r].pause) > 0 ? actS[r].pause + ' min' : '—', cx, y + 5.5); cx += cols[4]; if (r === 0) { doc.setFont('helvetica', 'bold'); doc.text(hStr + 'h', cx, y + 5.5); } cx += cols[5]; doc.setFont('helvetica', 'normal'); doc.text((actS[r].al || ''), cx, y + 5.5); cx += cols[6]; if (actS[r].sig) { try { doc.addImage(actS[r].sig, 'JPEG', cx, y + 1, 28, 8); } catch (e) { } } doc.setDrawColor(220); doc.line(ml, y + 10, ml + cw, y + 10); y += 10;
    }
  });
  y += 8; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Gesamtstunden:', ml, y); doc.setTextColor(24, 95, 165); doc.text(data.total + ' h', ml + 38, y);
  doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
  doc.text('Es werden nur Stunden angerechnet, die auf diesem Nachweis eingetragen und vom AL abgezeichnet sind.', ml, 285);
  doc.text('Einzureichen bis zum 20. Tag eines Monats.', ml, 290);
}
