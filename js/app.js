/**
 * Main Application Logic & Mode Management
 */

// ── GLOBAL STATE ──
var activeModule = localStorage.getItem('luebbert_mode') || null;
var THEMES = ['auto', 'light', 'dark'];
var ICONS = { 'auto': 'Auto', 'light': 'Hell', 'dark': 'Dunkel' };
var currentTheme = localStorage.getItem('theme') || 'auto';
var sigModalState = { key: null, drawing: false, last: null, hasInk: false };
var hourlyWage = parseFloat(localStorage.getItem('stundenzettel_wage')) || 0;
var billingCutoff = parseInt(localStorage.getItem('stundenzettel_cutoff')) || 20;
var departments;
try {
  departments = JSON.parse(localStorage.getItem('stundenzettel_depts') || 'null') || ["AL (Aufbauleitung)", "MA für Auf-/ Abbau", "Floristik", "Lager", "Stoffe", "Tischlerei"];
} catch(e) {
  departments = ["AL (Aufbauleitung)", "MA für Auf-/ Abbau", "Floristik", "Lager", "Stoffe", "Tischlerei"];
}
var selectedAbt = localStorage.getItem('stundenzettel_active_dept') || departments[0];
var monsterMode = localStorage.getItem('stundenzettel_monster') === 'true';
var deptWages;
try {
  deptWages = JSON.parse(localStorage.getItem('stundenzettel_dept_wages') || 'null') || Object.assign({}, STUNDEN_DEPT_WAGES_DEFAULT);
} catch(e) {
  deptWages = Object.assign({}, STUNDEN_DEPT_WAGES_DEFAULT);
}

// ── MODE SELECTION & NAVIGATION ──
function selectMode(m) {
  // Role-based guard
  if (m === 'protokoll' && typeof userRole !== 'undefined' && userRole === 'MA') {
    showToast('Zugriff verweigert: Nur für AL/PL.');
    return;
  }

  activeModule = m;
  localStorage.setItem('luebbert_mode', m);
  
  // Hide startup
  var startup = document.getElementById('page-startup');
  if (startup) startup.classList.remove('active');
  
  // Show navigation buttons (Back to Menu)
  var backBtn = document.getElementById('back-to-menu-btn');
  if (backBtn) backBtn.style.display = 'flex';

  if (m === 'stunden') {
    document.getElementById('main-nav').style.display = 'flex';
    document.getElementById('prot-nav').style.display = 'none';
    navigate('home');
  } else if (m === 'protokoll') {
    document.getElementById('main-nav').style.display = 'none';
    document.getElementById('prot-nav').style.display = 'flex';
    navigateProt('protokoll');
    if (typeof initProtokoll === 'function') initProtokoll();
  } else if (m === 'dashboard') {
    document.getElementById('main-nav').style.display = 'none';
    var pn = document.getElementById('prot-nav');
    if (pn) pn.style.display = 'none';
    navigate('dashboard');
    if (typeof initDashboardRealtime === 'function') initDashboardRealtime();
    if (typeof refreshDashboard === 'function') refreshDashboard();
  }
}

function exitToMenu() {
  activeModule = null;
  localStorage.removeItem('luebbert_mode');
  if (typeof stopDashboardRealtime === 'function') stopDashboardRealtime();
  
  // Reset UI
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.getElementById('page-startup').classList.add('active');
  document.getElementById('main-nav').style.display = 'none';
  var pn = document.getElementById('prot-nav');
  if (pn) pn.style.display = 'none';
  
  var backBtn = document.getElementById('back-to-menu-btn');
  if (backBtn) backBtn.style.display = 'none';
  
  updateTopBarSub();
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.querySelectorAll('.top-tab').forEach(function (b) { b.classList.remove('active'); });
  
  var targetPage = document.getElementById('page-' + page);
  var targetNav = document.getElementById('nav-' + page);
  
  if (targetPage) targetPage.classList.add('active');
  if (targetNav) targetNav.classList.add('active');
  
  if (page === 'history' && typeof renderHistory === 'function') {
    renderHistory();
    renderHistoryChart();
  }
}

function navigateProt(page) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  document.getElementById('prot-nav').querySelectorAll('.top-tab').forEach(function (b) { b.classList.remove('active'); });

  var targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');

  var navId = page === 'protokoll' ? 'nav-protokoll' : 'nav-protokoll-history';
  var navBtn = document.getElementById(navId);
  if (navBtn) navBtn.classList.add('active');

  if (page === 'protokoll-history' && typeof renderProtHistory === 'function') {
    renderProtHistory();
  }
}

// ── BRANDING & UI ──
function updateTopBarSub() {
  var sub = document.getElementById('top-bar-sub');
  if (!sub) return;

  if (activeModule === 'stunden') {
    var name = (document.getElementById('inp-name') || {}).value || '';
    var val = (document.getElementById('inp-week') || {}).value || currentWeekVal();
    var parts = val.split('-W');
    sub.textContent = name ? name + ' · KW ' + parseInt(parts[1]) : 'Stundennachweis';
  } else if (activeModule === 'protokoll') {
    sub.textContent = 'Auf- & Abbauprotokoll';
  } else {
    sub.textContent = 'Event Interiors & Logistics';
  }
}

// ── THEME ──
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('.theme-btn-icon').forEach(function (b) { b.textContent = ICONS[t]; });
}

function cycleTheme() {
  var idx = (THEMES.indexOf(currentTheme) + 1) % THEMES.length;
  currentTheme = THEMES[idx];
  localStorage.setItem('theme', currentTheme);
  applyTheme(currentTheme);
}

// ── EASTER EGG: MONSTER MODE ──
var titleTapCount = 0;
var titleTapTimer = null;
function titleTap() {
  titleTapCount++;
  clearTimeout(titleTapTimer);
  titleTapTimer = setTimeout(function () { titleTapCount = 0; }, 800);
  if (titleTapCount >= 7) {
    titleTapCount = 0;
    monsterMode = !monsterMode;
    localStorage.setItem('stundenzettel_monster', monsterMode);
    if (monsterMode) {
      showToast('MONSTER MODE AKTIVIERT!');
    } else {
      showToast('Monster Mode deaktiviert');
    }
    if (typeof calcTotal === 'function') calcTotal();
    if (document.getElementById('page-history') && document.getElementById('page-history').classList.contains('active')) {
      renderHistory();
    }
  }
}

function getDeptWage(dept) {
  if (dept && deptWages[dept] > 0) return deptWages[dept];
  return hourlyWage > 0 ? hourlyWage : 0;
}

function formatEarnings(totalHours, dept) {
  var wage = getDeptWage(dept);
  if (wage <= 0 || totalHours <= 0) return null;
  var euros = totalHours * wage;
  if (monsterMode) {
    var cans = Math.floor(euros / (STUNDEN_MONSTER_PRICE || 1.84));
    return '≈ ' + cans + ' <img src="icons/monsta_can.png" class="monster-icon" alt="Monster Can">';
  }
  return '≈ ' + euros.toFixed(2).replace('.', ',') + ' €';
}

// ── INIT ──
window.addEventListener('DOMContentLoaded', function() {
  applyTheme(currentTheme);
  
  var weekInp = document.getElementById('inp-week');
  if (weekInp) {
    weekInp.value = currentWeekVal();
    weekInp.addEventListener('change', buildDays);
  }

  var nameInp = document.getElementById('inp-name');
  if (nameInp) {
    var sn = localStorage.getItem('stundenzettel_name');
    if (sn) nameInp.value = sn;
    nameInp.addEventListener('blur', function (e) {
      localStorage.setItem('stundenzettel_name', e.target.value);
      updateTopBarSub();
    });
  }

  if (typeof buildDays === 'function') buildDays();
  if (typeof initProtokoll === 'function') initProtokoll();

  // Restore module
  if (activeModule) {
    selectMode(activeModule);
  }

  // PWAs & Service Workers
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      reg.update();
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }).catch(function () { });
  }
});

// ── SHARED SIGNATURE MODAL LOGIC ──
function initSigModalCanvas() {
  var c = document.getElementById('sig-modal-canvas'), dpr = window.devicePixelRatio || 1;
  var rect = c.parentElement.getBoundingClientRect(), w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
  c.width = w * dpr; c.height = h * dpr; c.style.width = '100%'; c.style.height = '100%';
  var ctx = c.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
  ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  return { canvas: c, ctx: ctx, w: w, h: h };
}

function sigModalPos(e, c) { var r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

function clearSigModal() { var c = document.getElementById('sig-modal-canvas'), ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); sigModalState.hasInk = false; }

function closeSigModal() {
  var m = document.getElementById('sig-modal'); m.classList.remove('open');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){});
  if (screen.orientation && screen.orientation.unlock) try { screen.orientation.unlock(); } catch(_){}
  sigModalState.key = null;
}

function saveSigModal() {
  var key = sigModalState.key; if (!key) return closeSigModal();
  var c = document.getElementById('sig-modal-canvas');
  if (sigModalState.hasInk) {
    var scale = Math.min(1, 400 / c.width), tempC = document.createElement('canvas');
    tempC.width = c.width * scale; tempC.height = c.height * scale;
    var tCtx = tempC.getContext('2d'); tCtx.fillStyle = "#FFFFFF"; tCtx.fillRect(0, 0, tempC.width, tempC.height);
    tCtx.scale(scale, scale); tCtx.drawImage(c, 0, 0);
    var data = tempC.toDataURL('image/jpeg', 0.6);
    
    if (key === 'prot') {
      if (typeof protState !== 'undefined') {
        protState.signature = data;
        if (typeof redrawProtSig === 'function') redrawProtSig();
      }
    } else {
      if (typeof shiftSigData !== 'undefined') {
        shiftSigData[key] = data;
        if (typeof redrawShiftSig === 'function') redrawShiftSig(key);
      }
    }
  } else {
    if (key === 'prot') {
      if (typeof protState !== 'undefined') {
        protState.signature = null;
        if (typeof redrawProtSig === 'function') redrawProtSig();
      }
    } else {
      if (typeof shiftSigData !== 'undefined') {
        shiftSigData[key] = null;
        if (typeof redrawShiftSig === 'function') redrawShiftSig(key);
      }
    }
  }
  closeSigModal();
}

// ── SETTINGS ──
function openSettingsModal() {
  var m = document.getElementById('settings-modal'), w = document.getElementById('inp-wage'), c = document.getElementById('inp-cutoff');
  if (w) w.value = hourlyWage > 0 ? hourlyWage : ''; 
  if (c) c.value = billingCutoff;
  renderSettingsDepts(); 
  if (m) m.classList.add('open');
}

function closeSettingsModal() { 
  var m = document.getElementById('settings-modal');
  if (m) m.classList.remove('open'); 
}

function saveSettingsModal() {
  var wEl = document.getElementById('inp-wage'), cEl = document.getElementById('inp-cutoff');
  var w = wEl ? parseFloat(wEl.value) : NaN, c = cEl ? parseInt(cEl.value) : NaN;
  
  if (!isNaN(w) && w > 0) { hourlyWage = w; localStorage.setItem('stundenzettel_wage', w); } 
  else { hourlyWage = 0; localStorage.removeItem('stundenzettel_wage'); }
  
  if (!isNaN(c) && c >= 1 && c <= 31) { billingCutoff = c; localStorage.setItem('stundenzettel_cutoff', c); }
  else { billingCutoff = 20; localStorage.removeItem('stundenzettel_cutoff'); }

  // Save per-dept wages
  departments.forEach(function(d) {
    var el = document.getElementById('inp-dept-wage-' + d.replace(/[^a-zA-Z0-9]/g, '_'));
    if (el) {
      var val = parseFloat(el.value);
      if (!isNaN(val) && val > 0) deptWages[d] = val;
      else delete deptWages[d];
    }
  });
  localStorage.setItem('stundenzettel_dept_wages', JSON.stringify(deptWages));
  
  closeSettingsModal(); 
  if (typeof calcTotal === 'function') calcTotal();
  if (document.getElementById('page-history') && document.getElementById('page-history').classList.contains('active')) { 
    if (typeof renderHistory === 'function') { renderHistory(); renderHistoryChart(); }
  }
  showToast('Einstellungen gespeichert');
}

function renderSettingsDepts() {
  var l = document.getElementById('settings-dept-list'); if (!l) return;
  l.innerHTML = departments.map(function(d, i) {
    var act = d === selectedAbt;
    var safeId = 'inp-dept-wage-' + d.replace(/[^a-zA-Z0-9]/g, '_');
    var wage = deptWages[d] || '';
    return '<div class="dept-item" style="cursor:pointer;' + (act ? 'background:var(--accent-bg);border-radius:var(--radius);padding:8px 10px;margin:0 -10px;' : '') + '">' +
           '<div style="display:flex;align-items:center;gap:8px;flex:1;" onclick="selectDepartment(\'' + d.replace(/'/g, "\\'") + '\')">' +
           '<span>' + (act ? '✓' : '') + '</span>' +
           '<span style="' + (act ? 'font-weight:600;color:var(--accent-text);' : '') + '">' + d + '</span>' +
           '</div>' +
           '<div style="display:flex;align-items:center;gap:6px;">' +
           '<input type="number" id="' + safeId + '" step="0.50" min="0" value="' + wage + '" placeholder="€/h" ' +
           'style="width:64px;padding:4px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);" ' +
           'onclick="event.stopPropagation()" />' +
           '<button onclick="event.stopPropagation();deleteDepartment(' + i + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:4px 8px;">✕</button>' +
           '</div></div>';
  }).join('');
}

function selectDepartment(d) { 
  selectedAbt = d; 
  localStorage.setItem('stundenzettel_active_dept', d); 
  renderSettingsDepts(); 
  updateTopBarSub(); 
  if (typeof renderDeptChips === 'function') renderDeptChips(); 
}

function addDepartment() {
  var i = document.getElementById('inp-new-dept'), v = i.value.trim(); if (!v) return;
  departments.push(v); localStorage.setItem('stundenzettel_depts', JSON.stringify(departments)); 
  i.value = ''; renderSettingsDepts(); 
  if (typeof renderDeptChips === 'function') renderDeptChips();
}

function deleteDepartment(i) {
  if (departments.length <= 1) { showToast('Mindestens eine Abteilung muss bleiben'); return; }
  departments.splice(i, 1); localStorage.setItem('stundenzettel_depts', JSON.stringify(departments)); 
  renderSettingsDepts(); 
  if (typeof renderDeptChips === 'function') renderDeptChips();
}

// ── BACKUP ──
function exportBackup() {
  var b = { meta: { date: new Date().toISOString(), version: '1.2' }, data: {} };
  for (var i = 0; i < localStorage.length; i++) { 
    var k = localStorage.key(i); 
    if (k.startsWith('stundenzettel') || k.startsWith('luebbert')) b.data[k] = localStorage.getItem(k); 
  }
  var blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'luebbert_app_backup_' + new Date().toISOString().split('T')[0] + '.json'; a.click();  
  showToast('Backup exportiert!');
}

function importBackup(e) {
  var f = e.target.files[0]; if (!f) return;
  var r = new FileReader(); r.onload = function(evt) {
    try {
      var b = JSON.parse(evt.target.result); if (!b.data) throw new Error();
      if (confirm('Daten überschreiben?')) { 
        Object.keys(b.data).forEach(function(k){ localStorage.setItem(k,b.data[k]); }); 
        window.location.reload(); 
      }
    } catch(err){ showToast('Fehler beim Import'); }
  }; r.readAsText(f);
}

// Global Event Binding
(function bindSigModal() {
  window.addEventListener('load', function() {
    var c = document.getElementById('sig-modal-canvas'); if (!c) return;
    c.addEventListener('pointerdown', function (e) {
      sigModalState.drawing = true; sigModalState.last = sigModalPos(e, c);
      if (c.setPointerCapture) c.setPointerCapture(e.pointerId); e.preventDefault();
    });
    c.addEventListener('pointermove', function (e) {
      if (!sigModalState.drawing) return;
      var ctx = c.getContext('2d'), p = sigModalPos(e, c), l = sigModalState.last;
      ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      sigModalState.last = p; sigModalState.hasInk = true; e.preventDefault();
    });
    c.addEventListener('pointerup', function (e) {
      sigModalState.drawing = false; if (c.releasePointerCapture) { try { c.releasePointerCapture(e.pointerId); } catch (_) { } }
    });
  });
})();
