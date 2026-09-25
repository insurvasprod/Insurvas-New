import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { searchWorkspace } from "@/lib/search/service";

const querySchema = z.object({
  q: z.string().trim().max(100),
  limit: z.coerce.number().int().min(1).max(20).default(7),
});

/**
 * Read-only, tenant-scoped, and it never serves or claims anything. Opening a result is a
 * navigation; the destination does its own guarding, as it did before this route existed.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;

  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? "7",
  });
  if (!parsed.success) return NextResponse.json({ error: "Search terms are limited to 100 characters." }, { status: 400 });
  if (parsed.data.q.trim().length < 2) {
    return NextResponse.json({ hits: [], total: 0, truncated: false }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const entitlement = await getEntitlement(auth.context.tenantId);
    const granted = await effectiveFeatures(entitlement.features, auth.context.tenantId);
    const result = await searchWorkspace({
      tenantId: auth.context.tenantId,
      role: auth.context.role,
      grantedFeatures: granted,
      query: parsed.data.q,
      limit: parsed.data.limit,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // A search box that throws is worse than one that finds nothing: the person retypes, it throws
    // again, and they conclude the product is broken rather than that one query failed.
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 503 });
  }
}
