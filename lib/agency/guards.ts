import "server-only";
import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { rowVisible, scopeFor } from "./visibility";

/**
 * AG-0.4 / AG-0.5 · one guard per resource family, for routes that act on ONE record by id.
 *
 * Each resolves the record's producer (decision D1: the user id in the column the table already carries)
 * and refuses a session that cannot see that producer — with 404, not 403, so producer A cannot even learn
 * that producer B's record exists. For an individual-plan tenant and for the all-seeing roles the scope is
 * null and no record is read at all.
 *
 * Usage, right after the role gate:
 *   const hidden = await guardAttempt(auth.context, id);
 *   if (hidden) return hidden;
 */

type Ctx = { tenantId: string; userId: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

const NOT_FOUND = (what: string) => NextResponse.json({ error: `That ${what} could not be found.` }, { status: 404 });

async function guard(context: Ctx, what: string, producerOf: () => Promise<string | null | undefined>): Promise<NextResponse | null> {
  const scope = await scopeFor(context);
  if (scope === null) return null;
  const producer = await producerOf();
  return rowVisible(scope, producer) ? null : NOT_FOUND(what);
}

async function caseProducer(tenantId: string, caseId: string | null | undefined): Promise<string | null> {
  if (!caseId) return null;
  const { data } = await db().from("tenant_application_cases").select("opened_by").eq("tenant_id", tenantId).eq("id", caseId).maybeSingle();
  return (data?.opened_by as string | null) ?? null;
}

/** An application attempt (tenant_applications.id) belongs to whoever opened its case. */
export function guardAttempt(context: Ctx, attemptId: string) {
  return guard(context, "application", async () => {
    const { data } = await db().from("tenant_applications").select("case_id").eq("tenant_id", context.tenantId).eq("id", attemptId).maybeSingle();
    return caseProducer(context.tenantId, data?.case_id);
  });
}

/** An application case (tenant_application_cases.id). */
export function guardCase(context: Ctx, caseId: string) {
  return guard(context, "application", () => caseProducer(context.tenantId, caseId));
}

/** A lead (agent_leads.id) belongs to the producer it is assigned to on the queue (AG-0.10). */
export async function leadProducer(tenantId: string, leadId: string): Promise<string | null> {
  const { data } = await db()
    .from("lead_queue")
    .select("owner_user_id")
    .eq("tenant_id", tenantId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) return (data.owner_user_id as string | null) ?? null;
  // No queue row (a lead typed in by hand, a manual deal): it is its creator's until the queue says otherwise.
  const { data: lead } = await db().from("agent_leads").select("created_by").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  return (lead?.created_by as string | null) ?? null;
}

export function guardLead(context: Ctx, leadId: string) {
  return guard(context, "lead", () => leadProducer(context.tenantId, leadId));
}

/** An underwriting requirement (tenant_application_requirements.id) belongs to its application. */
export function guardRequirement(context: Ctx, requirementId: string) {
  return guard(context, "requirement", async () => {
    const { data } = await db().from("tenant_application_requirements").select("application_id").eq("tenant_id", context.tenantId).eq("id", requirementId).maybeSingle();
    if (!data?.application_id) return null;
    const { data: attempt } = await db().from("tenant_applications").select("case_id").eq("tenant_id", context.tenantId).eq("id", data.application_id).maybeSingle();
    return caseProducer(context.tenantId, attempt?.case_id);
  });
}

/** An issued policy (tenant_issued_policies.deal_id or id) belongs to its application case's producer. */
export function guardIssuedPolicy(context: Ctx, id: string) {
  return guard(context, "policy", async () => {
    const { data } = await db()
      .from("tenant_issued_policies")
      .select("application_case_id")
      .eq("tenant_id", context.tenantId)
      .or(`id.eq.${id},deal_id.eq.${id}`)
      .limit(1)
      .maybeSingle();
    return caseProducer(context.tenantId, data?.application_case_id);
  });
}

/** A producer record (producer.id): visible when his user is in scope — himself, a manager's report, or all. */
export function guardProducer(context: Ctx, producerId: string) {
  return guard(context, "producer", async () => {
    const { data } = await db().from("producer").select("user_id").eq("tenant_id", context.tenantId).eq("id", producerId).maybeSingle();
    return (data?.user_id as string | null) ?? null;
  });
}

/** A dial attempt (tenant_call_attempts.id) belongs to the agent who dialled it. */
export function guardCallAttempt(context: Ctx, attemptId: string) {
  return guard(context, "call", async () => {
    const { data } = await db().from("tenant_call_attempts").select("agent_id").eq("tenant_id", context.tenantId).eq("id", attemptId).maybeSingle();
    return (data?.agent_id as string | null) ?? null;
  });
}
