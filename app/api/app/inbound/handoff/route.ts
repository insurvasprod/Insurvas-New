import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { acceptBufferHandoff, BufferHandoffError, getBufferHandoffContext, listPendingBufferHandoffs, offerBufferHandoff } from "@/lib/bufferHandoff/service";

const uuid = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("offer"), work_item_id: uuid, target_user_id: uuid }).strict(),
  z.object({ action: z.literal("accept"), handoff_id: uuid }).strict(),
]);

function errorResponse(error: unknown) {
  if (!(error instanceof BufferHandoffError)) return NextResponse.json({ error: "The handoff service is unavailable." }, { status: 500 });
  const status = ["licensed_agent_required", "buffer_role_required", "buffer_owner_required"].includes(error.code) ? 403
    : ["handoff_not_found", "work_item_not_found"].includes(error.code) ? 404
      : ["handoff_pending", "handoff_not_available", "handoff_expired"].includes(error.code) ? 409
        : ["invalid_input"].includes(error.code) ? 400 : 500;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  try {
    if (auth.context.role === "assistant") {
      if (!hasTenantPermission(auth.context.role, "inbound.buffer")) return NextResponse.json({ error: "Your role cannot offer handoffs." }, { status: 403 });
      return NextResponse.json(await getBufferHandoffContext(auth.context.tenantId, auth.context.userId));
    }
    const handoffs = await listPendingBufferHandoffs(auth.context.tenantId, auth.context.userId);
    const workItemId = new URL(request.url).searchParams.get("work_item_id");
    return NextResponse.json({ handoffs: workItemId ? handoffs.filter((handoff) => handoff.workItemId === workItemId) : handoffs });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose a valid handoff action." }, { status: 400 });
  if (body.data.action === "offer") {
    const auth = await requireFeatureRole("inbound_transfers", ["assistant"], { write: true });
    if (auth instanceof NextResponse) return auth;
    if (!hasTenantPermission(auth.context.role, "inbound.buffer")) return NextResponse.json({ error: "Your role cannot offer handoffs.", code: "buffer_role_required" }, { status: 403 });
    try {
      return NextResponse.json({ handoff: await offerBufferHandoff({ tenantId: auth.context.tenantId, workItemId: body.data.work_item_id, bufferUserId: auth.context.userId, targetUserId: body.data.target_user_id, request }) });
    } catch (error) { return errorResponse(error); }
  }

  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await acceptBufferHandoff({ tenantId: auth.context.tenantId, handoffId: body.data.handoff_id, licensedAgentId: auth.context.userId, request });
    return NextResponse.json({ handoff: result });
  } catch (error) { return errorResponse(error); }
}
