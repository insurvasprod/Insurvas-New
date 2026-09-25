import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { verificationProgress } from "@/lib/verification/progress";
import { isApplicationOutcome } from "./applicationOutcome";
import { DispositionError, listMappedOutcomes } from "./service";

/**
 * Verification status of an inbound transfer, read from its verification session: the open one,
 * or — once the call has ended — the latest. Progress is recomputed from the stored field rows (the
 * same rule as lib/verification/progress.ts), because a template with no required fields never
 * writes a progress_percentage above the default. Null when there is no session at all.
 */
export async function verificationStatus(tenantId: string, workItemId: string): Promise<{ progress: number; complete: boolean } | null> {
  const supabase = getSupabaseServiceClient();
  const session = await supabase
    .from("tenant_verification_sessions")
    .select("id, progress_percentage, completed_at, ended_at")
    .eq("tenant_id", tenantId)
    .eq("work_item_id", workItemId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (session.error) throw new DispositionError("disposition_unavailable", `Could not read verification: ${session.error.message}`);
  if (!session.data) return null;
  const fields = await supabase.from("verification_fields").select("field_key, state, is_required, is_visible").eq("session_id", session.data.id);
  if (fields.error || !fields.data?.length) {
    const progress = session.data.progress_percentage ?? 0;
    return { progress, complete: progress >= 100 };
  }
  const rows = fields.data as Array<{ field_key: string; state: "confirmed" | "corrected" | "outstanding"; is_required: boolean; is_visible: boolean }>;
  const progress = verificationProgress(rows, rows.filter((row) => row.is_required).map((row) => row.field_key), rows.filter((row) => row.is_visible).map((row) => row.field_key));
  return { progress, complete: progress >= 100 };
}

/**
 * The tenant's outcome for this key when it records an application (sale or submitted
 * application), else null — the one test both the verification gate and the dialer's setter rule
 * use. Read from the outcome's mapped stage and flags, never from the key.
 */
export async function applicationOutcomeFor(tenantId: string, dispositionKey: string) {
  const outcomes = await listMappedOutcomes(tenantId);
  const outcome = outcomes.find((row) => row.disposition_key === dispositionKey);
  return outcome && isApplicationOutcome(outcome, outcome.mapped_stage) ? outcome : null;
}

/**
 * User decision (2026-09-24): "Record call outcome" is always open, and the SERVER refuses an
 * application outcome until verification is 100% complete. Which outcomes are applications is read
 * from each outcome's mapped stage and flags (isApplicationOutcome), never from a key.
 *
 * Throws DispositionError("verification_incomplete") with a message the wizard shows as is. Other
 * outcomes pass straight through — they may be recorded at any point in the call.
 */
export async function assertApplicationOutcomeVerified(tenantId: string, workItemId: string, dispositionKey: string) {
  const outcome = await applicationOutcomeFor(tenantId, dispositionKey);
  // Not a mapped active application outcome: complete_disposition refuses or leaves it as it always has.
  if (!outcome) return;
  const status = await verificationStatus(tenantId, workItemId);
  if (status?.complete) return;
  throw new DispositionError(
    "verification_incomplete",
    status
      ? `“${outcome.label}” records an application, so verification has to be complete first. It is ${status.progress}% complete: go back to verification, confirm or correct the outstanding required fields, then record this outcome.`
      : `“${outcome.label}” records an application, so verification has to be complete first, and this transfer has no verification session. Open verification and confirm the required fields, then record this outcome.`,
  );
}
