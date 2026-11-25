// ask-shift: "Hey, hast du Zeit?" (Jenni, 25.11.2026). Whoever decides Meldungen (Admin or „Sieht Bewerbungen“) asks one
// person about one shift by Web Push; the person answers with „Ich kann“ in the Wochenplan.
// Body: { kind: 'shift', week_id, shift_key | kind: 'order', job_no, phase, user_id, label }.
// ask_log keeps who was asked about what: the same person is asked once per shift, at most 40 asks per asker and hour.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { pushTo, vapidReady } from '../_shared/push.ts';
import { askRef, askLabel, askPush, mayAsk, MAX_ASKS_PER_HOUR } from './ask.mjs';

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
  // deno-lint-ignore no-explicit-any
  let input: any = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const ref = askRef(input);
  if (!ref || !/^[0-9a-f-]{36}$/i.test(String(input.user_id || ''))) return json({ error: 'invalid_input' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const callerId = auth?.user?.id;
  if (!callerId) return json({ error: 'forbidden' }, 403);
  const { data: users, error: uErr } = await db.from('app_users').select('id, full_name, role, is_active, plan_interest_viewer').in('id', [callerId, input.user_id]);
  if (uErr) { console.error('ask-shift: load users failed', uErr); return json({ error: 'db_error' }, 500); }
  // deno-lint-ignore no-explicit-any
  const caller = (users || []).find((u: any) => u.id === callerId), target = (users || []).find((u: any) => u.id === input.user_id);
  if (!mayAsk(caller)) return json({ error: 'forbidden' }, 403);
  if (!target || target.is_active === false || target.role === 'Gast') return json({ error: 'unknown_user' }, 400);
  if (!vapidReady()) return json({ error: 'vapid_not_configured' }, 500);

  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: cErr } = await db.from('ask_log').select('id', { count: 'exact', head: true }).eq('asked_by', callerId).gt('created_at', since);
  if (cErr) { console.error('ask-shift: count failed', cErr); return json({ error: 'db_error' }, 500); }
  if ((count || 0) >= MAX_ASKS_PER_HOUR) return json({ error: 'rate_limited' }, 429);

  // Claim first (unique user + shift): a double tap or a second decider does not ask twice
  // label: the shift as the popup shows it (column from migration ask_antwort; without it the ask is stored without)
  const label = askLabel(input.label);
  let { data: claim, error: insErr } = await db.from('ask_log').insert({ asked_by: callerId, user_id: target.id, ref, label }).select('id').maybeSingle();
  if (insErr && /label/.test(insErr.message || '')) ({ data: claim, error: insErr } = await db.from('ask_log').insert({ asked_by: callerId, user_id: target.id, ref }).select('id').maybeSingle());
  if (insErr) {
    if (insErr.code === '23505') return json({ skipped: 'already_asked' });
    console.error('ask-shift: claim failed', insErr);
    return json({ error: 'db_error' }, 500);
  }
  const r = await pushTo(db, target.id, askPush(caller.full_name, label));
  if (r.ok === 0) {
    // Nobody reached (no device with push, or a failure): release, so asking again later works
    await db.from('ask_log').delete().eq('id', claim.id);
    return json({ sent: false, reason: r.failed ? 'push_failed' : 'no_device' });
  }
  return json({ sent: true, devices: r.ok });
});
