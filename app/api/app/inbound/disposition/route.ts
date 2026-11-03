import { NextResponse } from "next/server";
import { z } from "zod";

import { assertApplicationOutcomeVerified, verificationStatus } from "@/lib/dispositions/applicationGate";
import { isApplicationOutcome, outcomeDescription } from "@/lib/dispositions/applicationOutcome";
import { answerDisposition, completeDisposition, DispositionError, getDispositionWizard, listMappedOutcomes } from "@/lib/dispositions/service";
import { DO_NOT_CALL_DISPOSITION_KEY, type DispositionWizard } from "@/lib/dispositions/types";
import { ensureDefaultPublisherDispositionMappings } from "@/lib/pipelines/service";
import { leadPipelineId } from "@/lib/pipelines/outcomeStages";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { rowVisible, scopeFor, type ProducerScope } from "@/lib/agency/visibility";
import { guardWorkItem } from "@/lib/transferInbox/scope";

const uuid = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  // Opening the wizard starts (or resumes) the walk, a write — so it is a POST, never a GET.
  z.object({ action: z.literal("start"), work_item_id: uuid }).strict(),
  z.object({ action: z.literal("answer"), work_item_id: uuid, walk_id: uuid, node_id: uuid, sequence: z.number().int().min(0).max(100), answer: z.unknown().optional(), option_key: z.string().optional() }).strict(),
  z.object({ action: z.literal("complete"), work_item_id: uuid, walk_id: uuid, disposition_key: z.string().regex(/^[a-z][a-z0-9_]*$/), callback_subtype: z.string().max(120).optional(), callback_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(), callback_assigned_to: uuid.nullable().optional(), callback_idempotency_key: z.string().max(120).optional(), callback_timezone: z.string().max(64).optional() }).strict(),
]);

function errorResponse(error: unknown) {
  if (!(error instanceof DispositionError)) return NextResponse.json({ error: "The disposition service is unavailable." }, { status: 500 });
  const status = ["owner_required"].includes(error.code) ? 403 : ["work_item_not_found", "walk_not_found", "flow_not_found", "node_not_found", "option_not_found"].includes(error.code) ? 404 : ["walk_incomplete", "flow_changed", "verification_incomplete"].includes(error.code) ? 409 : ["invalid_input", "callback_date_required", "callback_outside_window", "option_required", "disposition_not_found", "phone_required", "customer_timezone_unknown", "customer_timezone_ambiguous"].includes(error.code) ? 400 : 500;
  return NextResponse.json({ error: error.message, code: error.code }, { status });
}

/**
 * What the inbound wizard needs beside the walk: the outcomes it may offer (active AND mapped to a
 * live stage, each described from that stage and how it closes), whether verification is complete
 * (so an application outcome can say it will be refused), and who is asking. Best-effort: if the
 * outcome list cannot be read, `outcomeOptions` is null and the wizard says so rather than offering
 * outcomes that might move nothing.
 */
async function withOutcomeContext(tenantId: string, userId: string, wizard: DispositionWizard, scope: ProducerScope = null) {
  const supabase = getSupabaseServiceClient();
  // The default outcome mappings are seeded here too, not only when an outcome is completed:
  // otherwise an agency's very first call offers no outcome, so none can ever be completed. An
  // outcome maps to one stage per agency (stage_dispositions is unique per tenant and key), and the
  // defaults live on the agency's publisher pipeline — so that pipeline is seeded whichever pipeline
  // this lead is in (a marketing or affiliate lead's first call used to offer nothing).
  const publisher = await supabase.from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").order("is_default", { ascending: false }).limit(1).maybeSingle();
  if (publisher.data?.id) await ensureDefaultPublisherDispositionMappings(tenantId, publisher.data.id).catch((error) => console.error("[disposition] default outcomes could not be seeded", error));
  // Each outcome is described by where it takes THIS lead: its pipeline's own stage first (20261022200000).
  const pipelineId = await leadPipelineId(tenantId, wizard.lead.id).catch(() => null);
  const [outcomes, verification, flowStage] = await Promise.all([
    listMappedOutcomes(tenantId, pipelineId).catch(() => null),
    verificationStatus(tenantId, wizard.workItem.id).catch(() => null),
    supabase.from("tenant_pipeline_stages").select("id, pipeline_id").eq("id", wizard.flow.stage_id).maybeSingle(),
  ]);
  const current = { stageId: wizard.flow.stage_id ?? null, pipelineId: flowStage.data?.pipeline_id ?? null };
  return {
    ...wizard,
    // AG-0.5: a callback can be handed only to the session itself or someone in its scope.
    assignees: scope === null ? wizard.assignees : wizard.assignees.filter((assignee) => assignee.id === userId || rowVisible(scope, assignee.id)),
    currentUserId: userId,
    verification,
    outcomeOptions: outcomes?.map((outcome) => {
      const application = isApplicationOutcome(outcome, outcome.mapped_stage);
      return {
        disposition_key: outcome.disposition_key,
        label: outcome.label,
        closes_as: outcome.closes_as,
        description: outcomeDescription(outcome, outcome.mapped_stage, current),
        stage: { id: outcome.mapped_stage.id, name: outcome.mapped_stage.name, pipeline_name: outcome.mapped_stage.pipeline_name, is_current: outcome.mapped_stage.id === current.stageId, color: outcome.mapped_stage.color ?? null },
        application,
        needs_verification: application && verification?.complete !== true,
        adds_to_do_not_call: outcome.disposition_key === DO_NOT_CALL_DISPOSITION_KEY,
      };
    }) ?? null,
  };
}

/**
 * Loading the wizard starts a walk (getDispositionWizard writes one), and a GET must be free of side
 * effects — prefetchers, link scanners and retries replay it. Opening it is POST { action: "start" }.
 */
export async function GET() {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ error: "Open the call outcome wizard with POST { action: \"start\", work_item_id }.", code: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid disposition action." }, { status: 400 });
  // AG-0.5: the transfer must be one this session may see (its own, or a visible producer's); another
  // producer's is 404 before any walk is started or read. A callback may be handed only to someone in
  // the session's scope (or the session itself). Null scope (solo, owner/admin): unchanged.
  const scope = await scopeFor(auth.context);
  const hidden = await guardWorkItem(auth.context, parsed.data.work_item_id, scope);
  if (hidden) return hidden;
  if (parsed.data.action === "complete" && parsed.data.callback_assigned_to && parsed.data.callback_assigned_to !== auth.context.userId && !rowVisible(scope, parsed.data.callback_assigned_to)) {
    return NextResponse.json({ error: "That person is not someone you can hand a callback to.", code: "invalid_input" }, { status: 400 });
  }
  try {
    if (parsed.data.action === "start") return NextResponse.json(await withOutcomeContext(auth.context.tenantId, auth.context.userId, await getDispositionWizard(auth.context.tenantId, auth.context.userId, parsed.data.work_item_id), scope));
    if (parsed.data.action === "answer") {
      const result = await answerDisposition(auth.context.tenantId, auth.context.userId, parsed.data);
      return NextResponse.json({ result, wizard: await withOutcomeContext(auth.context.tenantId, auth.context.userId, await getDispositionWizard(auth.context.tenantId, auth.context.userId, parsed.data.work_item_id), scope) });
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
