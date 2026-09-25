import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { createDisposition, createDispositionNode, createDispositionOption, DispositionError, listDispositionConfig, updateDisposition, updateDispositionNode, updateDispositionOption } from "@/lib/dispositions/service";

const uuid = z.string().uuid();
const dispositionKey = z.string().regex(/^[a-z][a-z0-9_]{1,79}$/);
// The next action (20260924240200) and the stage the outcome moves a lead to (stage_dispositions).
const nextAction = z.enum(["cadence", "retry", "rest", "close", "callback", "suppress"]);
const dispositionPatch = z.object({ kind: z.literal("disposition"), id: uuid, label: z.string(), counts_as_work_completed: z.boolean(), closes_as: z.enum(["completed", "dropped"]), is_active: z.boolean().optional(), ends_call: z.boolean().optional(), next_action: nextAction.optional(), next_action_minutes: z.number().int().nullable().optional(), stage_id: uuid.nullable().optional() }).strict();
const nodePatch = z.object({ kind: z.literal("node"), id: uuid, label: z.string(), prompt: z.string(), node_type: z.enum(["choice", "multi_select", "free_text"]), note_template: z.string().nullable().optional(), next_node_id: uuid.nullable().optional() }).strict();
const optionPatch = z.object({ kind: z.literal("option"), id: uuid, label: z.string(), next_node_id: uuid.nullable().optional(), disposition_key: dispositionKey.nullable().optional(), note_template: z.string().nullable().optional() }).strict();
const dispositionCreate = z.object({ kind: z.literal("disposition"), disposition_key: dispositionKey, label: z.string(), counts_as_work_completed: z.boolean(), closes_as: z.enum(["completed", "dropped"]), ends_call: z.boolean().optional(), next_action: nextAction.optional(), next_action_minutes: z.number().int().nullable().optional(), stage_id: uuid.nullable().optional() }).strict();
const nodeCreate = z.object({ kind: z.literal("node"), flow_id: uuid, node_key: dispositionKey, label: z.string(), prompt: z.string(), node_type: z.enum(["choice", "multi_select", "free_text"]), note_template: z.string().nullable().optional() }).strict();
const optionCreate = z.object({ kind: z.literal("option"), node_id: uuid, option_key: dispositionKey, label: z.string(), next_node_id: uuid.nullable().optional(), disposition_key: dispositionKey.nullable().optional(), note_template: z.string().nullable().optional() }).strict();
const patchSchema = z.discriminatedUnion("kind", [dispositionPatch, nodePatch, optionPatch]);
const createSchema = z.discriminatedUnion("kind", [dispositionCreate, nodeCreate, optionCreate]);

function statusFor(code: string) {
  if (code === "invalid_input") return 400;
  if (code === "duplicate") return 409;
  if (code === "schema_pending") return 503;
  if (code.endsWith("_not_found")) return 404;
  return 500;
}

function errorResponse(error: unknown) {
  if (!(error instanceof DispositionError)) return NextResponse.json({ error: "Could not save disposition settings." }, { status: 500 });
  return NextResponse.json({ error: error.message, code: error.code }, { status: statusFor(error.code) });
}

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json(await listDispositionConfig(auth.context.tenantId)); } catch (error) { return errorResponse(error); }
}

async function save(request: Request, create: boolean) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = (create ? createSchema : patchSchema).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the disposition setting fields and try again." }, { status: 400 });
  try {
    const body = parsed.data;
    let saved: { id: string };
    if (body.kind === "disposition") saved = "id" in body ? await updateDisposition(auth.context.tenantId, body.id, body) : await createDisposition(auth.context.tenantId, body);
    else if (body.kind === "node") saved = "flow_id" in body ? await createDispositionNode(auth.context.tenantId, body) : await updateDispositionNode(auth.context.tenantId, body.id, body);
    else saved = "node_id" in body ? await createDispositionOption(auth.context.tenantId, body) : await updateDispositionOption(auth.context.tenantId, body.id, body);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "setting.updated", targetType: `disposition_${body.kind}`, targetId: saved.id, metadata: { kind: body.kind, created: create }, request });
    return NextResponse.json({ saved }, { status: create ? 201 : 200 });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) { return save(request, true); }
export async function PATCH(request: Request) { return save(request, false); }

/**
 * Deleting is archiving. A past call stores the outcome's key, so removing the row would leave that
 * history reading as a bare key; `PATCH { kind: "disposition", is_active: false }` archives instead.
 */
export async function DELETE() {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ error: "Call outcomes are archived, never deleted. Archive it instead.", code: "archive_instead" }, { status: 405, headers: { Allow: "GET, POST, PATCH" } });
}
