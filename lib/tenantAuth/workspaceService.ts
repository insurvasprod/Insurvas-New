import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { describeWorkspaces, isUsableMembership, type MembershipRow, type Workspace } from "./workspaces";

type Row = { tenant_id: string; role: string; accepted_at: string | null; invited_at: string | null; tenants: { name: string | null } | null };

/**
 * Every membership this account holds, with the workspace name. Read by user id through the
 * service client because it crosses tenants by definition — the caller must pass the user id from
 * a verified session, never from the request body.
 */
export async function readMemberships(userId: string): Promise<MembershipRow[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("tenant_id, role, accepted_at, invited_at, tenants!inner(name)")
    .eq("user_id", userId);
  if (error) throw new Error(`Could not read workspaces: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    tenant_id: row.tenant_id,
    role: row.role,
    accepted_at: row.accepted_at,
    invited_at: row.invited_at,
    tenant_name: row.tenants?.name ?? null,
  }));
}

export async function listUserWorkspaces(userId: string, currentTenantId: string): Promise<Workspace[]> {
  return describeWorkspaces(await readMemberships(userId), currentTenantId);
}

/** The membership to switch into, only if the server can see it is this person's and usable. */
export async function verifiedMembership(userId: string, tenantId: string): Promise<MembershipRow | null> {
  const rows = await readMemberships(userId);
  const row = rows.find((candidate) => candidate.tenant_id === tenantId);
  return row && isUsableMembership(row) ? row : null;
}
