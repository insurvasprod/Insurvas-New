import "server-only";
import { cache } from "react";
import { NextResponse } from "next/server";

import { getPlanAudience } from "@/lib/agency/audience";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { soloFrom, type SoloMember } from "./soloRule";

type MemberRow = {
  role: string | null;
  extra_roles?: string[] | null;
  access_blocked_at?: string | null;
  users: { status: string | null } | null;
};

type Read = PromiseLike<{ data: MemberRow[] | null; error: { code?: string; message?: string } | null }>;
type Loose = { from(table: string): { select(columns: string): { eq(column: string, value: string): Read } } };

/**
 * The workspace's members as the rule reads them. Newest schema first: extra_roles (20261020500000) and
 * access_blocked_at (20261018150000) are dropped from the read when a database does not have them yet.
 * Null when the read fails: the caller then treats the workspace as a team, so nothing is hidden.
 */
async function readMembers(tenantId: string): Promise<SoloMember[] | null> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const status = "users!tenant_users_user_id_fkey(status)";
  for (const columns of [`role, extra_roles, access_blocked_at, ${status}`, `role, access_blocked_at, ${status}`, `role, ${status}`]) {
    const read = await db.from("tenant_users").select(columns).eq("tenant_id", tenantId);
    if (read.error) {
      if (read.error.code === "42703" || /extra_roles|access_blocked_at/.test(read.error.message ?? "")) continue;
      return null;
    }
    return (read.data ?? []).map((row) => ({
      role: row.role,
      extraRoles: row.extra_roles ?? [],
      status: row.users?.status ?? null,
      blocked: Boolean(row.access_blocked_at),
    }));
  }
  return null;
}

/**
 * Solo mode (owner 2026-10-29; the rule is lib/tenantTeam/soloRule.ts): an individual plan with no other
 * caller on it. The menu, the pages, the lead-sources rail and the routing writes all ask this one
 * question, so they agree. Request-memoised. An agency, a plan with no audience, or a failed read answer
 * false: the full app.
 */
export const isSoloWorkspace = cache(async (tenantId: string): Promise<boolean> => {
  try {
    const audience = await getPlanAudience(tenantId);
    // An agency is never solo, so its members are not read at all.
    if (audience !== "individual") return false;
    const members = await readMembers(tenantId);
    return members !== null && soloFrom(audience, members);
  } catch {
    return false;
  }
});

/**
 * The routing writes refuse a solo workspace (assign, return to the pool, rules, capacity): there is nobody
 * to route to, and the screens that make them are hidden. Reads are left alone. Null when allowed.
 */
export async function refuseRoutingWhenSolo(context: { tenantId: string }): Promise<NextResponse | null> {
  if (!(await isSoloWorkspace(context.tenantId))) return null;
  return NextResponse.json(
    { error: "You work alone, so new leads go straight to your dialer. Add a setter or an agent to route leads.", code: "solo_no_routing" },
    { status: 403 },
  );
}
