import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ProducerScope } from "@/lib/agency/visibilityCore";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import { scopeWithSelf, waitingTransferOr } from "@/lib/dashboard/scope";

/**
 * The numbers beside a page in the sidebar (Navigation A, 2026-10-28): work waiting on that page now.
 * Four head counts, no rows. Each one sits behind the same feature and roles as its menu item, so a
 * count is never shown for a page the reader cannot open, and each follows the reader's producer
 * scope the way the dashboard's "Needs you" strip does (lib/dashboard/today.ts):
 *   · leads.dialer      outbound leads ready to call (scoped: the reader's own assigned work);
 *   · leads.inbound     partner transfers waiting to be claimed (scoped: waiting, or held in scope);
 *   · sell.callbacks    open callbacks whose time has come (scoped: assigned to the scope or reader);
 *   · retention.lapse-risk  open lapse signals (the agency's; never under a scope).
 * A failed read leaves its key out: no number is better than a wrong one.
 */
export type NavCounts = Partial<Record<"leads.dialer" | "leads.inbound" | "sell.callbacks" | "retention.lapse-risk", number>>;

type Result = PromiseLike<{ error: { message: string } | null; count?: number | null }>;
type Chain = Result & {
  eq(column: string, value: unknown): Chain;
  in(column: string, values: readonly string[]): Chain;
  or(filters: string): Chain;
  is(column: string, value: null): Chain;
  not(column: string, op: string, value: unknown): Chain;
  lte(column: string, value: string): Chain;
};
type Loose = { from(table: string): { select(columns: string, options: { count: "exact"; head: true }): Chain } };

const head = (table: string) => (getSupabaseServiceClient() as unknown as Loose).from(table).select("id", { count: "exact", head: true });
const count = async (query: Chain) => {
  const result = await query;
  return result.error ? null : result.count ?? 0;
};

/**
 * The reader's own saved Inbound status, for the top bar's pill: what the Inbound page last saved for
 * them (agent_presence, their one row). Null when they do not take transfers or the read fails. The
 * pill only shows it; the status is changed on Inbound, as before.
 */
export type NavPresence = "ready" | "on_break" | "on_call" | "off" | null;

export async function readOwnPresence(input: { tenantId: string; userId: string; roles: readonly TenantRole[]; available: readonly string[] }): Promise<NavPresence> {
  if (!input.available.includes("inbound_transfers")) return null;
  if (!input.roles.some((role) => role === "owner" || role === "producer" || role === "assistant")) return null;
  const result = await getSupabaseServiceClient()
    .from("agent_presence")
    .select("status")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (result.error) return null;
  const status = (result.data as { status?: string } | null)?.status;
  return status === "ready" || status === "on_break" || status === "on_call" ? status : "off";
}

export async function readNavCounts(input: { tenantId: string; userId: string; roles: readonly TenantRole[]; available: readonly string[]; scope: ProducerScope; now?: number }): Promise<NavCounts> {
  const has = (feature: string) => input.available.includes(feature);
  const may = (...roles: TenantRole[]) => input.roles.some((role) => roles.includes(role));
  const isolated = input.scope !== null;
  const heldBy = scopeWithSelf(input.scope, input.userId);
  const now = new Date(input.now ?? Date.now()).toISOString();

  const reads: Array<[keyof NavCounts, Promise<number | null>]> = [];
  if (has("outbound_dialing") && may("owner", "producer", "setter")) {
    const query = head("lead_queue").eq("tenant_id", input.tenantId).eq("status", "unclaimed").is("partner_id", null);
    reads.push(["leads.dialer", count(isolated ? query.eq("owner_user_id", input.userId) : query)]);
  }
  if (has("inbound_transfers") && may("owner", "producer", "assistant")) {
    const query = head("lead_queue").eq("tenant_id", input.tenantId).eq("status", "unclaimed").not("partner_id", "is", null);
    reads.push(["leads.inbound", count(heldBy === null ? query : query.or(waitingTransferOr(heldBy)))]);
  }
  if (has("callback_calendar") && may("owner", "producer", "assistant")) {
    const query = head("tenant_callbacks").eq("tenant_id", input.tenantId).in("status", ["scheduled", "due", "missed"]).lte("scheduled_at_utc", now);
    reads.push(["sell.callbacks", count(heldBy === null ? query : query.in("assigned_to", heldBy))]);
  }
  if (has("chargeback_radar") && may("owner", "producer", "retention") && !isolated) {
    reads.push(["retention.lapse-risk", count(head("tenant_policy_lapse_signals").eq("tenant_id", input.tenantId).is("resolved_at", null))]);
  }

  const settled = await Promise.all(reads.map(([key, read]) => read.then((value) => [key, value] as const, () => [key, null] as const)));
  const counts: NavCounts = {};
  for (const [key, value] of settled) if (value !== null) counts[key] = value;
  return counts;
}
