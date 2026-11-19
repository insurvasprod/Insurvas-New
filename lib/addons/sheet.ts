import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { readCatalogAudit, type CatalogAuditItem } from "@/lib/adminCatalog/audit";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Viewer = { id: string; role: AdminRole };

export type AddonHolder = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  plan: string | null;
  status: string;
  attachedAt: string;
  /** Attached off-plan through the audited override. */
  overridden: boolean;
};

export type AddonSheetData = {
  addonId: string;
  /** Null when the attachments could not be read. */
  holders: AddonHolder[] | null;
  /** Null when the audit log could not be read. */
  history: CatalogAuditItem[] | null;
};

/**
 * One add-on's sheet (catalog.html screen 3): who has it — every live attachment on a subscription that is not
 * cancelled, the same rule as the Attached figure — and its audit history. Each part fails on its own.
 */
export async function fetchAddonSheet(addonId: string, viewer: Viewer): Promise<AddonSheetData> {
  const db = getSupabaseServiceClient();
  const [holders, history] = await Promise.all([
    (async (): Promise<AddonHolder[] | null> => {
      const { data, error } = await db
        .from("subscription_addons")
        .select("attached_at, availability_overridden, subscriptions!inner(id, tenant_id, status, plan_id)")
        .eq("addon_id", addonId)
        .is("detached_at", null)
        .neq("subscriptions.status", "cancelled")
        .order("attached_at", { ascending: false })
        .limit(500)
        .returns<{ attached_at: string; availability_overridden: boolean; subscriptions: { id: string; tenant_id: string; status: string; plan_id: string } | null }[]>();
      if (error) {
        console.error("[admin/addons] holders read failed:", error.message);
        return null;
      }
      const rows = (data ?? []).filter((row) => row.subscriptions);
      const tenantIds = [...new Set(rows.map((row) => row.subscriptions!.tenant_id))];
      const planIds = [...new Set(rows.map((row) => row.subscriptions!.plan_id))];
      const [tenants, plans] = await Promise.all([
        tenantIds.length ? db.from("tenants").select("id, name").in("id", tenantIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        planIds.length ? db.from("plans").select("id, name, version").in("id", planIds) : Promise.resolve({ data: [] as { id: string; name: string; version: number }[] }),
      ]);
      const tenantName = new Map((tenants.data ?? []).map((row) => [row.id, row.name]));
      const planName = new Map((plans.data ?? []).map((row) => [row.id, `${row.name} v${row.version}`]));
      return rows.map((row) => ({
        subscriptionId: row.subscriptions!.id,
        tenantId: row.subscriptions!.tenant_id,
        tenantName: tenantName.get(row.subscriptions!.tenant_id) ?? "Unnamed agency",
        plan: planName.get(row.subscriptions!.plan_id) ?? null,
        status: row.subscriptions!.status,
        attachedAt: row.attached_at,
        overridden: row.availability_overridden,
      }));
    })(),
    readCatalogAudit(viewer, { target: { type: "addon", ids: [addonId] } }, 60).catch((error: unknown) => {
      console.error("[admin/addons] history read failed:", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  return { addonId, holders, history };
}
