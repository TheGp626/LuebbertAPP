// Pure mail building for send-protocol-mail (no Deno/Node APIs → testable with `node --test`)

const GEWERKE_LABELS = { mobiliar: 'Mobiliar', stoffe: 'Stoffe & Hussen', floristik: 'Floristik', tischlerei: 'Tischlerei', logistik: 'Logistik' };
const FOOTER = 'Automatisch gesendet von der Lübbert App';

export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function formatDateDE(isoDate) {
  if (!isoDate) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(isoDate);
}

function isEmptyNote(s) {
  const t = (s || '').trim();
  return !t || t.toLowerCase() === 'nein' || t === '—';
}

function projectName(p) {
  return (p.projects && p.projects.name) || 'Protokoll';
}

function actionText(p) {
  const a = (p.action || '').trim();
  return a && a !== '—' ? a : '';
}

export function buildSubject(p, isUpdate, testPrefixName) {
  const action = actionText(p);
  const core = `${isUpdate ? 'Aktualisiert' : 'Neues Protokoll'}: ${projectName(p)} – ${formatDateDE(p.date)}` + (action ? ` (${action})` : '');
  return testPrefixName ? `[TEST → ${testPrefixName}] ${core}` : core;
}

function ratingLabel(r) {
  return (r.rating === 'up' ? 'gut' : 'schlecht') + (r.is_star ? ' + Stern' : '');
}

// Returns [label, value] rows; values are plain text (escaped later for HTML)
function summaryRows(p) {
  const rows = [
    ['Projekt', projectName(p)],
    ['Ort', (p.projects && p.projects.location) || '—'],
    ['Datum', formatDateDE(p.date)],
    ['Aktion', actionText(p) || '—'],
    ['AL', (p.al && p.al.full_name) || p.al_name_fallback || '—'],
    ['Personal', String((p.shifts || []).length)]
  ];
  return rows;
}

function sections(p) {
  const out = [];
  const issues = (p.protocol_equipments || [])
    .filter(eq => eq.status && eq.status !== 'okay')
    .map(eq => `${GEWERKE_LABELS[eq.category_id] || eq.category_id}: ${eq.status}` + (eq.note ? ` – ${eq.note}` : ''));
  if (issues.length) out.push(['Gewerke mit Problemen', issues]);
  if (!isEmptyNote(p.notes_damages)) out.push(['Mängel / Schäden', [p.notes_damages]]);
  if (!isEmptyNote(p.notes_incidents)) out.push(['Besondere Vorkommnisse', [p.notes_incidents]]);
  if (!isEmptyNote(p.notes_feedback)) out.push(['Feedback Location', [p.notes_feedback]]);
  const ratings = (p.worker_ratings || []).map(r => `${r.temp_worker_name}: ${ratingLabel(r)}`);
  if (ratings.length) out.push(['Bewertung Zenjob/Rockit', ratings]);
  return out;
}

export function buildBody(p) {
  const rows = summaryRows(p);
  const secs = sections(p);

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
    + secs.map(([title, lines]) => `\n\n${title}:\n` + lines.map(l => `- ${l}`).join('\n')).join('')
    + `\n\nDas vollständige Protokoll hängt als PDF an.\n\n${FOOTER}`;

  const td = 'padding:4px 12px 4px 0;vertical-align:top;';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">'
    + '<table style="border-collapse:collapse;">'
    + rows.map(([k, v]) => `<tr><td style="${td}color:#777;">${escapeHtml(k)}</td><td style="${td}font-weight:600;">${escapeHtml(v)}</td></tr>`).join('')
    + '</table>'
    + secs.map(([title, lines]) => `<h3 style="font-size:14px;margin:18px 0 6px;">${escapeHtml(title)}</h3><ul style="margin:0;padding-left:18px;">`
      + lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>').join('')
    + '<p style="margin-top:18px;">Das vollständige Protokoll hängt als PDF an.</p>'
    + `<p style="color:#999;font-size:12px;">${escapeHtml(FOOTER)}</p></div>`;

  return { html, text };
}

// Only attach real PDFs ("%PDF" = "JVBER" in base64); anything else is dropped
export function safePdfBase64(b64) {
  return typeof b64 === 'string' && b64.startsWith('JVBER') ? b64 : null;
}

export function attachmentName(p) {
  const proj = projectName(p).replace(/[^A-Za-z0-9äöüÄÖÜß_-]/g, '_');
  return `Protokoll_${proj}_${p.date || 'ohne-Datum'}.pdf`;
}
