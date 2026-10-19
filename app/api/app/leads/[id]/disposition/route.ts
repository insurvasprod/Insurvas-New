import { NextResponse } from "next/server";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardLead } from "@/lib/agency/guards";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  // AG-0.5 · a producer cannot open another producer's record by id (404, not 403).
  const hidden = await guardLead(auth.context, (await params).id);
  if (hidden) return hidden;
  await params;
  return NextResponse.json({ error: "Record the call outcome from the claimed transfer wizard.", code: "disposition_wizard_required" }, { status: 410 });
}
