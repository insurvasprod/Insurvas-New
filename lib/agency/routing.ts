import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * AG-0.10 · leads belong to the agency; the owner routes them.
 *
 *   · Routing (the LA-2.24 Lead assignment board) is the owner's and an admin's in an agency. A producer works
 *     his own assigned queue; he does not route the agency's leads or browse its pool.
 *   · The unassigned pool carries an AGE on every lead, because an unassigned lead is a lead we paid for and
 *     nobody called. Owner and admin only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type PoolLead = {
  workItemId: string;
  leadId: string;
  name: string;
  state: string | null;
  productLine: string | null;
  queuedAt: string;
  ageMinutes: number;
  partnerId: string | null;
};

/** Every unclaimed, unassigned lead, oldest first, with its age. */
export async function readUnassignedPool(tenantId: string, now = Date.now()): Promise<PoolLead[]> {
  const { data, error } = await db()
    .from("lead_queue")
    .select("id, lead_id, product_line, queued_at, created_at, partner_id, agent_leads(tenant_id, values)")
    .eq("tenant_id", tenantId)
    .eq("status", "unclaimed")
    .is("owner_user_id", null)
    .order("queued_at", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(`readUnassignedPool: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    // The embed has no tenant predicate of its own: another tenant's lead is never named (audit 2026-11-19).
    const lead = row.agent_leads as { tenant_id?: string; values?: Record<string, unknown> } | null;
    const values = ((lead && lead.tenant_id === tenantId ? lead.values : null) ?? {}) as Record<string, unknown>;
    const queuedAt = (row.queued_at as string | null) ?? (row.created_at as string);
    const name = [values.first_name, values.last_name].filter((v) => typeof v === "string" && v.trim()).join(" ") || "Unnamed lead";
    const state = typeof values.state === "string" ? values.state.toUpperCase() : null;
    return {
      workItemId: row.id as string,
      leadId: row.lead_id as string,
      name,
      state,
      productLine: (row.product_line as string | null) ?? null,
      queuedAt,
      ageMinutes: Math.max(0, Math.floor((now - new Date(queuedAt).getTime()) / 60_000)),
      partnerId: (row.partner_id as string | null) ?? null,
    };
  });
}
