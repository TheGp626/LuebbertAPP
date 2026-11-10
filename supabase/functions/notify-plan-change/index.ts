// notify-plan-change: Web Push after a Wochenplan upload (experimental).
// First upload of a week → everyone planned; later uploads → only people on changed, new or removed shifts
// and people taken off a shift (plan_weeks.removed entries with kind 'unassigned').
// Sends at most once per plan version (plan_weeks.notified_version is claimed atomically).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { pushTo, vapidReady } from '../_shared/push.ts';
import { buildPlanPushes } from './notify.mjs';
import { loadSettings } from '../_shared/settings.ts';

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

  // Admin switch: off → nothing is sent and the version stays unclaimed
  const settings = await loadSettings(db);
  if (!input.dry_run && !settings.plan_change_push_enabled) return json({ skipped: 'disabled' });
  if (!input.dry_run && week.notified_version >= week.version) return json({ skipped: 'already_notified' });

  const { data: shifts, error: sErr } = await db.from('plan_shifts')
    .select('date, venue, change_status, change_fields, added_user_ids, plan_assignments(user_id)').eq('week_id', week.id);
  if (sErr) { console.error('notify-plan-change: load shifts failed', sErr); return json({ error: 'db_error' }, 500); }
  const pushes = buildPlanPushes(week, shifts || [], berlinToday());
  if (input.dry_run) return json({ dry_run: true, enabled: settings.plan_change_push_enabled, pushes });

  if (!vapidReady()) return json({ skipped: 'vapid_not_configured' });

  // Claim this version so a repeated call (double tap, retry) can't push twice
  const { data: claimed, error: cErr } = await db.from('plan_weeks').update({ notified_version: week.version })
    .eq('id', week.id).lt('notified_version', week.version).select('id');
  if (cErr) { console.error('notify-plan-change: claim failed', cErr); return json({ error: 'db_error' }, 500); }
  if (!claimed || !claimed.length) return json({ skipped: 'already_notified' });

  let pushed = 0, removed = 0;
  for (const p of pushes) {
    const r = await pushTo(db, p.user_id, { title: p.title, body: p.body, url: './index.html?open=wochenplan' });
    pushed += r.ok; removed += r.removed;
  }
  return json({ users: pushes.length, pushed, removed_subscriptions: removed });
});
