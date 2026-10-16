import { NextResponse } from "next/server";

import { eoGraceDays, getAppointmentVault } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET() {
  const auth = await requireFeatureRole("appointment_vault", [
    "owner",
    "producer",
  ]);
  if (auth instanceof NextResponse) return auth;
  try {
    // eoGraceDays: Sixteen #4 — the page shows the E&O grace banner from the same number canWrite uses.
    const [vault, graceDays] = await Promise.all([getAppointmentVault(auth.context.tenantId), eoGraceDays()]);
    return NextResponse.json({ ...vault, eoGraceDays: graceDays }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load the appointment vault" },
      { status: 500 },
    );
  }
}
