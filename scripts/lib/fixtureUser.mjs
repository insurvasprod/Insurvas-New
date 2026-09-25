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
 * @param options.email  unique throwaway address — use an @invalid.test domain; the shared email
 *                       transport also blocks reserved QA domains as a second safety boundary
 * @param options.name   display name for the fixture
 * @param options.password optional known password for a login-level verifier; otherwise random
 * @param options.status defaults to 'active'; the bridge trigger creates the row as 'invited'
 * @returns {Promise<{userId: string, authUserId: string}>}
 */
export async function createFixtureUser(supabase, { email, name, password, status = "active" }) {
  const created = await supabase.auth.admin.createUser({
    email,
    // Long, random and never printed unless a verifier explicitly supplies its own test value.
    password: password ?? `Fixture-${crypto.randomUUID()}!`,
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
 * Creates the `organizations` row a fixture tenant needs.
 *
 * `partners.organization_id` and `partner_users.organization_id` are NOT NULL with a foreign key to
 * `organizations`, which belongs to the organizations-era product this database also serves. The
 * tenant plane never writes that column, so a fixture tenant with no paired organization cannot
 * hold a partner at all. Live tenants use the same id for both, so fixtures do too — that keeps
 * `organization_id: tenantId` correct everywhere rather than introducing a second id to thread.
 *
 * Only `name` and `slug` lack defaults, so this is deliberately minimal.
 *
 * @param supabase a service-role Supabase client
 * @param id       the tenant id, reused as the organization id
 * @param name     a throwaway display name
 */
export async function createFixtureOrganization(supabase, id, name) {
  const { error } = await supabase.from("organizations").insert({
    id,
    name,
    slug: `fixture-${id.slice(0, 8)}`,
  });
  // A re-run against a surviving row is fine; anything else is a real failure.
  if (error && !/duplicate key/i.test(error.message)) {
    throw new Error(`Could not create the fixture organization: ${error.message}`);
  }
}

/**
 * Gives a disposable LA-1 tenant one appointment-backed market pair so partner lead fixtures
 * can exercise the real carrier/state gate. Production still resolves this through the normal
 * appointment vault; this helper only prepares verifier-owned data.
 */
export async function createFixtureMarket(supabase, tenantId, { state = "AZ" } = {}) {
  const { data: carrier, error: carrierError } = await supabase
    .from("carriers")
    .select("id")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (carrierError) throw new Error(`Could not load a fixture carrier: ${carrierError.message}`);
  if (!carrier) throw new Error("No active carrier is available for the fixture market");

  const effectiveFrom = "2025-01-01";
  const contract = await supabase.from("tenant_carriers").upsert({
    tenant_id: tenantId,
    carrier_id: carrier.id,
    contract_level_bp: 10000,
    writing_number: `FIXTURE-${tenantId.slice(0, 8)}`,
    effective_from: effectiveFrom,
    is_active: true,
  }, { onConflict: "tenant_id,carrier_id,effective_from" });
  if (contract.error) throw new Error(`Could not create the fixture carrier contract: ${contract.error.message}`);

  const appointment = await supabase.from("appointments").upsert({
    tenant_id: tenantId,
    carrier_id: carrier.id,
    state,
    status: "active",
    effective_from: effectiveFrom,
    terminated_at: null,
  }, { onConflict: "tenant_id,carrier_id,state,effective_from" });
  if (appointment.error) throw new Error(`Could not create the fixture appointment: ${appointment.error.message}`);

  return { carrierId: carrier.id, state };
}

/** Removes a fixture organization. Partner rows cascade, so this runs after the tenant cleanup. */
export async function deleteFixtureOrganization(supabase, id) {
  if (!id) return;
  await supabase.from("organizations").delete().eq("id", id);
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

/**
 * Removes one LA-1 verifier tenant and proves that teardown actually completed.
 *
 * A number of the production-shaped tables deliberately use RESTRICT instead of CASCADE for
 * financial records, rejected submissions, and partner memberships.  A plain tenants.delete()
 * therefore fails after a suite has exercised one of those paths.  PostgREST returns that error
 * rather than throwing, so an ignored result quietly leaves a large performance fixture behind.
 *
 * This helper is deliberately narrow: it will only touch a tenant whose stored name has the
 * verifier-owned `LA-1.N` prefix.  It is not a general tenant deletion tool and cannot be pointed
 * at a demo or customer tenant by a malformed test id.
 */
export async function deleteLa1FixtureTenant(supabase, tenantId) {
  if (!tenantId) return;

  const { data: tenant, error: lookupError } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle();
  if (lookupError) throw new Error(`Could not inspect LA-1 fixture tenant ${tenantId}: ${lookupError.message}`);
  if (!tenant) return;
  if (!/^LA-1\.(?:[1-9]|1\d|2[0-5])\s/.test(tenant.name)) {
    throw new Error(`Refusing to delete non-LA-1 verifier tenant ${tenantId} (${tenant.name})`);
  }

  // Delete every direct RESTRICT dependency before deleting the tenant.  Other tenant-scoped
  // verifier data remains protected by database cascades, which is both more complete and less
  // fragile than trying to enumerate the whole tenant graph in each individual suite.
  for (const table of ["partner_rejected_submissions", "partner_users", "payments", "credit_notes", "platform_invoices"]) {
    const { error } = await supabase.from(table).delete().eq("tenant_id", tenantId);
    if (error) throw new Error(`Could not remove ${table} for LA-1 fixture ${tenantId}: ${error.message}`);
  }

  const { error: deleteError } = await supabase.from("tenants").delete().eq("id", tenantId);
  if (deleteError) throw new Error(`Could not remove LA-1 fixture tenant ${tenantId}: ${deleteError.message}`);

  const { data: remaining, error: verifyError } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (verifyError) throw new Error(`Could not verify LA-1 fixture teardown for ${tenantId}: ${verifyError.message}`);
  if (remaining) throw new Error(`LA-1 fixture tenant teardown did not remove ${tenantId}`);
}

/**
 * Deletes a large verifier-owned tenant table in bounded statements.  The hosted project's
 * statement timeout is deliberately short; a single 10,000-row delete can time out before its
 * cascading work starts.  Only the LA-1.13 performance fixture needs this today, but keeping the
 * guard here prevents a future high-volume verifier from reintroducing silent leftovers.
 */
export async function deleteLa1FixtureRowsInBatches(supabase, table, tenantId, batchSize = 250) {
  const supportedTables = new Set(["deal_flow", "lead_queue", "agent_leads"]);
  if (!supportedTables.has(table)) {
    throw new Error(`LA-1 fixture batch cleanup does not permit table ${table}`);
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("LA-1 fixture cleanup batch size must be an integer between 1 and 1000");
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError) throw new Error(`Could not inspect LA-1 fixture tenant ${tenantId}: ${tenantError.message}`);
  if (!tenant) return;
  if (!/^LA-1\.(?:[1-9]|1\d|2[0-5])\s/.test(tenant.name)) {
    throw new Error(`Refusing to clean rows for non-LA-1 verifier tenant ${tenantId} (${tenant.name})`);
  }

  while (true) {
    const { data: rows, error: selectError } = await supabase
      .from(table)
      .select("id")
      .eq("tenant_id", tenantId)
      .limit(batchSize);
    if (selectError) throw new Error(`Could not read ${table} for LA-1 fixture ${tenantId}: ${selectError.message}`);
    const ids = (rows ?? []).map((row) => row.id);
    if (ids.length === 0) return;

    const { error: deleteError } = await supabase.from(table).delete().in("id", ids);
    if (deleteError) throw new Error(`Could not remove ${table} batch for LA-1 fixture ${tenantId}: ${deleteError.message}`);
  }
}
