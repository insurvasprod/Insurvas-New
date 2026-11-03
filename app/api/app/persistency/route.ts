import { NextResponse } from "next/server";

import { getPersistencyReport } from "@/lib/persistency/service";
import { roleCanViewCommission } from "@/lib/tenantAuth/permissions";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

/**
 * Money boundary (LA-4.8): persistency — the share of policies still alive 3, 6, 9 and 13 months
 * after issue, overall, by carrier and by lead source. Owner, producer (their own book only, as the
 * ledger scopes it) and bookkeeper, as the Persistency menu item.
 */
const roles = ["owner", "producer", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("cohort_persistency", roles, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const report = await getPersistencyReport({
      tenantId: auth.context.tenantId,
      canView: (producerUserId) => roleCanViewCommission(auth.context.role, auth.context.userId, producerUserId),
      // AG-0.5 · and, in an agency, only the visible producers' policies count toward any rate.
      scope: await scopeFor(auth.context),
    });
    return NextResponse.json({ ok: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[persistency]", error);
    return NextResponse.json({ error: "Could not load persistency" }, { status: 500 });
  }
}
