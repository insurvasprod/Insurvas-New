import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { answerDisposition, completeDisposition, DispositionError, getDispositionWizard } from "@/lib/dispositions/service";

const uuid = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), work_item_id: uuid, walk_id: uuid, node_id: uuid, sequence: z.number().int().min(0).max(100), answer: z.unknown().optional(), option_key: z.string().optional() }).strict(),
  z.object({ action: z.literal("complete"), work_item_id: uuid, walk_id: uuid, disposition_key: z.string().regex(/^[a-z][a-z0-9_]*$/), callback_subtype: z.string().max(120).optional() }).strict(),
]);

function errorResponse(error: unknown) {
  if (!(error instanceof DispositionError)) return NextResponse.json({ error: "The disposition service is unavailable." }, { status: 500 });
  const status = ["owner_required"].includes(error.code) ? 403 : ["work_item_not_found", "walk_not_found", "flow_not_found", "node_not_found", "option_not_found"].includes(error.code) ? 404 : ["walk_incomplete", "flow_changed"].includes(error.code) ? 409 : ["invalid_input", "option_required", "disposition_not_found", "phone_required"].includes(error.code) ? 400 : 500;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = uuid.safeParse(new URL(request.url).searchParams.get("work_item_id"));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid transfer." }, { status: 400 });
  try { return NextResponse.json(await getDispositionWizard(auth.context.tenantId, auth.context.userId, parsed.data)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid disposition action." }, { status: 400 });
  try {
    const result = parsed.data.action === "answer"
      ? await answerDisposition(auth.context.tenantId, auth.context.userId, parsed.data)
      : await completeDisposition(auth.context.tenantId, auth.context.userId, parsed.data);
    return NextResponse.json({ result, wizard: await getDispositionWizard(auth.context.tenantId, auth.context.userId, parsed.data.work_item_id) });
  } catch (error) { return errorResponse(error); }
}
