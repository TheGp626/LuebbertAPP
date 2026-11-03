// pin-reset: a superior role deletes the target's Auth account (= PIN), so the target picks a new PIN at next login.
// Caller identity comes from the JWT (verify_jwt: true); roles are checked with mayResetPin.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { isUuid, mayResetPin } from '../_shared/pin.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const serverError = () => json({ error: 'server_error' }, 500);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: au, error: aErr } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
  if (aErr || !au?.user) return json({ error: 'unauthorized' }, 401);
  const callerId = au.user.id;

  let input: { target_user_id?: unknown } = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_input' }, 400); }
  if (!input || !isUuid(input.target_user_id)) return json({ error: 'invalid_input' }, 400);
  const targetId = input.target_user_id as string;

  const { data: rows, error: rErr } = await admin.from('app_users').select('id, role, is_active').in('id', [callerId, targetId]);
  if (rErr) { console.error('pin-reset: load users failed', rErr); return serverError(); }
  const caller = rows?.find((r) => r.id === callerId);
  const target = rows?.find((r) => r.id === targetId);
  if (!caller || caller.is_active === false) return json({ error: 'unauthorized' }, 401);
  if (!target) return json({ error: 'not_found' }, 404);
  if (!mayResetPin(caller.role, target.role)) return json({ error: 'forbidden' }, 403);

  const { error: dErr } = await admin.auth.admin.deleteUser(targetId);
  // no Auth account yet = already no PIN
  if (dErr && !(dErr.status === 404 || /not.?found/i.test(dErr.message || ''))) {
    console.error('pin-reset: delete auth user failed', dErr);
    return serverError();
  }
  const { error: lErr } = await admin.from('pin_lockouts').delete().eq('user_id', targetId);
  if (lErr) console.error('pin-reset: clear lockout failed', lErr);
  const { error: gErr } = await admin.from('pin_reset_log').insert({ reset_by: callerId, target: targetId });
  if (gErr) console.error('pin-reset: log insert failed', gErr);
  return json({ ok: true });
});
