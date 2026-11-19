import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { GOAL_PERIOD, type GoalKind } from "./goalRules";

/**
 * The stored goals (migration 20261118610000, paste supabase/deploy/2026-11-18-dashboard-goals.sql). Every read and
 * write is filtered by the session's tenant. Until the table exists every read answers `missing`, so the Home's rings
 * fall back to last month and the Set goal sheet says the goals need a database update.
 */
export type GoalRead = { state: "set"; target: number; setBy: string | null; updatedAt: string } | { state: "none" } | { state: "missing" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const TABLE = "tenant_dashboard_goal";
const db = (): Loose => getSupabaseServiceClient();

/** The table is not there yet (PostgREST's schema-cache miss, or Postgres's own undefined_table). */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(error.message ?? "");
}

/** One goal: a person's (`userId`) or the agency's (null). */
export async function readGoal(tenantId: string, userId: string | null, kind: GoalKind): Promise<GoalRead> {
  try {
    let query = db().from(TABLE).select("target, set_by, updated_at").eq("tenant_id", tenantId).eq("kind", kind);
    query = userId === null ? query.is("user_id", null) : query.eq("user_id", userId);
    const { data, error } = await query.limit(1);
    if (error) return isMissingTable(error) ? { state: "missing" } : { state: "none" };
    const row = (data ?? [])[0] as { target: number | string; set_by: string | null; updated_at: string } | undefined;
    return row ? { state: "set", target: Number(row.target), setBy: row.set_by, updatedAt: row.updated_at } : { state: "none" };
  } catch {
    return { state: "none" };
  }
}

export type GoalWrite = { ok: true; before: number | null } | { ok: false; reason: "missing" | "failed" };

/** Sets (or replaces) one goal. The caller has already checked who may set it. */
export async function writeGoal(input: { tenantId: string; userId: string | null; kind: GoalKind; target: number; setBy: string }): Promise<GoalWrite> {
  const before = await readGoal(input.tenantId, input.userId, input.kind);
  if (before.state === "missing") return { ok: false, reason: "missing" };
  const values = { target: input.target, set_by: input.setBy, period: GOAL_PERIOD[input.kind] };
  let result: { error: { code?: string; message?: string } | null };
  if (before.state === "set") {
    let query = db().from(TABLE).update(values).eq("tenant_id", input.tenantId).eq("kind", input.kind);
    query = input.userId === null ? query.is("user_id", null) : query.eq("user_id", input.userId);
    result = await query;
  } else {
    result = await db().from(TABLE).insert({ tenant_id: input.tenantId, user_id: input.userId, kind: input.kind, ...values });
  }
  if (result.error) return { ok: false, reason: isMissingTable(result.error) ? "missing" : "failed" };
  return { ok: true, before: before.state === "set" ? before.target : null };
}

/** Clears one goal (the ring falls back to last month). */
export async function clearGoal(input: { tenantId: string; userId: string | null; kind: GoalKind }): Promise<GoalWrite> {
  const before = await readGoal(input.tenantId, input.userId, input.kind);
  if (before.state === "missing") return { ok: false, reason: "missing" };
  if (before.state === "none") return { ok: true, before: null };
  let query = db().from(TABLE).delete().eq("tenant_id", input.tenantId).eq("kind", input.kind);
  query = input.userId === null ? query.is("user_id", null) : query.eq("user_id", input.userId);
  const { error } = await query;
  if (error) return { ok: false, reason: isMissingTable(error) ? "missing" : "failed" };
  return { ok: true, before: before.target };
}
