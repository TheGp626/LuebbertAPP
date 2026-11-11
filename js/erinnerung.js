/**
 * AL-Erinnerung: banner with open protocols, pre-filled protocol form, Web Push registration.
 * Open job = einsaetze row of the logged-in AL, not cancelled, date <= today, no protocol with same al_id + date.
 */

var ERINNERUNG_LOOKBACK_DAYS = 30;
var _erinnerungOpen = []; // [{id, date, action, folderName}]

async function fetchOpenEinsaetze(userId) {
  var today = localDateStr();
  var from = new Date(); from.setDate(from.getDate() - ERINNERUNG_LOOKBACK_DAYS);
  var { data: rows, error } = await supabaseClient.from('einsaetze')
    .select('id, date, action, al_id, cancelled, folder:project_folders(name)')
    .eq('al_id', userId).eq('cancelled', false)
    .gte('date', localDateStr(from)).lte('date', today).order('date');
  if (error) { console.error('Erinnerungen laden:', error); return []; }
  rows = rows || [];
  // Wochenplan → reminders (admin switch): the AL's own plan shifts count as jobs, one per date
  var planRows = [];
  if (typeof appSetting === 'function' && appSetting('plan_reminders_enabled')) {
    // Plan jobs only count from the day the switch went on (same rule as send-reminders)
    var planFrom = localDateStr(from);
    var { data: sw } = await supabaseClient.from('app_settings').select('updated_at').eq('key', 'plan_reminders_enabled').maybeSingle();
    if (sw && sw.updated_at && localDateStr(new Date(sw.updated_at)) > planFrom) planFrom = localDateStr(new Date(sw.updated_at));
    var { data: pa, error: pErr } = await supabaseClient.from('plan_assignments')
      .select('shift:plan_shifts!inner(date, venue, wann)')
      .eq('user_id', userId).eq('role', 'AL')
      .gte('shift.date', planFrom).lte('shift.date', today);
    if (pErr) console.error('Plan-Erinnerungen laden:', pErr);
    planRows = (pa || []).map(function(r) {
      return { date: r.shift.date, venue: r.shift.venue, action: planGuessAction(r.shift.wann ? String(r.shift.wann).split('\n') : []) };
    });
  }
  if (!rows.length && !planRows.length) return [];
  var dates = rows.map(function(r) { return r.date; }).concat(planRows.map(function(r) { return r.date; }));
  var { data: prots } = await supabaseClient.from('protocols').select('date')
    .eq('al_id', userId).in('date', dates);
  var done = {};
  (prots || []).forEach(function(p) { done[p.date] = true; });
  var folder = rows.filter(function(r) { return einsatzStatus(r, !!done[r.date], today) === 'open'; })
    .map(function(r) { return { id: r.id, date: r.date, action: r.action, folderName: (r.folder && r.folder.name) || 'Projekt' }; });
  return mergeOpenJobs(folder, planRows.filter(function(r) { return !done[r.date] && r.date <= today; }));
}

function isIosWithoutHomescreen() {
  // iPadOS 13+ reports itself as "Macintosh"; only the touch screen tells it apart from a Mac
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios && !navigator.standalone;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function loadErinnerungen() {
  var box = document.getElementById('erinnerung-banner');
  if (!box) return;
  box.style.display = 'none';
  box.innerHTML = '';
  if (typeof currentUser === 'undefined' || !currentUser || ['MA', 'Gast'].indexOf(userRole) !== -1) return;
  if (typeof supabaseClient === 'undefined') return;

  _erinnerungOpen = await fetchOpenEinsaetze(currentUser.id);
  var html = '';
  if (_erinnerungOpen.length) {
    html += '<div class="ui-card">' +
      '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;"><span class="ui-pill ui-pill-warn">Protokoll fehlt</span>' +
      '<b>' + _erinnerungOpen.length + ' offene' + (_erinnerungOpen.length === 1 ? 's Protokoll' : ' Protokolle') + '</b></div>' +
      _erinnerungOpen.map(function(e) {
        return '<button type="button" class="ui-btn ui-btn-block" style="justify-content:space-between; text-align:left; min-height:40px; margin-top:6px; font-size:14px;" ' +
          (e.id ? 'data-einsatz="' + e.id + '"' : 'data-datum="' + e.date + '"') + '><span>' +
          escapeHtml(e.folderName) + ' – ' + escapeHtml(e.action) + ' am ' + shortDateDE(e.date) + '</span><span aria-hidden="true">›</span></button>';
      }).join('') +
      '</div>';
  }

  await syncPushSubscription();

  // Push opt-in (only for users who can get reminders, i.e. not MA/Gast)
  if (isIosWithoutHomescreen()) {
    html += '<div class="ui-sub" style="margin-bottom:10px;">Für Benachrichtigungen: Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen.</div>';
  } else if (pushSupported() && Notification.permission === 'denied') {
    html += '<div class="ui-sub" style="margin-bottom:10px;">Benachrichtigungen sind für diese App blockiert. In den Browser-/Handy-Einstellungen erlauben, um Erinnerungen zu bekommen.</div>';
  } else if (pushSupported() && !(await hasPushSubscription())) {
    html += '<button type="button" class="ui-btn ui-btn-block" id="btn-enable-push" style="min-height:40px; font-size:14px; margin-bottom:10px;">Erinnerungen aufs Handy aktivieren</button>';
  }

  if (!html) return;
  box.innerHTML = html;
  box.style.display = 'block';
  box.querySelectorAll('[data-einsatz]').forEach(function(b) {
    b.addEventListener('click', function() { openProtokollForEinsatz(b.dataset.einsatz); });
  });
  box.querySelectorAll('[data-datum]').forEach(function(b) {
    b.addEventListener('click', function() { openProtokollForDate(b.dataset.datum); });
  });
  var pushBtn = document.getElementById('btn-enable-push');
  if (pushBtn) pushBtn.addEventListener('click', async function() {
    var res = await enablePushReminders();
    if (res === 'granted') { showToast('🔔 Erinnerungen aktiviert'); loadErinnerungen(); }
    else if (res === 'denied') showToast('Benachrichtigungen wurden abgelehnt (in den Browser-Einstellungen änderbar).', 'danger');
    else if (res === 'ios_needs_install') showToast('Bitte die App zuerst zum Home-Bildschirm hinzufügen.', 'info');
    else showToast('Benachrichtigungen werden auf diesem Gerät nicht unterstützt.', 'danger');
  });
}

// RPC (security definer): a direct upsert of an endpoint owned by someone else is refused by RLS,
// so a shared phone could never change owner
function savePushSubscription(j) {
  return supabaseClient.rpc('register_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
}

// This device's subscription always belongs to whoever is logged in: heals a failed first save and
// hands a shared phone over to the next AL (otherwise the old AL keeps getting the new one's pushes)
async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    var reg = await navigator.serviceWorker.getRegistration();
    var sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return;
    var j = sub.toJSON();
    var { error } = await savePushSubscription(j);
    if (error) console.error('Push-Abo abgleichen:', error);
  } catch (e) {
    console.error('Push-Abo abgleichen:', e);
  }
}

async function hasPushSubscription() {
  try {
    var reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && await reg.pushManager.getSubscription());
  } catch (e) { return false; }
}

function urlBase64ToUint8Array(b64) {
  var pad = '='.repeat((4 - b64.length % 4) % 4);
  var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Asks for permission, subscribes this device and stores it for the logged-in user
async function enablePushReminders() {
  if (isIosWithoutHomescreen()) return 'ios_needs_install';
  if (!pushSupported() || typeof VAPID_PUBLIC_KEY === 'undefined') return 'unsupported';
  var perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription() ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
    var j = sub.toJSON();
    var { error } = await savePushSubscription(j);
    if (error) throw error;
    return 'granted';
  } catch (e) {
    console.error('Push-Abo fehlgeschlagen:', e);
    return 'unsupported';
  }
}

// The AL's plan shifts of one day (planShiftFromDb shape, in plan order); [] when there are none or the plan can't be read
async function erPlanShifts(userId, date) {
  try {
    var { data, error } = await supabaseClient.from('plan_assignments')
      .select('shift:plan_shifts!inner(id, key, date, sort, venue, title, wann, location, details, notes, ap, ap_user_id, open_slots, plan_assignments(name, role, note, user_id))')
      .eq('user_id', userId).eq('role', 'AL').eq('shift.date', date);
    if (error) throw error;
    return (data || []).map(function(r) { return r.shift; }).sort(function(a, b) { return a.sort - b.sort; }).map(planShiftFromDb);
  } catch (err) {
    console.error('Plan-Einsatz laden:', err); // the form still opens, just with less filled in
    return [];
  }
}

// Which plan shift belongs to a project folder? The one sharing the most words with the folder name
// ("261111_Estrel_Business of Apps" ↔ venue "Estrel", title "Business of Apps"); no shared word → the only shift of the day, else none.
function erPickShift(shifts, folderName) {
  var words = function(t) { return String(t || '').toLowerCase().split(/[^a-zäöüß]+/).filter(function(w) { return w.length >= 3; }); };
  var want = words(folderName), best = null, bestScore = 0;
  (shifts || []).forEach(function(s) {
    var have = words([s.venue, s.title].concat(s.location || []).join(' '));
    var score = want.filter(function(w) { return have.indexOf(w) !== -1; }).length;
    if (score > bestScore) { best = s; bestScore = score; }
  });
  return best || ((shifts || []).length === 1 ? shifts[0] : null);
}

// One event often has several plan rows on a day (one per room): the protocol gets everyone from all of them
function erWithGroupPeople(shift, shifts) {
  var name = planEventName(shift).trim().toLowerCase();
  var group = shifts.filter(function(s) { return planEventName(s).trim().toLowerCase() === name; });
  if (group.length < 2 || typeof dashMergePlanPeople !== 'function') return shift;
  var open = [];
  group.forEach(function(s) { open = open.concat(s.open || []); });
  var notes = [];
  group.forEach(function(s) { (s.notes || []).forEach(function(n) { if (notes.indexOf(n) === -1) notes.push(n); }); });
  return Object.assign({}, shift, { people: dashMergePlanPeople(group, shift), open: open, notes: notes,
    keys: group.map(function(s) { return s.key; }).filter(Boolean) });
}

// Which Auftrag does a plan entry belong to? links = order_plan_links rows of that day, keys = the entry's plan key(s).
// Aufbau and Abbau of one Auftrag can sit on the same entry: then the protocol's action decides.
function erPickJob(links, keys, action) {
  var hits = (links || []).filter(function(l) { return l.job_no && l.plan_key && (keys || []).indexOf(l.plan_key) !== -1; });
  if (!hits.length) return '';
  var phase = typeof protPhaseOfAction === 'function' ? protPhaseOfAction(action) : null;
  var same = hits.filter(function(l) { return l.phase === phase; });
  return (same[0] || hits[0]).job_no;
}

async function erJobForShift(p) {
  var keys = (p.shift.keys && p.shift.keys.length) ? p.shift.keys : [p.shift.key].filter(Boolean);
  if (!keys.length || !p.date) return '';
  try {
    var r = await supabaseClient.from('order_plan_links').select('job_no, phase, plan_date, plan_key').eq('plan_date', p.date);
    if (r.error) throw r.error;
    return erPickJob(r.data, keys, p.action);
  } catch (err) {
    console.error('Auftrag zum Plan-Eintrag laden:', err); // the field just stays empty
    return '';
  }
}

function erPlanLocation(p) { return [p.venue].concat((p.location || []).slice(0, 1)).filter(Boolean).join(', '); }

// Opens a fresh protocol form pre-filled from a planned job (banner click or notification tap).
// Title, date, action, AL and PL come from the project folder; people, drivers and the place from the AL's plan shift of that day.
async function openProtokollForEinsatz(einsatzId) {
  var { data: e, error } = await supabaseClient.from('einsaetze')
    .select('id, date, action, al_id, job_no, folder:project_folders(name, pl_id)').eq('id', einsatzId).maybeSingle();
  if (error || !e) { showToast('Einsatz nicht gefunden.', 'danger'); return; }
  var name = (e.folder && e.folder.name) || '';
  var shifts = e.al_id ? await erPlanShifts(e.al_id, e.date) : [];
  var p = erPickShift(shifts, name);
  if (p) p = erWithGroupPeople(p, shifts);
  await openProtokollPrefilled({ event: name, date: e.date, action: e.action, alId: e.al_id, plId: (e.folder && e.folder.pl_id) || null, jobNo: e.job_no || '',
    location: p ? erPlanLocation(p) : '', shift: p || undefined });
}

// Fresh protocol form pre-filled with { event, date, action, alId, plId, jobNo, location, shift } (reminder banner, Wochenplan);
// shift (planShiftFromDb shape) also fills the personnel list, the drivers under Transport and the PL from what the plan names
async function openProtokollPrefilled(p) {
  var val = function(id) { return ((document.getElementById(id) || {}).value || '').trim(); };
  if (typeof appUsers !== 'undefined' && !appUsers.length && typeof fetchAppUsers === 'function') await fetchAppUsers();
  var plId = p.plId || (p.shift ? protPlanPl(p.shift, appUsers) : null);
  var setPl = function() {
    if (!plId || val('prot-pl')) return;
    protState.plId = plId;
    if (typeof populateAlPlSelects === 'function') populateAlPlSelects(); // the PL may not be in the list yet
    document.getElementById('prot-pl').value = plId;
  };
  var jobNo = p.jobNo || (p.shift ? await erJobForShift(p) : '');
  var setJob = function() {
    var el = document.getElementById('prot-job');
    if (el && jobNo && !el.value.trim()) el.value = jobNo;
  };
  var fillFromPlan = function() {
    if (!p.shift) return;
    protApplyPlanTransports(protPlanTransports(p.shift, appUsers, protVehicleTypes()));
    protApplyPlanPersonnel(protPlanCrew(p.shift, appUsers));
  };

  // The AL already started this very protocol → keep the draft, only fill what's missing
  if (val('prot-event') === p.event && val('prot-date') === p.date) {
    if (!val('prot-al') && p.alId) { document.getElementById('prot-al').value = p.alId; protState.alId = p.alId; }
    if (!val('prot-location') && p.location) document.getElementById('prot-location').value = p.location;
    setPl();
    setJob();
    saveProtDraft();
    fillFromPlan();
    selectMode('protokoll');
    return;
  }
  var hasDraft = ['prot-event', 'prot-location', 'prot-damages', 'prot-incidents', 'prot-feedback'].some(val) || !!protState.editingId;
  if (hasDraft && !confirm('Es gibt einen angefangenen Protokoll-Entwurf' + (val('prot-event') ? ' („' + val('prot-event') + '“)' : '') +
      '. Verwerfen und neues Protokoll für „' + p.event + '“ beginnen?')) return;
  clearProtForm(true);
  document.getElementById('prot-event').value = p.event;
  document.getElementById('prot-date').value = p.date;
  if (p.action) document.getElementById('prot-action').value = p.action;
  if (typeof syncProtActionSeg === 'function') syncProtActionSeg();
  if (p.location) document.getElementById('prot-location').value = p.location;
  if (p.alId) { document.getElementById('prot-al').value = p.alId; protState.alId = p.alId; }
  setPl();
  setJob();
  saveProtDraft();
  fillFromPlan();
  if (typeof calcProtCosts === 'function') calcProtCosts();
  selectMode('protokoll');
}

// Plan job (no einsatz id): the AL's own plan shift on that date pre-fills the protocol like
// "Protokoll starten" in the Wochenplan; without a shift only date and AL are filled in.
// The link carries the date, not a shift id, because shift ids change with every plan upload.
async function openProtokollForDate(date) {
  var me = currentUser.id;
  var shifts = await erPlanShifts(me, date);
  if (!shifts.length) { await openProtokollPrefilled({ event: '', date: date, alId: me }); return; }
  var p = erWithGroupPeople(shifts[0], shifts);
  await openProtokollPrefilled({ event: planEventName(p), date: date, action: planGuessAction(p.wann), alId: me, location: erPlanLocation(p), shift: p });
}

// Notification tap opens ./index.html?open=protokoll&einsatz=<id> (folder job) or &datum=YYYY-MM-DD (plan job);
// handled once the user is logged in
function handleEinsatzDeepLink() {
  var params = new URLSearchParams(location.search);
  if (params.get('open') !== 'protokoll' || (!params.get('einsatz') && !params.get('datum'))) return;
  history.replaceState(null, '', location.pathname);
  if (typeof currentUser === 'undefined' || !currentUser || ['MA', 'Gast'].indexOf(userRole) !== -1) return;
  if (params.get('einsatz')) openProtokollForEinsatz(params.get('einsatz'));
  else if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('datum'))) openProtokollForDate(params.get('datum'));
}
