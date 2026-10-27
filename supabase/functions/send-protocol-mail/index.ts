// send-protocol-mail: mails a protocol (summary + PDF) to the PL selected on it.
// The recipient is always looked up in the DB, never taken from the request.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { gmailConfigured, sendGmail } from '../_shared/gmail.ts';
import { buildSubject, buildBody, attachmentName, safePdfBase64 } from './mail.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PDF_B64 = 5_000_000;
const THROTTLE_MS = 60_000;
const MAX_MAILS_PER_HOUR = 30;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let input: { protocol_id?: string; pdf_base64?: string; is_update?: boolean };
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const { protocol_id, pdf_base64, is_update } = input || {};
  if (!protocol_id || typeof protocol_id !== 'string') return json({ error: 'protocol_id_required' }, 400);
  if (pdf_base64 && (typeof pdf_base64 !== 'string' || pdf_base64.length > MAX_PDF_B64)) return json({ error: 'pdf_too_large' }, 413);

  const testRecipient = Deno.env.get('TEST_RECIPIENT') || '';

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: p, error } = await db
    .from('protocols')
    .select(`id, date, action, notes_damages, notes_incidents, notes_feedback, al_name_fallback, pl_name_fallback, pl_id, mailed_at,
      projects(name, location),
      al:app_users!protocols_al_id_fkey(full_name),
      pl:app_users!protocols_pl_id_fkey(full_name, email),
      shifts(position_role, temp_worker_name, app_users(full_name)),
      protocol_equipments(category_id, status, note),
      worker_ratings(temp_worker_name, rating, is_star)`)
    .eq('id', protocol_id)
    .maybeSingle();
  if (error) {
    // Malformed UUID = the protocol can't exist; anything else is retryable
    if (error.code === '22P02') return json({ sent: false, reason: 'not_found' });
    console.error('send-protocol-mail: load failed', error);
    return json({ sent: false, reason: 'db_error' });
  }
  if (!p) return json({ sent: false, reason: 'not_found' });

  if (p.mailed_at && Date.now() - new Date(p.mailed_at).getTime() < THROTTLE_MS) {
    return json({ sent: false, reason: 'throttled' });
  }

  if (!gmailConfigured()) {
    console.error('send-protocol-mail: GMAIL_USER / GMAIL_APP_PASSWORD not set');
    return json({ sent: false, reason: 'not_configured' });
  }

  // Global cap: the endpoint is reachable with the public anon key
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count: recent, error: cntErr } = await db.from('protocols').select('id', { count: 'exact', head: true }).gt('mailed_at', since);
  if (cntErr) { console.error('send-protocol-mail: rate count failed', cntErr); return json({ sent: false, reason: 'db_error' }); }
  if ((recent || 0) >= MAX_MAILS_PER_HOUR) {
    console.error('send-protocol-mail: hourly cap reached', recent);
    return json({ sent: false, reason: 'rate_limited' });
  }

  const plName = (p.pl && p.pl.full_name) || p.pl_name_fallback || 'PL';
  const plEmail = (p.pl && (p.pl.email || '').trim()) || '';
  if (!testRecipient) {
    if (!p.pl_id) return json({ sent: false, reason: 'no_pl' });
    if (!plEmail) return json({ sent: false, reason: 'no_email', to_name: plName });
  }
  const to = testRecipient || plEmail;

  // Claim the send slot atomically so two concurrent calls (save + retry) can't both send
  const cutoff = new Date(Date.now() - THROTTLE_MS).toISOString();
  const { data: claimed, error: claimErr } = await db.from('protocols')
    .update({ mailed_at: new Date().toISOString() })
    .eq('id', protocol_id)
    .or(`mailed_at.is.null,mailed_at.lt.${cutoff}`)
    .select('id');
  if (claimErr) { console.error('send-protocol-mail: claim failed', claimErr); return json({ sent: false, reason: 'db_error' }); }
  if (!claimed || claimed.length === 0) return json({ sent: false, reason: 'throttled' });
  const releaseClaim = async () => {
    const { error: relErr } = await db.from('protocols').update({ mailed_at: p.mailed_at }).eq('id', protocol_id);
    if (relErr) console.error('send-protocol-mail: claim release failed', relErr);
  };

  const { html, text } = buildBody(p);
  const pdf = safePdfBase64(pdf_base64);
  try {
    await sendGmail({
      to,
      subject: buildSubject(p, !!is_update, testRecipient ? plName : undefined),
      text,
      html,
      attachments: pdf ? [{ filename: attachmentName(p), content: pdf, encoding: 'base64', contentType: 'application/pdf' }] : [],
    });
  } catch (e) {
    console.error('send-protocol-mail: SMTP failed', e);
    await releaseClaim();
    // Wrong Gmail credentials are a setup problem, not something the AL can fix
    return json({ sent: false, reason: (e as { code?: string })?.code === 'EAUTH' ? 'not_configured' : 'smtp_error' });
  }

  return json({ sent: true, to_name: plName });
});
