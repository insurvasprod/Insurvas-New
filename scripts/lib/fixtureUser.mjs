/**
 * Creates and removes the throwaway tenant users the LA-0 verification suites need.
 *
 * Why this exists. `public.users.id` has no default and carries `users_id_fkey` to `auth.users`,
 * because Supabase Auth is the credential authority for the tenant plane. A verifier that inserts
 * into `public.users` with its own `randomUUID()` therefore fails with
 *
 *   insert or update on table "users" violates foreign key constraint "users_id_fkey"
 *
 * and every authenticated assertion after it returns 401, because the session resolves to a user
 * that does not exist. Three suites were written before that change and failed exactly this way.
 *
 * The supported path is to create the Auth user first and let the `on_auth_user_created` bridge
 * trigger write the `public.users` row, then activate it. That is what this does.
 */

/**
 * @param supabase a service-role Supabase client
 * @param options.email  unique throwaway address — use an @invalid.test domain so nothing can be
 *                       delivered to it even by accident
 * @param options.name   display name for the fixture
 * @param options.status defaults to 'active'; the bridge trigger creates the row as 'invited'
 * @returns {Promise<{userId: string, authUserId: string}>}
 */
export async function createFixtureUser(supabase, { email, name, status = "active" }) {
  const created = await supabase.auth.admin.createUser({
    email,
    // Long, random and never printed. The fixture authenticates with a signed cookie, not a
    // password, so this value is only here because Auth requires one.
    password: `Fixture-${crypto.randomUUID()}!`,
    email_confirm: true,
    user_metadata: { name, full_name: name },
  });
  if (created.error) throw new Error(`Could not create the fixture auth user: ${created.error.message}`);

  const userId = created.data.user.id;

  // The trigger inserts the row as 'invited' and inactive. A verifier needs it active, or
  // resolveTenantContext() drops the session on the first request.
  const activated = await supabase
    .from("users")
    .update({ name, full_name: name, display_name: name, status, active: status === "active" })
    .eq("id", userId);
  if (activated.error) throw new Error(`Could not activate the fixture user: ${activated.error.message}`);

  return { userId, authUserId: userId };
}

/**
 * Removes a fixture user from both halves. Order matters: the `public.users` row references
 * `auth.users`, so it has to go first.
 */
export async function deleteFixtureUser(supabase, userId) {
  if (!userId) return;
  await supabase.from("users").delete().eq("id", userId);
  await supabase.auth.admin.deleteUser(userId).catch(() => {
    // Already gone, or never created — cleanup must never be the thing that fails a run.
  });
}
