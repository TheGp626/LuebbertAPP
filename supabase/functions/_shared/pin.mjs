// Shared by pin-login, pin-reset, pin-change; role matrix mirrored client-side in js/auth.js (mayResetPinClient).
export const PIN_MAX_FAILS = 5;
export const PIN_LOCK_MIN = 15;

const RESET = { Admin: ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung'], PL: ['AL', 'MA'], AL: ['MA'] };

export const isValidPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);
export const mayResetPin = (callerRole, targetRole) => (RESET[callerRole] || []).includes(targetRole);

export function lockoutRemainingMin(row, now) {
  const ms = row && row.locked_until ? new Date(row.locked_until) - now : 0;
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

export function lockoutAfterFailure(row, now) {
  const n = ((row && row.failed_count) || 0) + 1;
  if (n >= PIN_MAX_FAILS) {
    return { failed_count: 0, locked_until: new Date(now.getTime() + PIN_LOCK_MIN * 60000).toISOString(), remaining: 0 };
  }
  return { failed_count: n, locked_until: null, remaining: PIN_MAX_FAILS - n };
}

export const pinEmail = (userId) => `${userId}@nutzer.luebbert.invalid`;
export const pinPassword = (pin) => `lbt-pin:${pin}`;
export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
