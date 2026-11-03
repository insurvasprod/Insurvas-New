import { NextResponse } from "next/server";

import { requireTenant, contextRoles } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { scopeFor } from "@/lib/agency/visibility";
import { readNavCounts, readOwnPresence } from "@/lib/menu/navCounts";

/**
 * The sidebar's live counts (Navigation A, 2026-10-28). Read-only head counts, gated per page in
 * `readNavCounts` by the same feature, roles and producer scope as the page itself; a page the owner
 * hid for this member is dropped too. Any failure answers an empty map: the menu simply shows no number.
 */
export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const headers = { "Cache-Control": "no-store" };
  try {
    const entitlement = await getEntitlement(auth.context.tenantId);
    const [available, scope] = await Promise.all([
      effectiveFeatures(entitlement.features, auth.context.tenantId),
      scopeFor(auth.context),
    ]);
    const who = { tenantId: auth.context.tenantId, userId: auth.context.userId, roles: contextRoles(auth.context), available };
    const [counts, presence] = await Promise.all([
      readNavCounts({ ...who, scope }),
      readOwnPresence(who).catch(() => null),
    ]);
    for (const key of auth.context.hiddenPages ?? []) delete counts[key as keyof typeof counts];
    return NextResponse.json({ counts, presence: auth.context.hiddenPages?.includes("leads.inbound") ? null : presence }, { headers });
  } catch {
    return NextResponse.json({ counts: {}, presence: null }, { headers });
  }
}
