import { createHash } from "node:crypto";

import type { Json } from "@/lib/supabase/database.types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type SubscriptionMutationOperation =
  | "subscription.assign"
  | "subscription.change_plan"
  | "subscription.cancel"
  | "subscription.pause"
  | "subscription.resume";

type ClaimInput = {
  actorId: string;
  idempotencyKey: string;
  operation: SubscriptionMutationOperation;
  resourceId?: string | null;
  requestBody: unknown;
};

export type MutationClaim =
  | { kind: "execute"; id: string }
  | { kind: "replay"; status: number; body: Json }
  | { kind: "conflict"; message: string };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function normalizeIdempotencyKey(value: string | null): { key: string | null; error?: string } {
  const key = value?.trim() ?? "";
  if (!key) return { key: null };
  if (key.length > 200) return { key: null, error: "Idempotency-Key is too long" };
  return { key };
}

export async function claimSubscriptionMutation(input: ClaimInput): Promise<MutationClaim> {
  const requestHash = createHash("sha256")
    .update(stableJson({ operation: input.operation, resourceId: input.resourceId ?? null, body: input.requestBody }))
    .digest("hex");
  const supabase = getSupabaseServiceClient();
  const row = {
    actor_id: input.actorId,
    idempotency_key: input.idempotencyKey,
    operation: input.operation,
    resource_id: input.resourceId ?? null,
    request_hash: requestHash,
  };

  const { data: created, error: insertError } = await supabase
    .from("subscription_mutation_requests")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (!insertError && created) return { kind: "execute", id: created.id };

  if (insertError?.code !== "23505") {
    throw new Error(`Could not claim subscription mutation: ${insertError?.message ?? "unknown error"}`);
  }

  const { data: existing, error: lookupError } = await supabase
    .from("subscription_mutation_requests")
    .select("id, operation, resource_id, request_hash, status, response_status, response_body")
    .eq("actor_id", input.actorId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (lookupError || !existing) throw new Error("Could not load the existing idempotency record");
  if (
    existing.operation !== input.operation ||
    existing.resource_id !== (input.resourceId ?? null) ||
    existing.request_hash !== requestHash
  ) {
    return { kind: "conflict", message: "This Idempotency-Key was already used for a different request" };
  }
  if (existing.status === "pending") {
    return { kind: "conflict", message: "The original request is still processing; retry shortly" };
  }
  if (existing.response_status === null || existing.response_body === null) {
    throw new Error("The completed idempotency record has no replayable response");
  }
  return { kind: "replay", status: existing.response_status, body: existing.response_body };
}

export async function completeSubscriptionMutation(
  id: string,
  status: "succeeded" | "failed",
  responseStatus: number,
  responseBody: Json,
) {
  const { error } = await getSupabaseServiceClient()
    .from("subscription_mutation_requests")
    .update({ status, response_status: responseStatus, response_body: responseBody, completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`Could not complete subscription mutation: ${error.message}`);
}
