import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { hasFeature, type Entitlement } from "@/lib/entitlements/types";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";
import { CUSTOM_TEAM_ACCESS_FEATURE, isExtraRole, type ExtraRole } from "@/lib/tenantAuth/teamAccess";
import { MEMBER_ROLES, type MemberRole } from "@/lib/tenantAuth/roles";

/**
 * Custom team access (docs/team-access/DESIGN.md) · the Team screen's reads and writes. The two columns are written
 * only by tenant_set_member_access (20261020500000); presets are plain rows of this tenant.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type MemberAccess = { extraRoles: ExtraRole[]; hiddenPages: string[] };
type MemberAccessRow = MemberAccess & { agencyTitle: string | null };
export type AccessPreset = { id: string; name: string; mainRole: MemberRole; extraRoles: ExtraRole[]; hiddenPages: string[] };
export type TeamAccessSnapshot = {
  /** The agency holds the add-on: extra roles and hidden pages can be set and take effect. */
  available: boolean;
  /** False until 20261020500000 is applied. */
  schemaReady: boolean;
  presets: AccessPreset[];
  /** What the plan grants, so the screen lists only pages the agency has. */
  features: string[];
};

export async function readTeamAccess(tenantId: string, entitlement: Entitlement): Promise<{ snapshot: TeamAccessSnapshot; byUser: Map<string, MemberAccessRow> }> {
  const [members, presets] = await Promise.all([
    db().from("tenant_users").select("user_id, agency_role, extra_roles, hidden_pages").eq("tenant_id", tenantId),
    db().from("tenant_access_presets").select("id, name, main_role, extra_roles, hidden_pages").eq("tenant_id", tenantId).order("name"),
  ]);
  const schemaReady = !members.error && !presets.error;
  if (members.error && !isPendingSchema(members.error) && members.error.code !== "42703") console.error(`[team access] ${members.error.message}`);
  const byUser = new Map<string, MemberAccessRow>();
  for (const row of (members.error ? [] : members.data ?? []) as Array<{ user_id: string; agency_role: string | null; extra_roles: string[] | null; hidden_pages: string[] | null }>) {
    byUser.set(row.user_id, { extraRoles: (row.extra_roles ?? []).filter(isExtraRole), hiddenPages: row.hidden_pages ?? [], agencyTitle: row.agency_role ?? null });
  }
  return {
    byUser,
    snapshot: {
      available: schemaReady && hasFeature(entitlement, CUSTOM_TEAM_ACCESS_FEATURE),
      schemaReady,
      presets: ((presets.error ? [] : presets.data ?? []) as Array<{ id: string; name: string; main_role: string; extra_roles: string[] | null; hidden_pages: string[] | null }>).map((row) => ({
        id: row.id,
        name: row.name,
        mainRole: ((MEMBER_ROLES as readonly string[]).includes(row.main_role) ? row.main_role : "producer") as MemberRole,
        extraRoles: (row.extra_roles ?? []).filter(isExtraRole),
        hiddenPages: row.hidden_pages ?? [],
      })),
      features: entitlement.features,
    },
  };
}

const SET_ERRORS: Record<string, { status: number; error: string }> = {
  TEAM_ACCESS_OWNER_ONLY: { status: 403, error: "Only the owner or an admin can change what a teammate can do." },
  TEAM_ACCESS_NOT_SELF: { status: 403, error: "You cannot change your own access. Ask another admin or the owner." },
  TEAM_ACCESS_NOT_A_MEMBER: { status: 404, error: "That person is not on this team." },
  TEAM_ACCESS_BILLING_OWNER: { status: 403, error: "The account owner always has every role and page." },
  TEAM_ACCESS_ADDON_REQUIRED: { status: 403, error: "Extra roles and hidden pages need the Custom team access add-on." },
  TEAM_ACCESS_ROLE_INVALID: { status: 400, error: "Extra roles are producer, assistant, bookkeeper, setter and retention." },
  TEAM_ACCESS_OWNER_HOLDS_EVERY_ROLE: { status: 400, error: "An admin already has every role." },
  TEAM_ACCESS_ROLE_IS_MAIN: { status: 400, error: "An extra role cannot be the person's main role." },
  TEAM_ACCESS_PAGE_INVALID: { status: 400, error: "One of the pages is not a page of this app." },
};

export type SetAccessResult =
  | { ok: true; before: MemberAccess; after: MemberAccess }
  | { ok: false; status: number; error: string; code?: string };

export async function setMemberAccess(params: { tenantId: string; actorId: string; userId: string; access: MemberAccess }): Promise<SetAccessResult> {
  const { data, error } = await db().rpc("tenant_set_member_access", {
    p_tenant_id: params.tenantId,
    p_actor: params.actorId,
    p_user_id: params.userId,
    p_extra_roles: params.access.extraRoles,
    p_hidden_pages: params.access.hiddenPages,
  });
  if (error) {
    const code = Object.keys(SET_ERRORS).find((key) => (error.message ?? "").includes(key));
    if (code) return { ok: false, code, ...SET_ERRORS[code] };
    if (isPendingSchema(error) || error.code === "PGRST202") return { ok: false, status: 503, error: "Custom team access is waiting for a database update.", code: "schema_pending" };
    console.error(`[team access] set: ${error.message}`);
    return { ok: false, status: 500, error: "Could not save this person's access." };
  }
  const read = (side: { extra_roles?: string[]; hidden_pages?: string[] } | undefined): MemberAccess => ({
    extraRoles: (side?.extra_roles ?? []).filter(isExtraRole),
    hiddenPages: side?.hidden_pages ?? [],
  });
  return { ok: true, before: read(data?.before), after: read(data?.after) };
}

export async function savePreset(tenantId: string, actorId: string, preset: Omit<AccessPreset, "id">): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const { data, error } = await db()
    .from("tenant_access_presets")
    // Names are unique per agency ignoring case (tenant_access_presets_name_key); a clash is a 409, never an overwrite.
    .insert({ tenant_id: tenantId, name: preset.name.trim(), main_role: preset.mainRole, extra_roles: preset.extraRoles, hidden_pages: preset.hiddenPages, created_by: actorId })
    .select("id")
    .maybeSingle();
  if (!error) return { ok: true, id: data.id as string };
  if (error.code === "23505") return { ok: false, status: 409, error: "A preset with that name already exists." };
  if (isPendingSchema(error)) return { ok: false, status: 503, error: "Presets are waiting for a database update." };
  console.error(`[team access] preset: ${error.message}`);
  return { ok: false, status: 500, error: "Could not save the preset." };
}

export async function deletePreset(tenantId: string, id: string): Promise<boolean> {
  const { error } = await db().from("tenant_access_presets").delete().eq("tenant_id", tenantId).eq("id", id);
  return !error;
}
