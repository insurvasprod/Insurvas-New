import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { agencyRpc, AgencyRefusal } from "./rpc";

/**
 * AG-1.10 · the producer onboarding checklist. The items are DERIVED by the database (producer_checklist) from the
 * records each later module reads; this store only records the two things the owner attests — contracting and
 * the W-9 (owner uploads) — and then asks the database to re-derive can_submit. Nothing here writes can_submit.
 * (E&O was removed from the checklist 2026-10-26; migration 20261026400000.)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type ChecklistItem = { item: string; seq: number; done: boolean; detail: string };

export const CHECKLIST_FEEDS: Record<string, string> = {
  licence: "Feeds the licence gate",
  appointments: "Feeds the licence gate and state routing",
  contracting: "The owner approves",
  numbers: "Feeds statement attribution",
  levels: "Feeds the override",
  w9: "The owner uploads it; stored encrypted, shown masked",
};

export async function readChecklist(tenantId: string, producerId: string) {
  const [items, producer, records] = await Promise.all([
    agencyRpc<Array<{ item: string; seq: number; done: boolean; detail: string }>>("producer_checklist", { p_tenant_id: tenantId, p_producer_id: producerId }),
    db().from("producer").select("can_submit, can_submit_reason, can_submit_checked_at, status").eq("tenant_id", tenantId).eq("id", producerId).maybeSingle(),
    db().from("producer_onboarding_item").select("item, completed_at, expires_on, document_path").eq("tenant_id", tenantId).eq("producer_id", producerId),
  ]);
  const record = new Map(((records.data ?? []) as Array<{ item: string; completed_at: string; expires_on: string | null; document_path: string | null }>).map((r) => [r.item, r]));
  return {
    items: (items ?? []).sort((a, b) => a.seq - b.seq).map((i) => ({
      ...i,
      feeds: CHECKLIST_FEEDS[i.item] ?? null,
      completedAt: record.get(i.item)?.completed_at ?? null,
      expiresOn: record.get(i.item)?.expires_on ?? null,
      hasDocument: Boolean(record.get(i.item)?.document_path),
    })),
    canSubmit: Boolean(producer.data?.can_submit),
    reason: (producer.data?.can_submit_reason as string | null) ?? null,
    checkedAt: (producer.data?.can_submit_checked_at as string | null) ?? null,
    status: (producer.data?.status as string | null) ?? null,
  };
}

export async function refreshCanSubmit(tenantId: string, producerId: string): Promise<boolean> {
  return agencyRpc<boolean>("producer_refresh_can_submit", { p_tenant_id: tenantId, p_producer_id: producerId });
}

/** Records an attested item and re-derives can_submit. documentPath is a storage path, never the document. */
export async function completeItem(input: { tenantId: string; producerId: string; item: "contracting" | "w9"; actorId: string; expiresOn?: string | null; documentPath?: string | null }) {
  if (input.item === "w9" && !input.documentPath) throw new AgencyRefusal("Upload the W-9.", "w9_incomplete", 400);
  const { error } = await db().from("producer_onboarding_item").upsert({
    tenant_id: input.tenantId,
    producer_id: input.producerId,
    item: input.item,
    completed_at: new Date().toISOString(),
    completed_by: input.actorId,
    expires_on: input.expiresOn ?? null,
    document_path: input.documentPath ?? null,
  }, { onConflict: "producer_id,item" });
  if (error) throw new Error(`completeItem: ${error.message}`);
  return refreshCanSubmit(input.tenantId, input.producerId);
}
