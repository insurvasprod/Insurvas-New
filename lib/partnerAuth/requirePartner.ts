import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { PARTNER_SESSION_COOKIE, verifyPartnerSessionToken, type PartnerSessionPayload } from "./session";
import { isPartnerRole, type PartnerRole } from "./roles";

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
  const session = await getPartnerSession();
  if (!session) return null;

  const supabase = getSupabaseServiceClient();
  const { data: membership } = await supabase
    .from("partner_users")
    .select("tenant_id, partner_id, role, status, accepted_at, users!inner(status, session_version), partners!inner(name, status, timezone)")
    .eq("tenant_id", session.tenantId)
    .eq("partner_id", session.partnerId)
    .eq("user_id", session.sub)
    .maybeSingle();

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
}

export async function requirePartner(allowedRoles?: readonly PartnerRole[]): Promise<{ context: PartnerContext } | NextResponse> {
  const context = await resolvePartnerContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (allowedRoles && !allowedRoles.includes(context.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { context };
}
