// "Was ist neu" popup. Newest entry first. lastIsHint: render the last item as a highlighted line instead of a list step.
const CHANGELOG = [{
  version: '2026-11-pin',
  title: 'Neu: deine eigene PIN',
  lastIsHint: true,
  items: [
    'Namen auswählen.',
    'Beim ersten Mal: eine 4-stellige PIN ausdenken und zweimal eingeben.',
    'Ab jetzt meldest du dich mit dieser PIN an. Sie gilt 30 Tage pro Gerät, danach fragt die App wieder.',
    'PIN ändern: oben rechts im Menü „…“ → „PIN ändern“.',
    'PIN vergessen? Sag deinem AL oder PL Bescheid – die können sie zurücksetzen. Danach wählst du einfach eine neue.'
  ]
}];

function unseenChangelog(list, seenVersion) {
  const i = list.findIndex(e => e.version === seenVersion);
  return i < 0 ? list.slice() : list.slice(0, i);
}

function showChangelogIfNew() {
  let seen = '';
  try { seen = localStorage.getItem('luebbert_changelog_seen') || ''; } catch (e) {}
  const entries = unseenChangelog(CHANGELOG, seen);
  if (!entries.length) return;
  const esc = typeof uiEsc === 'function' ? uiEsc : s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const body = entries.map(e => {
    const steps = e.lastIsHint ? e.items.slice(0, -1) : e.items;
    const hint = e.lastIsHint ? e.items[e.items.length - 1] : '';
    return '<h4 style="margin:12px 0 6px;font-size:15px;">' + esc(e.title) + '</h4>' +
      '<ol style="margin:0 0 8px;padding-left:20px;line-height:1.5;">' + steps.map(t => '<li>' + esc(t) + '</li>').join('') + '</ol>' +
      (hint ? '<div style="margin-top:10px;padding:10px 12px;border-radius:var(--r-control);background:var(--bg3);font-weight:500;">' + esc(hint) + '</div>' : '');
  }).join('');
  const m = document.createElement('div');
  m.className = 'sig-modal ui-sheet open';
  m.style.zIndex = '10001'; // above #auth-overlay (10000)
  m.style.setProperty('--sheet-w', '520px');
  m.innerHTML = '<div class="sig-modal-inner"><div class="ui-sheet-head"><h3 class="ui-title" style="font-size:18px;">Was ist neu</h3></div>' + body +
    '<div class="ui-sheet-actions"><button type="button" class="ui-btn ui-btn-primary">Verstanden</button></div></div>';
  m.querySelector('button').onclick = () => {
    try { localStorage.setItem('luebbert_changelog_seen', CHANGELOG[0].version); } catch (e) {}
    m.remove();
  };
  document.body.appendChild(m);
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', showChangelogIfNew);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHANGELOG: CHANGELOG, unseenChangelog: unseenChangelog };
}
