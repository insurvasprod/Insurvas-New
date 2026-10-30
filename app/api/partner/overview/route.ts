import { NextResponse } from "next/server";

import { countPartnerRejectedSubmissions } from "@/lib/compliance/rejectedSubmissions";
import { listPartnerWorkspaceAlerts } from "@/lib/partnerAlerts/service";
import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { partnerTeamPulse } from "@/lib/partnerTeamReview/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The partner home's figures that are not in the pipeline read model (LA-1.17, LA-1.2, OQ #9),
 * in one round trip beside /api/partner/leads/pipeline. Read-only, and every read is scoped to the
 * session's tenant and partner on the server:
 *
 *   rejectedCompliance  a count of compliance-screening rejections (never which numbers); a
 *                       partner_user's is their own submissions only
 *   alerts              the organisation's workspace alerts, minus the status one (the portal
 *                       layout's banner already says that once)
 *   team, pulse         partner_admin only: seats in use / invitations pending, and Team review's
 *                       reply time and waiting conversations over the last 30 days
 *
 * A failed part comes back null rather than failing the page.
 */

const PULSE_WINDOW_MS = 30 * 86_400_000;
// The pulse reads up to 10,000 chat rows; the home polls every 15 s per open tab. A minute is fresh
// enough for "average reply time", and keeps the poll from re-reading the chat each tick.
const PULSE_CACHE_MS = 60_000;
type Pulse = { averageResponseMinutes: number | null; responses: number; pendingFollowUps: number };
const pulseCache = new Map<string, { at: number; value: Pulse }>();

async function cachedPulse(tenantId: string, partnerId: string): Promise<Pulse> {
  const key = `${tenantId}:${partnerId}`;
  const hit = pulseCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < PULSE_CACHE_MS) return hit.value;
  const { averageResponseMinutes, responses, pendingFollowUps } = await partnerTeamPulse(tenantId, partnerId, { from: now - PULSE_WINDOW_MS, to: now }, now);
  const value = { averageResponseMinutes, responses, pendingFollowUps };
  pulseCache.set(key, { at: now, value });
  return value;
}

async function teamSeats(tenantId: string, partnerId: string) {
  const { data, error } = await getSupabaseServiceClient()
    .from("partner_users")
    .select("status, accepted_at")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId);
  if (error) throw new Error(error.message);
  const active = (data ?? []).filter((row) => row.status === "active");
  return { active: active.length, pending: active.filter((row) => !row.accepted_at).length };
}

export async function GET() {
  const auth = await requirePartner();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;
  const isAdmin = context.role === "partner_admin";
  const [rejectedCompliance, alerts, team, pulse] = await Promise.all([
    countPartnerRejectedSubmissions(context.tenantId, context.partnerId, isAdmin ? null : context.userId).catch(() => null),
    listPartnerWorkspaceAlerts(context).catch(() => []),
    isAdmin ? teamSeats(context.tenantId, context.partnerId).catch(() => null) : Promise.resolve(undefined),
    isAdmin ? cachedPulse(context.tenantId, context.partnerId).catch(() => null) : Promise.resolve(undefined),
  ]);
  return NextResponse.json({
    rejectedCompliance,
    alerts: alerts.filter((alert) => !alert.id.startsWith("partner-status-")),
    ...(isAdmin ? { team, pulse } : {}),
    generatedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
