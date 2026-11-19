// Debug switches an Edge Function only honours for an Admin caller. Cron and the app send none of them,
// so for everyone else they are simply dropped and the call behaves like the normal scheduled run.
export const DEBUG_KEYS = ['dry_run', 'force', 'only_user_id', 'plan_override'];
export function stripDebug(input, isAdmin) {
  const out = { ...(input || {}) };
  if (!isAdmin) for (const k of DEBUG_KEYS) delete out[k];
  return out;
}
export const wantsDebug = (input) => DEBUG_KEYS.some((k) => input && input[k] !== undefined);
