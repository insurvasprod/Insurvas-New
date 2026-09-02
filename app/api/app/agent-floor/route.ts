import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createAgentFloorNudge, getAgentFloor, updateAgentPresence } from "@/lib/agentFloor/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const roles = ["owner", "producer", "assistant"] as const;
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("presence"), status: z.enum(["ready", "on_break", "off"]) }).strict(),
  z.object({
    action: z.literal("nudge"),
    work_item_id: z.string().uuid(),
    target_user_id: z.string().uuid().nullable().optional(),
    idempotency_key: z.string().uuid().default(() => randomUUID()),
    message: z.string().trim().min(1).max(240).default("Please pick up the waiting transfer."),
  }).strict(),
]);

export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getAgentFloor(auth.context.tenantId, auth.context.userId, auth.context.role));
  } catch (error) {
    console.error("Agent Floor load failed", error);
    return NextResponse.json({ error: "The Agent Floor is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid floor action." }, { status: 400 });

  try {
    if (parsed.data.action === "presence") {
      return NextResponse.json({ presence: await updateAgentPresence({ tenantId: auth.context.tenantId, userId: auth.context.userId, status: parsed.data.status, request }) });
    }
    return NextResponse.json({ nudge: await createAgentFloorNudge({ tenantId: auth.context.tenantId, userId: auth.context.userId, workItemId: parsed.data.work_item_id, targetUserId: parsed.data.target_user_id, idempotencyKey: parsed.data.idempotency_key, message: parsed.data.message, request }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The floor action could not be completed.";
    const status = message.includes("no longer") ? 409 : message.includes("Choose an active") ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? "The floor action could not be completed." : message }, { status });
  }
}
