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
      dept: deptEl ? deptEl.value : (shiftValues[i][s] && shiftValues[i][s].dept) || selectedAbt,
      isProtocol: shiftValues[i][s] ? (shiftValues[i][s].isProtocol || false) : false,
      protocolId: shiftValues[i][s] ? (shiftValues[i][s].protocolId || null) : null
    };
  }
}

function getShiftData(dayIdx, shiftIdx) {
  var key = dayIdx + '-' + shiftIdx;
  if (activeDayIdx === dayIdx) {
    var vonEl = document.getElementById('von-' + key);
    if (vonEl) {
      var sv0 = (shiftValues[dayIdx] || [])[shiftIdx] || {};
      var deptEl = document.getElementById('dept-' + key);
      return {
        von: vonEl.value || '',
        bis: (document.getElementById('bis-' + key) || {}).value || '',
        pause: (document.getElementById('pause-' + key) || { value: '0' }).value || '0',
        ort: (document.getElementById('ort-' + key) || {}).value || '',
        al: (document.getElementById('al-' + key) || {}).value || '',
        dept: deptEl ? deptEl.value : selectedAbt,
        sig: shiftSigData[key] || null,
        isProtocol: sv0.isProtocol || false,
        protocolId: sv0.protocolId || null
      };
    }
  }
  var sv = (shiftValues[dayIdx] || [])[shiftIdx] || {};
  return { von: sv.von || '', bis: sv.bis || '', pause: sv.pause || '0', ort: sv.ort || '', al: sv.al || '', dept: sv.dept || selectedAbt, sig: shiftSigData[key] || null, isProtocol: sv.isProtocol || false, protocolId: sv.protocolId || null };
}

// ── PER-USER STORAGE ──
// Weeks live in localStorage 'stundenzettel:<userId>' — on a shared device every user has their own history.
// The old shared key 'stundenzettel' is only migrated (see migrateLegacyStore), never read or pushed otherwise.
function szStoreKey() {
  return (typeof currentUser !== 'undefined' && currentUser && currentUser.id) ? 'stundenzettel:' + currentUser.id : null;
}

// Legacy weeks → { mine: weeks carrying this user's name, rest: everybody else's (stay where they are) }
function splitLegacyStore(legacy, fullName) {
  var norm = function (s) { return String(s || '').trim().toLowerCase(); };
  var me = norm(fullName), out = { mine: {}, rest: {} };
  Object.keys(legacy || {}).forEach(function (k) {
    var e = legacy[k];
    if (me && e && norm(e.name) === me) out.mine[k] = e; else out.rest[k] = e;
  });
  return out;
}

var _szMigrated = {};
function migrateLegacyStore(key) {
  if (_szMigrated[key]) return;
  _szMigrated[key] = true;
  try {
    var raw = localStorage.getItem('stundenzettel');
    if (!raw) return;
    var sp = splitLegacyStore(JSON.parse(raw), currentUser.full_name);
    if (!Object.keys(sp.mine).length) return;
    var mine = JSON.parse(localStorage.getItem(key) || '{}');
    Object.keys(sp.mine).forEach(function (k) { if (!(k in mine)) mine[k] = sp.mine[k]; });
    localStorage.setItem(key, JSON.stringify(mine));
    if (Object.keys(sp.rest).length) localStorage.setItem('stundenzettel', JSON.stringify(sp.rest));
    else localStorage.removeItem('stundenzettel');
  } catch (e) { console.warn('Stundenzettel-Migration:', e); }
}

function loadStore() {
  var key = szStoreKey();
  if (!key) return {};
  migrateLegacyStore(key);
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { return {}; }
}

function saveStore(all) {
  var key = szStoreKey();
  if (key) localStorage.setItem(key, JSON.stringify(all));
}

// ── EDITOR STATE ──
var _editorBaseline = null; // snapshot of the editor right after it was filled/saved → "untouched" check
var _editorWeek = null;

// Editor state (shifts per day, signatures) of a stored week; all dept parts merged by the caller
function weekToEditorState(w, fallbackDept) {
  var st = { shiftCounts: {}, shiftValues: {}, shiftSigData: {} };
  (w.days || []).forEach(function (dd, i) {
    var shs = dd.shifts || [{ von: dd.von || '', bis: dd.bis || '', pause: dd.pause || '0', ort: dd.ort || '', al: dd.al || '', sig: dd.sig || null }];
    st.shiftCounts[i] = shs.length;
    st.shiftValues[i] = shs.map(function (sh, s) {
      if (sh.sig) st.shiftSigData[i + '-' + s] = sh.sig;
      var _v = timeToMins(sh.von || ''), _b = timeToMins(sh.bis || '');
      var _p = (_v !== null && _b !== null) ? autoPause(_b < _v ? _b + 1440 - _v : _b - _v) : 0;
      return { von: sh.von || '', bis: sh.bis || '', ort: sh.ort || dd.ort || '', al: sh.al || dd.al || '', pause: _p.toString(), dept: sh.dept || fallbackDept, protocolId: sh.protocolId || null, isProtocol: sh.isProtocol || false };
    });
  });
  return st;
}

// days = [[shift, ...], ...] → string that changes only when real input changes (pause is derived)
function weekSnapshot(days) {
  return JSON.stringify(days.map(function (shs) {
    return shs.map(function (s) { return [s.von || '', s.bis || '', s.ort || '', s.al || '', s.dept || '', s.sig || '']; });
  }));
}

function editorSnapshot() {
  var days = [];
  for (var i = 0; i < DAYS.length; i++) {
    var shs = [];
    for (var s = 0; s < (shiftCounts[i] || 1); s++) shs.push(getShiftData(i, s));
    days.push(shs);
  }
  return weekSnapshot(days);
}

function markEditorClean() { _editorBaseline = editorSnapshot(); }
function editorIsDirty() { return _editorBaseline !== null && editorSnapshot() !== _editorBaseline; }

// Empty editor, then (if given) the stored week on top
function resetEditorState(w, fallbackDept) {
  shiftSigCanvases = {};
  shiftSigData = {};
  shiftValues = {};
  shiftCounts = {};
  for (var i = 0; i < DAYS.length; i++) {
    shiftCounts[i] = 1;
    shiftValues[i] = [{ von: '', bis: '', ort: '', al: '', pause: '0', dept: selectedAbt }];
  }
  if (w) {
    var st = weekToEditorState(w, fallbackDept || selectedAbt);
    Object.keys(st.shiftCounts).forEach(function (i) { shiftCounts[i] = st.shiftCounts[i]; shiftValues[i] = st.shiftValues[i]; });
    shiftSigData = st.shiftSigData;
  }
  activeDayIdx = null;
}

function renderEditorFromState() {
  renderWeekStrip();
  for (var i = 0; i < DAYS.length; i++) updateBubble(i);
  renderDayEditorArea();
  calcTotal();
  updateTopBarSub();
  _editorWeek = (document.getElementById('inp-week') || {}).value || currentWeekVal();
  markEditorClean();
}

// The sync brought a newer state of the week that is open — show it, but never over unsaved input
function refreshEditorIfClean() {
  if (!document.getElementById('inp-week') || editorIsDirty()) return;
  var wk = document.getElementById('inp-week').value || currentWeekVal();
  var w = mergeWeekParts(loadStore(), wk);
  if (!w) return;
  resetEditorState(w);
  renderEditorFromState();
}

// force = true: reset without asking (user change). As a 'change' listener the first argument is an Event.
function buildDays(force) {
  var inp = document.getElementById('inp-week');
  if (force !== true && inp && editorIsDirty()) {
    if (!confirm('Du hast ungespeicherte Eingaben (auch Unterschriften). Beim Wechsel der Woche gehen sie verloren. Trotzdem wechseln?')) {
      if (_editorWeek) inp.value = _editorWeek;
      return;
    }
  }
  var wk = (inp && inp.value) || currentWeekVal();
  // The week as saved so far (all dept parts), otherwise the next save would replace it with a nearly empty form
  resetEditorState(mergeWeekParts(loadStore(), wk));
  renderEditorFromState();

  if (typeof currentUser !== 'undefined' && currentUser) {
    fetchSupabaseShifts();
  }
}

var _shiftsSyncRunning = false;
var _shiftsSyncPromise = null;
var _serverSeenFor = null; // user id whose server shifts this session has loaded successfully at least once

// One sync at a time; callers (saveWeek) can await the one that is already running
function fetchSupabaseShifts() {
  if (_shiftsSyncPromise) return _shiftsSyncPromise;
  _shiftsSyncPromise = fetchShiftsNow().then(function () { _shiftsSyncPromise = null; }, function () { _shiftsSyncPromise = null; });
  return _shiftsSyncPromise;
}

async function fetchShiftsNow() {
  if (typeof supabaseClient === 'undefined' || !currentUser) return;
  if (_shiftsSyncRunning) return;
  _shiftsSyncRunning = true;

  try {
    // Weeks whose last save didn't reach the server (offline, failed check) are retried first —
    // like protocols, instead of waiting for the user to save again
    if (navigator.onLine !== false) {
      var pending = loadStore();
      for (var pw of unsyncedWeekKeys(pending)) {
        if (weekIsBlind(pending, pw)) continue; // saved without seeing the server: merged below, never planned against it
        if (serialBusy(_weekSyncChains, pw)) continue; // a save of this week is syncing right now — no second sync on top
        var pData = mergeWeekParts(pending, pw);
        if (pData) { try { await syncWeekToSupabase(pData, true); } catch (e) { console.warn('Woche erneut synchronisieren:', pw, e); } }
      }
    }

    var { data, error } = await supabaseClient
      .from('shifts')
      .select(`
        id, start_time, end_time, pause_mins, position_role, status, shift_date, protocol_id, ort,
        protocols ( date, al_name_fallback, pl_name_fallback, projects ( name, location ) )
      `)
      .eq('user_id', currentUser.id)
      .in('status', ['offen', 'eingetragen']);

    if (error) throw error;
    _serverSeenFor = currentUser.id;
    // Nothing on the server = empty server state: synced local weeks are stale and go (unsynced ones stay)
    if (!data || data.length === 0) {
      resolveBlindWeeks({});
      var staleAll = loadStore();
      if (dropSyncedWeeks(staleAll)) {
        saveStore(staleAll);
        if (typeof renderHistory === 'function' && document.getElementById('history-list')) {
          renderHistory(true);
          if (typeof renderHistoryChart === 'function' && document.getElementById('historyChart')) renderHistoryChart();
        }
        refreshEditorIfClean();
      }
      return;
    }

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
            isoDate: iterD.getFullYear() + '-' + pad(iterD.getMonth()+1) + '-' + pad(iterD.getDate()),
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
           pause: (function() { var v = timeToMins((sh.start_time||'').substring(0,5)), b = timeToMins((sh.end_time||'').substring(0,5)); if (v===null||b===null) return '0'; var r = b<v ? b+1440-v : b-v; return autoPause(r).toString(); })(),
           ort: (prot.projects && (prot.projects.location || prot.projects.name)) ? [prot.projects.location, prot.projects.name].filter(Boolean).join(', ') : (sh.ort || ''),
           al: prot.al_name_fallback || prot.pl_name_fallback || '',
           dept: sh.position_role || 'MA',
           sig: null,
           protocolId: sh.protocol_id || null,
           isProtocol: !!sh.protocol_id
         });
      }
    });

    resolveBlindWeeks(userWeeks);

    // Calculate totals for each week and inject into history
    var allLocal = loadStore();
    var changed = false;

    Object.keys(userWeeks).forEach(function(wKey) {
      var weekObj = userWeeks[wKey];

      // A local save that hasn't reached the server yet (offline, failed sync) wins —
      // replacing it with the server state would silently drop those shifts
      if (weekHasUnsynced(allLocal, wKey)) return;

      // Use proper week label matching the Stundenzettel format
      weekObj.weekLabel = weekLabelFromVal(wKey);

      // AL signatures and AL names on manual shifts exist ONLY locally (they are
      // never synced to the server) — carry them over while the local entries
      // for this week get replaced (both combined key and any dept-split keys),
      // or they'd be wiped on every sync.
      var oldEntries = removeWeekEntries(allLocal, wKey);
      mergeLocalShiftExtras(weekObj, oldEntries);

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

      // Split by dept and save separate cards (same as saveWeek())
      // so Lager, AL, MA etc. each get their own history card
      Object.assign(allLocal, buildWeekEntries(weekObj));
      changed = true;
    });

    if (changed) {
      saveStore(allLocal);
      // Re-render WITHOUT re-triggering the sync — renderHistory(false, true)
      // would otherwise call fetchSupabaseShifts again in an endless loop
      if (typeof renderHistory === 'function' && document.getElementById('history-list')) {
        renderHistory(true);
        if (typeof renderHistoryChart === 'function' && document.getElementById('historyChart')) renderHistoryChart();
      }
      refreshEditorIfClean();
    }
  } catch(e) { console.error("Error fetching shifts:", e); }
  finally { _shiftsSyncRunning = false; }
}

// Copies local-only shift data (AL signature, AL name, Ort fallback) from the
// previously stored week entries into a freshly server-built week object.
// Shifts are matched by day (isoDate or dd.mm.yyyy) + von + bis.
function mergeLocalShiftExtras(weekObj, oldEntries) {
  if (!oldEntries || !oldEntries.length) return;
  weekObj.days.forEach(function(dd) {
    dd.shifts.forEach(function(sh) {
      if (sh.sig && sh.al && sh.ort) return;
      oldEntries.forEach(function(oe) {
        (oe.days || []).forEach(function(od) {
          var sameDay = (od.isoDate && od.isoDate === dd.isoDate) || (od.date && od.date === dd.date);
          if (!sameDay) return;
          (od.shifts || []).forEach(function(os) {
            if (os.von !== sh.von || os.bis !== sh.bis) return;
            if (!sh.sig && os.sig) sh.sig = os.sig;
            if (!sh.al && os.al) sh.al = os.al;
            if (!sh.ort && os.ort) sh.ort = os.ort;
          });
        });
      });
    });
  });
}

// True while a local save of this week was made without having seen the server's state of it
function weekIsBlind(all, weekStart) {
  return Object.keys(all).some(function (k) {
    return (k === weekStart || k.indexOf(weekStart + ':') === 0) && all[k] && all[k].unsynced && all[k].blind;
  });
}

// Adds shifts the server has but the local week lacks (same day + von + bis + dept); keeps everything local
function mergeUnseenShifts(local, server) {
  var added = 0;
  var keyOf = function (s, w) { return [s.von, s.bis, s.dept || w.abt].join('|'); };
  var days = (local.days || []).map(function (dd, i) {
    var have = (dd.shifts || []).filter(function (s) { return s.von || s.bis; });
    var keys = {};
    have.forEach(function (s) { keys[keyOf(s, local)] = true; });
    var sd = server && server.days && server.days[i];
    ((sd && sd.shifts) || []).forEach(function (s) {
      if (!s.von || !s.bis) return;
      var k = keyOf(s, server);
      if (keys[k]) return;
      keys[k] = true;
      have.push(Object.assign({}, s, { dept: s.dept || server.abt }));
      added++;
    });
    return Object.assign({}, dd, { shifts: have.length ? have : (dd.shifts || []) });
  });
  return { week: Object.assign({}, local, { days: days }), added: added };
}

// Offline saves ('blind') meet the server for the first time: merge its shifts in (never delete them), then sync
function resolveBlindWeeks(userWeeks) {
  var all = loadStore(), done = [];
  unsyncedWeekKeys(all).forEach(function (ws) {
    if (!weekIsBlind(all, ws)) return;
    var local = mergeWeekParts(all, ws);
    var m = mergeUnseenShifts(local, userWeeks[ws] || null);
    var w = Object.assign({}, m.week, { saved: new Date().toISOString(), unsynced: true });
    delete w.blind;
    removeWeekEntries(all, ws);
    Object.assign(all, buildWeekEntries(w));
    done.push(w);
  });
  if (!done.length) return;
  saveStore(all);
  done.forEach(function (w) { syncWeekToSupabase(w, true); });
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
// ISO week `delta` weeks away from 'YYYY-Www' (via the Thursday of the target week)
function shiftWeekVal(val, delta) {
  var mon = getMondayFromWeekVal(val);
  var thu = new Date(Date.UTC(mon.getFullYear(), mon.getMonth(), mon.getDate() + delta * 7 + 3));
  var year = thu.getUTCFullYear();
  var week = Math.ceil(((thu - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return year + '-W' + pad(week);
}

// Day tile state: empty / partial (a shift lacks Von or Bis) / done / signed (all done + a signature)
function dayStatus(shifts, signedCount) {
  var filled = (shifts || []).filter(function (s) { return s && (s.von || s.bis); });
  if (!filled.length) return 'empty';
  if (filled.some(function (s) { return !s.von || !s.bis; })) return 'partial';
  return signedCount > 0 ? 'signed' : 'done';
}

// Week arrows: the hidden #inp-week stays the source of truth (buildDays listens to its change event)
function stundenWeekStep(delta) {
  var inp = document.getElementById('inp-week');
  inp.value = shiftWeekVal(inp.value || currentWeekVal(), delta);
  inp.dispatchEvent(new Event('change'));
}

function openStundenWeekPicker() {
  var inp = document.getElementById('inp-week');
  // Safari has no week picker: the field is plain text there, and focusing it would open a keyboard for an invisible field
  if (inp.type !== 'week') return;
  try { if (inp.showPicker) { inp.showPicker(); return; } } catch (e) { /* not allowed here */ }
  inp.focus();
}

// Name comes from the login; "Ändern" reveals the old field
function syncStundenName() {
  var inp = document.getElementById('inp-name'), txt = document.getElementById('stunden-name-text');
  if (inp && txt) txt.textContent = inp.value || 'Name fehlt';
}

function editStundenName() {
  var wrap = document.getElementById('stunden-name-field');
  if (!wrap) return;
  wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
  if (wrap.style.display === '') document.getElementById('inp-name').focus();
}

function renderWeekStrip() {
  var val = document.getElementById('inp-week').value || currentWeekVal();
  var mon = getMondayFromWeekVal(val);
  var sun = new Date(mon.getTime() + 6 * 86400000);
  var parts = val.split('-W');
  var lbl = document.getElementById('week-strip-label');
  if (lbl) lbl.textContent = 'KW ' + parseInt(parts[1]) + ' · ' + fmtDate(mon) + '.–' + fmtDate(sun) + '.';
  syncStundenName();

  var strip = document.getElementById('week-strip');
  if (!strip) return;
  strip.innerHTML = '';
  for (var i = 0; i < DAYS.length; i++) {
    (function (i) {
      var d = new Date(mon.getTime() + i * 86400000);
      var tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'ui-day';
      tile.id = 'dayw-' + i;
      tile.onclick = function () { selectDay(i); };
      tile.innerHTML = '<span>' + DAY_SHORT[i] + '</span><b id="bubble-' + i + '">–</b><span>' + fmtDate(d) + '</span><i></i>';
      strip.appendChild(tile);
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
    var t = document.getElementById('dayw-' + j);
    if (t) t.classList.toggle('ui-day-active', j === i);
  }
  renderDayEditorArea();
}

function updateBubble(dayIdx) {
  var bubble = document.getElementById('bubble-' + dayIdx);
  if (!bubble) return;
  var totalMins = 0, shifts = [], signed = 0;
  for (var s = 0; s < (shiftCounts[dayIdx] || 1); s++) {
    var data = getShiftData(dayIdx, s);
    shifts.push(data);
    if (shiftSigData[dayIdx + '-' + s]) signed++;
    var von = timeToMins(data.von), bis = timeToMins(data.bis);
    var pause = parseInt(data.pause) || 0;
    var effB = (bis < von) ? bis + 1440 : bis;
    if (von !== null && bis !== null && effB > von) totalMins += Math.max(180, effB - von - pause);
  }
  var status = dayStatus(shifts, signed);
  var tile = document.getElementById('dayw-' + dayIdx);
  if (tile) tile.className = 'ui-day' + (activeDayIdx === dayIdx ? ' ui-day-active' : '') + (status !== 'empty' ? ' ui-dot-' + status : '');
  if (totalMins > 0) {
    var h = totalMins / 60;
    bubble.textContent = h % 1 === 0 ? h.toFixed(0) : h.toFixed(1).replace('.', ',');
  } else {
    bubble.textContent = status === 'partial' ? '?' : '–';
  }
}

function renderDayEditorArea() {
  var area = document.getElementById('day-editor-area');
  if (!area) return;
  if (activeDayIdx === null) {
    area.innerHTML = uiEmptyHtml('Tag antippen', 'Wähle oben einen Tag, um Stunden einzutragen.');
    return;
  }
  var i = activeDayIdx;
  var val = document.getElementById('inp-week').value || currentWeekVal();
  var mon = getMondayFromWeekVal(val);
  var d = new Date(mon.getTime() + i * 86400000);
  area.innerHTML =
    '<div class="ui-section-head"><span class="ui-title" style="font-size:18px;">' + DAYS[i] + '</span><span class="ui-sub">' + fmtDateFull(d) + '</span></div>' +
    '<div id="shifts-' + i + '"></div>' +
    '<button type="button" class="ui-add-row" onclick="addShift(' + i + ')">' + uiIcon('plus') + ' Schicht hinzufügen</button>';

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
  var key = dayIdx + '-' + shiftIdx;
  var block = document.createElement('div');
  block.className = 'ui-card stunden-shift';
  block.id = 'shift-' + key;
  var removeBtn = shiftIdx > 0 ? '<button type="button" class="ui-icon-btn shift-remove" onclick="removeShift(' + dayIdx + ',' + shiftIdx + ')" aria-label="Schicht entfernen">' + uiIcon('trash') + '</button>' : '';
  var deptOpts = (typeof departments !== 'undefined' ? departments : []).map(function(d) {
    return '<option value="' + escapeHtml(d) + '">' + escapeHtml(typeof deptLabel === 'function' ? deptLabel(d) : d) + '</option>';
  }).join('');
  block.innerHTML =
    '<div class="stunden-shift-head"><span class="ui-label">Schicht ' + (shiftIdx + 1) + ' · ' + DAYS[dayIdx] + '</span>' + removeBtn + '</div>' +
    '<div class="stunden-times">' +
      '<label class="ui-field"><span>Von</span><input type="time" id="von-' + key + '" oninput="calcDay(' + dayIdx + ')"/></label>' +
      '<span class="stunden-dash" aria-hidden="true">–</span>' +
      '<label class="ui-field"><span>Bis</span><input type="time" id="bis-' + key + '" oninput="calcDay(' + dayIdx + ')"/></label>' +
    '</div>' +
    '<div class="ui-sub stunden-summary" id="pbadge-' + key + '">Von und Bis eintragen – die Pause wird automatisch berechnet</div>' +
    '<input type="hidden" id="pause-' + key + '" value="0"/>' +
    '<div class="stunden-grid">' +
      '<label class="ui-field"><span>Ort</span><input type="text" id="ort-' + key + '" placeholder="Einsatzort"/></label>' +
      '<label class="ui-field"><span>Name AL</span><input type="text" id="al-' + key + '" placeholder="Vorname Nachname"/></label>' +
    '</div>' +
    '<label class="ui-field"><span>Abteilung (diese Schicht)</span><select id="dept-' + key + '" onchange="calcTotal()">' + deptOpts + '</select></label>' +
    '<div class="stunden-sig-head"><span>Unterschrift AL</span><span class="ui-pill ui-pill-warn" id="sigpill-' + key + '">fehlt</span></div>' +
    '<div class="sig-wrap" onclick="openSignaturePad(' + dayIdx + ',' + shiftIdx + ')"><canvas id="sigc-' + key + '"></canvas><div class="sig-placeholder" id="sigph-' + key + '">Tippen für Unterschrift</div><button class="sig-clear" type="button" onclick="event.stopPropagation();clearShiftSig(' + dayIdx + ',' + shiftIdx + ')">löschen</button></div>';
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
  if (isShiftLocked(dayIdx, shiftIdx)) { showToast('🔒 Bereits abgezeichnet – Schicht kann nicht entfernt werden.'); return; }
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
// "7,5 h netto · 30 min Pause"; same rules as the day tiles (minimum 3 h, over midnight). '' while Von/Bis is missing
function shiftSummaryLine(von, bis, pauseMins) {
  var v = timeToMins(von), b = timeToMins(bis);
  if (v === null || b === null) return '';
  var effB = b < v ? b + 1440 : b;
  if (effB <= v) return '';
  var pause = parseInt(pauseMins) || 0, h = Math.max(180, effB - v - pause) / 60;
  return (h % 1 === 0 ? h.toFixed(0) : h.toFixed(1).replace('.', ',')) + ' h netto' + (pause > 0 ? ' · ' + pause + ' min Pause' : '');
}

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
      if (badge) badge.textContent = shiftSummaryLine(vonEl.value, bisEl.value, pause);
      totalMins += net;
    } else {
      if (pauseEl) pauseEl.value = 0;
      if (badge) badge.textContent = 'Von und Bis eintragen – die Pause wird automatisch berechnet';
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
  if (isShiftLocked(dayIdx, shiftIdx)) { showToast('🔒 Bereits abgezeichnet – nur AL/PL können das ändern.'); return; }
  var key = dayIdx + '-' + shiftIdx;
  document.getElementById('sig-modal').classList.add('open');
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function(){});
  if (screen.orientation && screen.orientation.lock) {
    try {
      var lockP = screen.orientation.lock("landscape");
      if (lockP && lockP.catch) lockP.catch(function(){});
    } catch(_){}
  }
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
  ctx.scale(dpr, dpr); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pw, ph); ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  shiftSigCanvases[key] = { canvas: canvas, ctx: ctx, w: pw, h: ph, _ready: true };
  redrawShiftSig(key);
}

function redrawShiftSig(key) {
  var sc = shiftSigCanvases[key];
  if (sc) {
    sc.ctx.clearRect(0, 0, sc.w, sc.h);
    if (shiftSigData[key]) {
      var img = new Image(); img.onload = function () { sc.ctx.drawImage(img, 0, 0, sc.w, sc.h); };
      img.src = shiftSigData[key];
    }
  }
  var ph = document.getElementById('sigph-' + key); if (ph) ph.style.display = shiftSigData[key] ? 'none' : '';
  updateShiftLockState(key);
}

// ── SIGNED-SHIFT LOCK ──
// Once the AL has signed a shift, MA users may no longer change its times.
// AL/PL/Buchhaltung/Admin keep edit rights so mistakes can still be corrected.
function canEditSignedShifts() {
  return typeof userRole !== 'undefined' && ['AL', 'PL', 'Buchhaltung', 'Admin'].indexOf(userRole) !== -1;
}

// A shift is locked for MA users when it carries a local AL signature OR when
// it was synced from a protocol (the AL signed the protocol; local edits to
// such shifts are never written back to the server anyway).
function isShiftLocked(dayIdx, shiftIdx) {
  if (canEditSignedShifts()) return false;
  if (shiftSigData[dayIdx + '-' + shiftIdx]) return true;
  var sv = (shiftValues[dayIdx] || [])[shiftIdx] || {};
  return !!sv.isProtocol;
}

function updateShiftLockState(key) {
  var parts = key.split('-');
  var dayIdx = parseInt(parts[0]), shiftIdx = parseInt(parts[1]);
  var locked = isShiftLocked(dayIdx, shiftIdx);
  var sv = (shiftValues[dayIdx] || [])[shiftIdx] || {};
  ['von-', 'bis-', 'ort-', 'al-', 'dept-'].forEach(function (prefix) {
    var el = document.getElementById(prefix + key);
    if (el) el.disabled = locked;
  });
  var block = document.getElementById('shift-' + key);
  if (block) {
    var clearBtn = block.querySelector('.sig-clear');
    if (clearBtn) clearBtn.style.display = locked ? 'none' : '';
    var fullBtn = block.querySelector('.sig-full-btn');
    if (fullBtn) fullBtn.style.display = locked ? 'none' : '';
    var removeBtn = block.querySelector('.shift-remove');
    if (removeBtn) removeBtn.style.display = locked ? 'none' : '';
    var sigWrap = block.querySelector('.sig-wrap');
    if (sigWrap) sigWrap.style.pointerEvents = locked ? 'none' : '';
    var hint = block.querySelector('.shift-lock-hint');
    if (locked && !hint) {
      hint = document.createElement('span');
      hint.className = 'shift-lock-hint ui-pill';
      var fromProtocol = sv.isProtocol && !shiftSigData[key];
      hint.textContent = fromProtocol ? 'aus Protokoll' : 'abgezeichnet';
      hint.title = fromProtocol ? 'Aus Protokoll übernommen – Änderungen nur durch AL/PL möglich.'
        : 'Vom AL abgezeichnet – Zeiten können nicht mehr geändert werden.';
      (block.querySelector('.stunden-shift-head') || block).appendChild(hint);
    } else if (!locked && hint) {
      hint.remove();
    }
    // Signature status pill next to "Unterschrift AL"
    var pill = document.getElementById('sigpill-' + key);
    if (pill) {
      pill.className = 'ui-pill ' + (shiftSigData[key] ? 'ui-pill-ok' : 'ui-pill-warn');
      pill.textContent = shiftSigData[key] ? 'unterschrieben' : 'fehlt';
    }
  }
  if (!isNaN(dayIdx)) updateBubble(dayIdx);
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
function clearShiftSig(d, s) {
  if (isShiftLocked(d, s)) { showToast('🔒 Bereits abgezeichnet – nur AL/PL können das ändern.'); return; }
  var key = d + '-' + s; shiftSigData[key] = null; redrawShiftSig(key);
}

// ── HISTORY ──
// Splits a stored week day-by-day into billing periods (cutoff-aware).
// Returns { periodKey: { label, hours } }. A week crossing the cutoff (e.g.
// Mon 16. – Sun 22. with cutoff 20) contributes to BOTH periods.
function weekBillingSplit(w) {
  var out = {}, hasAny = false;
  (w.days || []).forEach(function (dd) {
    var d = parseDayDate(dd);
    if (!d) return;
    var shifts = dd.shifts || [dd]; // legacy single-shift day format
    var hrs = 0;
    shifts.forEach(function (sh) { hrs += shiftNetHours(sh); });
    if (hrs <= 0) return;
    var p = getBillingKeyForDate(d, billingCutoff);
    if (!out[p.key]) out[p.key] = { label: p.label, hours: 0 };
    out[p.key].hours += hrs;
    hasAny = true;
  });
  if (!hasAny) {
    var m = getMonthKeyFromWeek(w.weekStart, billingCutoff);
    out[m.key] = { label: m.label, hours: parseFloat((w.total || '0').replace(',', '.')) || 0 };
  }
  return out;
}

function renderHistory(skipSync) {
  if (!skipSync) fetchSupabaseShifts(); // Background sync when entering history (not when called FROM the sync)

  var list = document.getElementById('history-list');
  var all = loadStore();
  var keys = Object.keys(all).sort().reverse();
  if (!keys.length) { list.innerHTML = uiEmptyHtml('Noch keine Wochen', 'Gespeicherte Wochen erscheinen hier.'); return; }
  var months = {};
  keys.forEach(function (k) {
    var w = all[k];
    var periods = weekBillingSplit(w);
    Object.keys(periods).forEach(function (pk) {
      if (!months[pk]) months[pk] = { label: periods[pk].label, weeks: [], totalHours: 0 };
      months[pk].weeks.push(w);
      months[pk].totalHours += periods[pk].hours;
    });
  });
  var html = '';
  Object.keys(months).sort().reverse().forEach(function (mKey) {
    var m = months[mKey];
    var hrs = m.totalHours % 1 === 0 ? m.totalHours.toFixed(0) : m.totalHours.toFixed(2);
    var bilRange = getBillingPeriodLabel(mKey, billingCutoff);
    html += '<div class="ui-section"><div class="ui-section-head"><div><div class="ui-row-title">' + escapeHtml(m.label) + '</div>' +
      '<div class="ui-sub">' + bilRange + ' · ' + hrs.replace('.', ',') + ' h</div></div>' +
      '<button type="button" class="ui-icon-btn" aria-label="Monat-Aktionen" onclick="historyMonthMenu(\'' + jsAttrArg(mKey) + '\')">' + uiIcon('dots') + '</button></div>';
    html += m.weeks.map(function (w) {
      var hKey = w.histKey || w.weekStart;
      var earnW = formatEarnings(parseFloat((w.total || '0').replace(',', '.')), w.abt);
      var kw = w.weekStart ? parseInt(String(w.weekStart).split('-W')[1]) : '';
      var range = '';
      if (w.weekStart) {
        var mon = getMondayFromWeekVal(String(w.weekStart).split(':')[0]);
        range = fmtDate(mon) + '.–' + fmtDate(new Date(mon.getTime() + 6 * 86400000)) + '.';
      }
      return '<div class="ui-row" onclick="loadWeek(\'' + jsAttrArg(hKey) + '\')">' +
        '<div class="stunden-kw"><span>KW</span><b>' + kw + '</b></div>' +
        '<div class="ui-row-main"><div class="ui-row-title">' + escapeHtml(range || w.weekLabel || '') + '</div>' +
          '<div class="ui-sub">' + escapeHtml(w.name || '') + (w.abt ? ' <span class="ui-pill ui-pill-info">' + escapeHtml(w.abt) + '</span>' : '') + '</div>' +
          (w.unsynced ? '<span class="ui-pill ui-pill-warn" style="margin-top:4px;">nicht synchronisiert</span>' : '') + '</div>' +
        '<div class="ui-row-end"><div><b class="stunden-h">' + escapeHtml(String(w.total || '0').replace('.', ',')) + ' h</b>' +
          (earnW ? '<div class="ui-sub">' + earnW + '</div>' : '') + '</div>' +
          '<button type="button" class="ui-icon-btn" aria-label="Woche-Aktionen" onclick="event.stopPropagation();historyWeekMenu(\'' + jsAttrArg(hKey) + '\')">' + uiIcon('dots') + '</button></div>' +
        '</div>';
    }).join('') + '</div>';
  });
  list.innerHTML = html;
}

function renderHistoryChart() {
  var ctx = document.getElementById('historyChart'); if (!ctx) return;
  var all = loadStore();
  // Aggregate hours per base week key (merges "2026-W12:AL" + "2026-W12:MA" into "2026-W12")
  var weekTotals = {};
  Object.keys(all).forEach(function(k) {
    var baseKey = k.split(':')[0]; // "2026-W12:AL" → "2026-W12"
    var hrs = parseFloat((all[k].total || '0').replace(',', '.'));
    weekTotals[baseKey] = (weekTotals[baseKey] || 0) + hrs;
  });
  var keys = Object.keys(weekTotals).sort().slice(-10);
  var labels = keys.map(function(k) { return 'KW ' + parseInt(k.split('-W')[1]); });
  var data = keys.map(function(k) { return weekTotals[k]; });
  if (historyChart) historyChart.destroy();
  // Colours from the theme tokens so the chart follows light/dark
  var css = getComputedStyle(document.documentElement);
  var accent = (css.getPropertyValue('--accent') || '#185FA5').trim(), muted = (css.getPropertyValue('--text2') || '#888').trim();
  historyChart = new Chart(ctx, {
    type: 'bar', data: { labels: labels, datasets: [{ label: 'Wochenstunden', data: data, backgroundColor: accent, borderRadius: 6, maxBarThickness: 28 }] },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(128,128,128,0.15)' }, ticks: { color: muted } }, x: { grid: { display: false }, ticks: { color: muted } } },
      plugins: { legend: { display: false } } }
  });
}

function historyMonthMenu(mKey) {
  openUiMenu([{ label: 'Monat als PDF exportieren', action: 'exportMonthlyPDF', args: [mKey] }]);
}

function historyWeekMenu(key) {
  openUiMenu([{ label: 'Woche öffnen', action: 'loadWeek', args: [key] }, { label: 'Woche löschen', action: 'deleteWeekFromMenu', args: [key], danger: true }]);
}

// The old delete expects a click event (stopPropagation); the menu has none
function deleteWeekFromMenu(key) {
  deleteWeek({ stopPropagation: function () {} }, key);
}

// ── WEEK STORAGE HELPERS ──
// localStorage 'stundenzettel' holds one entry per week ("2026-W44") or, for
// weeks with several departments, one per department ("2026-W44:AL frei").

// Full department name in the key: the first word alone made "AL fest" and "AL frei" collide
function weekPartKey(weekStart, dept) {
  return weekStart + ':' + dept;
}

// Removes the plain entry and every department part of a week; returns the removed entries
function removeWeekEntries(all, weekStart) {
  var removed = [];
  Object.keys(all).forEach(function (k) {
    if (k === weekStart || k.indexOf(weekStart + ':') === 0) { removed.push(all[k]); delete all[k]; }
  });
  return removed;
}

// The entries a week is stored as: { key: entry }
function buildWeekEntries(w) {
  var out = {};
  var pages = splitWeekByDepts(w);
  if (pages.length <= 1) { out[w.weekStart] = w; return out; }
  pages.forEach(function (page) {
    var k = weekPartKey(w.weekStart, page.abt);
    out[k] = Object.assign({}, page, { histKey: k });
  });
  return out;
}

// All stored parts of a week combined into one week (for editing); a single entry is returned as is
function mergeWeekParts(all, weekStart) {
  var keys = Object.keys(all).filter(function (k) { return k === weekStart || k.indexOf(weekStart + ':') === 0; }).sort();
  if (!keys.length) return null;
  if (keys.length === 1) return all[keys[0]];
  var base = all[keys[0]];
  var days = (base.days || []).map(function (dd) { return { day: dd.day, date: dd.date, isoDate: dd.isoDate, shifts: [] }; });
  keys.forEach(function (k) {
    var part = all[k];
    (part.days || []).forEach(function (dd, i) {
      if (!days[i]) days[i] = { day: dd.day, date: dd.date, isoDate: dd.isoDate, shifts: [] };
      (dd.shifts || []).forEach(function (s) {
        var shift = Object.assign({}, s, { dept: s.dept || part.abt });
        // An old plain week key can sit next to its department keys with the same shifts (pre-fix double count):
        // keep one copy (the signed one), or the next save would write the duplicates to the server
        var dupKey = [shift.von, shift.bis, shift.pause, shift.dept].join('|');
        var j = days[i].shifts.findIndex(function (x) { return [x.von, x.bis, x.pause, x.dept].join('|') === dupKey; });
        if (j === -1) days[i].shifts.push(shift);
        else if (!days[i].shifts[j].sig && shift.sig) days[i].shifts[j] = shift;
      });
    });
  });
  var merged = Object.assign({}, base, { days: days });
  delete merged.histKey;
  return merged;
}

// True while a local save of this week has not reached the server yet
function weekHasUnsynced(all, weekStart) {
  return Object.keys(all).some(function (k) {
    return (k === weekStart || k.indexOf(weekStart + ':') === 0) && all[k] && all[k].unsynced;
  });
}

// Week keys (without the ':dept' part) that still have a local save waiting for the server
function unsyncedWeekKeys(all) {
  var out = [];
  Object.keys(all).forEach(function (k) {
    if (!all[k] || !all[k].unsynced) return;
    var wk = k.split(':')[0];
    if (out.indexOf(wk) === -1) out.push(wk);
  });
  return out.sort();
}

// Clears the flag after a successful sync — only on entries of that exact save (a newer save keeps its flag)
function clearUnsyncedFlag(all, weekStart, saved) {
  var changed = false;
  Object.keys(all).forEach(function (k) {
    if ((k === weekStart || k.indexOf(weekStart + ':') === 0) && all[k] && all[k].unsynced && all[k].saved === saved) {
      delete all[k].unsynced;
      changed = true;
    }
  });
  return changed;
}

// What a week save changes on the server. existing = manual shifts of the user in that week
// (DB rows), desired = rows to insert built from the local week.
// - Shifts not 'offen' (accounting set them to 'eingetragen') are never deleted, and a desired
//   shift on the same date/time is not inserted again.
// - 'offen' shifts identical to a desired one stay untouched; the other 'offen' ones are deleted.
function planWeekSync(existing, desired) {
  var hm = function (t) { return (t || '').substring(0, 5); };
  var slot = function (r) { return r.shift_date + '|' + hm(r.start_time) + '|' + hm(r.end_time); };
  var full = function (r) { return slot(r) + '|' + (r.position_role || '') + '|' + (parseInt(r.pause_mins) || 0) + '|' + (r.ort || ''); };
  var booked = {}, open = {};
  existing.forEach(function (r) {
    if (r.status === 'offen') (open[full(r)] = open[full(r)] || []).push(r.id);
    else booked[slot(r)] = (booked[slot(r)] || 0) + 1;
  });
  var insert = [];
  desired.forEach(function (d) {
    if (booked[slot(d)]) { booked[slot(d)]--; return; }
    if (open[full(d)] && open[full(d)].length) { open[full(d)].shift(); return; }
    insert.push(d);
  });
  var deleteIds = [];
  Object.keys(open).forEach(function (k) { deleteIds = deleteIds.concat(open[k]); });
  return { deleteIds: deleteIds, insert: insert };
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

async function saveWeek() {
  if (!szStoreKey()) { showToast('Bitte zuerst anmelden'); return; }
  var d = collectData(); if (!d.name) { showToast('Bitte Namen eingeben'); return; }

  // A save replaces the week on the server (deletes open shifts that are not in the form) — so the server state of
  // the week must have been seen first. Never delete what the user never saw.
  var blind = false;
  if (typeof supabaseClient !== 'undefined' && _serverSeenFor !== currentUser.id) {
    if (navigator.onLine !== false) await fetchSupabaseShifts();
    if (_serverSeenFor === currentUser.id) {
      d = collectData(); // the sync may have refreshed an untouched editor
      var stored = loadStore();
      if (!weekHasUnsynced(stored, d.weekStart)) {
        var sw = mergeWeekParts(stored, d.weekStart);
        var m = sw ? mergeUnseenShifts(d, sw) : { added: 0 };
        if (m.added > 0) {
          resetEditorState(m.week);
          renderEditorFromState();
          _editorBaseline = ''; // merged but not saved yet → counts as changed
          showToast('Für diese Woche gab es schon Einträge auf dem Server – bitte prüfen und erneut speichern');
          return;
        }
      }
    } else {
      blind = true; // offline / server unreachable: save locally, merge with the server later
    }
  }
  var all = loadStore();

  // The saved week replaces ALL stored parts of that week (plain key and every
  // dept part) — otherwise an old split/unsplit entry stays and totals double-count.
  // Mixed weeks get one history entry per dept. 'unsynced' stays until the server has it.
  removeWeekEntries(all, d.weekStart);
  Object.assign(all, buildWeekEntries(Object.assign({}, d, blind ? { unsynced: true, blind: true } : { unsynced: true })));
  saveStore(all);
  markEditorClean();
  if (blind) { showToast('💾 Woche lokal gespeichert – wird beim nächsten Online-Abgleich mit dem Server zusammengeführt'); return; }
  showToast('💾 Woche gespeichert!');

  // ── PUSH TO SUPABASE (Async) ──
  syncWeekToSupabase(d);
}

function isoWeekToDate(weekStr, dayIdx) {
  // weekStr = "YYYY-Www", dayIdx 0=Mon ... 6=Sun
  // Uses getMondayFromWeekVal (local time) to avoid UTC timezone offset shifting dates by 1 day
  var mon = getMondayFromWeekVal(weekStr);
  var d = new Date(mon.getTime() + dayIdx * 86400000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// Runs fn after everything queued before it under the same key (never two syncs of one week at once)
function runSerial(chains, key, fn) {
  var c = chains[key] || (chains[key] = { p: Promise.resolve(), n: 0 });
  c.n++;
  var run = c.p.then(fn);
  c.p = run.then(function () { c.n--; }, function () { c.n--; });
  return run;
}

function serialBusy(chains, key) {
  return !!(chains[key] && chains[key].n > 0);
}

var _weekSyncChains = {};

// quiet = background retry: no toasts (the user did not ask for it)
function syncWeekToSupabase(data, quiet) {
  return runSerial(_weekSyncChains, data.weekStart, function () { return syncWeekNow(data, quiet); });
}

async function syncWeekNow(data, quiet) {
  if (typeof supabaseClient === 'undefined' || !currentUser) return;

  try {
    // Calculate the date range for this week (Mon–Sun), using local dates
    var weekStart = isoWeekToDate(data.weekStart, 0);
    var weekEnd   = isoWeekToDate(data.weekStart, 6);

    // Build the fresh shift list — skip shifts that came from a protocol (isSynced)
    // Those already live in Supabase under their protocol_id; re-inserting them causes duplicates
    var shiftsToSync = [];
    data.days.forEach(function(dd, dayIdx) {
      dd.shifts.forEach(function(sh) {
        if (!sh.von || !sh.bis) return;
        if (sh.isProtocol) return; // already exists as a protocol-linked shift — do not duplicate
        shiftsToSync.push({
          user_id:       currentUser.id,
          start_time:    sh.von,
          end_time:      sh.bis,
          pause_mins:    parseInt(sh.pause) || 0,
          position_role: sh.dept || data.abt,
          status:        'offen',
          temp_worker_name: null,
          shift_date:    isoWeekToDate(data.weekStart, dayIdx),
          ort:           sh.ort || null
        });
      });
    });

    // Existing manual (non-protocol) shifts of this user in exactly this week (Mon–Sun)
    var ex = await supabaseClient
      .from('shifts')
      .select('id, shift_date, start_time, end_time, status, position_role, pause_mins, ort')
      .eq('user_id', currentUser.id)
      .is('protocol_id', null)
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEnd);
    if (ex.error) throw ex.error;

    // Shifts accounting already marked 'eingetragen' are left alone (see planWeekSync)
    var plan = planWeekSync(ex.data || [], shiftsToSync);

    if (plan.deleteIds.length > 0) {
      var del = await supabaseClient.from('shifts').delete()
        .in('id', plan.deleteIds).eq('status', 'offen').select('id');
      if (del.error) throw del.error;
      // RLS returns 0 rows without an error — inserting anyway would create duplicates
      var delCount = (del.data || []).length;
      if (delCount !== plan.deleteIds.length) throw new Error('shifts delete: ' + delCount + ' of ' + plan.deleteIds.length + ' rows');
    }

    if (plan.insert.length > 0) {
      var ins = await supabaseClient.from('shifts').insert(plan.insert).select('id');
      if (ins.error) throw ins.error;
      var insCount = (ins.data || []).length;
      if (insCount !== plan.insert.length) throw new Error('shifts insert: ' + insCount + ' of ' + plan.insert.length + ' rows');
    }

    // Only now the server has this save → clear the flag (re-read: storage may have changed meanwhile)
    var allNow = loadStore();
    if (clearUnsyncedFlag(allNow, data.weekStart, data.saved)) {
      saveStore(allNow);
    }

    if (!quiet) showToast('✅ Stundenzettel mit Server synchronisiert!');
  } catch(e) {
    // The local week keeps its 'unsynced' flag → the history sync won't overwrite it; it is retried in the background
    console.error("Week Sync Error:", e);
    if (!quiet) showToast('Server-Sync fehlgeschlagen – Woche ist nur lokal gespeichert und wird später erneut übertragen.');
  }
}

// Server ids of the open, manual shifts a deleted history card stands for (role null = every role).
// Protocol shifts and anything accounting already booked ('eingetragen') are never touched.
function planWeekDelete(existing, role) {
  return (existing || []).filter(function (r) {
    return r.status === 'offen' && (role === null || r.position_role === role);
  }).map(function (r) { return r.id; });
}

// Removes every stored week part that has nothing waiting for the server (weeks with an unsynced part stay)
function dropSyncedWeeks(all) {
  var changed = false;
  Object.keys(all).forEach(function (k) {
    if (!weekHasUnsynced(all, k.split(':')[0])) { delete all[k]; changed = true; }
  });
  return changed;
}

function loadWeek(key) {
  var all = loadStore(), clicked = all[key]; if (!clicked) return;
  if (editorIsDirty() && !confirm('Du hast ungespeicherte Eingaben. Beim Laden dieser Woche gehen sie verloren. Trotzdem laden?')) return;
  // Edit the whole week (all dept parts): saving replaces every part locally and on the server,
  // so loading only the clicked part would drop the other departments' shifts
  var w = mergeWeekParts(all, clicked.weekStart) || clicked;
  document.getElementById('inp-name').value = w.name;
  document.getElementById('inp-week').value = w.weekStart;
  selectedAbt = clicked.abt;
  resetEditorState(w, clicked.abt || selectedAbt);
  renderEditorFromState();
  navigate('home');
  showToast('Backup geladen!');
}

// Deletes the card locally AND its open manual shifts on the server — otherwise the next history sync
// rebuilds the week from the server and it stays billed
async function deleteWeek(e, k) {
  e.stopPropagation();
  if (!confirm('Woche löschen?')) return;
  var all = loadStore(), entry = all[k];
  if (!entry) return;
  if (typeof supabaseClient !== 'undefined' && currentUser) {
    var ws = entry.weekStart || k.split(':')[0];
    // A plain key next to dept parts only stands for its own department
    var hasParts = Object.keys(all).some(function (x) { return x !== k && x.indexOf(ws + ':') === 0; });
    var role = (k === ws && !hasParts) ? null : (entry.abt || null);
    var failed = await runSerial(_weekSyncChains, ws, async function () {
      try {
        var ex = await supabaseClient.from('shifts').select('id, status, position_role')
          .eq('user_id', currentUser.id).is('protocol_id', null)
          .gte('shift_date', isoWeekToDate(ws, 0)).lte('shift_date', isoWeekToDate(ws, 6));
        if (ex.error) throw ex.error;
        var ids = planWeekDelete(ex.data || [], role);
        if (ids.length) {
          var del = await supabaseClient.from('shifts').delete().in('id', ids).eq('status', 'offen').select('id');
          if (del.error) throw del.error;
          var n = (del.data || []).length;
          if (n !== ids.length) throw new Error('shifts delete: ' + n + ' of ' + ids.length + ' rows');
        }
        return false;
      } catch (err) { console.error('Woche löschen (Server):', err); return true; }
    });
    if (failed) { showToast('Löschen auf dem Server fehlgeschlagen – Woche bleibt erhalten.'); return; }
  }
  all = loadStore(); delete all[k]; saveStore(all);
  renderHistory(); showToast('Gelöscht');
}

// ── SIGNATURE LAZY-LOADER ──
// Fetches signature_text only for the protocol IDs present in the given week data array.
// Populates sh.sig on each shift in-place. Call this before compressing/rendering PDFs.
async function fetchSignaturesForWeeks(weekDataArray) {
  if (typeof supabaseClient === 'undefined' || !currentUser) return;
  try {
    var ids = [];
    weekDataArray.forEach(function(w) {
      w.days.forEach(function(dd) {
        dd.shifts.forEach(function(sh) {
          if (sh.protocolId && ids.indexOf(sh.protocolId) === -1) ids.push(sh.protocolId);
        });
      });
    });
    if (!ids.length) return;
    var { data } = await supabaseClient.from('protocols').select('id, signature_text').in('id', ids);
    if (!data) return;
    var sigMap = {};
    data.forEach(function(r) { if (r.signature_text) sigMap[r.id] = r.signature_text; });
    weekDataArray.forEach(function(w) {
      w.days.forEach(function(dd) {
        dd.shifts.forEach(function(sh) { if (sh.protocolId && sigMap[sh.protocolId]) sh.sig = sigMap[sh.protocolId]; });
      });
    });
  } catch(e) { console.warn('fetchSignaturesForWeeks failed:', e); }
}

// ── PDF HELPERS ──

// Returns array of dept-filtered week copies. If only one dept, returns [w] unchanged.
function splitWeekByDepts(w) {
  var depts = [];
  (w.days || []).forEach(function(dd) {
    (dd.shifts || []).forEach(function(sh) {
      if (sh.von && sh.bis) {
        var d = sh.dept || w.abt;
        if (depts.indexOf(d) === -1) depts.push(d);
      }
    });
  });
  if (depts.length <= 1) return [w];
  return depts.map(function(dept) {
    var filteredDays = w.days.map(function(dd) {
      return { day: dd.day, date: dd.date, isoDate: dd.isoDate,
        shifts: (dd.shifts || []).filter(function(sh) { return (sh.dept || w.abt) === dept && sh.von && sh.bis; }) };
    });
    var deptMins = 0;
    filteredDays.forEach(function(dd) {
      dd.shifts.forEach(function(sh) {
        var v = timeToMins(sh.von), b = timeToMins(sh.bis), p = parseInt(sh.pause) || 0;
        var effB = (b < v) ? b + 1440 : b;
        if (v !== null && b !== null && effB > v) deptMins += Math.max(180, effB - v - p);
      });
    });
    var deptTotal = deptMins / 60;
    return Object.assign({}, w, { abt: dept, days: filteredDays, total: deptTotal % 1 === 0 ? deptTotal.toFixed(0) : deptTotal.toFixed(2) });
  });
}

// ── PDF ──
// Downloads the current week as PDF (one page per department). Pure download —
// saving/syncing happens only via the Speichern button.
async function downloadWeekPDF() {
  var data = collectData(); if (!data.name) { showToast('Bitte Namen eingeben'); return; }
  await fetchSignaturesForWeeks([data]);
  var sigP = [];
  data.days.forEach(function (dd) { dd.shifts.forEach(function (sh) { if (sh.sig) sigP.push(new Promise(function (res) { compressSignature(sh.sig, function (c) { sh.sig = c; res(); }); })); }); });
  await Promise.all(sigP);
  var doc = new jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' }), ml = 20, cw = 170;
  splitWeekByDepts(data).forEach(function (pageData, i) {
    if (i > 0) doc.addPage();
    drawPDFContent(doc, pageData, ml, cw);
  });
  var fileName = 'stundennachweis_' + data.weekStart + '_' + data.name.replace(/\s+/g, '_') + '.pdf';
  doc.save(fileName);
  showToast('📄 PDF heruntergeladen!');
}

// Backwards-compat alias (old button name)
var sendToBuchhaltung = downloadWeekPDF;

async function exportMonthlyPDF(mKey) {
  var all = loadStore();
  var ks = Object.keys(all).sort();
  var monthW = [], mLab = monthLabelFromKey(mKey), mTot = 0, name = '';
  ks.forEach(function (k) {
    var w = all[k];
    // Keep only the days of THIS billing period (a week crossing the cutoff
    // contributes its remaining days to the neighbouring month's export)
    var anyDate = false;
    var fDays = (w.days || []).map(function (dd) {
      var d = parseDayDate(dd);
      if (d) anyDate = true;
      var inPeriod = d && getBillingKeyForDate(d, billingCutoff).key === mKey;
      return { day: dd.day, date: dd.date, isoDate: dd.isoDate, shifts: inPeriod ? (dd.shifts || [dd]) : [] };
    });
    if (!anyDate) {
      // Legacy week without parseable dates — fall back to whole-week bucketing
      if (getMonthKeyFromWeek(w.weekStart, billingCutoff).key !== mKey) return;
      monthW.push(Object.assign({}, w));
      mTot += parseFloat((w.total || '0').replace(',', '.')) || 0;
      if (!name) name = w.name;
      return;
    }
    var hours = 0;
    fDays.forEach(function (dd) { dd.shifts.forEach(function (sh) { hours += shiftNetHours(sh); }); });
    if (hours <= 0) return;
    monthW.push(Object.assign({}, w, { days: fDays, total: hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(2) }));
    mTot += hours;
    if (!name) name = w.name;
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
  doc.setFont('helvetica', 'normal'); doc.text('Zeitraum:', ml, 56); doc.setFont('helvetica', 'bold'); doc.text(getBillingPeriodLabel(mKey, billingCutoff), ml + 25, 56);
  doc.setFont('helvetica', 'normal'); doc.text('Name:', ml, 64); doc.setFont('helvetica', 'bold'); doc.text(name || '—', ml + 25, 64);
  // Table with Abteilung column (cols: KW=35 | Zeitraum=65 | Abteilung=50 | Stunden=20)
  var colKW = ml, colZR = ml + 37, colAbt = ml + 105, colSt = ml + 155;
  var y = 80;
  doc.setFillColor(30, 30, 28); doc.rect(ml, y, cw, 10, 'F'); doc.setTextColor(255); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('Kalenderwoche', colKW + 3, y + 6.5);
  doc.text('Zeitraum', colZR, y + 6.5);
  doc.text('Abteilung', colAbt, y + 6.5);
  doc.text('Stunden', colSt, y + 6.5);
  doc.setTextColor(0); y += 10;
  var rowIdx = 0;
  monthW.forEach(function (w) {
    var pages = splitWeekByDepts(w);
    pages.forEach(function (pw, pi) {
      if (rowIdx % 2 === 0) { doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 10, 'F'); }
      doc.setFont('helvetica', 'bold');
      if (pi === 0) doc.text('KW ' + parseInt(w.weekStart.split('-W')[1]), colKW + 3, y + 6.5);
      doc.setFont('helvetica', 'normal');
      if (pi === 0) { var rangeLabel = (w.weekLabel || '').split('·'); doc.text((rangeLabel[1] || rangeLabel[0] || '').trim(), colZR, y + 6.5); }
      doc.text(pw.abt || '—', colAbt, y + 6.5);
      doc.setFont('helvetica', 'bold'); doc.text(pw.total + ' h', colSt, y + 6.5);
      doc.setDrawColor(220); doc.line(ml, y + 10, ml + cw, y + 10);
      y += 10; rowIdx++;
    });
  });
  y += 10; doc.setFontSize(14); doc.text('Gesamtstunden:', ml, y);
  doc.setTextColor(24, 95, 165); doc.text((mTot % 1 === 0 ? mTot.toFixed(0) : mTot.toFixed(2)) + ' h', ml + 50, y); doc.setTextColor(0);
  // Lazy-fetch signatures (removed from regular shift query to save egress), then compress
  await fetchSignaturesForWeeks(monthW);
  var sigComprP = [];
  monthW.forEach(function(w) {
    w.days.forEach(function(dd) {
      (dd.shifts || []).forEach(function(sh) {
        if (sh.sig) sigComprP.push(new Promise(function(res) {
          compressSignature(sh.sig, function(c) { sh.sig = c; res(); });
        }));
      });
    });
  });
  await Promise.all(sigComprP);
  monthW.forEach(function (w) { splitWeekByDepts(w).forEach(function (data) { doc.addPage(); drawPDFContent(doc, data, ml, cw); }); });
  var fN = 'stundennachweis_' + mKey.replace('-', '_') + '_' + (name || 'Mitarbeiter').replace(/\s+/g, '_') + '.pdf';
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
  // cols: Tag/Datum | Einsatzort | Abteilung | Von–Bis | Pause | Std | Name AL | Unterschrift AL
  var y = 56, cols = [32, 28, 18, 22, 11, 9, 14, 36], hd = ['Tag / Datum', 'Einsatzort', 'Abteilung', 'Von–Bis', 'Pause', 'Std', 'Name AL', 'Unterschrift AL'];
  var DAY_ABBR = {'Montag':'Mo','Dienstag':'Di','Mittwoch':'Mi','Donnerstag':'Do','Freitag':'Fr','Samstag':'Sa','Sonntag':'So'};
  doc.setFillColor(30, 30, 28); doc.rect(ml, y, cw, 8, 'F'); doc.setTextColor(255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  var cx = ml + 2; hd.forEach(function (h, i) { doc.text(h, cx, y + 5.5); cx += cols[i]; });
  doc.setTextColor(0); y += 8;
  data.days.forEach(function (dd, idx) {
    // legacy entries stored the shift inline on the day object instead of a shifts array
    var actS = (dd.shifts || [dd]).filter(function (sh) { return sh.von && sh.bis; }); if (!actS.length) return;
    var dRows = actS.length;
    if (y + dRows * 10 > 268) { doc.addPage(); y = 20; doc.setFillColor(30, 30, 28); doc.rect(ml, y, cw, 8, 'F'); doc.setTextColor(255); doc.setFontSize(8); doc.setFont('helvetica', 'bold'); var hcx = ml + 2; hd.forEach(function (h, i) { doc.text(h, hcx, y + 5.5); hcx += cols[i]; }); doc.setTextColor(0); y += 8; }
    for (var r = 0; r < dRows; r++) {
      if (idx % 2 === 0) { doc.setFillColor(248, 248, 246); doc.rect(ml, y, cw, 10, 'F'); }
      cx = ml + 2;
      if (r === 0) { doc.setFont('helvetica', 'bold'); doc.text((DAY_ABBR[dd.day] || dd.day.substring(0,2)) + ' ' + dd.date, cx, y + 5.5); }
      cx += cols[0]; doc.setFont('helvetica', 'normal');
      doc.text(truncatePdf(doc, actS[r].ort || '', cols[1] - 2), cx, y + 5.5); cx += cols[1];
      var deptShort = (actS[r].dept || '').split('(')[0].trim();
      var deptDisp = typeof deptLabel === 'function' ? deptLabel(deptShort) : deptShort;
      doc.text(truncatePdf(doc, deptDisp, cols[2] - 2), cx, y + 5.5); cx += cols[2];
      doc.text(actS[r].von + '–' + actS[r].bis, cx, y + 5.5); cx += cols[3];
      doc.text(parseInt(actS[r].pause) > 0 ? actS[r].pause + 'm' : '—', cx, y + 5.5); cx += cols[4];
      var sv = timeToMins(actS[r].von), sb = timeToMins(actS[r].bis), sp = parseInt(actS[r].pause) || 0;
      var seffB = (sb < sv) ? sb + 1440 : sb;
      var shNet = (sv !== null && sb !== null && seffB > sv) ? Math.max(3, (seffB - sv - sp) / 60) : 0;
      var shStr = shNet % 1 === 0 ? shNet.toFixed(0) : shNet.toFixed(2);
      doc.setFont('helvetica', 'bold'); doc.text(shNet > 0 ? shStr + 'h' : '—', cx, y + 5.5);
      cx += cols[5]; doc.setFont('helvetica', 'normal');
      doc.text(truncatePdf(doc, actS[r].al || '', cols[6] - 2), cx, y + 5.5); cx += cols[6];
      if (actS[r].sig) { try { doc.addImage(actS[r].sig, 'JPEG', cx, y + 1, cols[7] - 2, 8); } catch (e) { } }
      doc.setDrawColor(220); doc.line(ml, y + 10, ml + cw, y + 10); y += 10;
    }
  });
  y += 8; doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Gesamtstunden:', ml, y); doc.setTextColor(24, 95, 165); doc.text(data.total + ' h', ml + 38, y);
  doc.setTextColor(0);
  var rateC = window.currentUserRateConni || 0;
  if (rateC > 0 && parseFloat(data.total) > 0) {
    var earnings = (parseFloat(data.total) * rateC).toFixed(2).replace('.', ',');
    y += 7; doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Stundensatz:', ml, y); doc.setFont('helvetica', 'bold'); doc.text(rateC.toFixed(2).replace('.', ',') + ' €/h', ml + 28, y);
    doc.text('Verdienst:', ml + 70, y); doc.setTextColor(24, 95, 165); doc.text(earnings + ' €', ml + 93, y); doc.setTextColor(0);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
  doc.text('Es werden nur Stunden angerechnet, die auf diesem Nachweis eingetragen und vom AL abgezeichnet sind.', ml, 285);
  doc.text('Einzureichen bis zum ' + billingCutoff + '. Tag eines Monats.', ml, 290);
}
