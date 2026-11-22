// poll-plan-inbox: reads the app's Gmail inbox (IMAP) for Wochenplan PDFs from the allowed senders (secret PLAN_MAIL_FROM),
// stores each PDF once in bucket plan-inbox + table plan_inbox (status 'neu') and pushes the Admins.
// A PL/Admin then opens it in the Wochenplan; the import preview runs in the browser, so nothing goes live unchecked.
// Cron every 15 min (see migration 20261125_plan_inbox.sql) or a manual call; the client also calls it when the Wochenplan opens.
// Secrets: GMAIL_USER + GMAIL_APP_PASSWORD (same as sending; IMAP must be enabled in Gmail), PLAN_MAIL_FROM (comma-separated senders; "@firma.de" allows a whole domain).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { ImapFlow } from 'npm:imapflow@1.0.164';
import { simpleParser } from 'npm:mailparser@3.7.1';
import { gmailConfigured } from '../_shared/gmail.ts';
import { pushTo, vapidReady } from '../_shared/push.ts';
import { parseAllowed, pickPlanPdfs, senderAllowed, storagePath } from './inbox.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const LOOKBACK_DAYS = 14;
const MAX_MAILS = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const allowed = parseAllowed(Deno.env.get('PLAN_MAIL_FROM'));
  if (!gmailConfigured() || !allowed.length) return json({ skipped: 'not_configured' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: (Deno.env.get('GMAIL_USER') || '').trim(), pass: (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s+/g, '') } });
  client.on('error', (e: Error) => console.error('poll-plan-inbox: imap error', e.message));

  let stored = 0;
  const fresh: { file: string }[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000);
      const uids: number[] = (await client.search({ since }, { uid: true })) || [];
      // Cheap pass first: only mails from an allowed sender that are not stored yet get downloaded
      const candidates: number[] = [];
      if (uids.length) {
        const envs: { uid: number; id: string }[] = [];
        for await (const m of client.fetch(uids.slice(-MAX_MAILS), { envelope: true, uid: true }, { uid: true })) {
          const from = String(m.envelope?.from?.[0]?.address || '').toLowerCase();
          if (senderAllowed(from, allowed) && m.envelope?.messageId) envs.push({ uid: m.uid, id: m.envelope.messageId });
        }
        if (envs.length) {
          const { data: known, error } = await db.from('plan_inbox').select('message_id').in('message_id', envs.map((e) => e.id));
          if (error) { console.error('poll-plan-inbox: load known failed', error); return json({ error: 'db_error' }, 500); }
          const have = new Set((known || []).map((k: { message_id: string }) => k.message_id));
          for (const e of envs) if (!have.has(e.id)) candidates.push(e.uid);
        }
      }
      for (const uid of candidates) {
        const raw = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!raw || !raw.source) continue;
        const mail = await simpleParser(raw.source);
        const messageId = mail.messageId;
        if (!messageId) continue;
        const pdfs = pickPlanPdfs(mail, allowed);
        for (let i = 0; i < pdfs.length; i++) {
          const a = pdfs[i];
          const path = storagePath(messageId, i, a.filename || 'plan.pdf');
          const up = await db.storage.from('plan-inbox').upload(path, a.content, { contentType: 'application/pdf', upsert: false });
          if (up.error && !/exists|duplicate/i.test(up.error.message)) { console.error('poll-plan-inbox: upload failed', up.error.message); continue; }
          // One row per attachment: message_id is unique, so a second PDF in the same mail gets a suffix
          const { error } = await db.from('plan_inbox').insert({ message_id: i === 0 ? messageId : `${messageId}#${i}`,
            from_addr: mail.from?.value?.[0]?.address || '', subject: mail.subject || '', file_name: a.filename || 'plan.pdf',
            storage_path: path, received_at: (mail.date || new Date()).toISOString() });
          if (error) {
            if (error.code !== '23505') { console.error('poll-plan-inbox: insert failed', error); await db.storage.from('plan-inbox').remove([path]); }
            continue;
          }
          stored++; fresh.push({ file: a.filename || 'plan.pdf' });
        }
      }
    } finally { lock.release(); }
  } catch (e) {
    const code = (e as { authenticationFailed?: boolean })?.authenticationFailed;
    console.error('poll-plan-inbox: failed', (e as Error).message);
    return json({ error: code ? 'imap_auth_failed' : 'imap_failed' }, 502);
  } finally {
    try { await client.logout(); } catch { /* connection already gone */ }
  }

  let pushed = 0;
  if (stored && vapidReady()) {
    const { data: admins } = await db.from('app_users').select('id').eq('role', 'Admin').neq('is_active', false);
    for (const a of admins || []) {
      const r = await pushTo(db, a.id, { title: 'Neuer Wochenplan per Mail',
        body: stored === 1 ? fresh[0].file : `${stored} neue Pläne warten auf dich`, url: './index.html?open=wochenplan' });
      pushed += r.ok;
    }
  }
  return json({ stored, pushed });
});
