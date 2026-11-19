/**
 * Mitarbeiter pflegen, Verdienstgrenzen und unter 18 (Spec of 18.11.2026).
 * A: everyone but Fest without a shift for months (setting, 2) → list „Lange kein Einsatz“ (Admin decides: inaktiv / behalten), no push.
 * B: free-text names from protocols → „Unbekannte Namen“ (zuordnen, neu anlegen, Fremdkraft), remembered spellings.
 * C: default Verdienstgrenze from the Art der Anstellung (settings), own limit wins.
 * D: own Profilbild (voluntary, consent), shown instead of initials; one hint after login, then a dot.
 * E: Haken „unter 18“ (staff_minors + birthday; the server ends it on the 18th birthday): always Minijob, no „Ich kann“ /
 *    Annehmen on night work, breaks per JArbSchG, warning in the protocol, Admin box for late, long or 40+ h weeks.
 * F: share of the limit next to Meldungen (server: income_shares, no euros), „wenig gearbeitet zuerst“.
 * Pure helpers are exported for tests/mitarbeiter.test.js.
 */

var MIT_AGENCY_ROLES = ['Zenjob', 'Rockit'];

function mitEsc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function mitDe(iso) { return iso ? iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : ''; }
function mitIsAdmin() { return typeof userRole !== 'undefined' && userRole === 'Admin'; }

// ── C: Verdienstgrenze ──
function mitType(row) { return row.employment_type || (row.is_fest ? 'Fest' : 'Minijob'); }

// Default limit for the person's Art der Anstellung; null for Rechnung/Fest or a row without the type columns
function mitDefaultLimit(row, settings) {
  if (!row || (!('employment_type' in row) && !('is_fest' in row))) return null;
  var get = function(k) { return settings ? settings[k] : (typeof appSetting === 'function' ? appSetting(k) : null); };
  var t = mitType(row), v = t === 'Minijob' ? get('income_limit_minijob') : t === 'Midijob' ? get('income_limit_midijob') : null;
  return typeof v === 'number' && v > 0 ? v : null;
}

// ── A: Lange kein Einsatz ──
// ISO date `months` before (negative: after) the given day; the day is clamped to the target month's length
function mitAddMonths(iso, months) {
  var p = iso.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 - months, 1));
  var last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(p[2], last));
  return d.toISOString().slice(0, 10);
}

function mitShiftDate(s) { return s.shift_date || (s.protocols && s.protocols.date) || (s.created_at || '').slice(0, 10); }

// Newest day each person worked or was planned (shifts and Wochenplan rows {user_id, date}), up to today
function mitLastActivity(shifts, planRows, today) {
  var last = {};
  var see = function(uid, d) { if (uid && d && d <= today && (!last[uid] || d > last[uid])) last[uid] = d; };
  (shifts || []).forEach(function(s) { see(s.user_id, mitShiftDate(s)); });
  (planRows || []).forEach(function(r) { see(r.user_id, r.date); });
  return last;
}

// Active people paid per Einsatz (every type but Fest, never Gast) whose last activity, or creation day if they never
// worked, lies before today − months. „Behalten“ (keep_until in the future) keeps someone off the list. Longest ago first.
function mitInactiveWorkers(workers, last, today, months) {
  var limit = mitAddMonths(today, months);
  return (workers || []).filter(function(w) {
    return w.is_active !== false && w.role !== 'Gast' && mitType(w) !== 'Fest' && !(w.keep_until && w.keep_until >= today);
  }).map(function(w) {
    var l = last[w.id] || null;
    return { id: w.id, name: w.full_name || 'Unbekannt', last: l, since: l || (w.created_at || '').slice(0, 10) || null };
  }).filter(function(r) { return r.since && r.since < limit; })
    .sort(function(a, b) { return a.since.localeCompare(b.since) || a.name.localeCompare(b.name, 'de'); });
}

// ── B: Unbekannte Namen ──
// Same key as the server (lower(btrim(name)))
function mitNameKey(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function mitNoSurname(w) { return String(w.full_name || '').trim().split(/\s+/).filter(Boolean).length < 2; }

function mitTimeMins(t) {
  var m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function mitNetMins(s) {
  var a = mitTimeMins(s.start_time), b = mitTimeMins(s.end_time);
  if (a === null || b === null) return 0;
  if (b <= a) b += 1440;
  return Math.max(0, b - a - (s.pause_mins || 0));
}

// Free-text shifts (not Zenjob/Rockit, not marked Fremdkraft) grouped by name, most shifts first.
// Group: { key, name, shifts, mins, booked, protocols: ['12.11.2026 Projekt'], als: [] }
function mitUnknownNames(shifts, aliases) {
  var foreign = {}, by = {};
  (aliases || []).forEach(function(a) { if (!a.user_id) foreign[a.alias] = true; });
  (shifts || []).forEach(function(s) {
    if (s.user_id || !s.temp_worker_name || MIT_AGENCY_ROLES.indexOf(s.position_role) !== -1) return;
    var k = mitNameKey(s.temp_worker_name);
    if (!k || foreign[k]) return;
    var g = by[k] || (by[k] = { key: k, name: s.temp_worker_name.trim(), shifts: 0, mins: 0, booked: 0, protocols: {}, als: {} });
    g.shifts++;
    g.mins += mitNetMins(s);
    if (s.status === 'eingetragen') g.booked++;
    var p = s.protocols;
    if (p) {
      g.protocols[[mitDe(p.date || s.shift_date), p.projects && p.projects.name].filter(Boolean).join(' ')] = true;
      if (p.al_name_fallback) g.als[p.al_name_fallback] = true;
    } else if (s.shift_date) g.protocols[mitDe(s.shift_date)] = true;
  });
  return Object.keys(by).map(function(k) {
    var g = by[k];
    g.protocols = Object.keys(g.protocols).filter(Boolean);
    g.als = Object.keys(g.als);
    return g;
  }).sort(function(a, b) { return b.shifts - a.shifts || a.name.localeCompare(b.name, 'de'); });
}

function mitLev(a, b) {
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// People who could be meant: same full name, same first name, name contained, or a typo in the first name
function mitSuggest(name, workers, max) {
  var k = mitNameKey(name), first = k.split(/\s+/)[0];
  if (!k) return [];
  return (workers || []).filter(function(w) { return w.is_active !== false && w.role !== 'Gast' && w.full_name; }).map(function(w) {
    var f = mitNameKey(w.full_name), wf = f.split(/\s+/)[0];
    var score = f === k ? 0 : wf === first ? 1 : f.indexOf(k) !== -1 ? 2 : mitLev(wf, first) <= (first.length > 4 ? 2 : 1) ? 3 : 9;
    return { w: w, score: score };
  }).filter(function(x) { return x.score < 9; })
    .sort(function(a, b) { return a.score - b.score || a.w.full_name.localeCompare(b.w.full_name, 'de'); })
    .slice(0, max || 3).map(function(x) { return x.w; });
}

// ── E: unter 18 ──
// Times written in a text: "7:00", "7.30", "14 Uhr" → minutes, in order
function mitTextTimes(text) {
  var out = [], re = /\b(\d{1,2})(?:[:.](\d{2})|\s*Uhr)/gi, m;
  while ((m = re.exec(text || ''))) { var h = Number(m[1]); if (h < 24) out.push(h * 60 + (m[2] ? Number(m[2]) : 0)); }
  return out;
}

// True when someone under 18 may not take it: before 6 or after 20 Uhr, over midnight, a night teardown, or no time
// to tell. Without an end, up to 8 hours are assumed (start after 12 Uhr would run past 20 Uhr).
function mitNightForMinor(start, end, text) {
  if (/nacht/i.test(text || '')) return true;
  var t = mitTextTimes(text), s = start ? mitTimeMins(start) : null, e = end ? mitTimeMins(end) : null;
  if (s === null) s = t.length ? t[0] : null;
  if (e === null && !start) e = t.length > 1 ? t[1] : null;
  if (s === null) return true;
  if (s < 360) return true;
  if (e === null) return s > 720;
  if (e <= s) return true;
  return e > 1200;
}

// Rules for someone under 18 (Jenni, JArbSchG): only 6–20 Uhr, at most 8 h work a day, break 30 min over 4,5 h and
// 60 min over 6 h. → list of problems ('vor 6 Uhr', 'nach 20 Uhr', 'über 8 Std', 'Pause zu kurz'), [] = fine
function minorShiftIssues(start, end, pause) {
  var a = mitTimeMins(start), b = mitTimeMins(end), issues = [];
  if (a === null || b === null) return issues;
  if (b <= a) b += 1440;
  var p = pause || 0, net = b - a - p;
  if (a < 360) issues.push('vor 6 Uhr');
  if (b > 1200) issues.push('nach 20 Uhr');
  if (net > 480) issues.push('über 8 Std');
  if ((net > 360 && p < 60) || (net > 270 && p < 30)) issues.push('Pause zu kurz');
  return issues;
}

// Monday of the week of an ISO date
function mitWeekStart(iso) {
  var d = new Date(iso + 'T12:00:00Z'), back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

// Booked shifts of people with the tick that break a rule (minorShiftIssues), and every shift of a week (Mo–So) with
// more than 40 h. → [{ id, user_id, date, start, end, issues: [] }], newest first
function mitMinorIssues(shifts, minorIds, since) {
  var minor = {}, week = {};
  (minorIds || []).forEach(function(id) { minor[id] = true; });
  var list = (shifts || []).filter(function(s) {
    return minor[s.user_id] && mitShiftDate(s) >= since && mitTimeMins(s.start_time) !== null && mitTimeMins(s.end_time) !== null;
  });
  list.forEach(function(s) {
    var a = mitTimeMins(s.start_time), b = mitTimeMins(s.end_time), k = s.user_id + '|' + mitWeekStart(mitShiftDate(s));
    week[k] = (week[k] || 0) + (b <= a ? b + 1440 : b) - a - (s.pause_mins || 0);
  });
  return list.map(function(s) {
    var issues = minorShiftIssues(s.start_time, s.end_time, s.pause_mins);
    if (week[s.user_id + '|' + mitWeekStart(mitShiftDate(s))] > 2400) issues.push('Woche über 40 Std');
    return issues.length ? { id: s.id, user_id: s.user_id, date: mitShiftDate(s), start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), issues: issues } : null;
  }).filter(Boolean).sort(function(x, y) { return y.date.localeCompare(x.date); });
}

// The 18th birthday (ISO) has come by `today`
function mitIsAdult(birth, today) {
  if (!birth) return false;
  var p = birth.split('-').map(Number);
  var b18 = (p[0] + 18) + '-' + String(p[1]).padStart(2, '0') + '-' + String(p[2]).padStart(2, '0');
  return b18 <= today;
}

// ── F: Anteil der Grenze ──
function mitShareTone(pct) { return pct == null ? 'muted' : pct <= 70 ? 'ok' : pct <= 100 ? 'warn' : 'danger'; }

// r = one row of income_shares(); '' without data
function mitShareHtml(r) {
  if (!r) return '';
  var h = String(Number(r.hours) || 0).replace('.', ',') + ' Std';
  if (!r.has_limit) return '<span class="ord-pill ord-pill-muted" title="Keine Verdienstgrenze">' + h + '</span>';
  if (!r.has_rate) return '<span class="ord-pill ord-pill-muted">ohne Satz · ' + h + '</span>';
  return '<span class="ord-pill ord-pill-' + mitShareTone(r.pct) + '" title="Anteil der Verdienstgrenze in diesem Abrechnungsmonat">' + r.pct + ' % · ' + h + '</span>' +
    (r.ahead > 0 ? '<span class="ord-pill ord-pill-muted">+' + r.ahead + (r.ahead === 1 ? ' Monat' : ' Monate') + ' vorgearbeitet</span>' : '');
}

// Sort key for „wenig gearbeitet zuerst“: share, people without a limit by hours after them
function mitShareSort(r) { return !r ? 1e6 : r.pct != null ? r.pct : 1000 + (Number(r.hours) || 0); }

// Billing month now and the months before it in the same billing year (dashBillingRange in dashboard.js)
function mitBillingParams(now, cutoff) {
  var key = getBillingKeyForDate(now, cutoff).key, r = dashBillingRange(key, cutoff);
  return { from: r.from, to: r.to, yearFrom: dashBillingRange(key.slice(0, 4) + '-01', cutoff).from, past: Number(key.slice(5, 7)) - 1 };
}

// Shares and the tick for the people of the Meldungen inbox (deciders only) → { shares: {id: row}, minors: {id: true} }
async function mitLoadDeciderInfo(ids) {
  var out = { shares: {}, minors: {} };
  ids = ids.filter(function(id, i) { return id && ids.indexOf(id) === i; });
  if (!ids.length || typeof supabaseClient === 'undefined') return out;
  var bp = mitBillingParams(new Date(), typeof dashBillingCutoff === 'function' ? dashBillingCutoff() : 20);
  var res = await Promise.all([
    supabaseClient.rpc('income_shares', { p_ids: ids, p_from: bp.from, p_to: bp.to, p_year_from: bp.yearFrom, p_past_months: bp.past }),
    supabaseClient.rpc('minors_among', { p_ids: ids })
  ]);
  if (res[0].error) console.warn('Verdienst-Balken fehlt:', res[0].error); else (res[0].data || []).forEach(function(r) { out.shares[r.user_id] = r; });
  if (res[1].error) console.warn('unter 18 fehlt:', res[1].error);
  else (res[1].data || []).forEach(function(r) { out.minors[typeof r === 'string' ? r : r.minors_among || r.user_id] = true; });
  return out;
}

var MIT_LOW_FIRST_KEY = 'luebbert_meldungen_wenig_zuerst';
function mitLowFirst() { try { return localStorage.getItem(MIT_LOW_FIRST_KEY) === '1'; } catch (e) { return false; } }
function mitToggleLowFirst() {
  try { localStorage.setItem(MIT_LOW_FIRST_KEY, mitLowFirst() ? '0' : '1'); } catch (e) { /* private mode */ }
  if (typeof ordRenderList === 'function') ordRenderList();
}

// ── D: Profilbild ──
var _mitPhotos = {}, _mitPhotosAt = 0, _mitPhotosLoading = null;

// Signed URLs for everyone with a photo, at most every 50 minutes (they live 60)
function mitLoadPhotos(force) {
  if (typeof supabaseClient === 'undefined' || typeof userRole === 'undefined' || userRole === 'Gast') return Promise.resolve(_mitPhotos);
  if (!force && Date.now() - _mitPhotosAt < 50 * 60000) return Promise.resolve(_mitPhotos);
  if (_mitPhotosLoading) return _mitPhotosLoading;
  _mitPhotosLoading = (async function() {
    try {
      var r = await supabaseClient.rpc('team_photos');
      if (r.error) throw r.error;
      var rows = r.data || [], map = {};
      if (rows.length) {
        var s = await supabaseClient.storage.from('avatars').createSignedUrls(rows.map(function(x) { return x.photo_path; }), 3600);
        if (s.error) throw s.error;
        (s.data || []).forEach(function(d, i) { if (d && d.signedUrl) map[rows[i].user_id] = d.signedUrl; });
      }
      _mitPhotos = map;
      _mitPhotosAt = Date.now();
    } catch (e) {
      console.warn('Profilbilder laden:', e);
    } finally { _mitPhotosLoading = null; }
    return _mitPhotos;
  })();
  return _mitPhotosLoading;
}

// Inside an avatar circle: the photo, else the given (escaped) text
function mitAvatarInner(uid, textHtml) {
  var url = uid && _mitPhotos[uid];
  return url ? '<img class="mit-avatar-img" src="' + mitEsc(url) + '" alt="" loading="lazy">' : textHtml;
}

// Square crop from the middle, 256 × 256 JPEG
function mitResizeImage(file) {
  return new Promise(function(resolve, reject) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function() {
      var side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      c.toBlob(function(b) { b ? resolve(b) : reject(new Error('Bild konnte nicht verkleinert werden')); }, 'image/jpeg', 0.85);
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('Kein lesbares Bild')); };
    img.src = url;
  });
}

var MIT_CONSENT = 'Ich bin einverstanden, dass mein Bild in der App für Kolleginnen und Kollegen sichtbar ist. Ich kann es jederzeit löschen.';

function mitOpenPhoto() {
  if (typeof currentUser === 'undefined' || !currentUser || userRole === 'Gast') return;
  var has = !!currentUser.photo_path, url = _mitPhotos[currentUser.id];
  pinSheetOpen({ title: 'Profilbild', body:
    '<div class="mit-photo-box">' + (url ? '<img class="mit-photo-big" src="' + mitEsc(url) + '" alt="Dein Profilbild">'
      : '<div class="mit-photo-big mit-photo-empty">' + mitEsc((currentUser.full_name || '?').trim().charAt(0).toUpperCase()) + '</div>') +
    '<p class="ui-sub">Dein Bild erscheint statt der Initialen im Wochenplan und bei den Meldungen. Es ist freiwillig und nur für angemeldete Kolleginnen und Kollegen sichtbar.</p></div>' +
    (currentUser.photo_consent_at ? '' : '<label class="mit-consent"><input type="checkbox" id="mit-consent"> <span>' + mitEsc(MIT_CONSENT) + '</span></label>') +
    '<input type="file" id="mit-photo-file" accept="image/*" hidden onchange="mitUploadPhoto(this)">' +
    '<div class="ui-sheet-actions">' + (has ? '<button type="button" class="ui-btn ui-btn-danger" onclick="mitDeletePhoto()">Löschen</button>' : '') +
    '<button type="button" class="ui-btn ui-btn-primary" onclick="mitPickPhoto()">' + (has ? 'Neues Foto' : 'Foto wählen') + '</button></div>' });
}

function mitPickPhoto() {
  var c = document.getElementById('mit-consent');
  if (c && !c.checked) { showToast('Bitte zuerst die Einwilligung abhaken.', 'danger'); return; }
  document.getElementById('mit-photo-file').click();
}

var _mitUploading = false;
async function mitUploadPhoto(input) {
  var file = input.files && input.files[0];
  input.value = '';
  if (!file || _mitUploading) return;
  _mitUploading = true;
  try {
    var blob = await mitResizeImage(file), path = currentUser.id + '.jpg';
    var up = await supabaseClient.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (up.error) throw up.error;
    var r = await supabaseClient.rpc('set_my_photo', { p_on: true });
    if (r.error) throw r.error;
    currentUser.photo_path = path;
    currentUser.photo_consent_at = currentUser.photo_consent_at || new Date().toISOString();
    mitSaveOwnProfile();
    await mitLoadPhotos(true);
    mitUpdatePhotoDot();
    if (typeof closePinSheet === 'function') closePinSheet();
    showToast('Profilbild gespeichert');
  } catch (e) {
    console.error('Profilbild hochladen:', e);
    showToast('Profilbild nicht gespeichert. Prüf deine Verbindung.', 'danger');
  } finally { _mitUploading = false; }
}

async function mitDeletePhoto() {
  if (!confirm('Profilbild löschen?')) return;
  try {
    var rm = await supabaseClient.storage.from('avatars').remove([currentUser.id + '.jpg']);
    if (rm.error) throw rm.error;
    var r = await supabaseClient.rpc('set_my_photo', { p_on: false });
    if (r.error) throw r.error;
    currentUser.photo_path = null;
    currentUser.photo_consent_at = null;
    mitSaveOwnProfile();
    delete _mitPhotos[currentUser.id];
    mitUpdatePhotoDot();
    if (typeof closePinSheet === 'function') closePinSheet();
    showToast('Profilbild gelöscht');
  } catch (e) {
    console.error('Profilbild löschen:', e);
    showToast('Nicht gelöscht. Prüf deine Verbindung.', 'danger');
  }
}

// The cached own profile (auth.js) keeps the photo, so the hint does not come back offline
function mitSaveOwnProfile() {
  try {
    var key = typeof OWN_PROFILE_KEY !== 'undefined' ? OWN_PROFILE_KEY : null, c = key && JSON.parse(localStorage.getItem(key) || 'null');
    if (c && c.id === currentUser.id) { c.photo_path = currentUser.photo_path; c.photo_consent_at = currentUser.photo_consent_at; localStorage.setItem(key, JSON.stringify(c)); }
  } catch (e) { /* storage full */ }
}

function mitUpdatePhotoDot() {
  var dot = document.getElementById('opt-photo-dot');
  if (dot) dot.hidden = !(typeof currentUser !== 'undefined' && currentUser && userRole !== 'Gast' && !currentUser.photo_path);
}

// Once per person and device after login: a hint with „Hochladen“ / „Später“; afterwards only the dot in the menu
function mitMaybePhotoHint() {
  mitUpdatePhotoDot();
  if (typeof currentUser === 'undefined' || !currentUser || userRole === 'Gast' || currentUser.photo_path) return;
  var key = 'luebbert_photo_hint_' + currentUser.id;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) { return; }
  pinSheetOpen({ title: 'Profilbild', body: '<p class="ui-sub" style="margin:4px 0 14px;">Leg ein Profilbild an, damit das Team dich erkennt. Freiwillig, jederzeit änderbar oder löschbar.</p>' +
    '<div class="ui-sheet-actions"><button type="button" class="ui-btn" onclick="closePinSheet()">Später</button>' +
    '<button type="button" class="ui-btn ui-btn-primary" onclick="mitOpenPhoto()">Hochladen</button></div>' });
}

// After login: the tick for the person itself (hides „Ich kann“ on night work), photos, the hint
async function mitAfterLogin() {
  window.currentUserIsMinor = false;
  if (typeof supabaseClient === 'undefined' || userRole === 'Gast') return;
  try {
    var r = await supabaseClient.rpc('i_am_minor');
    if (!r.error) window.currentUserIsMinor = r.data === true;
  } catch (e) { /* offline: no lock, the deciders still see it */ }
  mitLoadPhotos();
  setTimeout(mitMaybePhotoHint, 1200);
}

// ── Office Dashboard (Admin): Lange kein Einsatz, Unbekannte Namen, unter 18 ──
var _mit = { idle: [], unknown: [], minorIssues: [], workers: [], months: 3, pendingName: null };

// Called by loadDashInsights with all shifts that have a person
async function mitLoadAdminBoxes(allShifts) {
  // „Lange kein Einsatz“ for everyone who manages staff; names and unter 18 only for Admin
  var manage = typeof dashMayManageStaff === 'function' && dashMayManageStaff(typeof userRole !== 'undefined' ? userRole : null);
  var show = { 'dash-idle-panel': manage, 'dash-unknown-panel': mitIsAdmin(), 'dash-minor-panel': mitIsAdmin() };
  Object.keys(show).forEach(function(id) { var el = document.getElementById(id); if (el) el.hidden = !show[id]; });
  if (!manage) return;
  var admin = mitIsAdmin(), none = Promise.resolve({ data: [] });
  var today = localDateStr(), months = appSetting('inactive_months') || 2, workers = dashboardWorkers || [];
  _mit.workers = workers;
  _mit.months = months;
  var res = await Promise.all([
    supabaseClient.from('plan_assignments').select('user_id, plan_shifts!inner(date)').not('user_id', 'is', null)
      .gte('plan_shifts.date', mitAddMonths(today, months + 1)).range(0, 4999),
    admin ? supabaseClient.from('shifts').select('id, temp_worker_name, position_role, start_time, end_time, pause_mins, status, shift_date, protocols(date, al_name_fallback, projects(name))')
      .is('user_id', null).not('temp_worker_name', 'is', null).range(0, 4999) : none,
    admin ? supabaseClient.from('worker_name_aliases').select('alias, user_id') : none,
    // under 18 for the breaks in the shift editor (Buchhaltung too) and the Admin box; the server leaves out the 18-year-olds
    loadMinorIds(workers.map(function(w) { return w.id; })).then(function() { return { data: [] }; })
  ]);
  res.forEach(function(r, i) { if (r.error) console.warn('Personal-Kästen (' + i + '):', r.error); });
  var ok = function(r) { return r.error ? [] : (r.data || []); };
  var plan = ok(res[0]).map(function(a) { return { user_id: a.user_id, date: a.plan_shifts && a.plan_shifts.date }; });
  _mit.idle = mitInactiveWorkers(workers, mitLastActivity(allShifts, plan, today), today, months);
  _mit.unknown = mitUnknownNames(ok(res[1]), ok(res[2]));
  _mit.minorIssues = admin ? mitMinorIssues(allShifts, Object.keys(minorUserIds), mitAddMonths(today, 2)) : [];
  mitRenderAdminBoxes();
}

function mitCount(n) { return '<span class="dash-count' + (n ? '' : ' dash-count-zero') + '">' + n + '</span>'; }

function mitWorkerName(id) { var w = (_mit.workers || []).find(function(x) { return x.id === id; }); return w ? w.full_name : 'Unbekannt'; }

function mitRenderAdminBoxes() {
  var el;
  if ((el = document.getElementById('dash-idle-title'))) el.innerHTML = 'Lange kein Einsatz' + mitCount(_mit.idle.length);
  if ((el = document.getElementById('dash-idle-list'))) {
    el.innerHTML = _mit.idle.length ? _mit.idle.map(function(r) {
      var when = r.last ? 'letzter Einsatz ' + mitDe(r.last) : 'noch nie im Einsatz, angelegt ' + mitDe(r.since);
      return '<div class="mit-item"><div><b>' + mitEsc(r.name) + '</b><div class="ui-sub">' + mitEsc(when) + '</div></div>' +
        '<div class="mit-acts"><button type="button" class="ui-btn dash-small-btn" onclick="mitKeep(\'' + jsAttrArg(r.id) + '\')">Behalten</button>' +
        '<button type="button" class="ui-btn dash-small-btn ui-btn-danger" onclick="mitDeactivate(\'' + jsAttrArg(r.id) + '\')">Inaktiv setzen</button></div></div>';
    }).join('') : '<div class="ui-sub" style="padding:6px 2px;">Alle (außer Festangestellte) waren in den letzten ' + _mit.months + ' Monaten im Einsatz.</div>';
  }
  if ((el = document.getElementById('dash-unknown-title'))) el.innerHTML = 'Unbekannte Namen' + mitCount(_mit.unknown.length);
  if ((el = document.getElementById('dash-unknown-list'))) {
    var active = (_mit.workers || []).filter(function(w) { return w.role !== 'Gast'; }), a = _mit.lastAssign;
    var last = a ? '<div class="mit-item"><div class="ui-sub">„' + mitEsc(a.g.name) + '“ → ' + mitEsc(mitWorkerName(a.userId)) + ' (' + a.n + (a.n === 1 ? ' Schicht' : ' Schichten') + ')</div>' +
      '<button type="button" class="ui-btn dash-small-btn" onclick="mitUndoAssign()">Rückgängig</button></div>' : '';
    el.innerHTML = last + (_mit.unknown.length ?_mit.unknown.map(function(g, i) {
      var sugg = mitSuggest(g.name, active, 3), sid = {};
      sugg.forEach(function(w) { sid[w.id] = true; });
      var opts = sugg.map(function(w) { return '<option value="' + mitEsc(w.id) + '">' + mitEsc(w.full_name) + ' (Vorschlag)</option>'; }).join('') +
        active.filter(function(w) { return !sid[w.id]; }).map(function(w) { return '<option value="' + mitEsc(w.id) + '">' + mitEsc(w.full_name) + '</option>'; }).join('');
      var hours = (g.mins / 60).toFixed(1).replace('.', ',');
      return '<div class="mit-item mit-item-col"><div><b>„' + mitEsc(g.name) + '“</b> · ' + g.shifts + (g.shifts === 1 ? ' Schicht' : ' Schichten') + ' · ' + hours + ' Std' +
          (g.als.length ? '<div class="ui-sub">eingetragen von ' + mitEsc(g.als.join(', ')) + '</div>' : '') +
          (g.protocols.length ? '<div class="ui-sub">' + mitEsc(g.protocols.slice(0, 4).join(', ') + (g.protocols.length > 4 ? ' …' : '')) + '</div>' : '') + '</div>' +
        '<div class="mit-acts"><select class="meta-input mit-pick" id="mit-pick-' + i + '" aria-label="Person für ' + mitEsc(g.name) + '">' +
          '<option value="">Person wählen …</option>' + opts + '</select>' +
          '<button type="button" class="ui-btn dash-small-btn ui-btn-primary" onclick="mitAssign(' + i + ')">Zuordnen</button>' +
          '<button type="button" class="ui-btn dash-small-btn" onclick="mitCreateFor(' + i + ')">Neu anlegen</button>' +
          '<button type="button" class="ui-btn dash-small-btn" onclick="mitForeign(' + i + ')">Ist eine Fremdkraft</button></div></div>';
    }).join('') : '<div class="ui-sub" style="padding:6px 2px;">Keine unbekannten Namen in den Protokollen.</div>');
  }
  if ((el = document.getElementById('dash-minor-title'))) el.innerHTML = 'Unter 18: Einsätze prüfen' + mitCount(_mit.minorIssues.length);
  if ((el = document.getElementById('dash-minor-list'))) {
    el.innerHTML = _mit.minorIssues.length ? _mit.minorIssues.map(function(r) {
      return dashPersonBtn(r.user_id, mitEsc(mitWorkerName(r.user_id)), mitEsc(mitDe(r.date) + ' · ' + r.start + '–' + r.end),
        '<span class="ui-pill ui-pill-danger">' + mitEsc(r.issues.join(', ')) + '</span>');
    }).join('') : '<div class="ui-sub" style="padding:6px 2px;">Keine Auffälligkeiten in den letzten 2 Monaten.</div>';
  }
}

async function mitKeep(id) {
  var until = mitAddMonths(localDateStr(), -_mit.months);
  var r = await supabaseClient.from('app_users').update({ keep_until: until }).eq('id', id).select('id');
  if (r.error || !r.data || !r.data.length) { console.error('Behalten:', r.error); showToast('Nicht gespeichert.', 'danger'); return; }
  _mit.idle = _mit.idle.filter(function(x) { return x.id !== id; });
  var w = (_mit.workers || []).find(function(x) { return x.id === id; });
  if (w) w.keep_until = until;
  mitRenderAdminBoxes();
  showToast('Behalten bis ' + mitDe(until));
}

async function mitDeactivate(id) {
  if (!confirm('„' + mitWorkerName(id) + '“ inaktiv setzen?\nDie Person kann sich nicht mehr anmelden. Alte Schichten und Protokolle bleiben. Rückgängig über „aktiv“.')) return;
  var r = await supabaseClient.from('app_users').update({ is_active: false }).eq('id', id).select('id');
  if (r.error || !r.data || !r.data.length) { console.error('Inaktiv setzen:', r.error); showToast('Nicht gespeichert.', 'danger'); return; }
  showToast('Inaktiv gesetzt');
  loadDashboardWorkers();
}

async function mitAssignTo(g, userId) {
  if (g.booked && !confirm(g.booked + (g.booked === 1 ? ' Schicht ist' : ' Schichten sind') + ' schon eingetragen (abgerechnet). Trotzdem zuordnen?')) return false;
  var r = await supabaseClient.rpc('assign_worker_name', { p_name: g.key, p_user: userId });
  if (r.error) { console.error('Zuordnen:', r.error); showToast('Nicht zugeordnet.', 'danger'); return false; }
  _mit.unknown = _mit.unknown.filter(function(x) { return x.key !== g.key; });
  _mit.lastAssign = { g: g, userId: userId, n: r.data };
  mitRenderAdminBoxes();
  showToast(r.data + (r.data === 1 ? ' Schicht zählt' : ' Schichten zählen') + ' jetzt bei ' + mitWorkerName(userId));
  return true;
}

// Undo of the last Zuordnung (shown above the list): the shifts become free text again, the name is back in the list
async function mitUndoAssign() {
  var a = _mit.lastAssign;
  if (!a) return;
  var u = await supabaseClient.rpc('unassign_worker_name', { p_name: a.g.key, p_user: a.userId });
  if (u.error) { console.error('Rückgängig:', u.error); showToast('Rückgängig fehlgeschlagen.', 'danger'); return; }
  _mit.lastAssign = null;
  _mit.unknown.unshift(a.g);
  mitRenderAdminBoxes();
  showToast('Rückgängig gemacht');
}

function mitAssign(i) {
  var g = _mit.unknown[i], sel = document.getElementById('mit-pick-' + i);
  if (!g || !sel || !sel.value) { showToast('Bitte eine Person wählen.', 'danger'); return; }
  mitAssignTo(g, sel.value);
}

// „Neu anlegen“: the add form with the name filled in; addDashboardUser calls mitAfterUserCreated
function mitCreateFor(i) {
  var g = _mit.unknown[i];
  if (!g) return;
  var parts = g.name.split(/\s+/);
  _mit.pendingName = g;
  document.getElementById('new-user-firstname').value = parts[0] || '';
  document.getElementById('new-user-lastname').value = parts.slice(1).join(' ');
  document.getElementById('new-user-role').value = 'MA';
  toggleAddUserForm();
}

async function mitAfterUserCreated(userId) {
  var g = _mit.pendingName;
  _mit.pendingName = null;
  if (g && mitIsAdmin()) await mitAssignTo(Object.assign({}, g, { booked: 0 }), userId);
}

async function mitForeign(i) {
  var g = _mit.unknown[i];
  if (!g || !confirm('„' + g.name + '“ ist eine Fremdkraft? Der Name bleibt Freitext und verschwindet aus der Liste.')) return;
  var r = await supabaseClient.from('worker_name_aliases').upsert({ alias: g.key, user_id: null }, { onConflict: 'alias' }).select('alias');
  if (r.error || !r.data || !r.data.length) { console.error('Fremdkraft:', r.error); showToast('Nicht gespeichert.', 'danger'); return; }
  _mit.unknown.splice(i, 1);
  mitRenderAdminBoxes();
}

// ── Edit sheet (Admin): Haken „unter 18“, delete someone's photo ──
var _mitMinorLoaded = null, _mitBirthLoaded = ''; // tick and birthday as loaded; null = not shown

// Tick „unter 18“: birthday field, and the person is always Minijob (the type cannot be changed while ticked)
function mitMinorToggle() {
  var box = document.getElementById('edit-worker-minor'), birth = document.getElementById('edit-worker-birth-field');
  var type = document.getElementById('edit-worker-type'), on = !!(box && box.checked && _mitMinorLoaded !== null);
  if (birth) birth.style.display = on ? '' : 'none';
  if (!type) return;
  if (on && type.value !== 'Minijob') { type.value = 'Minijob'; if (typeof dashSyncInternal === 'function') dashSyncInternal('edit'); }
  type.disabled = on;
  type.title = on ? 'Unter 18: immer Minijob' : '';
}

async function mitLoadEditExtras(worker) {
  var field = document.getElementById('edit-worker-minor-field'), box = document.getElementById('edit-worker-minor');
  var photo = document.getElementById('edit-worker-photo-btn');
  _mitMinorLoaded = null;
  if (photo) photo.style.display = mitIsAdmin() && worker.photo_path ? '' : 'none';
  if (!field || !box) return;
  field.style.display = 'none';
  box.checked = false;
  mitMinorToggle();
  if (!mitIsAdmin()) return;
  var r = await supabaseClient.from('staff_minors').select('user_id, birth_date').eq('user_id', worker.id);
  if (r.error || !dashboardCurrentWorker || dashboardCurrentWorker.id !== worker.id) return;
  var row = r.data && r.data[0];
  _mitMinorLoaded = !!row && !mitIsAdult(row.birth_date, localDateStr()); // turned 18 today, before the nightly cleanup
  _mitBirthLoaded = (row && row.birth_date) || '';
  box.checked = _mitMinorLoaded;
  var birth = document.getElementById('edit-worker-birth');
  if (birth) { birth.value = _mitBirthLoaded; birth.max = localDateStr(); }
  field.style.display = '';
  mitMinorToggle();
}

// Checked before anything is saved: a birthday that is already 18 years ago cannot go with the tick
function mitEditExtrasError() {
  var box = document.getElementById('edit-worker-minor'), birth = document.getElementById('edit-worker-birth');
  if (_mitMinorLoaded === null || !box || !box.checked || !birth || !birth.value) return null;
  return mitIsAdult(birth.value, localDateStr()) ? 'Laut Geburtstag schon 18 – Haken „unter 18“ bitte rausnehmen.' : null;
}

async function mitSaveEditExtras(workerId) {
  var box = document.getElementById('edit-worker-minor'), birthEl = document.getElementById('edit-worker-birth');
  var birth = (birthEl && birthEl.value) || null;
  if (_mitMinorLoaded === null || !box) return;
  if (box.checked === _mitMinorLoaded && (!box.checked || (birth || '') === _mitBirthLoaded)) return;
  var t = supabaseClient.from('staff_minors'), r;
  if (!box.checked) r = await t.delete().eq('user_id', workerId).select('user_id');
  else r = await t.upsert({ user_id: workerId, birth_date: birth }).select('user_id');
  if (r.error) throw r.error;
  if (!r.data || !r.data.length) throw new Error('Haken „unter 18“ nicht gespeichert – keine Berechtigung');
}

async function mitAdminDeletePhoto() {
  var w = dashboardCurrentWorker;
  if (!w || !mitIsAdmin() || !confirm('Profilbild von „' + (w.full_name || '') + '“ löschen?')) return;
  var rm = await supabaseClient.storage.from('avatars').remove([w.id + '.jpg']);
  var r = rm.error ? rm : await supabaseClient.rpc('clear_photo', { p_user: w.id });
  if (r.error) { console.error('Profilbild löschen:', r.error); showToast('Nicht gelöscht.', 'danger'); return; }
  w.photo_path = null;
  delete _mitPhotos[w.id];
  document.getElementById('edit-worker-photo-btn').style.display = 'none';
  showToast('Profilbild gelöscht');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mitDefaultLimit: mitDefaultLimit, mitAddMonths: mitAddMonths, mitLastActivity: mitLastActivity,
    mitInactiveWorkers: mitInactiveWorkers, mitNameKey: mitNameKey, mitNoSurname: mitNoSurname, mitUnknownNames: mitUnknownNames,
    mitSuggest: mitSuggest, mitTextTimes: mitTextTimes, mitNightForMinor: mitNightForMinor, mitMinorIssues: mitMinorIssues,
    minorShiftIssues: minorShiftIssues, mitWeekStart: mitWeekStart, mitIsAdult: mitIsAdult, mitShareTone: mitShareTone, mitShareHtml: mitShareHtml, mitShareSort: mitShareSort, mitBillingParams: mitBillingParams };
}
