// calendar-feed: subscribable calendar (.ics) of a person's Wochenplan shifts.
// GET ?t=<app_users.calendar_token>[.ics] → text/calendar. Subscribed by iOS (webcal://) and Google Calendar.
// Deploy with verify_jwt = false (supabase functions deploy calendar-feed --no-verify-jwt): calendar apps send no
// auth header, the secret token is the only key. Unknown token / inactive user → 404, bad token → 400.
// Window: shifts from 14 days ago onwards. Needs _shared/plan-ics.mjs and feed.mjs.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { planIcs } from '../_shared/plan-ics.mjs';
import { parseToken, windowStart, dedupeShifts } from './feed.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
};

function plain(status: number, text: string) {
  return new Response(text, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function berlinToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'Method not allowed');
  const token = parseToken(req.url);
  if (!token) return plain(400, 'Bad request');

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: user, error: uErr } = await db.from('app_users').select('id, full_name, is_active')
    .eq('calendar_token', token).maybeSingle();
  if (uErr) { console.error('calendar-feed: load user failed', uErr); return plain(500, 'Server error'); }
  // is_active null means active (same rule as the login list); only an explicit false is deactivated
  if (!user || user.is_active === false) return plain(404, 'Not found');

  const { data, error } = await db.from('plan_assignments')
    .select('shift:plan_shifts!inner(*, plan_assignments(*))')
    .eq('user_id', user.id)
    .gte('shift.date', windowStart(berlinToday()));
  if (error) { console.error('calendar-feed: load shifts failed', error); return plain(500, 'Server error'); }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ics = planIcs(dedupeShifts(data), user.id, stamp);
  return new Response(req.method === 'HEAD' ? null : ics, {
    status: 200,
    headers: {
      ...CORS,
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Disposition': 'inline; filename="luebbert-schichten.ics"',
    },
  });
});
