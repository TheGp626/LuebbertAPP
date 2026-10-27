// send-reminders: daily 9:00 (Berlin) reminders for planned jobs without a protocol.
// Day 1–5 after the job → Web Push to the AL; from day 6 one mail to the PL (retried until day 10).
// Jobs come from project folders (einsaetze) and, when switched on, from the Wochenplan (AL + date).
// Cron runs several times in the 9:00 hour; reminder_log / plan_reminder_log make later runs no-ops and retry failures.
// Body: { mode? ("evening" → evening push), force?, only_user_id?, dry_run? (list only, send/log nothing), plan_override? (daily dry runs: treat plan reminders as on) }
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { berlinDate, isBerlinNineAm, classify, groupPushes, plMail, mergePlanJobs, groupPlanPushes, planJobVenue, planWindowStart, buildEveningPushes, berlinHour, LOOKBACK_DAYS } from './reminders.mjs';
import { gmailConfigured, sendGmail } from '../_shared/gmail.ts';
import { loadSettings } from '../_shared/settings.ts';
import { chooseRecipient } from '../_shared/recipient.mjs';
import { planGuessAction } from '../_shared/plan-time.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function shiftDate(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

type Input = { force?: boolean; only_user_id?: string; dry_run?: boolean; plan_override?: boolean; mode?: string };
// deno-lint-ignore no-explicit-any
type Db = any;
type Push = { al_id: string; title: string; body: string; url: string };

// Sends one push to all devices of a user. ok = devices reached, failed = retryable failures
async function pushTo(db: Db, userId: string, p: Push) {
  const { data: subs, error: subErr } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
  if (subErr) { console.error('send-reminders: load subscriptions failed', subErr); return { ok: 0, failed: 1, removed: 0 }; }
  let ok = 0, failed = 0, removed = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: p.title, body: p.body, url: p.url }), { TTL: 86400 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        removed++;
      } else {
        console.error('send-reminders: push failed', code, e);
        failed++;
      }
    }
  }
  return { ok, failed, removed };
}

function vapidReady() {
  try {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY') || '', Deno.env.get('VAPID_PRIVATE_KEY') || '');
    return true;
  } catch (e) {
    console.error('send-reminders: VAPID not configured', (e as Error).message);
    return false;
  }
}

async function runDaily(db: Db, input: Input, settings: Record<string, unknown>, now: Date) {
  if (!input.force && !isBerlinNineAm(now)) return json({ skipped: 'not_9am' });
  if (!settings.reminders_enabled && !input.dry_run) return json({ skipped: 'disabled' });
  const today = berlinDate(now);
  const from = shiftDate(today, -LOOKBACK_DAYS), to = shiftDate(today, -1);
  const dry = !!input.dry_run;

  // ── Folder jobs ──
  let q = db.from('einsaetze')
    .select(`id, date, action, al_id, cancelled,
      folder:project_folders(name, pl_id, pl:app_users!project_folders_pl_id_fkey(full_name, email)),
      al:app_users!einsaetze_al_id_fkey(full_name)`)
    .eq('cancelled', false).gte('date', from).lte('date', to);
  if (input.only_user_id) q = q.eq('al_id', input.only_user_id);
  const { data: einsaetze, error } = await q;
  if (error) { console.error('send-reminders: load einsaetze failed', error); return json({ error: 'db_error' }, 500); }

  // ── Plan jobs (AL + date) ──
  let planJobs: ReturnType<typeof mergePlanJobs> = [];
  const planOn = settings.plan_reminders_enabled || (dry && input.plan_override);
  if (planOn) {
    // Only jobs from the day the switch went on (dry-run overrides look at the whole window)
    let planFrom = from;
    if (settings.plan_reminders_enabled) {
      const { data: sw } = await db.from('app_settings').select('updated_at').eq('key', 'plan_reminders_enabled').maybeSingle();
      planFrom = planWindowStart(from, sw?.updated_at || null);
    }
    let pq = db.from('plan_assignments')
      .select('user_id, role, shift:plan_shifts!inner(date, venue, title, wann, ap_user_id)')
      .eq('role', 'AL').not('user_id', 'is', null)
      .gte('shift.date', planFrom).lte('shift.date', to);
    if (input.only_user_id) pq = pq.eq('user_id', input.only_user_id);
    const { data: rows, error: rErr } = await pq;
    if (rErr) { console.error('send-reminders: load plan failed', rErr); return json({ error: 'db_error' }, 500); }
    planJobs = mergePlanJobs(einsaetze || [], (rows || []).map((r: Db) => ({ al_id: r.user_id, date: r.shift.date, venue: r.shift.venue,
      title: r.shift.title, wann: r.shift.wann, ap_user_id: r.shift.ap_user_id })));
  }
  if (!(einsaetze || []).length && !planJobs.length) return json({ pushed: 0, mailed: 0, removed_subscriptions: 0, ...(dry ? { dry_run: true } : {}) });

  // Which (al_id, date) pairs already have a protocol
  const all = [...(einsaetze || []), ...planJobs];
  const { data: prots, error: pErr } = await db.from('protocols').select('al_id, date')
    .in('al_id', [...new Set(all.map(e => e.al_id))]).in('date', [...new Set(all.map(e => e.date))]);
  if (pErr) { console.error('send-reminders: load protocols failed', pErr); return json({ error: 'db_error' }, 500); }
  const done = new Set((prots || []).map((p: Db) => `${p.al_id}|${p.date}`));

  // Today's sends (any kind) + PL mails from earlier days; a failed read must not cause double sends
  let already = new Set<string>(), plMailedEarlier = new Set<string>();
  if ((einsaetze || []).length) {
    const { data: logged, error: logErr } = await db.from('reminder_log').select('einsatz_id, kind, day')
      .in('einsatz_id', einsaetze.map((e: Db) => e.id)).or(`day.eq.${today},kind.eq.pl_mail`);
    if (logErr) { console.error('send-reminders: load reminder_log failed', logErr); return json({ error: 'db_error' }, 500); }
    already = new Set((logged || []).filter((l: Db) => l.day === today).map((l: Db) => `${l.einsatz_id}|${l.kind}`));
    plMailedEarlier = new Set((logged || []).filter((l: Db) => l.kind === 'pl_mail').map((l: Db) => l.einsatz_id));
  }
  let planAlready = new Set<string>(), planMailedEarlier = new Set<string>();
  if (planJobs.length) {
    const { data: pl, error: plErr } = await db.from('plan_reminder_log').select('al_id, date, day, kind')
      .in('al_id', [...new Set(planJobs.map(j => j.al_id))]).or(`day.eq.${today},kind.eq.pl_mail`);
    if (plErr) { console.error('send-reminders: load plan_reminder_log failed', plErr); return json({ error: 'db_error' }, 500); }
    planAlready = new Set((pl || []).filter((l: Db) => l.day === today).map((l: Db) => `${l.al_id}|${l.date}|${l.kind}`));
    planMailedEarlier = new Set((pl || []).filter((l: Db) => l.kind === 'pl_mail').map((l: Db) => `${l.al_id}|${l.date}`));
  }

  // ── Classify ──
  const pushItems: Db[] = [], mailItems: Db[] = [], planPush: typeof planJobs = [], planMail: typeof planJobs = [];
  for (const e of einsaetze || []) {
    const kind = classify(e, done.has(`${e.al_id}|${e.date}`), today, plMailedEarlier.has(e.id));
    if (kind === 'none' || already.has(`${e.id}|${kind}`)) continue;
    const folderName = e.folder?.name || 'Projekt';
    if (kind === 'push') pushItems.push({ einsatz: e, folderName });
    else mailItems.push({ einsatz: e, folderName, alName: e.al?.full_name || '—' });
  }
  for (const j of planJobs) {
    const k = `${j.al_id}|${j.date}`;
    const kind = classify(j, done.has(k), today, planMailedEarlier.has(k));
    if (kind === 'none' || planAlready.has(`${k}|${kind}`)) continue;
    (kind === 'push' ? planPush : planMail).push(j);
  }

  // Names/emails for plan ALs and PLs
  const userIds = [...new Set([...planMail.map(j => j.al_id), ...planMail.flatMap(j => j.pl_ids)])];
  const users = new Map<string, { full_name: string; email: string | null }>();
  if (userIds.length) {
    const { data: us, error: uErr } = await db.from('app_users').select('id, full_name, email').in('id', userIds);
    if (uErr) { console.error('send-reminders: load users failed', uErr); return json({ error: 'db_error' }, 500); }
    (us || []).forEach((u: Db) => users.set(u.id, u));
  }

  const folderPushes = groupPushes(pushItems), planPushes = groupPlanPushes(planPush);
  // PL mails: one per PL; plan jobs without PL go to the 'none' bucket like folders without PL
  type MailGroup = { plId: string | null; plName: string; plEmail: string; items: Db[]; logFolder: string[]; logPlan: { al_id: string; date: string }[] };
  const groups = new Map<string, MailGroup>();
  const group = (plId: string | null, plName: string, plEmail: string) => {
    const key = plId || 'none';
    if (!groups.has(key)) groups.set(key, { plId, plName, plEmail, items: [], logFolder: [], logPlan: [] });
    return groups.get(key)!;
  };
  for (const it of mailItems) {
    const g = group(it.einsatz.folder?.pl_id || null, it.einsatz.folder?.pl?.full_name || 'keine PL', it.einsatz.folder?.pl?.email || '');
    g.items.push(it); g.logFolder.push(it.einsatz.id);
  }
  for (const j of planMail) {
    const item = { einsatz: { date: j.date, action: planGuessAction(j.wann) }, folderName: planJobVenue(j), alName: users.get(j.al_id)?.full_name || '—' };
    const pls = j.pl_ids.length ? j.pl_ids : [null];
    for (const plId of pls) {
      const u = plId ? users.get(plId) : null;
      const g = group(plId, u?.full_name || 'keine PL', u?.email || '');
      g.items.push(item);
      if (!g.logPlan.some(x => x.al_id === j.al_id && x.date === j.date)) g.logPlan.push({ al_id: j.al_id, date: j.date });
    }
  }
  const testRecipient = Deno.env.get('TEST_RECIPIENT') || '';
  const mailPlans = [...groups.values()].map(g => ({ g, rcpt: chooseRecipient({ mailEnabled: true, testMode: settings.mail_test_mode as boolean,
    testRecipient, plEmail: g.plEmail, plId: g.plId }), m: plMail(g.items) }));

  if (dry) {
    return json({ dry_run: true, enabled: settings.reminders_enabled, plan_enabled: settings.plan_reminders_enabled,
      pushes: [...folderPushes.map(p => ({ al_id: p.al_id, title: p.title, body: p.body, url: p.url })), ...planPushes.map(p => ({ al_id: p.al_id, title: p.title, body: p.body, url: p.url }))],
      mails: mailPlans.map(x => ({ pl: x.g.plName, to: x.rcpt.to ? (x.rcpt.test ? 'TEST_RECIPIENT' : 'PL') : null, reason: x.rcpt.reason, subject: x.m.subject })) });
  }

  const log = async (ids: string[], kind: 'push' | 'pl_mail') => {
    if (!ids.length) return;
    const { error: lErr } = await db.from('reminder_log').upsert(ids.map(id => ({ einsatz_id: id, day: today, kind })), { ignoreDuplicates: true });
    if (lErr) console.error('send-reminders: log failed', lErr);
  };
  const logPlan = async (keys: { al_id: string; date: string }[], kind: 'push' | 'pl_mail') => {
    if (!keys.length) return;
    const { error: lErr } = await db.from('plan_reminder_log').upsert(keys.map(k => ({ ...k, day: today, kind })), { ignoreDuplicates: true });
    if (lErr) console.error('send-reminders: plan log failed', lErr);
  };

  // ── Push (one per AL and source) ──
  let pushed = 0, removed = 0;
  const vapid = (folderPushes.length || planPushes.length) ? vapidReady() : false;
  if (vapid) {
    for (const g of folderPushes) {
      const r = await pushTo(db, g.al_id, g);
      pushed += r.ok; removed += r.removed;
      // Logged when at least one device got it, or when there's nothing to retry (no device / only dead ones)
      if (r.ok > 0 || r.failed === 0) await log(g.einsatz_ids, 'push');
    }
    for (const g of planPushes) {
      const r = await pushTo(db, g.al_id, g);
      pushed += r.ok; removed += r.removed;
      if (r.ok > 0 || r.failed === 0) await logPlan(g.keys, 'push');
    }
  }

  // ── Day-6 mail (one per PL) ──
  let mailed = 0;
  for (const { g, rcpt, m } of mailPlans) {
    if (rcpt.reason === 'no_pl' || rcpt.reason === 'no_email') {
      console.error('send-reminders: kein PL/E-Mail für', g.items.map((it: Db) => it.folderName).join(', '));
      await log(g.logFolder, 'pl_mail'); await logPlan(g.logPlan, 'pl_mail'); // nothing to retry
      continue;
    }
    if (rcpt.reason) { console.error('send-reminders: PL mail held back', rcpt.reason); continue; } // not_configured → retried
    if (!gmailConfigured()) { console.error('send-reminders: Gmail not configured'); continue; }
    try {
      await sendGmail({ to: rcpt.to!, subject: rcpt.test ? `[TEST → ${g.plName}] ${m.subject}` : m.subject, text: m.text, html: m.html });
      mailed++;
      await log(g.logFolder, 'pl_mail'); await logPlan(g.logPlan, 'pl_mail');
    } catch (e) {
      console.error('send-reminders: PL mail failed', e);
    }
  }

  return json({ pushed, mailed, removed_subscriptions: removed, ...((folderPushes.length || planPushes.length) && !vapid ? { push_skipped: 'vapid_not_configured' } : {}) });
}

// Evening push (cron 'send-evening-push', body {"mode":"evening"}): one message per AL about tomorrow.
// Runs every 15 min in the afternoon/evening; sends once the Berlin hour equals evening_push_hour, at most once per AL per evening.
async function runEvening(db: Db, input: Input, settings: Record<string, unknown>, now: Date) {
  const dry = !!input.dry_run;
  if (!settings.evening_push_enabled && !dry) return json({ skipped: 'disabled' });
  if (!input.force && berlinHour(now) !== settings.evening_push_hour) return json({ skipped: 'not_time' });
  const today = berlinDate(now), tomorrow = shiftDate(today, 1);

  let pq = db.from('plan_assignments')
    .select('user_id, shift:plan_shifts!inner(date, sort, venue, title, wann, ap, open_slots, plan_assignments(name, role, user_id))')
    .eq('role', 'AL').not('user_id', 'is', null).eq('shift.date', tomorrow);
  if (input.only_user_id) pq = pq.eq('user_id', input.only_user_id);
  const { data: rows, error: rErr } = await pq;
  if (rErr) { console.error('send-reminders: evening plan load failed', rErr); return json({ error: 'db_error' }, 500); }
  let fq = db.from('einsaetze').select('al_id, date, action, folder:project_folders(name)').eq('cancelled', false).eq('date', tomorrow);
  if (input.only_user_id) fq = fq.eq('al_id', input.only_user_id);
  const { data: folder, error: fErr } = await fq;
  if (fErr) { console.error('send-reminders: evening folder load failed', fErr); return json({ error: 'db_error' }, 500); }

  const agency = ['Zenjob', 'ROCKiT'];
  const items = [
    ...(rows || []).sort((a: Db, b: Db) => a.shift.sort - b.shift.sort).map((r: Db) => ({
      al_id: r.user_id, date: tomorrow, source: 'plan', venue: r.shift.venue || 'Einsatz', title: r.shift.title || '',
      wann: r.shift.wann ? String(r.shift.wann).split('\n') : [],
      team: (r.shift.plan_assignments || []).filter((a: Db) => a.user_id !== r.user_id && agency.indexOf(a.role) === -1).map((a: Db) => String(a.name).split(' ')[0]),
      open: r.shift.open_slots || [], pl: r.shift.ap || null,
    })),
    ...(folder || []).map((e: Db) => ({ al_id: e.al_id, date: tomorrow, source: 'folder', folderName: e.folder?.name || 'Projekt', action: e.action })),
  ];
  if (!items.length) return json({ pushed: 0, ...(dry ? { dry_run: true, pushes: [] } : {}) });

  const { data: logged, error: lErr } = await db.from('plan_reminder_log').select('al_id')
    .in('al_id', [...new Set(items.map(i => i.al_id))]).eq('date', tomorrow).eq('day', today).eq('kind', 'evening');
  if (lErr) { console.error('send-reminders: evening log read failed', lErr); return json({ error: 'db_error' }, 500); }
  const done = new Set((logged || []).map((l: Db) => l.al_id));
  const pushes = buildEveningPushes(items.filter(i => !done.has(i.al_id)));
  if (dry) return json({ dry_run: true, enabled: settings.evening_push_enabled, hour: settings.evening_push_hour, tomorrow, pushes });
  if (!pushes.length) return json({ pushed: 0 });
  if (!vapidReady()) return json({ pushed: 0, push_skipped: 'vapid_not_configured' });

  let pushed = 0, removed = 0;
  for (const p of pushes) {
    const r = await pushTo(db, p.al_id, p);
    pushed += r.ok; removed += r.removed;
    if (r.ok > 0 || r.failed === 0) {
      const { error: wErr } = await db.from('plan_reminder_log')
        .upsert({ al_id: p.al_id, date: tomorrow, day: today, kind: 'evening' }, { ignoreDuplicates: true });
      if (wErr) console.error('send-reminders: evening log failed', wErr);
    }
  }
  return json({ pushed, users: pushes.length, removed_subscriptions: removed });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let input: Input = {};
  try { input = await req.json(); } catch { /* empty body from cron */ }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const settings = await loadSettings(db);
  const now = new Date();
  return input.mode === 'evening' ? runEvening(db, input, settings, now) : runDaily(db, input, settings, now);
});
