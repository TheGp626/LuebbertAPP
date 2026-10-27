// send-reminders: daily 9:00 (Berlin) reminders for planned jobs without a protocol.
// Day 1–5 after the job → Web Push to the AL; from day 6 one mail to the folder's PL (retried until day 10).
// Cron runs several times in the 9:00 hour; reminder_log makes the later runs no-ops and retries failures.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { berlinDate, isBerlinNineAm, classify, groupPushes, plMail, LOOKBACK_DAYS } from './reminders.mjs';
import { gmailConfigured, sendGmail } from '../_shared/gmail.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let input: { force?: boolean; only_user_id?: string } = {};
  try { input = await req.json(); } catch { /* empty body from cron */ }

  const now = new Date();
  if (!input.force && !isBerlinNineAm(now)) return json({ skipped: 'not_9am' });
  const today = berlinDate(now);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let q = db.from('einsaetze')
    .select(`id, date, action, al_id, cancelled,
      folder:project_folders(name, pl_id, pl:app_users!project_folders_pl_id_fkey(full_name, email)),
      al:app_users!einsaetze_al_id_fkey(full_name)`)
    .eq('cancelled', false)
    .gte('date', shiftDate(today, -LOOKBACK_DAYS))
    .lte('date', shiftDate(today, -1));
  if (input.only_user_id) q = q.eq('al_id', input.only_user_id);
  const { data: einsaetze, error } = await q;
  if (error) { console.error('send-reminders: load einsaetze failed', error); return json({ error: 'db_error' }, 500); }
  if (!einsaetze || !einsaetze.length) return json({ pushed: 0, mailed: 0, removed_subscriptions: 0 });

  // Which (al_id, date) pairs already have a protocol
  const { data: prots, error: pErr } = await db.from('protocols').select('al_id, date')
    .in('al_id', [...new Set(einsaetze.map(e => e.al_id))])
    .in('date', [...new Set(einsaetze.map(e => e.date))]);
  if (pErr) { console.error('send-reminders: load protocols failed', pErr); return json({ error: 'db_error' }, 500); }
  const done = new Set((prots || []).map(p => `${p.al_id}|${p.date}`));

  // Today's sends (any kind) + PL mails from earlier days; a failed read must not cause double sends
  const { data: logged, error: logErr } = await db.from('reminder_log').select('einsatz_id, kind, day')
    .in('einsatz_id', einsaetze.map(e => e.id))
    .or(`day.eq.${today},kind.eq.pl_mail`);
  if (logErr) { console.error('send-reminders: load reminder_log failed', logErr); return json({ error: 'db_error' }, 500); }
  const already = new Set((logged || []).filter(l => l.day === today).map(l => `${l.einsatz_id}|${l.kind}`));
  const plMailedEarlier = new Set((logged || []).filter(l => l.kind === 'pl_mail').map(l => l.einsatz_id));

  const pushItems: { einsatz: typeof einsaetze[number]; folderName: string }[] = [];
  const mailItems: { einsatz: typeof einsaetze[number]; folderName: string; alName: string }[] = [];
  for (const e of einsaetze) {
    const kind = classify(e, done.has(`${e.al_id}|${e.date}`), today, plMailedEarlier.has(e.id));
    if (kind === 'none' || already.has(`${e.id}|${kind}`)) continue;
    const folderName = e.folder?.name || 'Projekt';
    if (kind === 'push') pushItems.push({ einsatz: e, folderName });
    else mailItems.push({ einsatz: e, folderName, alName: e.al?.full_name || '—' });
  }

  const log = async (ids: string[], kind: 'push' | 'pl_mail') => {
    if (!ids.length) return;
    const { error: lErr } = await db.from('reminder_log').upsert(ids.map(id => ({ einsatz_id: id, day: today, kind })), { ignoreDuplicates: true });
    if (lErr) console.error('send-reminders: log failed', lErr);
  };

  // ── Push (one per AL) ──
  let pushed = 0, removed = 0;
  let vapidReady = false;
  if (pushItems.length) {
    // Missing/invalid VAPID secrets must not block the PL mails below; nothing is logged, so it retries later
    try {
      webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@example.com',
        Deno.env.get('VAPID_PUBLIC_KEY') || '', Deno.env.get('VAPID_PRIVATE_KEY') || '');
      vapidReady = true;
    } catch (e) {
      console.error('send-reminders: VAPID not configured', (e as Error).message);
    }
  }
  if (vapidReady) {
    for (const g of groupPushes(pushItems)) {
      const { data: subs, error: subErr } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', g.al_id);
      if (subErr) { console.error('send-reminders: load subscriptions failed', subErr); continue; } // not logged → retried
      let ok = 0, failed = 0;
      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: g.title, body: g.body, url: g.url }), { TTL: 86400 });
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
      pushed += ok;
      // Logged when at least one device got it, or when there's nothing to retry (no device / only dead ones)
      if (ok > 0 || failed === 0) await log(g.einsatz_ids, 'push');
    }
  }

  // ── Day-6 mail (one per PL) ──
  let mailed = 0;
  if (mailItems.length) {
    const testRecipient = Deno.env.get('TEST_RECIPIENT') || '';
    const byPl = new Map<string, typeof mailItems>();
    for (const it of mailItems) {
      const key = it.einsatz.folder?.pl_id || 'none';
      if (!byPl.has(key)) byPl.set(key, []);
      byPl.get(key)!.push(it);
    }
    for (const [plId, items] of byPl) {
      const ids = items.map(it => it.einsatz.id);
      const pl = items[0].einsatz.folder?.pl;
      const to = testRecipient || (pl?.email || '').trim();
      if (!to || plId === 'none') {
        console.error('send-reminders: kein PL/E-Mail für Ordner', items.map(it => it.folderName).join(', '));
        if (!testRecipient) { await log(ids, 'pl_mail'); continue; }
      }
      if (!gmailConfigured()) { console.error('send-reminders: Gmail not configured'); continue; }
      const m = plMail(items);
      try {
        await sendGmail({ to, subject: testRecipient ? `[TEST → ${pl?.full_name || 'keine PL'}] ${m.subject}` : m.subject, text: m.text, html: m.html });
        mailed++;
        await log(ids, 'pl_mail');
      } catch (e) {
        console.error('send-reminders: PL mail failed', e);
      }
    }
  }

  return json({ pushed, mailed, removed_subscriptions: removed, ...(pushItems.length && !vapidReady ? { push_skipped: 'vapid_not_configured' } : {}) });
});
