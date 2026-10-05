import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { holdsAgencyMembership } from "@/lib/auth/planeSeparation";
import { PARTNER_SESSION_COOKIE, verifyPartnerSessionToken, type PartnerSessionPayload } from "./session";
import { isPartnerRole, type PartnerRole } from "./roles";
import { isTenantSuspended } from "@/lib/tenants/suspension";

export type PartnerContext = {
  userId: string;
  tenantId: string;
  partnerId: string;
  role: PartnerRole;
  partnerName: string;
  partnerTimezone: string;
  partnerStatus: "draft" | "active" | "paused" | "offboarded";
};

export async function getPartnerSession(): Promise<PartnerSessionPayload | null> {
  const store = await cookies();
  const token = store.get(PARTNER_SESSION_COOKIE)?.value;
  return token ? verifyPartnerSessionToken(token) : null;
}

/** Resolve partner membership and account status from the database on every request. */
export async function resolvePartnerContext(): Promise<PartnerContext | null> {
  return readPartnerContext();
}

// Memoised for one request: the portal layout and the page beneath it both resolve the partner.
// Still read from the database on every request, as above.
const readPartnerContext = cache(async (): Promise<PartnerContext | null> => {
  const session = await getPartnerSession();
  if (!session) return null;

  const supabase = getSupabaseServiceClient();
  // The agency's state rides along in the same round trip: a partner works inside one agency's
  // workspace, so a suspended agency closes the partner portal too (decision 4).
  // An agency account never opens the partner portal, whatever partner_users says
  // (lib/auth/planeSeparation.ts) — read in the same round trip.
  const [{ data: membership }, { data: tenant }, isAgencyAccount] = await Promise.all([
    supabase
      .from("partner_users")
      .select("tenant_id, partner_id, role, status, accepted_at, users!partner_users_user_id_fkey!inner(status, session_version), partners!inner(name, status, timezone)")
      .eq("tenant_id", session.tenantId)
      .eq("partner_id", session.partnerId)
      .eq("user_id", session.sub)
      .maybeSingle(),
    supabase.from("tenants").select("status").eq("id", session.tenantId).maybeSingle<{ status: string }>(),
    holdsAgencyMembership(session.sub),
  ]);
  if (isAgencyAccount) return null;
  if (!tenant || isTenantSuspended(tenant.status)) return null;

  type PartnerMembershipRow = {
    tenant_id: string;
    partner_id: string;
    role: string;
    status: string;
    accepted_at: string | null;
    users: { status: string; session_version: number };
    partners: { name: string; status: PartnerContext["partnerStatus"]; timezone: string };
  };
  const row = membership as unknown as PartnerMembershipRow | null;

  if (!row || row.status !== "active" || !row.accepted_at || !isPartnerRole(row.role)) return null;
  if (row.users.status !== "active") return null;
  if (session.sessionVersion !== undefined && session.sessionVersion !== row.users.session_version) return null;
  if (row.partners.status === "offboarded") return null;

  return { userId: session.sub, tenantId: session.tenantId, partnerId: session.partnerId, role: row.role, partnerName: row.partners.name, partnerTimezone: row.partners.timezone, partnerStatus: row.partners.status };
});

export async function requirePartner(allowedRoles?: readonly PartnerRole[]): Promise<{ context: PartnerContext } | NextResponse> {
  const context = await resolvePartnerContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (allowedRoles && !allowedRoles.includes(context.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { context };
}
