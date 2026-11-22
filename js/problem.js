// "Problem melden": a short form anyone can send (also logged out, from the PIN screen).
// Technical info (version, device, screen, last actions) goes along unless the tick is removed.
// Queued and sent like errors (js/errors.js queueReport → RPC report_problem).

function buildProblemPayload(wanted, happened, withTech, snapshot, fps) {
  var w = String(wanted == null ? '' : wanted).trim().slice(0, 2000);
  var h = String(happened == null ? '' : happened).trim().slice(0, 2000);
  if (!w && !h) return null;
  return { wanted: w, happened: h, context: withTech ? snapshot : null, fingerprints: (fps || []).slice(0, 20) };
}

function _problemSnapshot() {
  return typeof errorContextSnapshot === 'function' ? errorContextSnapshot() : {};
}

function openProblemForm() {
  if (typeof breadcrumb === 'function') breadcrumb('problem-form');
  var m = document.getElementById('problem-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'problem-modal';
    m.className = 'sig-modal ui-sheet';
    m.style.setProperty('--sheet-w', '420px');
    m.addEventListener('click', function (e) { if (e.target === m) closeProblemForm(); });
    document.body.appendChild(m);
  }
  m.innerHTML = '<div class="sig-modal-inner">' +
    '<div class="ui-sheet-head"><h3 class="ui-title" style="font-size:18px;">Problem melden</h3></div>' +
    '<label class="ui-label" for="problem-wanted">Was wolltest du machen?</label>' +
    '<textarea id="problem-wanted" maxlength="2000"></textarea>' +
    '<label class="ui-label" for="problem-happened">Was ist passiert?</label>' +
    '<textarea id="problem-happened" maxlength="2000"></textarea>' +
    '<label class="problem-check"><input type="checkbox" id="problem-tech" checked> Technische Infos mitsenden</label>' +
    '<button type="button" class="problem-link" style="margin:0;padding:0;" onclick="toggleProblemTech()">Was wird gesendet?</button>' +
    '<pre id="problem-tech-pre" hidden></pre>' +
    '<div class="problem-actions">' +
    '<button type="button" class="ui-btn" onclick="closeProblemForm()">Abbrechen</button>' +
    '<button type="button" class="ui-btn ui-btn-primary" onclick="sendProblemForm()">Senden</button>' +
    '</div></div>';
  m.classList.add('open');
}

function closeProblemForm() {
  var m = document.getElementById('problem-modal');
  if (m) m.classList.remove('open');
}

function toggleProblemTech() {
  var pre = document.getElementById('problem-tech-pre');
  if (!pre) return;
  pre.hidden = !pre.hidden;
  if (!pre.hidden) pre.textContent = JSON.stringify(_problemSnapshot(), null, 2); // textContent: no HTML injection
}

function sendProblemForm() {
  var p = buildProblemPayload(
    document.getElementById('problem-wanted').value,
    document.getElementById('problem-happened').value,
    document.getElementById('problem-tech').checked,
    _problemSnapshot(),
    typeof recentFingerprints === 'function' ? recentFingerprints(10) : []);
  if (!p) { showToast('Bitte kurz beschreiben, was passiert ist.', 'danger'); return; }
  // errors.js failed to load (very old browser): say so instead of a false "Danke"
  if (typeof queueReport !== 'function') { showToast('Senden geht gerade nicht. Bitte lade die App neu.', 'danger'); return; }
  queueReport(p);
  closeProblemForm();
  showToast(navigator.onLine === false ? 'Wird gesendet, sobald du online bist' : 'Danke, ist angekommen');
}

// After a crash (once per page load): offer the form while the person still remembers what they did
var _problemToastShown = false;
if (typeof onUncaughtError === 'function') {
  onUncaughtError(function () {
    if (_problemToastShown || typeof showToast !== 'function') return;
    _problemToastShown = true;
    showToast('Da ist was schiefgelaufen. Tippen, um es zu melden.', 'danger', openProblemForm);
  });
}
