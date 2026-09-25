import { NextResponse } from "next/server";
import { z } from "zod";

import { assertApplicationOutcomeVerified, verificationStatus } from "@/lib/dispositions/applicationGate";
import { isApplicationOutcome, outcomeDescription } from "@/lib/dispositions/applicationOutcome";
import { answerDisposition, completeDisposition, DispositionError, getDispositionWizard, listMappedOutcomes } from "@/lib/dispositions/service";
import { DO_NOT_CALL_DISPOSITION_KEY, type DispositionWizard } from "@/lib/dispositions/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const uuid = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("answer"), work_item_id: uuid, walk_id: uuid, node_id: uuid, sequence: z.number().int().min(0).max(100), answer: z.unknown().optional(), option_key: z.string().optional() }).strict(),
  z.object({ action: z.literal("complete"), work_item_id: uuid, walk_id: uuid, disposition_key: z.string().regex(/^[a-z][a-z0-9_]*$/), callback_subtype: z.string().max(120).optional(), callback_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(), callback_assigned_to: uuid.nullable().optional(), callback_idempotency_key: z.string().max(120).optional() }).strict(),
]);

function errorResponse(error: unknown) {
  if (!(error instanceof DispositionError)) return NextResponse.json({ error: "The disposition service is unavailable." }, { status: 500 });
  const status = ["owner_required"].includes(error.code) ? 403 : ["work_item_not_found", "walk_not_found", "flow_not_found", "node_not_found", "option_not_found"].includes(error.code) ? 404 : ["walk_incomplete", "flow_changed", "verification_incomplete"].includes(error.code) ? 409 : ["invalid_input", "callback_date_required", "callback_outside_window", "option_required", "disposition_not_found", "phone_required"].includes(error.code) ? 400 : 500;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

/**
 * What the inbound wizard needs beside the walk: the outcomes it may offer (active AND mapped to a
 * live stage, each described from that stage and how it closes), whether verification is complete
 * (so an application outcome can say it will be refused), and who is asking. Best-effort: if the
 * outcome list cannot be read, `outcomeOptions` is null and the wizard says so rather than offering
 * outcomes that might move nothing.
 */
async function withOutcomeContext(tenantId: string, userId: string, wizard: DispositionWizard) {
  const supabase = getSupabaseServiceClient();
  const [outcomes, verification, flowStage] = await Promise.all([
    listMappedOutcomes(tenantId).catch(() => null),
    verificationStatus(tenantId, wizard.workItem.id).catch(() => null),
    supabase.from("tenant_pipeline_stages").select("id, pipeline_id").eq("id", wizard.flow.stage_id).maybeSingle(),
  ]);
  const current = { stageId: wizard.flow.stage_id ?? null, pipelineId: flowStage.data?.pipeline_id ?? null };
  return {
    ...wizard,
    currentUserId: userId,
    verification,
    outcomeOptions: outcomes?.map((outcome) => {
      const application = isApplicationOutcome(outcome, outcome.mapped_stage);
      return {
        disposition_key: outcome.disposition_key,
        label: outcome.label,
        closes_as: outcome.closes_as,
        description: outcomeDescription(outcome, outcome.mapped_stage, current),
        stage: { id: outcome.mapped_stage.id, name: outcome.mapped_stage.name, pipeline_name: outcome.mapped_stage.pipeline_name, is_current: outcome.mapped_stage.id === current.stageId },
        application,
        needs_verification: application && verification?.complete !== true,
        adds_to_do_not_call: outcome.disposition_key === DO_NOT_CALL_DISPOSITION_KEY,
      };
    }) ?? null,
  };
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = uuid.safeParse(new URL(request.url).searchParams.get("work_item_id"));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid transfer." }, { status: 400 });
  try { return NextResponse.json(await withOutcomeContext(auth.context.tenantId, auth.context.userId, await getDispositionWizard(auth.context.tenantId, auth.context.userId, parsed.data))); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid disposition action." }, { status: 400 });
  try {
    if (parsed.data.action === "answer") {
      const result = await answerDisposition(auth.context.tenantId, auth.context.userId, parsed.data);
      return NextResponse.json({ result, wizard: await withOutcomeContext(auth.context.tenantId, auth.context.userId, await getDispositionWizard(auth.context.tenantId, auth.context.userId, parsed.data.work_item_id)) });
    }
    // An application outcome is refused until verification is complete (user decision,
    // 2026-09-24). Checked before anything is written; every other outcome passes through.
    await assertApplicationOutcomeVerified(auth.context.tenantId, parsed.data.work_item_id, parsed.data.disposition_key);
    // The disposition transition can change the lead's pipeline stage. Reloading a stage-scoped
    // wizard after that atomic transition asks the old walk to resolve against a new flow and
    // returns DISPOSITION_FLOW_CHANGED even though the outcome succeeded. The caller leaves this
    // page for Deal flow, so return the committed result directly.
    const result = await completeDisposition(auth.context.tenantId, auth.context.userId, parsed.data);
    return NextResponse.json({ result });
  } catch (error) { return errorResponse(error); }
}
