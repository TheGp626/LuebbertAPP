// Web Push helpers shared by send-reminders, notify-folder and notify-plan-change.
import webpush from 'npm:web-push@3.6.7';

// Sets the VAPID keys from the secrets; false when they are missing or invalid (caller skips pushing)
export function vapidReady() {
  try {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:noreply@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY') || '', Deno.env.get('VAPID_PRIVATE_KEY') || '');
    return true;
  } catch (e) {
    console.error('push: VAPID not configured', (e as Error).message);
    return false;
  }
}

// Sends one push to all devices of a user. ok = devices reached, failed = retryable failures,
// removed = expired subscriptions (404/410) deleted on the way
// deno-lint-ignore no-explicit-any
export async function pushTo(db: any, userId: string, p: { title: string; body: string; url: string }) {
  const { data: subs, error: subErr } = await db.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId);
  if (subErr) { console.error('push: load subscriptions failed', subErr); return { ok: 0, failed: 1, removed: 0 }; }
  let ok = 0, failed = 0, removed = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: p.title, body: p.body, url: p.url }), { TTL: 86400 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        removed++;
      } else {
        console.error('push: send failed', code, e);
        failed++;
      }
    }
  }
  return { ok, failed, removed };
}
