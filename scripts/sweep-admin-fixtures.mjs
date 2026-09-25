/**
 * Deactivates leftover QA admin fixtures, and fails if any is still live.
 *
 *   npm run qa:admin-fixtures          # deactivate any active fixture admin, audit-logged
 *   npm run qa:admin-fixtures:check    # report only; exit 1 if any is active
 *
 * ## Why this exists
 *
 * Twenty-one scripts in this directory create an `admin_users` row so they can mint a session for
 * a role that has no real account. Most deactivate what they created; the ones that exit early, or
 * threw before their cleanup, do not. On 2026-09-21 that had left **33 fixture rows, 5 of them
 * active `super_admin`** — live god-mode accounts with password hashes, named
 * `verify-<timestamp>@insurvas.invalid`.
 *
 * Nobody would find those by reading code, because no single script is wrong. The leak is what a
 * fleet of scripts does over two weeks, so the guard has to be a sweep rather than a fix.
 *
 * ## Deactivate, never delete
 *
 * These rows are referenced by `audit_log.actor_id`, and the audit log is append-only by database
 * privilege — so deleting the admin would either fail on the foreign key or orphan the evidence of
 * what that fixture did. `is_active = false` is what the application checks on every request
 * (`resolveAdminContext`), so it is the whole of the security fix and it keeps the trail intact.
 *
 * ## What counts as a fixture
 *
 * Only the `@insurvas.invalid` domain — reserved, unroutable, and used by these scripts by
 * convention. Real accounts and the `@insurvas.test` demo accounts are never touched.
 */
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

const FIXTURE_DOMAIN = "@insurvas.invalid";
const checkOnly = process.argv.includes("--check");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Uses `process.exitCode` and returns rather than calling `process.exit()`: exiting while the
// Supabase client still holds open handles trips a libuv assertion on Windows, which prints over
// the result and can mask the exit code the caller is checking.
async function main() {
  const { data: fixtures, error } = await sb
    .from("admin_users")
    .select("id, email, role, is_active, created_at")
    .ilike("email", `%${FIXTURE_DOMAIN}`);

  if (error) {
    console.error(`Could not read admin_users: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const active = (fixtures ?? []).filter((row) => row.is_active);

  console.log(`fixture admin rows (${FIXTURE_DOMAIN}): ${fixtures?.length ?? 0}`);
  console.log(`still active                          : ${active.length}`);

  if (active.length === 0) {
    console.log("\nNothing to sweep.");
    return;
  }

  const byRole = active.reduce((counts, row) => ({ ...counts, [row.role]: (counts[row.role] ?? 0) + 1 }), {});
  console.log(`by role                               : ${JSON.stringify(byRole)}`);
  for (const row of active) {
    console.log(`  ${row.role.padEnd(16)} created ${row.created_at?.slice(0, 19) ?? "?"}  ${row.email}`);
  }

  if (checkOnly) {
    console.error(
      `\n${active.length} QA fixture admin account(s) are still active. Each can authenticate every` +
        ` /api/admin/* route at its role. Run: npm run qa:admin-fixtures`,
    );
    process.exitCode = 1;
    return;
  }

  const ids = active.map((row) => row.id);
  const { error: updateError } = await sb.from("admin_users").update({ is_active: false }).in("id", ids);
  if (updateError) {
    console.error(`\nCould not deactivate: ${updateError.message}`);
    process.exitCode = 1;
    return;
  }

  // One row naming what was swept. The audit log accepts inserts and refuses updates and deletes,
  // so this is a permanent record that the sweep ran — which is the point of recording it at all.
  const { error: auditError } = await sb.from("audit_log").insert({
    actor_type: "system",
    action: "admin.deactivated",
    target_type: "admin_user",
    target_id: ids[0],
    reason: `QA fixture sweep: deactivated ${ids.length} leftover ${FIXTURE_DOMAIN} admin account(s)`,
    metadata: { swept: active.map((row) => ({ id: row.id, role: row.role })) },
  });
  if (auditError) console.error(`warning: swept, but could not write the audit row: ${auditError.message}`);

  console.log(`\nDeactivated ${ids.length} fixture admin account(s). Re-run with --check to confirm.`);
}

await main();
