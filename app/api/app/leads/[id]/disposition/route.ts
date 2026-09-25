import { NextResponse } from "next/server";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  await params;
  return NextResponse.json({ error: "Record the call outcome from the claimed transfer wizard.", code: "disposition_wizard_required" }, { status: 410 });
}
