// Shared by pin-login, pin-reset, pin-change; role matrix mirrored client-side in js/auth.js (mayResetPinClient).
export const PIN_MAX_FAILS = 5;
export const PIN_LOCK_MIN = 15;

const RESET = { Admin: ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung'], PL: ['AL', 'MA'], AL: ['MA'] };

export const isValidPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);
const rolesOf = (callerRole) => (Object.hasOwn(RESET, callerRole) ? RESET[callerRole] : []);
export const mayResetPin = (callerRole, targetRole) => rolesOf(callerRole).includes(targetRole);
export const mayResetAny = (callerRole) => rolesOf(callerRole).length > 0;

export function lockoutRemainingMin(row, now) {
  const ms = row && row.locked_until ? new Date(row.locked_until) - now : 0;
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

export const pinEmail = (userId) => `${userId}@nutzer.luebbert.invalid`;
export const pinPassword = (pin) => `lbt-pin:${pin}`;
export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
