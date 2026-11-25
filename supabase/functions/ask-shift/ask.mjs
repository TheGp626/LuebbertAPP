// Pure helpers for ask-shift ("Hey, hast du Zeit?"): testable with `node --test`.

// Which shift is asked about: a plan entry (week id + key) or an Auftrag phase (job no + phase). null = invalid
export function askRef(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.kind === 'shift' && /^[0-9a-f-]{36}$/i.test(String(input.week_id || '')) && typeof input.shift_key === 'string'
      && input.shift_key.length >= 1 && input.shift_key.length <= 200) return 'shift:' + input.week_id + '|' + input.shift_key;
  if (input.kind === 'order' && /^\d{2}-\d{4}\.\d{2}$/.test(String(input.job_no || '')) && ['setup', 'teardown'].includes(input.phase))
    return 'order:' + input.job_no + '|' + input.phase;
  return null;
}

// What the shift is, as the decider's screen shows it ("Fr 28.11. 07:00 · Estrel – Hagebau Gala · Aufbau"):
// one line, no control characters, at most 120 characters
export function askLabel(s) {
  const t = String(s || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? t.slice(0, 119) + '…' : t;
}

export function askPush(askerName, label) {
  const who = String(askerName || '').trim().split(/\s+/)[0] || 'Das Büro';
  // ?ask=1: the app opens the Ja/Nein popup (js/frage.js); older app versions ignore it and open the start page
  return { title: 'Hast du Zeit?', body: `${who} fragt: ${label || 'ein Einsatz'}. Tippen zum Antworten.`, url: './index.html?ask=1' };
}

// Same rule as public.sees_plan_interest(): Admin, or anyone with the switch "Sieht Bewerbungen"
export function mayAsk(u) {
  return !!u && u.is_active !== false && (u.role === 'Admin' || !!u.plan_interest_viewer);
}
export const MAX_ASKS_PER_HOUR = 40;
