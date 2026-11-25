// send-protocol-mail: mails a protocol (summary + PDF) to the PL selected on it.
// The recipient is always looked up in the DB, never taken from the request.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { gmailConfigured, sendGmail } from '../_shared/gmail.ts';
import { buildSubject, buildBody, attachmentName, safePdfBase64 } from './mail.mjs';
import { loadSettings } from '../_shared/settings.ts';
import { chooseRecipient, disabledReason, emailOf } from '../_shared/recipient.mjs';
import { departmentFeedback, planDepartmentMails, buildDepartmentSubject, buildDepartmentBody, departmentRecipient } from './departments.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_PDF_B64 = 5_000_000;
const THROTTLE_MS = 60_000;
const MAX_MAILS_PER_HOUR = 30;
const MAX_DEPARTMENT_MAILS_PER_HOUR = 30;

// Abteilungs-Mails (Lager, Logistik, Tischlerei, Stoffe, Floristik): independent of the PL mail and never blocking it.
// department_mail_log is claimed before sending (unique protocol + department + feedback hash), so a retry or a
// second call at the same time sends nothing twice; a failed send releases the claim.
// deno-lint-ignore no-explicit-any
async function sendDepartmentMails(db: any, p: any, settings: any, testRecipient: string) {
  const out: { department: string; sent: boolean; reason?: string }[] = [];
  const plan = planDepartmentMails(departmentFeedback(p, settings.department_routes), await (async () => {
    const { data, error } = await db.from('department_mail_log').select('department, items').eq('protocol_id', p.id);
    if (error) throw error;
    return data;
  })());
  if (!plan.length) return out;
  if (!gmailConfigured()) return plan.map((m) => ({ department: m.department, sent: false, reason: 'not_configured' }));
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: cntErr } = await db.from('department_mail_log').select('id', { count: 'exact', head: true }).gt('sent_at', since);
  if (cntErr) throw cntErr;
  let budget = MAX_DEPARTMENT_MAILS_PER_HOUR - (count || 0);
  for (const m of plan) {
    const rcpt = departmentRecipient(m.department, { enabled: settings.department_mail_enabled,
      testMode: settings.mail_test_mode || settings.department_mail_test_mode, testRecipient, emails: settings.department_emails });
    if (rcpt.reason) { out.push({ department: m.department, sent: false, reason: rcpt.reason }); continue; }
    if (budget <= 0) { console.error('send-protocol-mail: department hourly cap reached'); out.push({ department: m.department, sent: false, reason: 'rate_limited' }); continue; }
    const { data: claim, error: claimErr } = await db.from('department_mail_log')
      .insert({ protocol_id: p.id, department: m.department, items: m.lines, items_hash: m.hash, is_supplement: m.isSupplement, sent_to_test: rcpt.test })
      .select('id').maybeSingle();
    if (claimErr) {
      out.push({ department: m.department, sent: false, reason: claimErr.code === '23505' ? 'already_sent' : 'db_error' });
      if (claimErr.code !== '23505') console.error('send-protocol-mail: department claim failed', claimErr);
      continue;
    }
    budget--;
    const { text, html } = buildDepartmentBody(p, m.department, m.lines, m.isSupplement);
    try {
      await sendGmail({ to: rcpt.to!, subject: buildDepartmentSubject(p, m.department, m.isSupplement, rcpt.test), text, html });
      out.push({ department: m.department, sent: true });
    } catch (e) {
      console.error('send-protocol-mail: department SMTP failed', m.department, e);
      const { error: relErr } = await db.from('department_mail_log').delete().eq('id', claim.id);
      if (relErr) console.error('send-protocol-mail: department claim release failed', relErr);
      out.push({ department: m.department, sent: false, reason: 'smtp_error' });
    }
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Protocol photos (bucket protocol-photos) as JPEG attachments: at most 8, each at most 3 MB; one that fails is left out
// deno-lint-ignore no-explicit-any
async function photoAttachments(db: any, paths: unknown) {
  const list = (Array.isArray(paths) ? paths : []).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}\/[0-9a-f-]{36}\.jpg$/.test(x)).slice(0, 8);
  const out: { filename: string; content: string; encoding: 'base64'; contentType: string }[] = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const { data, error } = await db.storage.from('protocol-photos').download(list[i]);
      if (error || !data) throw error || new Error('missing');
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length > 3_000_000) continue;
      let bin = '';
      for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
      out.push({ filename: `foto-${i + 1}.jpg`, content: btoa(bin), encoding: 'base64', contentType: 'image/jpeg' });
    } catch (e) { console.error('send-protocol-mail: photo left out', list[i], e); }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let input: { protocol_id?: string; pdf_base64?: string; is_update?: boolean; client?: number };
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const { protocol_id, pdf_base64, is_update } = input || {};
  if (!protocol_id || typeof protocol_id !== 'string') return json({ error: 'protocol_id_required' }, 400);
  if (pdf_base64 && (typeof pdf_base64 !== 'string' || pdf_base64.length > MAX_PDF_B64)) return json({ error: 'pdf_too_large' }, 413);

  const testRecipient = Deno.env.get('TEST_RECIPIENT') || '';

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // photos only exists from migration jenni_runde_4 on: without it the protocol is loaded (and mailed) without photos
  const load = (withPhotos: boolean) => db
    .from('protocols')
    .select(`id, date, action, job_no, shortages,${withPhotos ? ' photos,' : ''} notes_damages, notes_incidents, notes_feedback, al_name_fallback, pl_name_fallback, pl_id, mailed_at, side_of,
      main:side_of(projects(name)),
      projects(name, location),
      al:app_users!protocols_al_id_fkey(full_name),
      pl:app_users!protocols_pl_id_fkey(full_name, app_user_private(email)),
      shifts(position_role, temp_worker_name, app_users(full_name)),
      protocol_equipments(category_id, status, note, hussen_delivered, hussen_returned),
      worker_ratings(temp_worker_name, rating, is_star)`)
    .eq('id', protocol_id)
    .maybeSingle();
  let { data: p, error } = await load(true);
  if (error && /photos/.test(error.message || '')) ({ data: p, error } = await load(false));
  if (error) {
    // Malformed UUID = the protocol can't exist; anything else is retryable
    if (error.code === '22P02') return json({ sent: false, reason: 'not_found' });
    console.error('send-protocol-mail: load failed', error);
    return json({ sent: false, reason: 'db_error' });
  }
  if (!p) return json({ sent: false, reason: 'not_found' });

  // Admin switches (Office Dashboard → Einstellungen); a failed read keeps today's behaviour
  const settings = await loadSettings(db);
  // Department mails first and on their own: a throttled or held-back PL mail must not hold them back
  let departments: unknown = [];
  try { departments = await sendDepartmentMails(db, p, settings, testRecipient); }
  catch (e) { console.error('send-protocol-mail: department mails failed', e); departments = 'error'; }
  if (!settings.protocol_mail_enabled) return json({ sent: false, reason: disabledReason(input.client), departments });

  if (p.mailed_at && Date.now() - new Date(p.mailed_at).getTime() < THROTTLE_MS) {
    return json({ sent: false, reason: 'throttled', departments });
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
  const rcpt = chooseRecipient({ mailEnabled: true, testMode: settings.mail_test_mode, testRecipient,
    plEmail: emailOf(p.pl), plId: p.pl_id });
  if (rcpt.reason === 'not_configured') console.error('send-protocol-mail: test mode on but TEST_RECIPIENT not set, mail held back');
  if (rcpt.reason) return json({ sent: false, reason: rcpt.reason, ...(rcpt.reason === 'no_email' ? { to_name: plName } : {}) });
  const to = rcpt.to!;

  // Claim the send slot atomically so two concurrent calls (save + retry) can't both send
  const cutoff = new Date(Date.now() - THROTTLE_MS).toISOString();
  const { data: claimed, error: claimErr } = await db.from('protocols')
    .update({ mailed_at: new Date().toISOString() })
    .eq('id', protocol_id)
    .or(`mailed_at.is.null,mailed_at.lt.${cutoff}`)
    .select('id');
  if (claimErr) { console.error('send-protocol-mail: claim failed', claimErr); return json({ sent: false, reason: 'db_error' }); }
  if (!claimed || claimed.length === 0) return json({ sent: false, reason: 'throttled', departments });
  const releaseClaim = async () => {
    const { error: relErr } = await db.from('protocols').update({ mailed_at: p.mailed_at }).eq('id', protocol_id);
    if (relErr) console.error('send-protocol-mail: claim release failed', relErr);
  };

  const { html, text } = buildBody(p);
  const pdf = safePdfBase64(pdf_base64);
  const photos = await photoAttachments(db, p.photos);
  try {
    await sendGmail({
      to,
      subject: buildSubject(p, !!is_update, rcpt.test ? plName : undefined),
      text,
      html,
      attachments: [...(pdf ? [{ filename: attachmentName(p), content: pdf, encoding: 'base64' as const, contentType: 'application/pdf' }] : []), ...photos],
    });
  } catch (e) {
    console.error('send-protocol-mail: SMTP failed', e);
    await releaseClaim();
    // Wrong Gmail credentials are a setup problem, not something the AL can fix
    return json({ sent: false, reason: (e as { code?: string })?.code === 'EAUTH' ? 'not_configured' : 'smtp_error' });
  }

  return json({ sent: true, to_name: plName, departments });
});
