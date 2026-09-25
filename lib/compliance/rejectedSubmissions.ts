import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { maskLastFour, TCPA_REJECTION_REASON } from "./rejectionContract";

export { maskLastFour, NEUTRAL_END_CALL_SCRIPT, TCPA_REJECTION_REASON } from "./rejectionContract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function recordRejectedPartnerSubmission(input: {
  tenantId: string;
  partnerId: string;
  userId: string | null;
  submissionId: string;
  productCode: string;
  reason: typeof TCPA_REJECTION_REASON;
  phoneDigits: string | null;
  screeningResultId: string | null;
}): Promise<{ id: string; created: boolean; count: number; maskedPhone: string | null }> {
  if (!UUID.test(input.tenantId) || !UUID.test(input.partnerId) || !UUID.test(input.submissionId)) {
    throw new Error("Could not record the rejected submission");
  }
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("partner_rejected_submissions").insert({
    tenant_id: input.tenantId,
    partner_id: input.partnerId,
    user_id: input.userId,
    submission_id: input.submissionId,
    product_code: input.productCode,
    reason: input.reason,
    phone_last4: input.phoneDigits?.slice(-4) ?? null,
    screening_result_id: input.screeningResultId,
  });
  if (error && error.code !== "23505") throw new Error("Could not record the rejected submission");

  const { data: row, error: rowError } = await supabase
    .from("partner_rejected_submissions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("partner_id", input.partnerId)
    .eq("submission_id", input.submissionId)
    .eq("reason", input.reason)
    .single();
  if (rowError || !row) throw new Error("Could not resolve the rejected submission");

  const { count, error: countError } = await supabase
    .from("partner_rejected_submissions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("partner_id", input.partnerId)
    .eq("reason", input.reason);
  if (countError) throw new Error("Could not load rejected submission count");
  return {
    id: row.id,
    created: !error,
    count: count ?? 0,
    maskedPhone: maskLastFour(input.phoneDigits),
  };
}
