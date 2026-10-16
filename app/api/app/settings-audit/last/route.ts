import { NextResponse, type NextRequest } from "next/server";

import { lastSettingsChange } from "@/lib/settingsAudit/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * LA-8.8 · GET /api/app/settings-audit/last?section=<registry id> — the newest change in a section,
 * for the "last changed by X on Y" line beside it. Owners only, like the log it links into.
 */
export async function GET(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const section = new URL(request.url).searchParams.get("section") ?? "";
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(section)) return NextResponse.json({ error: "Name a section" }, { status: 400 });
  try {
    return NextResponse.json({ last: await lastSettingsChange(auth.context.tenantId, section) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ last: null });
  }
}
