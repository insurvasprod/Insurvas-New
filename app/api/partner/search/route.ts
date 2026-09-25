import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { searchPartner } from "@/lib/search/partnerService";

const querySchema = z.object({
  q: z.string().trim().max(100),
  limit: z.coerce.number().int().min(1).max(20).default(7),
});

export async function GET(request: NextRequest) {
  const auth = await requirePartner();
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
    const result = await searchPartner({
      tenantId: auth.context.tenantId,
      partnerId: auth.context.partnerId,
      query: parsed.data.q,
      limit: parsed.data.limit,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 503 });
  }
}
