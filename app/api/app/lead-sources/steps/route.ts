import { NextResponse } from "next/server";

import { contextRoles } from "@/lib/tenantAuth/requireTenant";
import { requireTenantAhead } from "@/lib/tenantAuth/requireTenantAhead";
import { scopeFor } from "@/lib/agency/visibility";
import { readLatestReviewBatch, readStepCounts } from "@/lib/leadSources/stepCounts";

/**
 * The live counts on the one Leads page's rail (2026-10-28). Read-only head counts, each gated in
 * `readStepCounts` by its step's own feature, roles and agency scope; a page the owner hid for this
 * member is left out. Any failure answers an empty map: the rail keeps its plain lines.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  // The plan, kill switches, scope and solo reads ride with the membership read: one trip before the counts.
  let auth: Awaited<ReturnType<typeof requireTenantAhead>>;
  try {
    auth = await requireTenantAhead({ scope: true, solo: true });
  } catch {
    return NextResponse.json({ counts: {} }, { headers });
  }
  if (auth instanceof NextResponse) return auth;
  try {
    const available = auth.available;
    const solo = auth.solo === true;
    const scope = await scopeFor(auth.context);
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
