import { NextResponse } from "next/server";

import { getAppointmentVault } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET() {
  const auth = await requireFeatureRole("appointment_vault", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getAppointmentVault(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the appointment vault" }, { status: 500 });
  }
}
