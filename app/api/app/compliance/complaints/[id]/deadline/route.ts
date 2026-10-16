import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { ComplaintError, setRegulatorDeadline } from "@/lib/compliance/complaintStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-6.4 (Notion sprint) · the answer to "no deadline configured": the regulator's response days,
 * saved for this regulator and applied to this complaint. Never a guessed default. Owner only — it
 * is agency configuration (LA-6.8 lists every regulator's).
 */
const body = z.object({ response_days: z.number().int().min(1).max(180) }).strict();

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("tcpa_checker", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That complaint isn't here." }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Response days must be a whole number from 1 to 180." }, { status: 400 });
  const { tenantId, userId, role } = auth.context;
  try {
    const complaint = await setRegulatorDeadline({ tenantId, userId, role }, id, parsed.data.response_days);
    await audit({ actorType: "tenant", actorId: userId, action: "compliance.complaint_deadline_set", targetType: "complaint", targetId: id, metadata: { tenantId, responseDays: parsed.data.response_days, regulator: complaint.channel === "ftc" ? "FTC" : complaint.regulatorState }, request });
    return NextResponse.json({ complaint });
  } catch (error) {
    if (error instanceof ComplaintError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[complaint-deadline]", error);
    return NextResponse.json({ error: "The deadline could not be saved" }, { status: 500 });
  }
}
