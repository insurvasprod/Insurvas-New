import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";
import { isRecordUuid } from "@/lib/ingestion/path";
import { PIPELINE_RULES_PENDING_MESSAGE, RULE_EVENTS, RULE_MODES } from "@/lib/pipelineRules/rules";
import { checkEvaluation, createRule, duplicateRule, loadRulesList, PipelineRulesError, previewRule, resolveHold, saveVersion, setEnabled, setMode, undoMove, type RuleContent } from "@/lib/pipelineRules/store";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Book of business › Setup › Pipeline rules (owner 2026-11-02, docs/la4/SIMPLIFY-PROPOSAL.md §4). GET: the
 * agency's rules. POST: write a rule (version 1, in forecast), save a new version, preview on today's
 * data (writes nothing), switch forecast / live (live replays nothing unless asked), turn on or off,
 * duplicate, mark a forecast line right or wrong, undo a move, settle two rules that disagree.
 *
 * Owner and bookkeeper, like the rest of Setup. Every read and write filters on the caller's tenant
 * (lib/pipelineRules/store.ts); every change is audited.
 */
const roles = ["owner", "bookkeeper"] as const;
const uuid = z.string().refine(isRecordUuid, "Choose from the list.");

const content = z.object({
  event: z.enum(RULE_EVENTS, { message: "Choose what happens." }),
  carrier_ids: z.array(uuid).max(200),
  from_stage_ids: z.array(uuid).max(200),
  target_pipeline_id: uuid,
  target_stage_id: uuid,
  note_on: z.boolean(),
  note_template: z.string().max(2000).nullable(),
}).strict();
const name = z.string().trim().min(1, "Name the rule.").max(120);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, content, mode: z.enum(["draft", "forecast"]).optional() }).strict(),
  z.object({ action: z.literal("save_version"), rule_id: uuid, name, content }).strict(),
  z.object({ action: z.literal("preview"), rule_id: uuid.nullable(), name: z.string().max(120).optional(), content: content.optional(), as_live: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("set_mode"), rule_id: uuid, mode: z.enum(RULE_MODES), replay: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("set_enabled"), rule_id: uuid, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal("duplicate"), rule_id: uuid }).strict(),
  z.object({ action: z.literal("check"), evaluation_id: uuid, verdict: z.enum(["right", "wrong"]).nullable(), note: z.string().max(500).nullable().optional() }).strict(),
  z.object({ action: z.literal("undo"), evaluation_id: uuid }).strict(),
  z.object({ action: z.literal("resolve_hold"), hold_id: uuid, rule_id: uuid.nullable() }).strict(),
]);

const toContent = (c: z.infer<typeof content>): RuleContent => ({ event: c.event, carrierIds: c.carrier_ids, fromStageIds: c.from_stage_ids, targetPipelineId: c.target_pipeline_id, targetStageId: c.target_stage_id, noteOn: c.note_on, noteTemplate: c.note_template });

function failure(error: unknown) {
  if (error instanceof PipelineRulesError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[pipeline-rules]", error);
  return NextResponse.json({ error: "The pipeline rule could not be saved. Try again." }, { status: 500 });
}

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const view = await loadRulesList(auth.context.tenantId);
    return NextResponse.json({ ok: true, ...view, message: view.available ? null : PIPELINE_RULES_PENDING_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  // Every POST counts as a write (a read-only account sees the Preview tab, drawn on the server, instead).
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the rule and try again." }, { status: 400 });
  const input = parsed.data;
  const scope = { tenantId: auth.context.tenantId, userId: auth.context.userId };
  const record = (action: AuditAction, targetId: string, metadata: Record<string, unknown> = {}) =>
    audit({ actorType: "tenant", actorId: scope.userId, action, targetType: "pipeline_rule", targetId, metadata: { tenantId: scope.tenantId, ...metadata }, request });

  try {
    switch (input.action) {
      case "preview": {
        const preview = await previewRule(scope.tenantId, { ruleId: input.rule_id, name: input.name, content: input.content ? toContent(input.content) : undefined, asLive: input.as_live });
        return NextResponse.json({ ok: true, ...preview, message: preview.available ? null : PIPELINE_RULES_PENDING_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
      }
      case "create": {
        const id = await createRule(scope, { name: input.name, content: toContent(input.content), mode: input.mode });
        await record("pipeline_rule.created", id, { event: input.content.event, mode: input.mode ?? "forecast" });
        return NextResponse.json({ ok: true, id }, { status: 201 });
      }
      case "save_version": {
        const version = await saveVersion(scope, input.rule_id, { name: input.name, content: toContent(input.content) });
        await record("pipeline_rule.version_saved", input.rule_id, { version, event: input.content.event });
        return NextResponse.json({ ok: true, id: input.rule_id, version });
      }
      case "set_mode": {
        const done = await setMode(scope, input.rule_id, input.mode, input.replay ?? false);
        await record("pipeline_rule.mode_changed", input.rule_id, { mode: input.mode, replay: input.replay ?? false, moved: done.moved });
        return NextResponse.json({ ok: true, moved: done.moved });
      }
      case "set_enabled": {
        await setEnabled(scope, input.rule_id, input.enabled);
        await record(input.enabled ? "pipeline_rule.turned_on" : "pipeline_rule.turned_off", input.rule_id);
        return NextResponse.json({ ok: true });
      }
      case "duplicate": {
        const id = await duplicateRule(scope, input.rule_id);
        await record("pipeline_rule.duplicated", id, { from: input.rule_id });
        return NextResponse.json({ ok: true, id }, { status: 201 });
      }
      case "check": {
        await checkEvaluation(scope, input.evaluation_id, input.verdict, input.note ?? null);
        await audit({ actorType: "tenant", actorId: scope.userId, action: "pipeline_rule.forecast_checked", targetType: "pipeline_rule_evaluation", targetId: input.evaluation_id, metadata: { tenantId: scope.tenantId, verdict: input.verdict }, request });
        return NextResponse.json({ ok: true });
      }
      case "undo": {
        await undoMove(scope, input.evaluation_id);
        await audit({ actorType: "tenant", actorId: scope.userId, action: "pipeline_rule.move_undone", targetType: "pipeline_rule_evaluation", targetId: input.evaluation_id, metadata: { tenantId: scope.tenantId }, request });
        return NextResponse.json({ ok: true });
      }
      case "resolve_hold": {
        await resolveHold(scope, input.hold_id, input.rule_id);
        await audit({ actorType: "tenant", actorId: scope.userId, action: "pipeline_rule.hold_resolved", targetType: "pipeline_rule_hold", targetId: input.hold_id, metadata: { tenantId: scope.tenantId, chosen: input.rule_id }, request });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (error) {
    return failure(error);
  }
}
