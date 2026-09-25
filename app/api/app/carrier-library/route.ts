import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getCarrierLibrary } from "@/lib/carriers/service";

export async function GET() {
  const auth = await requireFeatureRole("appointment_vault", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getCarrierLibrary(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the carrier library" }, { status: 500 });
  }
}
