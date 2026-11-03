// pin-change: logged-in user changes own PIN. Old PIN is verified with the same lockout bookkeeping as pin-login.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  PIN_LOCK_MIN, PIN_MAX_FAILS, isValidPin, lockoutRemainingMin, pinEmail, pinPassword,
} from '../_shared/pin.mjs';

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
  const pub = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: au, error: aErr } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
  if (aErr || !au?.user) return json({ error: 'unauthorized' }, 401);
  const id = au.user.id;

  const { data: caller, error: cErr } = await admin.from('app_users').select('id, role, is_active').eq('id', id).maybeSingle();
  if (cErr) { console.error('pin-change: load caller failed', cErr); return serverError(); }
  if (!caller || caller.is_active === false) return json({ error: 'unauthorized' }, 401);
  if (caller.role === 'Gast') return json({ error: 'forbidden' }, 403);

  let input: { old_pin?: unknown; new_pin?: unknown } = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_input' }, 400); }
  if (!input || !isValidPin(input.old_pin) || !isValidPin(input.new_pin)) return json({ error: 'invalid_pin' });

  // Lock check comes before any sign-in attempt
  const { data: row, error: lErr } = await admin.from('pin_lockouts').select('failed_count, locked_until').eq('user_id', id).maybeSingle();
  if (lErr) { console.error('pin-change: load lockout failed', lErr); return serverError(); }
  const mins0 = lockoutRemainingMin(row, new Date());
  if (mins0 > 0) return json({ error: 'locked', minutes: mins0 });

  const { data: sign, error: sErr } = await pub.auth.signInWithPassword({ email: pinEmail(id), password: pinPassword(input.old_pin as string) });
  if (sErr || !sign?.session) {
    const { data: f, error: wErr } = await admin.rpc('pin_register_failure', { p_user_id: id, p_max: PIN_MAX_FAILS, p_lock_min: PIN_LOCK_MIN });
    if (wErr || !f) { console.error('pin-change: register failure failed', wErr); return serverError(); }
    const mins = lockoutRemainingMin(f, new Date());
    return mins > 0 ? json({ error: 'locked', minutes: mins }) : json({ error: 'wrong_pin', remaining: PIN_MAX_FAILS - f.failed_count });
  }

  const { error: uErr } = await admin.auth.admin.updateUserById(id, { password: pinPassword(input.new_pin as string) });
  if (uErr) { console.error('pin-change: update password failed', uErr); return serverError(); }
  const { error: dErr } = await admin.from('pin_lockouts').delete().eq('user_id', id);
  if (dErr) console.error('pin-change: clear lockout failed', dErr);
  return json({ ok: true });
});
