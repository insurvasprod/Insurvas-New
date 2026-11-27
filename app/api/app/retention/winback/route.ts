import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { isRecordUuid } from "@/lib/ingestion/path";
import { scopeFor } from "@/lib/agency/visibility";
import { loadWinback, resolveClaim, WINBACK_PENDING_MESSAGE, WinbackError } from "@/lib/retention/winbackStore";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.7 (Notion sprint) · win-back. Mark a possible claim handled (a lapse after a death: the family
 * was helped, or it was not a death). Releases are not requested here: a candidate goes to the
 * Win-back list when its cooling-off ends, and the database refuses a never-call one.
 *
 * Gated on `winback`; owner and producer (a producer reaches the policies credited to them).
 */
const body = z.object({
  action: z.literal("resolve_claim"),
  id: z.string().refine(isRecordUuid, "Choose the follow-up."),
  note: z.string().trim().max(2000).nullable(),
}).strict();

/**
 * The phone's Win-back list (mobile release 2, board F3c): the former clients who are not "never call", with where
 * each stands (on the Win-back lead list, stuck, cooling off until a date) and the lead a released one became, so
 * the call goes through that lead's dialer checks. Read through loadWinback, as the page reads it, but never
 * releasing: creating leads stays with the page and the files. Gated as the page's writes are (owner, producer; a
 * retention rep has no win-back calls, LA-5.8). No premium or face amount.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

/**
 * Dialer attempts per lead (tenant_call_attempts): how many, and the newest one's disposition. Empty on failure.
 * AG-0.4: a narrowed session inside an agency counts only the attempts its own producer scope made
 * (lib/agency/visibility `scopeFor`); an all-seeing role (null scope) counts every attempt.
 */
async function callsOn(context: { tenantId: string; userId: string }, leadIds: string[]): Promise<Map<string, { count: number; lastDisposition: string | null }>> {
  const out = new Map<string, { count: number; lastDisposition: string | null }>();
  const { tenantId } = context;
  try {
    const scope = await scopeFor(context);
    if (scope !== null && !scope.length) return out;
    for (let i = 0; i < leadIds.length; i += 200) {
      let query = (getSupabaseServiceClient() as Loose).from("tenant_call_attempts").select("lead_id, disposition, attempted_at")
        .eq("tenant_id", tenantId).in("lead_id", leadIds.slice(i, i + 200));
      if (scope !== null) query = query.in("agent_id", scope);
      const { data, error } = await query.order("attempted_at", { ascending: false });
      if (error) return out;
      for (const a of (data ?? []) as Loose[]) {
        const seen = out.get(a.lead_id);
        out.set(a.lead_id, seen ? { ...seen, count: seen.count + 1 } : { count: 1, lastDisposition: a.disposition ?? null });
      }
    }
  } catch {
    return out;
  }
  return out;
}

export async function GET() {
  const auth = await requireFeatureRole("winback", ["owner", "producer"] as const, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const headers = { "Cache-Control": "no-store" };
  const { tenantId, userId, role } = auth.context;
  try {
    const winback = await loadWinback({ tenantId, userId, role }, { release: false });
    if (!winback.available) return NextResponse.json({ available: false, message: WINBACK_PENDING_MESSAGE }, { headers });
    const people = winback.rows.filter((r) => r.band !== "never");
    // Board F3c (2026-11-27, additive): "called 2× · no answer" — the dialer attempts on each released lead, counted.
    const calls = await callsOn({ tenantId, userId }, people.map((r) => r.leadId).filter((id): id is string => Boolean(id)));
    return NextResponse.json({
      available: true,
      today: winback.today,
      people: people.map((r) => ({
        id: r.id, clientName: r.clientName, carrierName: r.carrierName, policyNumber: r.policyNumber, lapsedOn: r.lapsedOn,
        category: r.category, band: r.band, eligibleFrom: r.eligibleFrom, releasedAt: r.releasedAt, leadId: r.leadId, blockedReason: r.blockedReason,
        calls: r.leadId ? calls.get(r.leadId) ?? { count: 0, lastDisposition: null } : null,
      })),
    }, { headers });
  } catch (error) {
    console.error("[winback] read:", error);
    return NextResponse.json({ error: "Win-back could not be read" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("winback", ["owner", "producer"] as const, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  try {
    await resolveClaim({ tenantId, userId, role }, parsed.data.id, parsed.data.note);
    await audit({ actorType: "tenant", actorId: userId, action: "retention.claim_followup_resolved", targetType: "household_claim_followup", targetId: parsed.data.id, metadata: { tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WinbackError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[winback]", error);
    return NextResponse.json({ error: "That could not be saved" }, { status: 500 });
  }
}
