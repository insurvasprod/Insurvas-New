import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { QUEUES_PENDING_MESSAGE, QueueError, resolveItem, type ResolveInput } from "@/lib/ingestion/exceptionQueuesStore";

import { orphanSubjectKey } from "./kinds";
import { loadUnknownPolicy } from "./store";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/** The answers a "Paid on a policy we don't have" item takes: the orphan queue's own (lib/ingestion/exceptionQueues.ts). */
export const UNKNOWN_POLICY_ANSWERS = ["another_writing_number", "raised_with_carrier", "not_mine"] as const;
export type UnknownPolicyAnswer = (typeof UNKNOWN_POLICY_ANSWERS)[number];

/**
 * A person answers a "Paid on a policy we don't have" item (QA 2026-11-03). It has no row of its own, so the
 * answer raises the orphan_commission queue item now — through open_queue_item, with the orphan sweep's own
 * subject key, payload and age, so it is the item the sweep would have opened at the agency's threshold — and
 * resolves it through the queue's own resolveItem with the queue's own answers. No new table or value: the same
 * rows and functions LA-4.9 and LA-4.14 write. "Wait for the policy file" saves nothing, so it never comes here.
 */
export async function answerUnknownPolicy(scope: { tenantId: string; userId: string }, id: string, answer: UnknownPolicyAnswer, note: string | null) {
  // Refused before anything is written, so a refusal never leaves a raised item behind.
  if (answer === "raised_with_carrier" && !note?.trim()) throw new QueueError("Say what you asked the carrier.", 400);
  const found = await loadUnknownPolicy(scope.tenantId, id);
  if (!found) throw new QueueError("Someone decided it, or a policy file now has this policy.", 409);
  const { data: itemId, error } = await db().rpc("open_queue_item", {
    p_tenant_id: scope.tenantId, p_queue_type: "orphan_commission", p_subject_key: orphanSubjectKey(found.carrierId, found.policyNumber), p_subject_type: "commission_policy",
    p_subject_id: null, p_carrier_id: found.carrierId, p_policy_number: found.policyNumber, p_deal_id: null, p_contact_id: null, p_related_contact_id: null,
    p_payload: { lines: found.lines.length, amount_cents: found.amountCents, first_seen: found.firstSeen }, p_writing_agent: null, p_age_from: found.firstSeen,
  });
  if (error) {
    if (isSchemaGap(error)) throw new QueueError(QUEUES_PENDING_MESSAGE, 503);
    if (error.code === "P0001" || error.code === "22023") throw new QueueError(error.message, 409);
    throw new Error(`The item could not be raised: ${error.message}`);
  }
  const input: ResolveInput = answer === "not_mine" ? { resolution: "not_mine" } : { resolution: answer, note: note?.trim() || null };
  // The owner and bookkeepers answer these (keeper-only), and they see every queue item.
  const done = await resolveItem({ tenantId: scope.tenantId, userId: scope.userId, seesAll: true }, String(itemId), input);
  return { itemId: String(itemId), ...done };
}
