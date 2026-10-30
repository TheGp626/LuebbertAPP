// Pure helpers of the Edge Function calendar-feed (tested in feed.test.mjs).

const TOKEN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.ics)?$/i;

// Token from "?t=<uuid>" or "?t=<uuid>.ics" (iOS likes URLs ending in .ics), or from a trailing "/<uuid>.ics" path
// segment. Anything else → null.
export function parseToken(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  const raw = u.searchParams.has('t') ? u.searchParams.get('t') : u.pathname.split('/').pop();
  const m = TOKEN_RE.exec(raw || '');
  return m ? m[1].toLowerCase() : null;
}

// First day of the feed: 14 days before today (YYYY-MM-DD, Berlin date passed in)
export function windowStart(today) {
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 14);
  return d.toISOString().slice(0, 10);
}

// Rows of plan_assignments joined with their plan_shifts ({ shift }) → each shift once, in order
export function dedupeShifts(rows) {
  const seen = new Set(), out = [];
  for (const r of rows || []) {
    const s = r && r.shift;
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}
