// pin-login: personal PIN login. Account id = app_users.id, email/password derived server-side from the PIN.
// Gast has no PIN (password = GAST_LOGIN_SECRET, no lockout). Others: 5 wrong PINs lock the user for 15 min.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import {
  PIN_LOCK_MIN, isValidPin, isUuid, lockoutRemainingMin, lockoutAfterFailure, pinEmail, pinPassword,
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
  let input: { user_id?: unknown; pin?: unknown } = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_input' }, 400); }
  if (!input || !isUuid(input.user_id)) return json({ error: 'invalid_input' }, 400);
  const id = input.user_id as string;

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const pub = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: user, error: uErr } = await admin.from('app_users').select('id, role, is_active').eq('id', id).maybeSingle();
  if (uErr) { console.error('pin-login: load user failed', uErr); return serverError(); }
  if (!user || user.is_active === false) return json({ error: 'not_found' });

  const isGast = user.role === 'Gast';
  let password: string;
  if (isGast) {
    const secret = Deno.env.get('GAST_LOGIN_SECRET');
    if (!secret) { console.error('pin-login: GAST_LOGIN_SECRET missing'); return serverError(); }
    password = secret;
  } else {
    if (input.pin === undefined || input.pin === null || input.pin === '') return json({ error: 'pin_required' });
    if (!isValidPin(input.pin)) return json({ error: 'invalid_pin' });
    password = pinPassword(input.pin as string);
  }

  // Lock check comes before any sign-in attempt
  let row: { failed_count: number; locked_until: string | null } | null = null;
  if (!isGast) {
    const { data, error } = await admin.from('pin_lockouts').select('failed_count, locked_until').eq('user_id', id).maybeSingle();
    if (error) { console.error('pin-login: load lockout failed', error); return serverError(); }
    row = data;
    const mins = lockoutRemainingMin(row, new Date());
    if (mins > 0) return json({ error: 'locked', minutes: mins });
  }

  const email = pinEmail(id);
  let created = false;
  const { data: existing } = await admin.auth.admin.getUserById(id);
  if (!existing?.user) {
    // getUserById reports "not found" as an error too, so only the missing user matters here
    const { error: cErr } = await admin.auth.admin.createUser({ id, email, password, email_confirm: true });
    if (!cErr) created = true;
    else if (!/already|registered|exists/i.test(cErr.message || '')) {
      console.error('pin-login: create user failed', cErr);
      return serverError();
    }
  }

  const { data: sign, error: sErr } = await pub.auth.signInWithPassword({ email, password });
  if (sErr || !sign?.session) {
    if (isGast) { console.error('pin-login: Gast sign-in failed', sErr); return serverError(); }
    const { remaining, ...upd } = lockoutAfterFailure(row, new Date());
    const { error: wErr } = await admin.from('pin_lockouts').upsert({ user_id: id, ...upd });
    if (wErr) { console.error('pin-login: write lockout failed', wErr); return serverError(); }
    return remaining > 0 ? json({ error: 'wrong_pin', remaining }) : json({ error: 'locked', minutes: PIN_LOCK_MIN });
  }

  if (!isGast) await admin.from('pin_lockouts').delete().eq('user_id', id);
  return json({ session: { access_token: sign.session.access_token, refresh_token: sign.session.refresh_token }, created });
});
