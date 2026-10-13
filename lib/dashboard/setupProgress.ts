import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { readFoundRow, readHasPhone, type ExistenceRead, type SetupProgress } from "./checklist";
import { hasImportedStatement } from "./summaries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tenants.support_phone is not in database.types.ts yet (shared; not ours to regenerate)
const db = () => getSupabaseServiceClient() as any;

/** A read that throws (rather than returning an error) proves nothing either. */
async function proves(read: PromiseLike<ExistenceRead>, test: (result: ExistenceRead) => boolean): Promise<boolean> {
  try {
    return test(await read);
  } catch {
    return false;
  }
}

/**
 * The setup checklist's per-step facts, for one tenant. Five cheap existence reads (`limit 1` or a
 * head count) run in parallel. Every read is filtered by the tenant: these go through the service
 * role, which has no RLS predicate, and an unfiltered read would walk every tenant's rows.
 */
export async function loadSetupProgress(tenantId: string): Promise<SetupProgress> {
  const [carriersAdded, statementImported, appointmentsConfirmed, leadSourcesAdded, phoneAdded, finished] = await Promise.all([
    proves(db().from("tenant_carriers").select("id").eq("tenant_id", tenantId).eq("is_active", true).limit(1), readFoundRow),
    hasImportedStatement(tenantId),
    // An agency appointment in force — the same rows the "Appointments" tile counts.
    proves(db().from("appointments").select("id").eq("tenant_id", tenantId).is("terminated_at", null).limit(1), readFoundRow),
    // Any publisher, marketing company or affiliate the agency has not offboarded.
    proves(db().from("partners").select("id").eq("tenant_id", tenantId).neq("status", "offboarded").limit(1), readFoundRow),
    // The phone on the agency profile tab (migration 20260924210000). The tenant's own row.
    proves(db().from("tenants").select("support_phone").eq("id", tenantId).maybeSingle(), readHasPhone),
    // LA-0.3's "does not come back": stamped once, the first time every step was done. Before the
    // column is migrated the read errors, which proves nothing — the checklist just follows the steps.
    proves(db().from("tenants").select("setup_checklist_completed_at").eq("id", tenantId).maybeSingle(), (read) =>
      readFoundRow(read) && (read?.data as { setup_checklist_completed_at?: unknown }).setup_checklist_completed_at != null,
    ),
  ]);
  return { carriersAdded, statementImported, appointmentsConfirmed, leadSourcesAdded, phoneAdded, finished };
}

/**
 * Stamps the checklist finished, once. Called when a render finds every step done and no stamp;
 * `is null` makes a second, racing render a no-op, and a failure (column not migrated yet) only means
 * the next render tries again.
 */
export async function recordSetupFinished(tenantId: string): Promise<void> {
  try {
    await db().from("tenants").update({ setup_checklist_completed_at: new Date().toISOString() }).eq("id", tenantId).is("setup_checklist_completed_at", null);
  } catch {
    // Not stamped: the steps still hold, so the checklist stays hidden on the next render anyway.
  }
}
