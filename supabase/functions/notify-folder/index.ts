// notify-folder: Web Push to the ALs of a project folder (experimental).
// Called after a folder is saved: every AL with a job in it who was not told yet gets one push.
// The told ALs are stored in project_folders.notified_al_ids and claimed before sending, so a repeated call
// (double tap, retry, edit of the same folder) never pushes the same AL twice for the same folder.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import { buildFolderPushes, pgUuidArray } from './notify.mjs';
import { loadSettings } from '../_shared/settings.ts';

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
  let input: { folder_id?: string; dry_run?: boolean } = {};
  try { input = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!input.folder_id || typeof input.folder_id !== 'string') return json({ error: 'folder_id_required' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: folder, error } = await db.from('project_folders').select('id, name, notified_al_ids')
    .eq('id', input.folder_id).maybeSingle();
  if (error) {
    if (error.code === '22P02') return json({ skipped: 'not_found' });
    console.error('notify-folder: load folder failed', error);
    return json({ error: 'db_error' }, 500);
  }
  if (!folder) return json({ skipped: 'not_found' });

  // Admin switch: off → nothing is sent and nobody is marked as told
  const settings = await loadSettings(db);
  if (!input.dry_run && !settings.folder_push_enabled) return json({ skipped: 'disabled' });

  const { data: einsaetze, error: eErr } = await db.from('einsaetze')
    .select('al_id, date, action, cancelled').eq('folder_id', folder.id);
  if (eErr) { console.error('notify-folder: load jobs failed', eErr); return json({ error: 'db_error' }, 500); }
  const told: string[] = folder.notified_al_ids || [];
  const pushes = buildFolderPushes({ name: folder.name, notified_al_ids: told }, einsaetze || []);
  if (input.dry_run) return json({ dry_run: true, enabled: settings.folder_push_enabled, pushes });
  if (!pushes.length) return json({ users: 0, pushed: 0 });

  try {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY') || '', Deno.env.get('VAPID_PRIVATE_KEY') || '');
  } catch (e) {
    console.error('notify-folder: VAPID not configured', (e as Error).message);
    return json({ skipped: 'vapid_not_configured' });
  }

  // Claim the recipients first: only the call that still sees the list it read can write the new one
  const { data: claimed, error: cErr } = await db.from('project_folders')
    .update({ notified_al_ids: [...told, ...pushes.map(p => p.user_id)] })
    .eq('id', folder.id).eq('notified_al_ids', pgUuidArray(told)).select('id');
  if (cErr) { console.error('notify-folder: claim failed', cErr); return json({ error: 'db_error' }, 500); }
  if (!claimed || !claimed.length) return json({ skipped: 'already_notified' });

  let pushed = 0, removed = 0;
  for (const p of pushes) {
    const { data: subs, error: subErr } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', p.user_id);
    if (subErr) { console.error('notify-folder: load subscriptions failed', subErr); continue; }
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: p.title, body: p.body, url: p.url }), { TTL: 86400 });
        pushed++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          removed++;
        } else console.error('notify-folder: push failed', code, e);
      }
    }
  }
  return json({ users: pushes.length, pushed, removed_subscriptions: removed });
});
