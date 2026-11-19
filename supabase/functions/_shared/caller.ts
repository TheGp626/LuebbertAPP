// Who is calling an Edge Function. verify_jwt only proves "some valid JWT", and the public anon key is one,
// so debug switches (dry runs, force, test pushes) must check the caller's app role themselves.
// Returns the active caller's app role, or null for the anon key / cron / unknown or inactive users.
// deno-lint-ignore no-explicit-any
export async function callerRole(admin: any, req: Request): Promise<string | null> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data?.user) return null;
  const { data: u } = await admin.from('app_users').select('role, is_active').eq('id', data.user.id).maybeSingle();
  if (!u || u.is_active === false) return null;
  return u.role || null;
}
export const isAdminRole = (role: string | null) => role === 'Admin';
