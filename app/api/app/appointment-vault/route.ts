import { NextResponse } from "next/server";

import { getAppointmentVault } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function GET() {
  const auth = await requireFeatureRole("appointment_vault", [
    "owner",
    "producer",
  ]);
  if (auth instanceof NextResponse) return auth;
  try {
    const vault = await getAppointmentVault(auth.context.tenantId);
    return NextResponse.json(vault, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load the appointment vault" },
      { status: 500 },
    );
  }
}
