import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { cancelCallback, completeCallback, listCallbacks, rescheduleCallback } from "@/lib/callbacks/service";

const uuid = z.string().uuid();
const querySchema = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() });
const bodySchema = z.object({ action: z.enum(["reschedule", "cancel", "complete"]), callback_id: uuid, callback_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional() }).strict();

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "The callback service is unavailable.";
  const code = message.split(" ")[0];
  const status = ["CALLBACK_NOT_FOUND"].includes(code) ? 404 : ["CALLBACK_NOT_ACTIVE", "CALLBACK_ALREADY_COMPLETED"].includes(code) ? 409 : ["CALLBACK_DATE_REQUIRED", "CALLBACK_DATE_PAST", "CALLBACK_ACTOR_INVALID"].includes(code) || message.startsWith("Choose a valid callback") ? 400 : 500;
  return NextResponse.json({ error: message.startsWith("CALLBACK_") ? "That callback cannot be changed in its current state." : message, code: message.startsWith("CALLBACK_") ? code.toLowerCase() : "callback_unavailable" }, { status });
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("callback_calendar", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid callback date range." }, { status: 400 });
  try { return NextResponse.json({ callbacks: await listCallbacks(auth.context.tenantId, parsed.data) }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const auth = await requireFeatureRole("callback_calendar", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid callback action." }, { status: 400 });
  try {
    const params = { tenantId: auth.context.tenantId, userId: auth.context.userId, callbackId: parsed.data.callback_id, request };
    const result = parsed.data.action === "reschedule" ? await rescheduleCallback({ ...params, local: parsed.data.callback_local }) : parsed.data.action === "cancel" ? await cancelCallback(params) : await completeCallback(params);
    return NextResponse.json({ result });
  } catch (error) { return errorResponse(error); }
}
