import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Small read-only lookups the phone's call and calendar screens add to existing answers (boards C4b,
 * C8b, C13, C13b, 2026-11-26). Always one tenant, always by id lists the route already holds; each is
 * best-effort and answers null when it could not read, so the answer it decorates never fails.
 */
type Rows = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Chain = Rows & { eq(column: string, value: unknown): Chain; in(column: string, values: string[]): Chain; maybeSingle(): Rows };
type Loose = { from(table: string): { select(columns: string): Chain } };
const db = () => getSupabaseServiceClient() as unknown as Loose;

/** Each person's licensed states (Settings › Team, tenant_user_licensed_states), by user id. */
export async function licensedStatesFor(tenantId: string, userIds: string[]): Promise<Record<string, string[]> | null> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await db().from("tenant_user_licensed_states").select("user_id, state").eq("tenant_id", tenantId).in("user_id", ids);
  if (error) return null;
  const out: Record<string, string[]> = {};
  for (const row of (data ?? []) as { user_id: string; state: string }[]) {
    const state = String(row.state ?? "").trim().toUpperCase();
    if (!state) continue;
    (out[row.user_id] ??= []).push(state);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** Each member's role in this tenant (tenant_users.role), by user id. */
export async function memberRolesFor(tenantId: string, userIds: string[]): Promise<Record<string, string> | null> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await db().from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).in("user_id", ids);
  if (error) return null;
  return Object.fromEntries(((data ?? []) as { user_id: string; role: string | null }[]).filter((r) => r.role).map((r) => [r.user_id, String(r.role)]));
}

/** The two-letter state on a lead's values (the same key the dialer's calling window reads), or null. */
export async function leadStateOf(tenantId: string, leadId: string): Promise<string | null> {
  const { data, error } = await db().from("agent_leads").select("values").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle();
  if (error || !data) return null;
  const values = ((data as { values?: Record<string, unknown> | null }).values ?? {}) as Record<string, unknown>;
  const raw = typeof values.state === "string" ? values.state.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}
