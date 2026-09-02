import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { reopenExpiredLead } from "@/lib/queueSla/service";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("book_of_business", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Choose a valid lead." }, { status: 400 });
  try { return NextResponse.json({ result: await reopenExpiredLead({ tenantId: auth.context.tenantId, workItemId: id.data, actorId: auth.context.userId }) }); }
  catch (error) { const message = error instanceof Error ? error.message : "Could not reopen lead."; const status = message.includes("WORK_ITEM_NOT_FOUND") ? 404 : message.includes("ROLE_NOT_ALLOWED") ? 403 : message.includes("LEAD_NOT_EXPIRED") ? 409 : 500; return NextResponse.json({ error: status === 500 ? "Could not reopen lead." : message }, { status }); }
}
