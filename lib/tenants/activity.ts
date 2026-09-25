import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/** Rows per page on the tenant record's Activity tab. */
export const TENANT_ACTIVITY_PAGE_SIZE = 50;

export type TenantActivityRow = {
  id: string;
  ts: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
};

export type TenantActivityPage = {
  rows: TenantActivityRow[];
  total: number;
  /**
   * True when the database function is not there yet (migration 20260924347000) and the fallback
   * had to cap how many people and invoices it asked about. The tab says so rather than implying
   * the list is complete.
   */
  partial: boolean;
};

type RawRow = {
  id: string;
  ts: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
};

// Error codes that mean "that function is not in the database yet" rather than "the read failed".
const MISSING_FUNCTION = new Set(["42883", "PGRST202"]);

// The fallback sends its target ids in one `in (...)` filter, which travels in the URL. These caps
// keep that request well under proxy URL limits; the newest people and invoices are the ones kept.
const FALLBACK_USER_CAP = 100;
const FALLBACK_INVOICE_CAP = 60;

/**
 * What staff and the platform did to one agency, newest first: rows whose target is the tenant, one
 * of its subscriptions, one of its people, or one of its invoices. The agency's own activity
 * (actor_type 'tenant') is not part of it.
 *
 * Everyone who can open the tenant sees the full history (user decision); /admin/audit-log keeps its
 * stricter per-actor rule. Throws when the log cannot be read — "no recorded actions"
 * and "we could not read the record" must never look the same.
 */
export async function fetchTenantActivity(
  tenantId: string,
  options: { page: number },
): Promise<TenantActivityPage> {
  const supabase = getSupabaseServiceClient();
  const page = Math.max(1, Math.floor(options.page) || 1);
  const offset = (page - 1) * TENANT_ACTIVITY_PAGE_SIZE;

  const rpc = await supabase.rpc("admin_tenant_activity" as never, {
    p_tenant_id: tenantId,
    p_limit: TENANT_ACTIVITY_PAGE_SIZE,
    p_offset: offset,
  } as never);

  let raw: RawRow[];
  let total: number;
  let partial = false;

  if (!rpc.error) {
    const rows = (rpc.data ?? []) as unknown as (RawRow & { total_count: number | string })[];
    raw = rows;
    // The window count rides on every row; past the last page there are no rows to carry it, so
    // the count is unknown there and the pager only needs to know there is nothing further.
    total = rows.length ? Number(rows[0].total_count) : offset;
  } else if (MISSING_FUNCTION.has(rpc.error.code ?? "")) {
    ({ raw, total, partial } = await fallbackActivity(tenantId, offset));
  } else {
    throw new Error(`Could not load this tenant's activity: ${rpc.error.message}`);
  }

  // Actor names: the admins on this page only.
  const actorIds = [...new Set(raw.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data } = await supabase.from("admin_users").select("id, name").in("id", actorIds);
    for (const admin of (data ?? []) as { id: string; name: string }[]) names.set(admin.id, admin.name);
  }

  return {
    rows: raw.map((row) => ({
      id: row.id,
      ts: row.ts,
      actorType: row.actor_type,
      actorId: row.actor_id,
      actorName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason,
    })),
    total,
    partial,
  };
}

/** Before the migration: collect the target ids here and ask audit_log once. */
async function fallbackActivity(
  tenantId: string,
  offset: number,
): Promise<{ raw: RawRow[]; total: number; partial: boolean }> {
  const supabase = getSupabaseServiceClient();
  const [subscriptions, members, invoices] = await Promise.all([
    supabase.from("subscriptions").select("id").eq("tenant_id", tenantId),
    supabase
      .from("tenant_users")
      .select("user_id, invited_at")
      .eq("tenant_id", tenantId)
      .order("invited_at", { ascending: false })
      .limit(FALLBACK_USER_CAP + 1),
    supabase
      .from("platform_invoices")
      .select("id, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(FALLBACK_INVOICE_CAP + 1),
  ]);
  for (const read of [subscriptions, members, invoices]) {
    if (read.error) throw new Error(`Could not load this tenant's activity: ${read.error.message}`);
  }

  const userIds = ((members.data ?? []) as { user_id: string }[]).map((row) => row.user_id);
  const invoiceIds = ((invoices.data ?? []) as { id: string }[]).map((row) => row.id);
  const partial = userIds.length > FALLBACK_USER_CAP || invoiceIds.length > FALLBACK_INVOICE_CAP;
  const targets = [
    tenantId,
    ...((subscriptions.data ?? []) as { id: string }[]).map((row) => row.id),
    ...userIds.slice(0, FALLBACK_USER_CAP),
    ...invoiceIds.slice(0, FALLBACK_INVOICE_CAP),
  ];

  const query = supabase
    .from("audit_log")
    .select("id, ts, actor_type, actor_id, action, target_type, target_id, reason", { count: "exact" })
    .in("target_id", targets)
    .neq("actor_type", "tenant")
    .order("ts", { ascending: false })
    .order("id", { ascending: false });

  const { data, count, error } = await query.range(offset, offset + TENANT_ACTIVITY_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load this tenant's activity: ${error.message}`);
  return { raw: (data ?? []) as RawRow[], total: count ?? 0, partial };
}
