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
  const [{ data: membership }, { data: user }, { data: partner }] = await Promise.all([
    supabase.from("partner_users").select("tenant_id, partner_id, role, status, accepted_at").eq("tenant_id", session.tenantId).eq("partner_id", session.partnerId).eq("user_id", session.sub).maybeSingle<{ tenant_id: string; partner_id: string; role: string; status: string; accepted_at: string | null }>(),
    supabase.from("users").select("status").eq("id", session.sub).maybeSingle<{ status: string }>(),
    supabase.from("partners").select("name, status, timezone").eq("id", session.partnerId).eq("tenant_id", session.tenantId).maybeSingle<{ name: string; status: PartnerContext["partnerStatus"]; timezone: string }>(),
  ]);

  if (!membership || membership.status !== "active" || !membership.accepted_at || !isPartnerRole(membership.role)) return null;
  if (!user || user.status !== "active") return null;
  if (!partner || partner.status === "offboarded") return null;

  return { userId: session.sub, tenantId: session.tenantId, partnerId: session.partnerId, role: membership.role, partnerName: partner.name, partnerTimezone: partner.timezone, partnerStatus: partner.status };
}

export async function requirePartner(allowedRoles?: readonly PartnerRole[]): Promise<{ context: PartnerContext } | NextResponse> {
  const context = await resolvePartnerContext();
  if (!context) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (allowedRoles && !allowedRoles.includes(context.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { context };
}
