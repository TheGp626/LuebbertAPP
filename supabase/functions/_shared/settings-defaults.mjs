// Admin settings (table app_settings) with the defaults that reproduce the behaviour before the table existed.
// Pure → testable with `node --test`; js/settings.js mirrors the same values for the app.

export const SETTINGS_DEFAULTS = Object.freeze({
  reminders_enabled: true,
  plan_reminders_enabled: false,
  evening_push_enabled: false,
  evening_push_hour: 18,
  plan_change_push_enabled: true,
  protocol_mail_enabled: true,
  mail_test_mode: true,
  billing_cutoff: 20,
});

// rows: [{key, value}] from app_settings, or null when the read failed.
// Unknown keys are dropped; a value of the wrong type keeps the default.
export function withDefaults(rows) {
  const out = { ...SETTINGS_DEFAULTS };
  for (const r of rows || []) {
    if (!(r.key in SETTINGS_DEFAULTS)) continue;
    if (typeof r.value === typeof SETTINGS_DEFAULTS[r.key]) out[r.key] = r.value;
  }
  return out;
}
