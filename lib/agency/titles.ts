import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isAgencyTitle, type AgencyTitle } from "@/lib/tenantAuth/roles";

/**
 * AG-0.2 · each member's agency title (admin / manager), as garnish on a team list. Its own read so a
 * database without migration 20261018110000 still lists the team — every title is then simply absent.
 */
export async function memberTitles(tenantId: string): Promise<Map<string, AgencyTitle>> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("user_id, agency_role")
    .eq("tenant_id", tenantId)
    .not("agency_role", "is", null);
  if (error) return new Map();
  return new Map(
    ((data ?? []) as unknown as Array<{ user_id: string; agency_role: string | null }>)
      .filter((row) => isAgencyTitle(row.agency_role))
      .map((row) => [row.user_id, row.agency_role as AgencyTitle]),
  );
}

export class AgencyRoleRefusal extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "AgencyRoleRefusal";
  }
}

/** Grants a member role that may be an agency title, through the one SQL writer of the title. */
export async function setMemberAgencyRole(tenantId: string, userId: string, memberRole: string): Promise<{ role: string; agencyRole: string | null }> {
  const { data, error } = await (getSupabaseServiceClient() as unknown as {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
  }).rpc("tenant_set_member_agency_role", { p_tenant_id: tenantId, p_user_id: userId, p_member_role: memberRole });
  if (error) {
    const message = error.message ?? "";
    if (/agency_role_needs_agency_plan/.test(message)) throw new AgencyRoleRefusal("Admin and manager exist only on an agency plan.", "agency_plan_required", 409);
    if (/last_owner/.test(message)) throw new AgencyRoleRefusal("This is the only owner who holds billing. Make someone else the owner first.", "last_owner", 409);
    if (/member_not_found/.test(message)) throw new AgencyRoleRefusal("That teammate is not in this workspace.", "member_not_found", 404);
    if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(message)) {
      throw new AgencyRoleRefusal("Agency roles need a database update (20261018110000) that has not been applied yet.", "schema_pending", 503);
    }
    throw new Error(`tenant_set_member_agency_role: ${message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { role: string; agency_role: string | null };
  return { role: row.role, agencyRole: row.agency_role };
}
