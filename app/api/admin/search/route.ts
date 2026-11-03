import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { searchAdmin } from "@/lib/search/adminService";

const querySchema = z.object({
  q: z.string().trim().max(100),
  limit: z.coerce.number().int().min(1).max(20).default(7),
});

/** Read-only. Opening a result is a navigation; the destination guards itself, as it always did. */
export async function GET(request: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = querySchema.safeParse({
    q: request.nextUrl.searchParams.get("q") ?? "",
    limit: request.nextUrl.searchParams.get("limit") ?? "7",
  });
  if (!parsed.success) return NextResponse.json({ error: "Search terms are limited to 100 characters." }, { status: 400 });
  if (parsed.data.q.trim().length < 2) {
    return NextResponse.json({ hits: [], total: 0, truncated: false }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const result = await searchAdmin({ role: admin.role, query: parsed.data.q, limit: parsed.data.limit });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 503 });
  }
}
