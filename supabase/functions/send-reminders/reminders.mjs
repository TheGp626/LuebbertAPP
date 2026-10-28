// Pure reminder logic for send-reminders (no Deno/Node APIs → testable with `node --test`)
import { planGuessAction, planWhen } from '../_shared/plan-time.mjs';

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

export function berlinHour(now) {
  return berlinParts(now).hour;
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

// ── Plan jobs (Wochenplan → reminders): one job per AL + date ──

// planRows: [{al_id, date, venue, title, wann (text), ap_user_id}] from plan AL assignments.
// A non-cancelled folder job on the same AL + date wins (it has its own PL and log).
export function mergePlanJobs(folderJobs, planRows) {
  const taken = new Set((folderJobs || []).filter(e => !e.cancelled).map(e => `${e.al_id}|${e.date}`));
  const byKey = new Map();
  for (const r of planRows || []) {
    const key = `${r.al_id}|${r.date}`;
    if (taken.has(key)) continue;
    if (!byKey.has(key)) byKey.set(key, { source: 'plan', al_id: r.al_id, date: r.date, cancelled: false, venues: [], titles: [], wann: [], pl_ids: [] });
    const j = byKey.get(key);
    if (r.venue && !j.venues.includes(r.venue)) j.venues.push(r.venue);
    if (r.title) j.titles.push(r.title);
    if (r.wann) j.wann.push(...String(r.wann).split('\n'));
    if (r.ap_user_id && !j.pl_ids.includes(r.ap_user_id)) j.pl_ids.push(r.ap_user_id);
  }
  return [...byKey.values()];
}

// First job date that counts for plan reminders: the later of the lookback start and the (Berlin) day the
// switch was turned on — switching on must not flood the PLs with mails about weeks before
export function planWindowStart(lookbackFrom, enabledAtIso) {
  if (!enabledAtIso) return lookbackFrom;
  const enabledDay = berlinDate(new Date(enabledAtIso));
  return enabledDay > lookbackFrom ? enabledDay : lookbackFrom;
}

// groups: [{keys:[{al_id,date}], resolved}] — one per PL mail. A plan job (AL + date) is logged as mailed only
// when every PL mail it belongs to is resolved (sent, or nothing to retry); otherwise all stay pending
export function planMailLogKeys(groups) {
  const state = new Map();
  for (const g of groups) {
    for (const k of g.keys) {
      const id = `${k.al_id}|${k.date}`;
      const prev = state.get(id);
      state.set(id, { key: k, ok: (prev ? prev.ok : true) && g.resolved });
    }
  }
  return [...state.values()].filter(s => s.ok).map(s => s.key);
}

export function planJobVenue(job) {
  return job.venues.join(' / ') || 'Einsatz';
}

// One push per AL; the tap opens the protocol for the oldest date (date link survives plan re-uploads)
export function groupPlanPushes(jobs) {
  const byAl = new Map();
  for (const j of jobs) {
    if (!byAl.has(j.al_id)) byAl.set(j.al_id, []);
    byAl.get(j.al_id).push(j);
  }
  return [...byAl.entries()].map(([al_id, list]) => {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const first = list[0];
    const body = list.length === 1
      ? `${planJobVenue(first)} – ${planGuessAction(first.wann)} am ${shortDate(first.date)}`
      : `${list.length} offene Protokolle: ` + list.map(j => `${planJobVenue(j)} (${shortDate(j.date)})`).join(', ');
    return { al_id, title: 'Protokoll fehlt', body, url: `./index.html?open=protokoll&datum=${first.date}`,
      keys: list.map(j => ({ al_id: j.al_id, date: j.date })) };
  });
}

// ── Evening push: one message per AL about tomorrow ──
// items: {al_id, date, source:'plan', venue, title, wann[], team[], open[{count,role}], pl}
//      | {al_id, date, source:'folder', folderName, action}
// Plan details win: a folder job is only used for an AL without plan jobs tomorrow.
export function buildEveningPushes(items) {
  const byAl = new Map();
  for (const it of items) {
    if (!byAl.has(it.al_id)) byAl.set(it.al_id, []);
    byAl.get(it.al_id).push(it);
  }
  const out = [];
  for (const [al_id, all] of byAl) {
    const plan = all.filter(i => i.source === 'plan');
    const list = plan.length ? plan : all;
    if (!plan.length) {
      const f = list[0];
      out.push({ al_id, title: list.length === 1 ? `Morgen: ${f.folderName} – ${f.action}` : `Morgen ${list.length} Einsätze`,
        body: list.length === 1 ? '' : list.map(i => i.folderName).join(' · '), url: './index.html' });
      continue;
    }
    const withTime = list.map(i => ({ i, w: planWhen(i.wann || []) }))
      .sort((a, b) => (a.w.time ? 0 : 1) - (b.w.time ? 0 : 1) || (a.w.time || '').localeCompare(b.w.time || ''));
    if (withTime.length > 1) {
      // Several rooms of one event at the same time read as one entry
      const entries = [...new Set(withTime.map(({ i, w }) => (w.time ? w.time + ' ' : '') + i.venue))];
      out.push({ al_id, title: `Morgen ${withTime.length} Einsätze`, body: entries.join(' · '), url: './index.html?open=wochenplan' });
      continue;
    }
    const { i, w } = withTime[0];
    const title = `Morgen: ${i.venue}` + (i.title && i.title !== i.venue && !/^\d+\s+\S/.test(i.title) ? ` · ${i.title}` : ''); // "7 Loungesessel …" = equipment, no heading
    const time = w.time ? [w.time, w.label].filter(Boolean).join(' ') : '';
    const missing = (i.open || []).map(o => `${o.count} ${o.role} ${o.count === 1 ? 'fehlt' : 'fehlen'}`);
    const team = [(i.team || []).slice(0, 3).join(', '), ...missing].filter(Boolean).join(', ');
    const body = [time, team, i.pl ? `PL ${i.pl}` : ''].filter(Boolean).join(' · ');
    out.push({ al_id, title, body, url: './index.html?open=wochenplan' });
  }
  return out;
}

// ── Test push (admin settings tab, body {mode:'test', user_id, pin}) ──
// The Berlin time in the text tells several tests apart
export function testPush(nowIso) {
  const time = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }).format(new Date(nowIso));
  return { title: 'Test-Push', body: `Push-Benachrichtigungen funktionieren auf diesem Gerät (${time} Uhr).`, url: './index.html' };
}

// pushTo result → answer for the app
export function testPushResult(r) {
  if (r.ok > 0) return { status: 'sent', devices: r.ok, ...(r.failed ? { failed: r.failed } : {}) };
  if (r.failed > 0) return { status: 'failed', devices: 0, failed: r.failed };
  return { status: 'no_device', devices: 0, ...(r.removed ? { removed: r.removed } : {}) };
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
