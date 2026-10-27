/**
 * Wochenplan (experimental): Daniel's weekly plan PDFs as a table.
 * Everyone sees the whole week with their own shifts highlighted ("Meine Schichten").
 * PL/Admin upload a PDF → plan-pdf.js reads it → plan-parser.js builds shifts → preview with name
 * assignment → saved to plan_weeks/plan_shifts/plan_assignments; changes get a push (notify-plan-change).
 */

var WP_UPLOAD_ROLES = ['Admin', 'PL'];
var WP_WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
var wpUsers = [];        // app_users (also inactive, for names of old assignments)
var wpAliases = {};      // alias (lowercase) → user id
var wpWeeks = [];        // plan_weeks, newest first
var wpWeekId = null;     // week shown in "Ganze Woche"
var wpView = 'mine';
var wpImport = null;     // { parsed, fileName, existing, unresolved }

function wpEsc(s) { return escapeHtml(s == null ? '' : String(s)); }

function wpDayLabel(iso) {
  var p = iso.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]);
  return WP_WEEKDAYS[d.getDay()] + ' ' + ('0' + p[2]).slice(-2) + '.' + ('0' + p[1]).slice(-2) + '.';
}

function wpUserName(id) {
  var u = wpUsers.find(function(x) { return x.id === id; });
  return u ? u.full_name : null;
}

function wpCanUpload() {
  return typeof userRole !== 'undefined' && WP_UPLOAD_ROLES.indexOf(userRole) !== -1;
}

async function initWochenplan() {
  document.getElementById('wp-import').style.display = 'none';
  document.getElementById('wp-main').style.display = '';
  document.getElementById('wp-upload-btn').style.display = wpCanUpload() ? '' : 'none';
  var content = document.getElementById('wp-content');
  content.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text3);">Lädt…</div>';
  var [u, a, w] = await Promise.all([
    supabaseClient.from('app_users').select('id, full_name, role, is_active').order('full_name'),
    supabaseClient.from('plan_name_aliases').select('alias, user_id'),
    supabaseClient.from('plan_weeks').select('*').order('week_start', { ascending: false })
  ]);
  if (u.error || a.error || w.error) {
    console.error('Wochenplan laden:', u.error || a.error || w.error);
    content.innerHTML = '<div class="empty-state">Wochenplan konnte nicht geladen werden.</div>';
    return;
  }
  wpUsers = u.data || [];
  wpAliases = {};
  (a.data || []).forEach(function(r) { wpAliases[r.alias] = r.user_id; });
  wpWeeks = w.data || [];
  // Default: the week containing today, else the next upcoming one, else the newest
  var today = localDateStr();
  if (!wpWeeks.some(function(x) { return x.id === wpWeekId; })) {
    var cur = wpWeeks.find(function(x) { return x.week_start <= today && x.week_end >= today; }) ||
      wpWeeks.slice().reverse().find(function(x) { return x.week_start > today; }) || wpWeeks[0];
    wpWeekId = cur ? cur.id : null;
  }
  if (typeof syncPushSubscription === 'function') syncPushSubscription();
  await wpRenderPushHint();
  wpSetView(wpView);
}

async function wpRenderPushHint() {
  var box = document.getElementById('wp-push-hint');
  box.innerHTML = '';
  if (typeof pushSupported !== 'function') return;
  if (isIosWithoutHomescreen()) {
    box.innerHTML = '<div style="font-size:12px; color:var(--text3); margin-bottom:12px;">🔔 Für Benachrichtigungen bei Planänderungen: Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen.</div>';
  } else if (pushSupported() && Notification.permission !== 'denied' && !(await hasPushSubscription())) {
    box.innerHTML = '<button type="button" class="btn" style="width:100%; padding:10px; font-size:13px; margin-bottom:12px;" onclick="wpEnablePush()">🔔 Bei Planänderungen benachrichtigen</button>';
  }
}

async function wpEnablePush() {
  var res = await enablePushReminders();
  if (res === 'granted') { showToast('🔔 Benachrichtigungen aktiviert'); wpRenderPushHint(); }
  else if (res === 'denied') showToast('Benachrichtigungen wurden abgelehnt (in den Browser-Einstellungen änderbar).', 'danger');
  else if (res === 'ios_needs_install') showToast('Bitte die App zuerst zum Home-Bildschirm hinzufügen.', 'info');
  else showToast('Benachrichtigungen werden auf diesem Gerät nicht unterstützt.', 'danger');
}

function wpSetView(v) {
  wpView = v;
  document.getElementById('wp-tab-mine').classList.toggle('active', v === 'mine');
  document.getElementById('wp-tab-all').classList.toggle('active', v === 'all');
  document.getElementById('wp-week-nav').style.display = v === 'all' ? 'flex' : 'none';
  if (v === 'mine') wpRenderMine(); else wpRenderWeek();
}

function wpStepWeek(dir) {
  // wpWeeks is newest first → "next week" is the previous index
  var i = wpWeeks.findIndex(function(w) { return w.id === wpWeekId; });
  var n = wpWeeks[i - dir];
  if (n) { wpWeekId = n.id; wpRenderWeek(); }
}

// One shift card. mine = the logged-in user is on it
function wpShiftCard(s, opts) {
  opts = opts || {};
  var me = currentUser && currentUser.id;
  var mine = (s.plan_assignments || []).some(function(a) { return a.user_id === me; });
  var myRole = mine ? (s.plan_assignments.find(function(a) { return a.user_id === me; }).role || '') : '';
  var badge = s.change_status ? '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:99px; background:' +
    (s.change_status === 'neu' ? 'rgba(34,197,94,0.18); color:#15803d' : 'rgba(245,158,11,0.2); color:#b45309') + ';">' + s.change_status + '</span>' : '';
  var people = (s.plan_assignments || []).map(function(a) {
    var label = a.user_id ? (wpUserName(a.user_id) || a.name) : a.name;
    var isMe = a.user_id === me;
    var role = a.role && a.role !== 'MA' ? ' <span style="opacity:.65;">' + wpEsc(a.role) + '</span>' : '';
    return '<span style="display:inline-block; margin:2px 4px 2px 0; padding:2px 8px; border-radius:99px; font-size:12px; border:0.5px solid var(--border2);' +
      (isMe ? ' background:var(--accent-bg); color:var(--accent-text); font-weight:600; border-color:var(--accent);' : '') + '"' +
      (a.note ? ' title="' + wpEsc(a.note) + '"' : '') + '>' + wpEsc(label) + role + (a.note ? ' <span style="opacity:.6;">(' + wpEsc(a.note) + ')</span>' : '') + '</span>';
  }).join('');
  var open = (s.open_slots || []).map(function(o) {
    return '<span style="display:inline-block; margin:2px 4px 2px 0; padding:2px 8px; border-radius:99px; font-size:12px; border:1px dashed var(--border2); color:var(--text3);">' +
      o.count + ' ' + wpEsc(o.role) + ' offen' + (o.note ? ' · ' + wpEsc(o.note) : '') + '</span>';
  }).join('');
  var lines = function(t) { return t ? wpEsc(t).replace(/\n/g, '<br>') : ''; };
  var protBtn = mine && myRole === 'AL'
    ? '<button type="button" class="btn" style="width:auto; padding:6px 12px; font-size:12px; margin-top:8px;" onclick="wpStartProtokoll(\'' + s.id + '\')">📋 Protokoll starten</button>' : '';
  return '<div class="card" style="cursor:default; border-left:4px solid ' + (s.color || (mine ? 'var(--accent)' : 'var(--border2)')) + ';' +
      (mine ? ' box-shadow:0 0 0 1.5px var(--accent) inset;' : '') + '">' +
    '<div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">' +
      '<div style="min-width:0;">' +
        (opts.showDate ? '<div style="font-size:12px; color:var(--text3); font-weight:600;">' + wpDayLabel(s.date) + '</div>' : '') +
        '<div style="font-weight:700; font-size:15px;">' + wpEsc(s.venue || '—') + '</div>' +
        (s.title ? '<div style="font-size:13px; color:var(--text2);">' + wpEsc(s.title) + '</div>' : '') +
      '</div>' +
      '<div style="text-align:right; flex-shrink:0;">' + badge +
        (s.ap ? '<div style="font-size:11px; color:var(--text3); margin-top:4px;">PL ' + wpEsc(s.ap) + '</div>' : '') +
      '</div>' +
    '</div>' +
    (s.wann ? '<div style="font-size:13px; margin-top:8px;">🕒 ' + lines(s.wann) + '</div>' : '') +
    ((people || open) ? '<div style="margin-top:8px;">' + people + open + '</div>' : '') +
    (s.notes ? '<div style="font-size:12px; color:var(--text3); margin-top:6px;">🚚 ' + lines(s.notes) + '</div>' : '') +
    ((s.location || s.details) ? '<details style="margin-top:8px; font-size:12px; color:var(--text2);"><summary style="cursor:pointer;">Ort & Material</summary>' +
      (s.location ? '<div style="margin-top:6px;">📍 ' + lines(s.location) + '</div>' : '') +
      (s.details ? '<div style="margin-top:6px;">' + lines(s.details) + '</div>' : '') + '</details>' : '') +
    protBtn +
  '</div>';
}

var _wpShiftCache = {};

async function wpRenderMine() {
  var content = document.getElementById('wp-content');
  if (!currentUser) return;
  var from = new Date(); from.setDate(from.getDate() - 1);
  var { data, error } = await supabaseClient.from('plan_assignments')
    .select('shift:plan_shifts!inner(*, plan_assignments(*), plan_weeks(kw))')
    .eq('user_id', currentUser.id)
    .gte('shift.date', localDateStr(from));
  if (error) { console.error('Meine Schichten:', error); content.innerHTML = '<div class="empty-state">Fehler beim Laden.</div>'; return; }
  var shifts = (data || []).map(function(r) { return r.shift; }).filter(Boolean)
    .sort(function(a, b) { return (a.date < b.date ? -1 : a.date > b.date ? 1 : a.sort - b.sort); });
  shifts.forEach(function(s) { _wpShiftCache[s.id] = s; });
  if (!shifts.length) {
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><div>Keine anstehenden Schichten für dich im Plan.' +
      (wpWeeks.length ? '<br><span style="font-size:12px;">Unter „Ganze Woche“ siehst du den kompletten Plan.</span>' : '') + '</div></div>';
    return;
  }
  content.innerHTML = shifts.map(function(s) { return wpShiftCard(s, { showDate: true }); }).join('');
}

async function wpRenderWeek() {
  var content = document.getElementById('wp-content');
  var week = wpWeeks.find(function(w) { return w.id === wpWeekId; });
  var label = document.getElementById('wp-week-label');
  var i = wpWeeks.indexOf(week);
  document.getElementById('wp-prev').disabled = !week || i >= wpWeeks.length - 1;
  document.getElementById('wp-next').disabled = !week || i <= 0;
  if (!week) {
    label.textContent = '—';
    content.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><div>Noch kein Wochenplan hochgeladen.' +
      (wpCanUpload() ? '<br><span style="font-size:12px;">Oben auf „Plan hochladen“ tippen und Daniels PDF wählen.</span>' : '') + '</div></div>';
    return;
  }
  label.innerHTML = 'KW ' + week.kw + ' <span style="font-weight:400; color:var(--text3); font-size:12px;">' +
    wpDayLabel(week.week_start).slice(3) + '–' + wpDayLabel(week.week_end).slice(3) + (week.version > 1 ? ' · Stand ' + week.version : '') + '</span>';
  content.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text3);">Lädt…</div>';
  var { data, error } = await supabaseClient.from('plan_shifts').select('*, plan_assignments(*)')
    .eq('week_id', week.id).order('date').order('sort');
  if (error) { console.error('Woche laden:', error); content.innerHTML = '<div class="empty-state">Fehler beim Laden.</div>'; return; }
  (data || []).forEach(function(s) { _wpShiftCache[s.id] = s; });
  var html = '';
  if ((week.removed || []).length) {
    html += '<div class="card" style="cursor:default; border-left:4px solid #ef4444;"><div style="font-weight:700; margin-bottom:4px;">Entfallen seit dem letzten Stand</div>' +
      week.removed.map(function(r) { return '<div style="font-size:13px;">' + wpDayLabel(r.date) + ' · ' + wpEsc(r.venue) + (r.title ? ' – ' + wpEsc(r.title) : '') + '</div>'; }).join('') + '</div>';
  }
  var byDay = {};
  (data || []).forEach(function(s) { (byDay[s.date] = byDay[s.date] || []).push(s); });
  Object.keys(byDay).sort().forEach(function(d) {
    html += '<div style="font-weight:700; font-size:13px; color:var(--text2); margin:18px 0 8px; text-transform:uppercase; letter-spacing:.04em;">' + wpDayLabel(d) + '</div>' +
      byDay[d].map(function(s) { return wpShiftCard(s); }).join('');
  });
  content.innerHTML = html || '<div class="empty-state">Keine Einsätze in dieser Woche.</div>';
}

function wpStartProtokoll(shiftId) {
  var s = _wpShiftCache[shiftId];
  if (!s) return;
  var parsed = planShiftFromDb(s);
  openProtokollPrefilled({
    event: planEventName(parsed), date: s.date, action: planGuessAction(parsed.wann),
    alId: currentUser.id, location: [s.venue].concat(parsed.location.slice(0, 1)).filter(Boolean).join(', ')
  });
}

// ── IMPORT ──

function wpPickFile() {
  if (!wpCanUpload()) { showToast('Nur PL/Admin können Pläne hochladen.', 'danger'); return; }
  var inp = document.getElementById('wp-file');
  inp.value = '';
  inp.click();
}

async function wpFileChosen(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { showToast('Bitte eine PDF-Datei wählen.', 'danger'); return; }
  showToast('Plan wird gelesen…', 'info');
  var parsed;
  try {
    parsed = planParse(await readPlanPdf(await file.arrayBuffer()));
  } catch (e) {
    console.error('Plan lesen:', e);
    showToast('PDF konnte nicht gelesen werden.', 'danger');
    return;
  }
  if (!parsed.shifts.length) { showToast(parsed.warnings[0] || 'Keine Einsätze erkannt.', 'danger'); return; }
  var { data: ex, error } = await supabaseClient.from('plan_weeks')
    .select('*, plan_shifts(*, plan_assignments(*))').eq('year', parsed.year).eq('kw', parsed.kw).maybeSingle();
  if (error) { console.error('Woche prüfen:', error); showToast('Server nicht erreichbar.', 'danger'); return; }

  // Names that could not be matched automatically (agency workers are never matched)
  var unresolved = {};
  parsed.shifts.forEach(function(s) {
    s.people.forEach(function(p) {
      var m = planMatchPerson(p, wpUsers, wpAliases);
      p.userId = m.userId;
      if (!m.userId && p.role !== 'Zenjob' && p.role !== 'ROCKiT') {
        var k = p.name.toLowerCase();
        if (!unresolved[k]) unresolved[k] = { name: p.name, candidates: m.candidates, count: 0 };
        unresolved[k].count++;
      }
    });
  });
  wpImport = { parsed: parsed, fileName: file.name, existing: ex || null, unresolved: unresolved };
  wpRenderImport();
}

function wpRenderImport() {
  var p = wpImport.parsed, ex = wpImport.existing;
  var active = wpUsers.filter(function(u) { return u.is_active !== false && u.role !== 'Gast'; });
  var diffInfo = '';
  if (ex) {
    var d = planDiff((ex.plan_shifts || []).map(planShiftFromDb), p.shifts);
    var cnt = function(st) { return d.status.filter(function(x) { return x === st; }).length; };
    diffInfo = '<div style="margin-top:6px; font-size:13px;">Ersetzt Stand ' + ex.version + ': <b>' + cnt('geändert') + '</b> geändert, <b>' +
      cnt('neu') + '</b> neu, <b>' + d.removed.length + '</b> entfallen.</div>';
  }
  var names = Object.keys(wpImport.unresolved).sort();
  var nameRows = names.map(function(k) {
    var r = wpImport.unresolved[k];
    var cands = r.candidates.map(function(id) { return active.find(function(u) { return u.id === id; }); }).filter(Boolean);
    var rest = active.filter(function(u) { return r.candidates.indexOf(u.id) === -1; });
    var opt = function(u) { return '<option value="' + u.id + '">' + wpEsc(u.full_name) + '</option>'; };
    return '<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">' +
      '<div style="flex:1; min-width:120px; font-weight:600;">„' + wpEsc(r.name) + '“ <span style="font-weight:400; color:var(--text3); font-size:12px;">' + r.count + '×</span></div>' +
      '<select class="meta-input" style="flex:2; min-width:180px; margin:0;" data-alias="' + wpEsc(k) + '">' +
        '<option value="">— nicht zuordnen (nur Name) —</option>' +
        (cands.length ? '<optgroup label="Vorschläge">' + cands.map(opt).join('') + '</optgroup>' : '') +
        '<optgroup label="Alle">' + rest.map(opt).join('') + '</optgroup>' +
      '</select></div>';
  }).join('');
  var byDay = {};
  p.shifts.forEach(function(s) { (byDay[s.date] = byDay[s.date] || []).push(s); });
  var preview = Object.keys(byDay).sort().map(function(d) {
    return '<div style="font-weight:700; font-size:12px; color:var(--text2); margin:12px 0 4px;">' + wpDayLabel(d) + '</div>' +
      byDay[d].map(function(s) {
        return '<div style="font-size:12px; padding:6px 8px; border-left:3px solid ' + (s.color || 'var(--border2)') + '; background:var(--bg2); border-radius:6px; margin-bottom:4px;">' +
          '<b>' + wpEsc(s.venue) + '</b>' + (s.title ? ' – ' + wpEsc(s.title) : '') +
          (s.wann[0] ? ' · <span style="color:var(--text2);">' + wpEsc(s.wann[0]) + '</span>' : '') +
          '<div style="color:var(--text2); margin-top:2px;">' + (s.people.map(function(x) {
            return wpEsc(x.name) + (x.role !== 'MA' ? ' (' + wpEsc(x.role) + ')' : '') + (x.userId ? ' ✓' : (x.role === 'Zenjob' || x.role === 'ROCKiT') ? '' : ' ?');
          }).join(', ') || '—') + (s.open.length ? ' · ' + s.open.map(function(o) { return o.count + ' ' + o.role + ' offen'; }).join(', ') : '') + '</div></div>';
      }).join('');
  }).join('');

  document.getElementById('wp-import-body').innerHTML =
    '<div class="card" style="cursor:default;"><div style="font-weight:700; font-size:16px;">KW ' + p.kw + ' · ' + wpDayLabel(p.weekStart) + ' – ' + wpDayLabel(p.weekEnd) + '</div>' +
      '<div style="font-size:13px; color:var(--text2); margin-top:4px;">' + p.shifts.length + ' Einsätze erkannt aus „' + wpEsc(wpImport.fileName) + '“. Telefonnummern werden nicht gespeichert.</div>' +
      diffInfo +
      (p.warnings.length ? '<div style="margin-top:6px; font-size:12px; color:#b45309;">⚠️ ' + p.warnings.map(wpEsc).join('<br>⚠️ ') + '</div>' : '') +
    '</div>' +
    (names.length ? '<div class="card" style="cursor:default;"><div style="font-weight:700; margin-bottom:4px;">Namen zuordnen</div>' +
      '<div style="font-size:12px; color:var(--text3); margin-bottom:10px;">Die App merkt sich die Zuordnung für die nächsten Pläne.</div>' + nameRows + '</div>' : '') +
    '<div class="card" style="cursor:default;"><div style="font-weight:700;">Vorschau</div>' +
      '<div style="font-size:12px; color:var(--text3);">✓ = Mitarbeiter erkannt, ? = nur Name</div>' + preview + '</div>';
  document.getElementById('wp-main').style.display = 'none';
  document.getElementById('wp-import').style.display = '';
  document.getElementById('page-wochenplan').scrollTop = 0;
}

function wpCancelImport() {
  wpImport = null;
  document.getElementById('wp-import').style.display = 'none';
  document.getElementById('wp-main').style.display = '';
}

async function wpSaveImport() {
  if (!wpImport) return;
  var btn = document.getElementById('wp-save-btn');
  btn.disabled = true; btn.textContent = 'Speichert…';
  try {
    var p = wpImport.parsed, ex = wpImport.existing;
    // Names chosen in the preview → remembered as aliases
    var newAliases = [];
    document.querySelectorAll('#wp-import-body select[data-alias]').forEach(function(sel) {
      if (sel.value) { wpAliases[sel.dataset.alias] = sel.value; newAliases.push({ alias: sel.dataset.alias, user_id: sel.value }); }
    });
    p.shifts.forEach(function(s) {
      s.people.forEach(function(x) { if (!x.userId) x.userId = wpAliases[x.name.toLowerCase()] || null; });
    });

    var oldShifts = ex ? (ex.plan_shifts || []).map(planShiftFromDb) : [];
    var diff = ex ? planDiff(oldShifts, p.shifts) : { status: p.shifts.map(function() { return null; }), removed: [] };
    var removed = diff.removed.map(function(r) {
      return { date: r.date, venue: r.venue, title: r.title,
        user_ids: r.people.map(function(x) { return x.userId; }).filter(Boolean) };
    });
    var weekRow = { year: p.year, kw: p.kw, week_start: p.weekStart, week_end: p.weekEnd, removed: removed,
      file_name: wpImport.fileName, uploaded_by: currentUser.id, uploaded_at: new Date().toISOString() };

    var weekId;
    if (ex) {
      weekRow.version = ex.version + 1;
      var up = await supabaseClient.from('plan_weeks').update(weekRow).eq('id', ex.id).select('id');
      if (up.error || !up.data || !up.data.length) throw up.error || new Error('Woche nicht aktualisiert');
      weekId = ex.id;
    } else {
      var ins = await supabaseClient.from('plan_weeks').insert(weekRow).select('id').single();
      if (ins.error) throw ins.error;
      weekId = ins.data.id;
    }

    // New shifts first, old ones deleted afterwards → a failed upload never leaves an empty week
    var rows = p.shifts.map(function(s, i) { return planShiftRow(s, weekId, diff.status[i]); });
    var sh = await supabaseClient.from('plan_shifts').insert(rows).select('id, key');
    if (sh.error || !sh.data || sh.data.length !== rows.length) throw sh.error || new Error('Einsätze nicht gespeichert');
    var idByKey = {};
    sh.data.forEach(function(r) { idByKey[r.key] = r.id; });
    var asg = [];
    p.shifts.forEach(function(s) {
      s.people.forEach(function(x) {
        asg.push({ shift_id: idByKey[s.key], user_id: x.userId || null, name: x.name, role: x.role, note: x.note || null });
      });
    });
    if (asg.length) {
      var as = await supabaseClient.from('plan_assignments').insert(asg).select('id');
      if (as.error || !as.data || as.data.length !== asg.length) throw as.error || new Error('Personal nicht gespeichert');
    }
    if (oldShifts.length) {
      var del = await supabaseClient.from('plan_shifts').delete().in('id', oldShifts.map(function(s) { return s.id; }));
      if (del.error) console.error('Alte Einsätze löschen:', del.error);
    }
    if (newAliases.length) {
      var al = await supabaseClient.from('plan_name_aliases').upsert(newAliases, { onConflict: 'alias' });
      if (al.error) console.error('Zuordnungen merken:', al.error);
    }

    // Push to everyone affected (the function decides who and sends at most once per version)
    supabaseClient.functions.invoke('notify-plan-change', { body: { week_id: weekId } })
      .then(function(r) { if (r.error) console.error('Plan-Push:', r.error); })
      .catch(function(e) { console.error('Plan-Push:', e); });

    showToast('✅ Wochenplan KW ' + p.kw + ' gespeichert');
    wpImport = null;
    wpWeekId = weekId;
    wpView = 'all';
    await initWochenplan();
  } catch (e) {
    console.error('Plan speichern:', e);
    showToast('Speichern fehlgeschlagen: ' + (e.message || e), 'danger');
  } finally {
    btn.disabled = false; btn.textContent = 'Übernehmen';
  }
}

// Notification tap opens ./index.html?open=wochenplan
function handleWochenplanDeepLink() {
  var params = new URLSearchParams(location.search);
  if (params.get('open') !== 'wochenplan') return;
  history.replaceState(null, '', location.pathname);
  if (typeof currentUser === 'undefined' || !currentUser || userRole === 'Gast') return;
  wpView = 'mine';
  selectMode('wochenplan');
}
