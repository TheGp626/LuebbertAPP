// notify-attendance: Web Push to the Personalteam when the AL marks someone as kurzfristig abgesagt, krank or
// nicht erschienen in a protocol (Jenni, Briefing 26.11.2026). Until the role Personalteam exists the recipients are
// Admins and everyone with „Sieht Bewerbungen“ (plan_interest_viewer). Called by the app after a protocol is saved.
// Rows are claimed (protocol_attendance.alerted_at) before sending, so a retry or second save never pushes twice.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { pushTo, vapidReady } from '../_shared/push.ts';
import { ALERT_STATUSES, buildAttendancePushes } from './notify.mjs';
import { callerRole } from '../_shared/caller.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let input: { protocol_id?: string } = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!input.protocol_id || typeof input.protocol_id !== 'string') return json({ error: 'protocol_id_required' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Only the roles that write protocols may trigger it
  if (!['AL', 'PL', 'Buchhaltung', 'Admin'].includes(String(await callerRole(db, req)))) return json({ error: 'forbidden' }, 403);
  if (!vapidReady()) return json({ skipped: 'vapid_not_configured' });

  // Claim first: only rows still unalerted are sent, by exactly one call
  const { data: rows, error } = await db.from('protocol_attendance')
    .update({ alerted_at: new Date().toISOString() })
    .eq('protocol_id', input.protocol_id).is('alerted_at', null).in('status', ALERT_STATUSES as unknown as string[])
    .select('status, user_id, temp_worker_name, app_users(full_name)');
  if (error) {
    if (error.code === '22P02') return json({ skipped: 'not_found' });
    console.error('notify-attendance: claim failed', error);
    return json({ error: 'db_error' }, 500);
  }
  if (!rows || !rows.length) return json({ users: 0, pushed: 0 });

  const { data: prot } = await db.from('protocols').select('date, job_no, projects(name)').eq('id', input.protocol_id).maybeSingle();
  const { data: team, error: tErr } = await db.from('app_users').select('id')
    .or('role.eq.Admin,plan_interest_viewer.eq.true').not('is_active', 'is', false);
  if (tErr) { console.error('notify-attendance: recipients failed', tErr); return json({ error: 'db_error' }, 500); }

  const pushes = buildAttendancePushes(
    rows.map((r: any) => ({ status: r.status, name: (r.app_users && r.app_users.full_name) || r.temp_worker_name })),
    prot ? { date: prot.date, job_no: prot.job_no, project: (prot as any).projects?.name } : {},
    (team || []).map((u: { id: string }) => u.id));
  let pushed = 0, removed = 0;
  for (const p of pushes) {
    const r = await pushTo(db, p.user_id, { title: p.title, body: p.body, url: p.url });
    pushed += r.ok; removed += r.removed;
  }
  return json({ users: pushes.length, pushed, removed_subscriptions: removed });
});
