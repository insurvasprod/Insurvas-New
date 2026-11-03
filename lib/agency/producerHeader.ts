import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { guardProducer } from "@/lib/agency/guards";
import type { ProducerStatus } from "@/lib/agency/constants";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type ProducerHeader = {
  id: string; userId: string; displayName: string; status: ProducerStatus; role: string | null; managerName: string; hiredOn: string | null;
  offboardedOn: string | null; reactivatableUntil: string | null; canSubmit: boolean; email: string | null; isSelf: boolean;
};

/**
 * AG-1.1 · what a producer record's header needs (the merged Team page, 2026-11-03): name, status, role, manager and
 * hire date, read on the server so the title, chip and facts line draw with the page. The same visibility as the
 * record's API (/api/app/agency/producers/<id>): guardProducer — himself, a manager's report, or anyone for the
 * all-seeing roles. Null when the record does not exist or is not this person's to see.
 */
export async function readProducerHeader(context: TenantContext, producerId: string): Promise<ProducerHeader | null> {
  if (await guardProducer(context, producerId)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: p }, hierarchy] = await Promise.all([
    db().from("producer").select("id, user_id, display_name, status, hired_on, offboarded_on, reactivatable_until, can_submit, users!producer_user_id_fkey(email)").eq("tenant_id", context.tenantId).eq("id", producerId).maybeSingle(),
    db().from("producer_hierarchy").select("parent_producer_id, effective_from, effective_to").eq("tenant_id", context.tenantId).eq("producer_id", producerId).lte("effective_from", today),
  ]);
  if (!p) return null;
  const current = ((hierarchy.data ?? []) as Array<{ parent_producer_id: string | null; effective_to: string | null }>).find((h) => !h.effective_to || today <= h.effective_to);
  const [membership, manager] = await Promise.all([
    db().from("tenant_users").select("role, agency_role").eq("tenant_id", context.tenantId).eq("user_id", p.user_id).maybeSingle(),
    current?.parent_producer_id ? db().from("producer").select("display_name").eq("tenant_id", context.tenantId).eq("id", current.parent_producer_id).maybeSingle() : null,
  ]);
  return {
    id: p.id,
    userId: p.user_id,
    displayName: p.display_name,
    status: p.status,
    role: membership.data?.agency_role ?? membership.data?.role ?? null,
    managerName: manager ? manager.data?.display_name ?? "Manager" : "Owner",
    hiredOn: p.hired_on,
    offboardedOn: p.offboarded_on,
    reactivatableUntil: p.reactivatable_until,
    canSubmit: Boolean(p.can_submit),
    email: p.users?.email ?? null,
    isSelf: p.user_id === context.userId,
  };
}
