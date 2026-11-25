// „Hast du Zeit?“ answered in the app (Patryk, 25.11.2026): whoever was asked (Edge Function ask-shift) gets a popup with
// the shift and answers Ja or Nein. Ja = „Ich kann“ (the Meldung is written as the person, RLS as for the button in the
// Wochenplan), then the answer is stored (RPC answer_ask). Nein is stored and shown to whoever decides.
// Shown after login, when the app comes back to the foreground, and from the push (?ask=1 reloads the app).

// ref from ask_log → the Meldung to write; null = unknown kind
function frageMeldung(ref, userId) {
  var m = /^shift:([0-9a-f-]{36})\|(.+)$/i.exec(ref || '');
  if (m) return { table: 'plan_shift_interest', row: { week_id: m[1], shift_key: m[2], user_id: userId } };
  m = /^order:(\d{2}-\d{4}\.\d{2})\|(setup|teardown)$/.exec(ref || '');
  if (m) return { table: 'order_applications', row: { job_no: m[1], phase: m[2], user_id: userId } };
  return null;
}

var _frage = { list: [], at: 0, busy: false };

async function frageCheck(force) {
  if (typeof supabaseClient === 'undefined' || typeof currentUser === 'undefined' || !currentUser || userRole === 'Gast') return;
  if (_frage.busy || (!force && Date.now() - _frage.at < 60000)) return;
  _frage.at = Date.now();
  var r;
  try { r = await supabaseClient.rpc('my_open_asks'); } catch (e) { return; }
  if (r.error) return; // offline, or a database without the migration ask_antwort: no popup
  _frage.list = r.data || [];
  frageShow();
}

function frageShow() {
  var a = _frage.list[0];
  if (!a) return;
  var who = a.asked_by_name ? escapeHtml(a.asked_by_name) + ' fragt' : 'Das Büro fragt';
  pinSheetOpen({ title: 'Hast du Zeit?', body:
    '<p class="ui-sub" style="margin:0 0 6px;">' + who + ':</p>' +
    '<p style="font-size:17px;font-weight:700;line-height:1.35;margin:0 0 18px;">' + escapeHtml(a.label || 'Ein Einsatz (Details im Wochenplan)') + '</p>' +
    '<div class="ui-sheet-actions"><button type="button" class="ui-btn" id="frage-nein" onclick="frageAnswer(\'nein\')">Nein</button>' +
    '<button type="button" class="ui-btn ui-btn-primary" id="frage-ja" onclick="frageAnswer(\'ja\')">Ja, ich kann</button></div>' });
}

async function frageAnswer(answer) {
  var a = _frage.list[0];
  if (!a || _frage.busy) return;
  _frage.busy = true;
  ['frage-ja', 'frage-nein'].forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = true; });
  try {
    if (answer === 'ja') {
      var mel = frageMeldung(a.ref, currentUser.id);
      if (mel) {
        var ins = await supabaseClient.from(mel.table).insert(mel.row).select('user_id');
        // 23505: already said „Ich kann“ for it; anything else (offline, full, not allowed) keeps the question open
        if (ins.error && ins.error.code !== '23505') {
          console.error('Hast du Zeit (Ich kann):', ins.error);
          showToast('Nicht gespeichert. Prüf deine Verbindung oder melde dich im Wochenplan.', 'danger');
          closePinSheet();
          return;
        }
      }
    }
    var r = await supabaseClient.rpc('answer_ask', { p_id: a.id, p_answer: answer });
    if (r.error) throw r.error;
    _frage.list.shift();
    closePinSheet();
    showToast(answer === 'ja' ? 'Gemeldet. Ob du dabei bist, siehst du im Wochenplan.' : 'Danke, ist angekommen.', 'success');
    if (answer === 'ja' && typeof activeModule !== 'undefined' && activeModule === 'wochenplan' && typeof wpRenderWeek === 'function') wpRenderWeek();
    if (_frage.list.length) setTimeout(frageShow, 400);
  } catch (e) {
    console.error('Hast du Zeit (Antwort):', e);
    showToast('Nicht gespeichert. Prüf deine Verbindung.', 'danger');
    ['frage-ja', 'frage-nein'].forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = false; });
  } finally {
    _frage.busy = false;
  }
}

if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') frageCheck(); });
}
