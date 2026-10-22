import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Doc 2 §5.3: "The comped option needs a mandatory reason field and shows up in a report. Free
 * accounts multiply silently otherwise." This is that report's read: every tenant with an open comp
 * (tenant_comps.ended_at null, 20261015530000), newest first, with who comped it and why.
 */
export type CompedTenantRow = {
  tenantId: string;
  tenantName: string | null;
  tenantStatus: string | null;
  reason: string;
  compedAt: string;
  compedBy: { id: string; name: string | null; email: string | null } | null;
};

type CompRow = { tenant_id: string; reason: string; created_at: string; created_by: string | null };

/** Null when 20261015530000 is not applied yet (no tenant_comps), so callers can say so. */
export async function fetchCompedTenants(): Promise<CompedTenantRow[] | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_comps" as never)
    .select("tenant_id, reason, created_at, created_by")
    .is("ended_at" as never, null)
    .order("created_at" as never, { ascending: false });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /tenant_comps/.test(error.message ?? "")) return null;
    throw new Error(`Could not load comped tenants: ${error.message}`);
  }
  const comps = (data ?? []) as unknown as CompRow[];
  if (comps.length === 0) return [];

  const tenantIds = [...new Set(comps.map((c) => c.tenant_id))];
  const adminIds = [...new Set(comps.map((c) => c.created_by).filter((id): id is string => Boolean(id)))];
  const [tenants, admins] = await Promise.all([
    supabase.from("tenants").select("id, name, status").in("id", tenantIds),
    adminIds.length
      ? supabase.from("admin_users").select("id, name, email").in("id", adminIds)
      : Promise.resolve({ data: [] as { id: string; name: string; email: string }[], error: null }),
  ]);
  if (tenants.error) throw new Error(`Could not load comped tenants: ${tenants.error.message}`);
  if (admins.error) throw new Error(`Could not load comped tenants: ${admins.error.message}`);

  const tenantOf = new Map((tenants.data ?? []).map((t) => [t.id, t]));
  const adminOf = new Map((admins.data ?? []).map((a) => [a.id, a]));
  return comps.map((c) => {
    const tenant = tenantOf.get(c.tenant_id);
    const admin = c.created_by ? adminOf.get(c.created_by) : undefined;
    return {
      tenantId: c.tenant_id,
      tenantName: tenant?.name ?? null,
      tenantStatus: tenant?.status ?? null,
      reason: c.reason,
      compedAt: c.created_at,
      compedBy: c.created_by ? { id: c.created_by, name: admin?.name ?? null, email: admin?.email ?? null } : null,
    };
  });
}
