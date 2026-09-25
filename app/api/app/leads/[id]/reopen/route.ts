import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { reopenExpiredLeadByLeadId } from "@/lib/queueSla/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Choose a valid lead." }, { status: 400 });
  try { return NextResponse.json({ result: await reopenExpiredLeadByLeadId({ tenantId: auth.context.tenantId, leadId: id.data, actorId: auth.context.userId }) }); }
  catch (error) {
    const raw = error instanceof Error ? error.message : "Could not reopen lead.";
    // 20260924230400: expiry made the lead a nurture lead, and a nurture call is in progress.
    if (raw.includes("LEAD_BEING_DIALLED")) return NextResponse.json({ error: "This lead is on a nurture call right now. Reopen it once that call is dispositioned.", code: "lead_being_dialled" }, { status: 409 });
    const message = raw; const status = message.includes("WORK_ITEM_NOT_FOUND") ? 404 : message.includes("ROLE_NOT_ALLOWED") ? 403 : message.includes("LEAD_NOT_EXPIRED") ? 409 : 500; return NextResponse.json({ error: status === 500 ? "Could not reopen lead." : message }, { status }); }
}
