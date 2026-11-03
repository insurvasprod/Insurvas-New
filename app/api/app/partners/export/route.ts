import { NextResponse } from "next/server";

import { csvForPartners } from "@/lib/partners/csv";
import { listPartners } from "@/lib/partners/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// Same feature and roles as the directory it exports. An export that a wider audience can reach
// than the screen is a way around the screen's gate, not a convenience.
const PARTNER_ROLES = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const partners = await listPartners(auth.context.tenantId);
    return new NextResponse(csvForPartners(partners), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=partners.csv",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not export partners" },
      { status: 500 },
    );
  }
}
