// Shared by pin-login, pin-reset, pin-change; role matrix mirrored client-side in js/auth.js (mayResetPinClient).
export const PIN_MAX_FAILS = 5;
export const PIN_LOCK_MIN = 15;

const RESET = { Admin: ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung'], PL: ['AL', 'MA'], AL: ['MA'] };

export const isValidPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);
const rolesOf = (callerRole) => (Object.hasOwn(RESET, callerRole) ? RESET[callerRole] : []);
export const mayResetPin = (callerRole, targetRole) => rolesOf(callerRole).includes(targetRole);
export const mayResetAny = (callerRole) => rolesOf(callerRole).length > 0;
// Rollout guard: a leader account's first PIN needs the shared admin password once (else anyone could claim it)
export const firstPinNeedsAdminPin = (role) => ['Admin', 'PL', 'AL', 'Buchhaltung'].includes(role);

export function lockoutRemainingMin(row, now) {
  const ms = row && row.locked_until ? new Date(row.locked_until) - now : 0;
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

// Legacy: the login email used to be derived from the (public) user id, so anyone could call Supabase Auth directly
// with it and guess the 4 digit PIN without our lockout. New accounts get a random email; existing ones were moved
// by migration 20261117_security_haertung. Functions read the email from the auth user, never rebuild it.
export const pinEmail = (userId) => `${userId}@nutzer.luebbert.invalid`;
export const newPinEmail = () => `${crypto.randomUUID()}@nutzer.luebbert.invalid`;
export const isLegacyPinEmail = (userId, email) => String(email || '').toLowerCase() === pinEmail(userId).toLowerCase();
export const pinPassword = (pin) => `lbt-pin:${pin}`;
export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Only an Auth 400 (invalid_credentials) means a wrong PIN; 429/5xx/network errors must not count toward the lockout.
export const isWrongCredentials = (err) => err?.status === 400;
