import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { qaVerdictForReview } from "@/lib/applications/mutations";
import { agencyRpc } from "./rpc";
import { scopeFor } from "./visibility";
import type { ReviewErrorType } from "./reviewCore";

/**
 * AG-1.11 · the Application Review queue: sampled submitted applications, each shown against LA-3's own check
 * results (qaVerdictForReview — not one check reimplemented), with pass / fail / fix-and-resubmit and an error
 * type. A producer sees his own reviews and tally; a manager his reports'; owner and admin everyone's.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type ReviewRow = {
  id: string;
  applicationId: string;
  producerUserId: string;
  sampleBps: number;
  sampledAt: string;
  status: "queued" | "passed" | "failed" | "fix_requested";
  errorTypes: ReviewErrorType[];
  note: string | null;
  reviewedAt: string | null;
  clientName: string | null;
  carrierName: string | null;
};

export async function readReviews(context: { tenantId: string; userId: string }): Promise<ReviewRow[]> {
  await agencyRpc<number>("agency_review_sample", { p_tenant_id: context.tenantId });
  const scope = await scopeFor(context);
  let query = db()
    .from("application_review")
    .select("id, application_id, producer_user_id, sample_bps, sampled_at, status, error_types, note, reviewed_at, tenant_applications(carrier_id, case_id, carriers(name))")
    .eq("tenant_id", context.tenantId)
    .order("sampled_at", { ascending: false })
    .limit(500);
  if (scope !== null) query = query.in("producer_user_id", scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await query;
  if (error) throw new Error(`readReviews: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const app = (r.tenant_applications ?? {}) as { carriers?: { name?: string } | null };
    return {
      id: r.id as string,
      applicationId: r.application_id as string,
      producerUserId: r.producer_user_id as string,
      sampleBps: Number(r.sample_bps),
      sampledAt: r.sampled_at as string,
      status: r.status as ReviewRow["status"],
      errorTypes: (r.error_types ?? []) as ReviewErrorType[],
      note: (r.note as string | null) ?? null,
      reviewedAt: (r.reviewed_at as string | null) ?? null,
      clientName: null,
      carrierName: app.carriers?.name ?? null,
    };
  });
}

/** LA-3's verdict for one sampled application, for the reviewer. */
export async function reviewChecks(tenantId: string, applicationId: string) {
  const verdict = await qaVerdictForReview(tenantId, applicationId);
  return verdict;
}

export async function recordReview(input: { tenantId: string; reviewId: string; status: "passed" | "failed" | "fix_requested"; errorTypes: ReviewErrorType[]; note: string | null; actorId: string }) {
  await agencyRpc("agency_review_record", {
    p_tenant_id: input.tenantId,
    p_review_id: input.reviewId,
    p_status: input.status,
    p_error_types: input.errorTypes,
    p_note: input.note,
    p_actor: input.actorId,
  });
}

export async function setSampleRate(tenantId: string, producerUserId: string, sampleBps: number, actorId: string) {
  const { error } = await db().from("agency_review_rate").upsert({ tenant_id: tenantId, producer_user_id: producerUserId, sample_bps: sampleBps, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,producer_user_id" });
  if (error) throw new Error(`setSampleRate: ${error.message}`);
}
