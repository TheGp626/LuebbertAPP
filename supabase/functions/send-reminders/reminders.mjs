// Pure reminder logic for send-reminders (no Deno/Node APIs → testable with `node --test`)

const FOOTER = 'Automatisch gesendet von der Lübbert App';
const PUSH_DAYS_MAX = 5;   // day 1–5 after the job: push to the AL
const PL_MAIL_DAY = 6;     // day 6: one mail to the folder's PL …
const PL_MAIL_LAST_DAY = 10; // … retried daily until it went out once (a failed 9:00 run must not drop it)
export const LOOKBACK_DAYS = PL_MAIL_LAST_DAY;

function berlinParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

export function berlinDate(now) {
  return berlinParts(now).date;
}

export function isBerlinNineAm(now) {
  return berlinParts(now).hour === 9;
}

// Whole calendar days between two YYYY-MM-DD dates (date-only math, DST-safe)
export function daysSince(einsatzDate, todayBerlin) {
  const toUtc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(todayBerlin) - toUtc(einsatzDate)) / 86400000);
}

// plMailed: a pl_mail for this job was already sent on an earlier day
export function classify(einsatz, hasProtocol, todayBerlin, plMailed = false) {
  if (einsatz.cancelled || hasProtocol) return 'none';
  const d = daysSince(einsatz.date, todayBerlin);
  if (d >= 1 && d <= PUSH_DAYS_MAX) return 'push';
  if (d >= PL_MAIL_DAY && d <= PL_MAIL_LAST_DAY && !plMailed) return 'pl_mail';
  return 'none';
}

function shortDate(iso) { const [, m, d] = iso.split('-'); return `${d}.${m}.`; }
function longDate(iso) { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; }

export function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// One push per AL; the tap opens the oldest open job
export function groupPushes(items) {
  const byAl = new Map();
  items.forEach(it => {
    if (!byAl.has(it.einsatz.al_id)) byAl.set(it.einsatz.al_id, []);
    byAl.get(it.einsatz.al_id).push(it);
  });
  return [...byAl.entries()].map(([al_id, list]) => {
    list.sort((a, b) => a.einsatz.date.localeCompare(b.einsatz.date));
    const first = list[0];
    const body = list.length === 1
      ? `${first.folderName} – ${first.einsatz.action} am ${shortDate(first.einsatz.date)}`
      : `${list.length} offene Protokolle: ` + list.map(it => `${it.folderName} (${shortDate(it.einsatz.date)})`).join(', ');
    return {
      al_id,
      title: 'Protokoll fehlt',
      body,
      url: `./index.html?open=protokoll&einsatz=${first.einsatz.id}`,
      einsatz_ids: list.map(it => it.einsatz.id),
    };
  });
}

// Day-6 mail to one PL listing all of their overdue jobs
export function plMail(items) {
  const sorted = [...items].sort((a, b) => a.einsatz.date.localeCompare(b.einsatz.date));
  const subject = sorted.length === 1
    ? `Protokoll fehlt seit 6 Tagen: ${sorted[0].folderName} – ${shortDate(sorted[0].einsatz.date)}`
    : `${sorted.length} Protokolle fehlen seit 6 Tagen`;
  const lines = sorted.map(it => `${it.folderName} – ${it.einsatz.action} am ${longDate(it.einsatz.date)} (AL: ${it.alName || '—'})`);
  const intro = 'Für diese Einsätze fehlt seit 6 Tagen das Protokoll. Die Aufbauleitung wurde täglich erinnert.';
  const text = `${intro}\n\n` + lines.map(l => `- ${l}`).join('\n') + `\n\n${FOOTER}`;
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">'
    + `<p>${escapeHtml(intro)}</p><ul>` + lines.map(l => `<li>${escapeHtml(l)}</li>`).join('') + '</ul>'
    + `<p style="color:#999;font-size:12px;">${escapeHtml(FOOTER)}</p></div>`;
  return { subject, text, html };
}
