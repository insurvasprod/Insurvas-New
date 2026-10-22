import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { rowVisible, type ProducerScope } from "../agency/visibilityCore";

/**
 * AG-0.5 · which work items (lead_queue rows) a session may see, for the inbound inbox, the Agent Floor,
 * the partner chat's transfer cards and every route that acts on one transfer by id. No next/server and
 * no session read here, so the services that import it stay loadable on their own; the route-side guard
 * is lib/transferInbox/scope.ts.
 *
 * A work item belongs to the producer it is with (D1: lead_queue.owner_user_id — the agent who claimed
 * the transfer, or who was routed it). Visible to a narrow session when that producer is in its scope,
 * or when the session itself holds it (a buffer assistant's own claim: an assistant's scope is the
 * producers he assists, not himself).
 *
 * One exception: a LIVE inbound transfer still waiting in the inbox (partner_id set, unclaimed — every
 * path that sets a row back to 'unclaimed' clears owner_user_id) is nobody's row yet and is visible to
 * every member who may claim transfers. AG-0.10 keeps that on purpose: "a live transfer is still
 * assigned at the moment of transfer (LA-1's claim) — there is a human on the phone". An unclaimed
 * OUTBOUND work item (partner_id null) is the agency's unassigned pool, which in an agency is the
 * owner's and an admin's only (lib/agency/routing.ts), so it is NOT visible to a narrow session.
 *
 * With a null scope (individual plan, owner/admin, bookkeeper, retention) everything is visible and no
 * row is read: solo tenants behave exactly as before.
 */
export type WorkItemFacts = { status: string | null; owner_user_id: string | null; partner_id?: string | null };

export function isWaitingTransfer(item: WorkItemFacts): boolean {
  return item.status === "unclaimed" && !item.owner_user_id && Boolean(item.partner_id);
}

export function workItemVisible(scope: ProducerScope, item: WorkItemFacts, viewerId?: string | null): boolean {
  if (scope === null) return true;
  if (isWaitingTransfer(item)) return true;
  if (viewerId && item.owner_user_id === viewerId) return true;
  return rowVisible(scope, item.owner_user_id);
}

/** Inbox rows carry `status` and `ownerUserId`; every inbox row is an inbound transfer (partner leads only). */
export function inboxItemVisible(scope: ProducerScope, item: { status: string; ownerUserId: string | null }, viewerId?: string | null): boolean {
  return workItemVisible(scope, { status: item.status, owner_user_id: item.ownerUserId, partner_id: "inbound" }, viewerId);
}

/** The work items among these the scope may see. One read; none when the scope is null. */
export async function visibleWorkItemIds(tenantId: string, scope: ProducerScope, workItemIds: readonly string[], viewerId?: string | null): Promise<Set<string>> {
  const ids = [...new Set(workItemIds.filter(Boolean))];
  if (scope === null) return new Set(ids);
  if (!ids.length) return new Set();
  const { data, error } = await getSupabaseServiceClient()
    .from("lead_queue")
    .select("id, status, owner_user_id, partner_id")
    .eq("tenant_id", tenantId)
    .in("id", ids.slice(0, 1000));
  // A failed read closes the scope rather than opening it.
  if (error) {
    console.error(`[agency scope] could not read work items: ${error.message}`);
    return new Set();
  }
  return new Set(((data ?? []) as Array<WorkItemFacts & { id: string }>).filter((row) => workItemVisible(scope, row, viewerId)).map((row) => row.id));
}
