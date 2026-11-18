// Abteilungs-Mails (Spec Teil B): Lager, Stoffe and Floristik get a short mail when their protocol area has feedback.
// Pure (no Deno/Node APIs) → testable with `node --test`. No staff, times, costs or signature ever go in.
import { escapeHtml, formatDateDE } from './mail.mjs';

// Fixed here on purpose: a protocol or a setting can never point a mail at another address
export const DEPARTMENTS = Object.freeze({
  lager: { label: 'Lager', to: 'lager@peterluebbert.de' },
  stoffe: { label: 'Stoffe', to: 'Stoffe@peterluebbert.de' },
  floristik: { label: 'Floristik', to: 'Florist@peterluebbert.de' },
});

export const DEFAULT_ROUTES = Object.freeze({ logistik: 'lager', mobiliar: 'lager', tischlerei: '', stoffe: 'stoffe', floristik: 'floristik' });

const AREA_LABELS = { mobiliar: 'Mobiliar', stoffe: 'Stoffe', floristik: 'Floristik', tischlerei: 'Tischlerei', logistik: 'Lager / Logistik' };
const AREA_ORDER = ['logistik', 'mobiliar', 'tischlerei', 'stoffe', 'floristik'];
const FOOTER = 'Automatisch gesendet von der Lübbert App';

function emptyNote(s) {
  const t = String(s == null ? '' : s).trim();
  return !t || /^(nein|—|-|okay|ok)$/i.test(t);
}

// area → department; unknown or '' → none. Only the three known departments are ever returned.
export function routeOf(area, routes) {
  const r = (routes && typeof routes === 'object' && area in routes) ? routes[area] : DEFAULT_ROUTES[area];
  return Object.prototype.hasOwnProperty.call(DEPARTMENTS, r) ? r : '';
}

// Feedback lines per department: { stoffe: ['Stoffe: beschädigt. Bemerkung: Riss', 'Hussen: 120 geliefert, 114 zurück, 6 fehlen'] }
export function departmentFeedback(p, routes) {
  const out = {};
  const eqs = (p && p.protocol_equipments || []).slice()
    .sort((a, b) => AREA_ORDER.indexOf(a.category_id) - AREA_ORDER.indexOf(b.category_id));
  for (const eq of eqs) {
    const dep = routeOf(eq.category_id, routes);
    if (!dep) continue;
    const lines = [];
    const status = String(eq.status || '').trim();
    const bad = status && status !== 'okay';
    const note = emptyNote(eq.note) ? '' : String(eq.note).trim();
    if (bad || note) lines.push(`${AREA_LABELS[eq.category_id] || eq.category_id}: ${status || 'okay'}` + (note ? `. Bemerkung: ${note}` : ''));
    const del = Number(eq.hussen_delivered), ret = Number(eq.hussen_returned);
    if (eq.category_id === 'stoffe' && eq.hussen_delivered != null && eq.hussen_returned != null && del > ret) {
      lines.push(`Hussen: ${del} geliefert, ${ret} zurück, ${del - ret} fehlen`);
    }
    if (lines.length) out[dep] = (out[dep] || []).concat(lines);
  }
  return out;
}

// FNV-1a over the sorted lines: same feedback → same hash (unique key in department_mail_log)
export function feedbackHash(lines) {
  let h = 0x811c9dc5;
  const s = (lines || []).slice().sort().join('\n');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// Which mails to send now. log = earlier department_mail_log rows of this protocol ({department, items}).
// A department gets a mail only for lines it has never been sent; a removed damage sends nothing.
export function planDepartmentMails(feedback, log) {
  const sent = {};
  for (const r of log || []) {
    (sent[r.department] = sent[r.department] || new Set());
    for (const it of (Array.isArray(r.items) ? r.items : [])) sent[r.department].add(it);
  }
  const out = [];
  for (const dep of Object.keys(DEPARTMENTS)) {
    const lines = (feedback && feedback[dep]) || [];
    if (!lines.length) continue;
    const before = sent[dep];
    if (before && lines.every(l => before.has(l))) continue;
    out.push({ department: dep, lines, isSupplement: !!before, hash: feedbackHash(lines) });
  }
  return out;
}

function projectName(p) { return (p.projects && p.projects.name) || 'Protokoll'; }

// "Rückmeldung Stoffe: Hagebau, Estrel, 17.11.2026"; a later mail for the same protocol says "Ergänzung"
export function buildDepartmentSubject(p, dep, isSupplement, testMode) {
  const loc = (p.projects && p.projects.location) || '';
  const core = `${isSupplement ? 'Ergänzung ' : ''}Rückmeldung ${DEPARTMENTS[dep].label}: ${[projectName(p), loc, formatDateDE(p.date)].filter(Boolean).join(', ')}`;
  return testMode ? `[TEST → ${DEPARTMENTS[dep].label}] ${core}` : core;
}

export function buildDepartmentBody(p, dep, lines, isSupplement) {
  const action = String(p.action || '').trim();
  const rows = [
    ['Projekt', projectName(p)],
    ['Projektnummer', p.job_no || '—'],
    ['Ort', (p.projects && p.projects.location) || '—'],
    ['Datum', formatDateDE(p.date)],
    ['Aktion', action && action !== '—' ? action : '—'],
    ['AL', (p.al && p.al.full_name) || p.al_name_fallback || '—'],
    ['PL', (p.pl && p.pl.full_name) || p.pl_name_fallback || '—'],
  ];
  if (p.side_of) rows.push(['Zusatzauftrag', 'im Zuge von ' + ((p.main && p.main.projects && p.main.projects.name) || 'Hauptprotokoll')]);
  const title = `Rückmeldung ${DEPARTMENTS[dep].label}` + (isSupplement ? ' (Ergänzung)' : '');
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${title}:\n` + lines.map(l => `- ${l}`).join('\n')
    + `\n\nFragen dazu bitte an AL oder PL.\n\n${FOOTER}`;
  const td = 'padding:4px 12px 4px 0;vertical-align:top;';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;"><table style="border-collapse:collapse;">'
    + rows.map(([k, v]) => `<tr><td style="${td}color:#777;">${escapeHtml(k)}</td><td style="${td}font-weight:600;">${escapeHtml(v)}</td></tr>`).join('')
    + `</table><h3 style="font-size:14px;margin:18px 0 6px;">${escapeHtml(title)}</h3><ul style="margin:0;padding-left:18px;">`
    + lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>'
    + '<p style="margin-top:18px;">Fragen dazu bitte an AL oder PL.</p>'
    + `<p style="color:#999;font-size:12px;">${escapeHtml(FOOTER)}</p></div>`;
  return { text, html };
}

// Recipient: off → none; test mode (global or for departments) → TEST_RECIPIENT or held back; else the fixed address
export function departmentRecipient(dep, { enabled, testMode, testRecipient }) {
  if (!enabled) return { to: null, reason: 'disabled', test: false };
  if (testMode) return testRecipient ? { to: testRecipient, reason: null, test: true } : { to: null, reason: 'not_configured', test: true };
  return { to: DEPARTMENTS[dep].to, reason: null, test: false };
}
