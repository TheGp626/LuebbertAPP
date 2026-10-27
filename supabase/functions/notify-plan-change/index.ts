// notify-plan-change: Web Push after a Wochenplan upload (experimental).
// First upload of a week → everyone planned; later uploads → only people on changed, new or removed shifts.
// Sends at most once per plan version (plan_weeks.notified_version is claimed atomically).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { buildPlanPushes } from './notify.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function berlinToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let input: { week_id?: string; dry_run?: boolean } = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!input.week_id || typeof input.week_id !== 'string') return json({ error: 'week_id_required' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: week, error } = await db.from('plan_weeks').select('id, kw, version, notified_version, removed')
    .eq('id', input.week_id).maybeSingle();
  if (error) {
    if (error.code === '22P02') return json({ skipped: 'not_found' });
    console.error('notify-plan-change: load week failed', error);
    return json({ error: 'db_error' }, 500);
  }
  if (!week) return json({ skipped: 'not_found' });
  if (week.notified_version >= week.version) return json({ skipped: 'already_notified' });

  const { data: shifts, error: sErr } = await db.from('plan_shifts')
    .select('date, venue, change_status, plan_assignments(user_id)').eq('week_id', week.id);
  if (sErr) { console.error('notify-plan-change: load shifts failed', sErr); return json({ error: 'db_error' }, 500); }
  const pushes = buildPlanPushes(week, shifts || [], berlinToday());
  if (input.dry_run) return json({ dry_run: true, pushes });

  try {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY') || '', Deno.env.get('VAPID_PRIVATE_KEY') || '');
  } catch (e) {
    console.error('notify-plan-change: VAPID not configured', (e as Error).message);
    return json({ skipped: 'vapid_not_configured' });
  }

  // Claim this version so a repeated call (double tap, retry) can't push twice
  const { data: claimed, error: cErr } = await db.from('plan_weeks').update({ notified_version: week.version })
    .eq('id', week.id).lt('notified_version', week.version).select('id');
  if (cErr) { console.error('notify-plan-change: claim failed', cErr); return json({ error: 'db_error' }, 500); }
  if (!claimed || !claimed.length) return json({ skipped: 'already_notified' });

  let pushed = 0, removed = 0;
  for (const p of pushes) {
    const { data: subs, error: subErr } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', p.user_id);
    if (subErr) { console.error('notify-plan-change: load subscriptions failed', subErr); continue; }
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: p.title, body: p.body, url: './index.html?open=wochenplan' }), { TTL: 86400 });
        pushed++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          removed++;
        } else console.error('notify-plan-change: push failed', code, e);
      }
    }
  }
  return json({ users: pushes.length, pushed, removed_subscriptions: removed });
});
