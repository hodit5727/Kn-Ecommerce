/**
 * Server-side ADMIN provisioning (BACKEND_SPEC §4 "Dedicated Admin Login").
 *
 * On first boot the backend creates the admin Auth user with the password
 * from ADMIN_BOOTSTRAP_PASSWORD, or a strong random one printed ONCE to the
 * console when the variable is empty. If the admin Auth user ALREADY exists
 * and ADMIN_BOOTSTRAP_PASSWORD is set, the password is (re)set to it — a
 * deterministic recovery path: an ephemeral generated password lost to a
 * failed boot / redeploy can be replaced simply by setting the env var
 * (this also keeps Railway redeploys reproducible). The profiles row is
 * upserted with role ADMIN (identity trigger assigns roles/business id
 * server-side). No credentials are hardcoded anywhere (§2.9) and nothing
 * admin-related is client-controlled (§2.4).
 */
import { generateSecret } from './hash.js';

/**
 * @returns {Promise<{ email: string, password: string|null, generated: boolean, setByEnv: boolean }>}
 *          generated=true → password created at runtime (print once, not recoverable later).
 *          setByEnv=true   → password was applied from ADMIN_BOOTSTRAP_PASSWORD (create or reset).
 */
export async function ensureAdmin(service, env) {
  const email = env.ADMIN_BOOTSTRAP_EMAIL;
  const envPassword = env.ADMIN_BOOTSTRAP_PASSWORD || null;

  // Look the auth user up (listUsers is deterministic across supabase-js
  // versions — getUserByEmail's not-found shape varies).
  const { data: page, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  const existing = page?.users?.find((u) => u.email?.toLowerCase() === email) ?? null;

  let authUserId;
  let password = null;
  let generated = false;
  let setByEnv = false;

  if (!existing) {
    password = envPassword || generateSecret(24);
    generated = !envPassword;
    setByEnv = Boolean(envPassword);
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { provisioned: true },
    });
    if (createError) throw createError;
    authUserId = created.user.id;
  } else if (envPassword) {
    // Recovery / deterministic redeploy: apply the env password to the
    // existing admin Auth user.
    const { error: updateError } = await service.auth.admin.updateUserById(existing.id, {
      password: envPassword,
    });
    if (updateError) throw updateError;
    password = envPassword;
    setByEnv = true;
    authUserId = existing.id;
  } else {
    // Existing user, password unchanged (unknown to the backend — admin can
    // set ADMIN_BOOTSTRAP_PASSWORD later to reset it).
    authUserId = existing.id;
  }

  // Ensure the DB profile row exists with role ADMIN (trigger owns roles).
  const { data: profileRow, error: profileError } = await service
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .maybeSingle();
  if (profileError) throw profileError;

  if (!profileRow) {
    const { error: insertError } = await service
      .from('profiles')
      .insert({ id: authUserId, email, role: 'ADMIN' });
    if (insertError) throw insertError;
  } else if (profileRow.role !== 'ADMIN') {
    const { error: updateError } = await service
      .from('profiles')
      .update({ role: 'ADMIN' })
      .eq('id', authUserId);
    if (updateError) throw updateError;
  }

  return { email, password, generated, setByEnv };
}