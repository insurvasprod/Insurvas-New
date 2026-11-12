import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refusedPosts } from "@/lib/leadPost/boardStore";
import { REASON_WORDS } from "@/lib/leadPost/board";

/**
 * Round 8 · the Rejections tab: refused posts in a window (today in the viewer's zone, 7 or 30
 * days), each with only "Martha R. · TX" of the person, or the same as a CSV. Owner only.
 */
const ROLES = ["owner"] as const;

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", ROLES);
  if (auth instanceof NextResponse) return auth;
  const params = request.nextUrl.searchParams;
  const daysParam = params.get("days");
  const days = daysParam === "7" ? 7 : daysParam === "30" ? 30 : 1;
  let tz = params.get("tz") ?? "America/Chicago";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "America/Chicago";
  }
  try {
    const result = await refusedPosts(auth.context.tenantId, days, tz);
    if (params.get("format") === "csv") {
      const lines = [
        "Time,Vendor,Lead,Why,Charged",
        ...result.rows.map((row) => [row.receivedAt, row.vendorName, row.lead, REASON_WORDS[row.reasonCode] ?? row.reasonCode, "0.00"].map(csvCell).join(",")),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="refused-posts-${days === 1 ? "today" : `${days}-days`}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Refused posts didn't load" }, { status: 500 });
  }
}
