import { NextResponse } from "next/server";

import { contextRoles } from "@/lib/tenantAuth/requireTenant";
import { requireTenantAhead } from "@/lib/tenantAuth/requireTenantAhead";
import { scopeFor } from "@/lib/agency/visibility";
import { readNavCounts, readOwnPresence } from "@/lib/menu/navCounts";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * `retention.save-queue` (the Cases page's key; the phone's Cases tab badge, mobile boards B7/F3): a retention rep's
 * own cases that need work, the ladder's open and working cases they own (a case waiting on the carrier waits on the
 * carrier, not on them). Only for the retention role with the Retention module, and dropped like every count when the
 * owner hid the page; a head count, no rows. Null on failure: no number shown.
 */
async function retentionCasesNeedingWork(tenantId: string, userId: string): Promise<number | null> {
  type Head = PromiseLike<{ error: unknown; count?: number | null }> & { eq(c: string, v: unknown): Head; in(c: string, v: readonly string[]): Head };
  const db = getSupabaseServiceClient() as unknown as { from(t: string): { select(c: string, o: { count: "exact"; head: true }): Head } };
  try {
    const result = await db.from("retention_case").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("owner_user_id", userId).in("status", ["open", "working"]);
    return result.error ? null : result.count ?? 0;
  } catch {
    return null;
  }
}

/**
 * The sidebar's live counts (Navigation A, 2026-10-28). Read-only head counts, gated per page in
 * `readNavCounts` by the same feature, roles and producer scope as the page itself; a page the owner
 * hid for this member is dropped too. Any failure answers an empty map: the menu simply shows no number.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  // The plan, kill switches and scope ride with the membership read: one trip before the counts (was three).
  let auth: Awaited<ReturnType<typeof requireTenantAhead>>;
  try {
    auth = await requireTenantAhead({ scope: true });
  } catch {
    return NextResponse.json({ counts: {}, presence: null }, { headers });
  }
  if (auth instanceof NextResponse) return auth;
  try {
    const available = auth.available;
    const scope = await scopeFor(auth.context);
    const who = { tenantId: auth.context.tenantId, userId: auth.context.userId, roles: contextRoles(auth.context), available };
    const retentionRep = who.roles.includes("retention") && available.includes("chargeback_radar");
    const [navCounts, presence, cases] = await Promise.all([
      readNavCounts({ ...who, scope }),
      readOwnPresence(who).catch(() => null),
      retentionRep ? retentionCasesNeedingWork(who.tenantId, who.userId) : null,
    ]);
    const counts: Record<string, number> = { ...navCounts } as Record<string, number>;
    if (cases !== null) counts["retention.save-queue"] = cases;
    for (const key of auth.context.hiddenPages ?? []) delete counts[key];
    return NextResponse.json({ counts, presence: auth.context.hiddenPages?.includes("leads.inbound") ? null : presence }, { headers });
  } catch {
    return NextResponse.json({ counts: {}, presence: null }, { headers });
  }
}
