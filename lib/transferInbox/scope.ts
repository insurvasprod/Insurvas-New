import "server-only";
import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { scopeFor, type ProducerScope } from "@/lib/agency/visibility";
import { workItemVisible, type WorkItemFacts } from "./scopeCore";

export { inboxItemVisible, isWaitingTransfer, visibleWorkItemIds, workItemVisible, type WorkItemFacts } from "./scopeCore";

/**
 * AG-0.5 · the route-side guard for ONE work item by id (the rule itself is in ./scopeCore.ts): 404
 * (never 403, so a producer cannot learn that another producer's transfer exists) when the session's
 * scope cannot see it. A work item that does not exist is left to the route's own not-found answer.
 * Pass the scope the route already read, or omit it. Null scope (solo, all-seeing roles): no read.
 */
export async function guardWorkItem(context: { tenantId: string; userId: string }, workItemId: string, known?: ProducerScope): Promise<NextResponse | null> {
  const scope = known === undefined ? await scopeFor(context) : known;
  if (scope === null) return null;
  const { data, error } = await getSupabaseServiceClient()
    .from("lead_queue")
    .select("status, owner_user_id, partner_id")
    .eq("tenant_id", context.tenantId)
    .eq("id", workItemId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "That transfer could not be found." }, { status: 404 });
  if (!data) return null;
  return workItemVisible(scope, data as WorkItemFacts, context.userId) ? null : NextResponse.json({ error: "That transfer could not be found." }, { status: 404 });
}
