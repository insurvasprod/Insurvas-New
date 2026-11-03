import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { StaffReadStateUnavailable, listStaffFeed, markStaffNotificationsRead } from "@/lib/adminAlerts/service";

/**
 * The staff bar's feed: platform alerts (clear when fixed) and billing notifications (clear when
 * read), both filtered to what this admin's role can open. See lib/adminAlerts/presentation.ts.
 */
export async function GET() {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listStaffFeed(auth.session.sub, auth.session.role), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load staff alerts" }, { status: 503 });
  }
}

// Source keys, as the GET returned them: "audit:<id>" or "trial-ending:<subscription>:<ends at>".
const readSchema = z.object({ ids: z.array(z.string().min(1).max(300).regex(/^(audit|trial-ending):[A-Za-z0-9:._+-]+$/)).min(1).max(100) }).strict();

/** Mark this admin's notifications read — their own marks only; the admin id is the session's. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;
  const parsed = readSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send the notification ids to mark read." }, { status: 400 });
  try {
    return NextResponse.json(await markStaffNotificationsRead(auth.session.sub, parsed.data.ids), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StaffReadStateUnavailable) return NextResponse.json({ error: error.message, code: "needs_migration" }, { status: 503 });
    return NextResponse.json({ error: "Could not mark notifications read" }, { status: 503 });
  }
}
