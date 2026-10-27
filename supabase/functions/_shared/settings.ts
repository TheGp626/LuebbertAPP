// Loads the admin settings for an Edge Function. A failed read never blocks today's behaviour: defaults apply.
import { withDefaults } from './settings-defaults.mjs';

// deno-lint-ignore no-explicit-any
export async function loadSettings(db: any) {
  const { data, error } = await db.from('app_settings').select('key, value');
  if (error) console.error('settings: load failed, using defaults', error);
  return withDefaults(error ? null : data);
}
