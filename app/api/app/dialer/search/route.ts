import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAgentTemplate, searchAgentLeads } from "@/lib/agentTemplates/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(40),
});

/** LA-2.8: opening a search result is read-only and never serves or claims a lead. */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", ["owner", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = querySchema.safeParse({ q: request.nextUrl.searchParams.get("q") ?? "", limit: request.nextUrl.searchParams.get("limit") ?? "40" });
  if (!parsed.success) return NextResponse.json({ error: "Enter at least two characters to search leads" }, { status: 400 });
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    // AG-0.5: a narrowed agency session finds its producers' leads only (scope from the session).
    const leads = await searchAgentLeads(auth.context.tenantId, template, parsed.data.q, parsed.data.limit, await scopeFor(auth.context));
    return NextResponse.json({ leads, mode: "non_serving_search" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not search leads" }, { status: 500 });
  }
}
