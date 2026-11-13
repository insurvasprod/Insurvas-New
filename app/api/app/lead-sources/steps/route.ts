import { NextResponse } from "next/server";

import { requireTenant, contextRoles } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { scopeFor } from "@/lib/agency/visibility";
import { readLatestReviewBatch, readStepCounts } from "@/lib/leadSources/stepCounts";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

/**
 * The live counts on the one Leads page's rail (2026-10-28). Read-only head counts, each gated in
 * `readStepCounts` by its step's own feature, roles and agency scope; a page the owner hid for this
 * member is left out. Any failure answers an empty map: the rail keeps its plain lines.
 */
export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const headers = { "Cache-Control": "no-store" };
  try {
    // The scope and solo reads need no entitlement, so the three go out together; only the kill
    // switches wait for the entitlement's features.
    const [available, scope, solo] = await Promise.all([
      getEntitlement(auth.context.tenantId).then((entitlement) => effectiveFeatures(entitlement.features, auth.context.tenantId)),
      scopeFor(auth.context),
      isSoloWorkspace(auth.context.tenantId),
    ]);
    // Where Review opens: the newest staged file, read beside the counts (a narrow session never gets a
    // review count, so it is not read for one) and used only for someone the review count was read for.
    const reviewRead = scope === null ? readLatestReviewBatch(auth.context.tenantId).catch(() => null) : Promise.resolve(null);
    const [counts, latestBatch] = await Promise.all([
      readStepCounts({
        tenantId: auth.context.tenantId,
        roles: contextRoles(auth.context),
        available,
        narrow: scope !== null,
        hidden: auth.context.hiddenPages ?? [],
        solo,
      }),
      reviewRead,
    ]);
    const reviewBatch = counts.review ? latestBatch : null;
    return NextResponse.json({ counts, reviewHref: reviewBatch ? `/app/import/review/${reviewBatch}` : null }, { headers });
  } catch {
    return NextResponse.json({ counts: {} }, { headers });
  }
}
