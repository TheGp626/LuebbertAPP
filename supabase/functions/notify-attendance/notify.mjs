// Pure push building for notify-attendance (no Deno/Node APIs → testable with `node --test`)

export const ATTENDANCE_LABELS = Object.freeze({
  verspaetet: 'verspätet', abgesagt: 'kurzfristig abgesagt', krank: 'krank', nicht_erschienen: 'nicht erschienen',
});
// Statuses the Personalteam hears about at once (Jenni: the last three of the list)
export const ALERT_STATUSES = Object.freeze(['abgesagt', 'krank', 'nicht_erschienen']);

const ddmm = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}.${p[1]}.` : ''; };

// rows: [{status, name}] of one protocol, prot: {date, job_no, project}, recipients: [user ids]
// One push per recipient listing everyone of the protocol. Returns [{user_id, title, body, url}].
export function buildAttendancePushes(rows, prot, recipients) {
  const hits = (rows || []).filter((r) => ALERT_STATUSES.includes(r.status));
  if (!hits.length) return [];
  const who = hits.map((r) => `${r.name || 'Ohne Name'} ${ATTENDANCE_LABELS[r.status]}`).join(', ');
  const where = [prot && prot.project, prot && prot.job_no, prot && ddmm(prot.date)].filter(Boolean).join(' · ');
  const title = hits.length === 1 ? 'Ausfall im Einsatz' : `${hits.length} Ausfälle im Einsatz`;
  const body = where ? `${who} (${where})` : who;
  return [...new Set(recipients || [])].map((user_id) => ({ user_id, title, body, url: './index.html' }));
}
