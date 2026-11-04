import "server-only";

import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { missingRuleCount } from "./carrierCoverageModel";
import { loadCarrierCoverage } from "./carrierCoverage";

/**
 * Setup's tab counts (board 8): each tab's count is what is missing there, the same on every tab.
 *   Rate card      carriers with a policy the rate card cannot price (expected_commission, no_rate_card)
 *   Carrier rules  windows not set, across the carriers the agency works with
 *   Agent codes    writing-agent codes no person is mapped to
 * Pipeline rules and Files in have nothing missing to count. A count that cannot be read is left off,
 * never shown as 0. Reads only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

async function distinct(read: PromiseLike<{ data: Loose[] | null; error: unknown }>, key: (row: Loose) => string): Promise<number | null> {
  const { data, error } = await read;
  if (error) return null;
  return new Set((data ?? []).map(key)).size;
}

export const setupTabCounts = cache(async (tenantId: string): Promise<{ "rate-card": number | null; "carrier-rules": number | null; "agent-codes": number | null }> => {
  const [rates, rules, codes] = await Promise.all([
    distinct(db().from("expected_commission").select("carrier_id").eq("tenant_id", tenantId).eq("confidence", "no_rate_card").limit(10_000), (row) => row.carrier_id).catch(() => null),
    loadCarrierCoverage(tenantId).then((view) => (view.available ? missingRuleCount(view.carriers) : null)).catch(() => null),
    distinct(db().from("policy_current").select("carrier_id, agent_identifier").eq("tenant_id", tenantId).not("agent_identifier", "is", null).is("agent_user_id", null).limit(10_000), (row) => `${row.carrier_id}|${row.agent_identifier}`).catch(() => null),
  ]);
  return { "rate-card": rates, "carrier-rules": rules, "agent-codes": codes };
});
