import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { customerName, customerTimezone } from "@/lib/callbacks/timezone";
import { verificationStatus } from "@/lib/dispositions/applicationGate";
import { isApplicationOutcome } from "@/lib/dispositions/applicationOutcome";
import { dialConsequence } from "@/lib/dispositions/callConsequence";
import { derivedNextAction, DO_NOT_CALL_KEY } from "@/lib/dispositions/nextAction";
import { DispositionError, getDispositionWizard, listDispositionConfig } from "@/lib/dispositions/service";
import type { DispositionWizard } from "@/lib/dispositions/types";
import { DialerWorkflowError } from "./service";
import type { DialOutcomeRow } from "./dialOutcomeKey";
import { FALLBACK_DIALER_OUTCOMES, INBOUND_RETURN_CALL } from "./outcomes";

/**
 * The "Record call outcome" dialog in CALL mode: the disposition walk linked to one dial attempt.
 *
 * The walk definition and answers are the same as the inbound wizard's (getDispositionWizard,
 * record_disposition_answer), served here under the dialer's own guard so a tenant with outbound
 * dialing and no inbound transfers can use it. The outcome is recorded by the DIALER's function,
 * so every option is described by what that function does (lib/dispositions/callConsequence.ts).
 */

type Row = Record<string, unknown>;
function text(value: unknown) { return typeof value === "string" ? value : ""; }

// Columns the generated types do not know yet (tenant_call_attempts, dispositions.next_action).
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result<unknown>> & { select(columns: string): Query; eq(column: string, value: unknown): Query; maybeSingle<T = unknown>(): Promise<Result<T | null>> };
const loose = () => getSupabaseServiceClient() as unknown as { from(table: string): Query };

/**
 * The dialer's outcomes a tenant has no row for yet — only before 20260929200000 seeds them into the
 * one vocabulary (lib/dialerScripts/outcomes.ts). After it, every one is a tenant row and this adds
 * nothing.
 */
const ATTEMPT_OUTCOMES: Array<[string, string]> = FALLBACK_DIALER_OUTCOMES.map((row) => [row.key, row.label]);

export type CallOutcomeOption = {
  disposition_key: string;
  label: string;
  closes_as: "completed" | "dropped";
  description: string;
  preview: string;
  stage: { id: string; name: string; pipeline_name: string; is_current: boolean } | null;
  application: boolean;
  needs_verification: boolean;
  adds_to_do_not_call: boolean;
};

async function readAttempt(tenantId: string, agentId: string, attemptId: string) {
  const attempt = await loose().from("tenant_call_attempts")
    .select("id, work_item_id, lead_id, disposition, dial_clicked_at")
    .eq("id", attemptId).eq("tenant_id", tenantId).eq("agent_id", agentId).maybeSingle<Row>();
  if (attempt.error) throw new DialerWorkflowError(503, `Could not read this call attempt: ${attempt.error.message}`);
  if (!attempt.data) throw new DialerWorkflowError(404, "Call attempt not found.");
  const row = attempt.data;
  if (text(row.disposition)) throw new DialerWorkflowError(409, "This call's outcome is already recorded.");
  if (!row.dial_clicked_at) throw new DialerWorkflowError(409, "Start the call first; the outcome is recorded against it.");
  const workItemId = text(row.work_item_id);
  if (!workItemId) throw new DialerWorkflowError(409, "This attempt is not attached to a claimed lead and cannot be completed safely.");
  return { workItemId };
}

/** One outcome's row, for the route's key check. Tolerates a database without next_action yet. */
export async function loadDialOutcomeRow(tenantId: string, key: string): Promise<DialOutcomeRow> {
  const db = loose();
  const withNext = await db.from("dispositions").select("is_active, next_action").eq("tenant_id", tenantId).eq("disposition_key", key).maybeSingle<Row>();
  if (!withNext.error) return withNext.data ? { is_active: withNext.data.is_active === true, next_action: text(withNext.data.next_action) || null } : null;
  const plain = await db.from("dispositions").select("is_active").eq("tenant_id", tenantId).eq("disposition_key", key).maybeSingle<Row>();
  if (plain.error) throw new DialerWorkflowError(503, `Could not read this outcome: ${plain.error.message}`);
  return plain.data ? { is_active: plain.data.is_active === true, next_action: null } : null;
}

/** disposition_default_ends_call, asked of the database rather than copied: its list is the SQL's. */
async function defaultEndsCall(keys: string[]): Promise<Map<string, boolean>> {
  const db = getSupabaseServiceClient() as unknown as { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
  const answers = await Promise.all(keys.map(async (key) => [key, await db.rpc("disposition_default_ends_call", { p_disposition_key: key })] as const));
  return new Map(answers.map(([key, result]) => [key, result.error ? false : result.data === true]));
}

/**
 * Every outcome call mode offers — the tenant's active outcomes, then the attempt-only ones — each
 * described by what complete_existing_dial_disposition does with it.
 */
async function callOutcomeOptions(tenantId: string, verification: { complete: boolean } | null): Promise<CallOutcomeOption[]> {
  const config = await listDispositionConfig(tenantId);
  // The inbound return call is the customer's call, offered only on the search path, never here.
  const active = config.dispositions.filter((row) => row.is_active && row.disposition_key !== INBOUND_RETURN_CALL);
  const known = new Set(config.dispositions.map((row) => row.disposition_key));
  const attemptOnly = ATTEMPT_OUTCOMES.filter(([key]) => !known.has(key));
  const needDefault = [...active.filter((row) => row.ends_call === null || row.ends_call === undefined).map((row) => row.disposition_key), ...attemptOnly.map(([key]) => key)];
  const defaults = await defaultEndsCall(needDefault);

  const options: CallOutcomeOption[] = active.map((row) => {
    const endsCall = row.ends_call ?? defaults.get(row.disposition_key) ?? false;
    const next = row.next ?? derivedNextAction(row.disposition_key, endsCall);
    const stage = row.mapped_stage;
    // The gate's own test: an application is a MAPPED active outcome whose stage or flags say so.
    const application = Boolean(stage) && isApplicationOutcome(row, stage);
    const needsVerification = application && verification?.complete !== true;
    const consequence = dialConsequence({ disposition_key: row.disposition_key, ends_call: endsCall, next, mapped_stage: stage, needs_verification: needsVerification });
    return {
      disposition_key: row.disposition_key,
      label: row.label,
      closes_as: row.closes_as,
      description: consequence.line,
      preview: consequence.preview,
      stage: stage ? { id: stage.id, name: stage.name, pipeline_name: stage.pipeline_name, is_current: false } : null,
      application,
      needs_verification: needsVerification,
      adds_to_do_not_call: row.disposition_key === DO_NOT_CALL_KEY,
    };
  });
  for (const [key, label] of attemptOnly) {
    const endsCall = defaults.get(key) ?? false;
    const consequence = dialConsequence({ disposition_key: key, ends_call: endsCall, next: derivedNextAction(key, endsCall), mapped_stage: null });
    options.push({ disposition_key: key, label, closes_as: "completed", description: consequence.line, preview: consequence.preview, stage: null, application: false, needs_verification: false, adds_to_do_not_call: false });
  }
  return options;
}

/** A walk-less wizard for a stage with no question flow: call mode then goes straight to the outcome. */
async function flowlessWizard(tenantId: string, workItemId: string): Promise<DispositionWizard> {
  const db = getSupabaseServiceClient();
  const queue = await db.from("lead_queue").select("id, product_line, lead_id").eq("tenant_id", tenantId).eq("id", workItemId).single();
  if (queue.error || !queue.data) throw new DispositionError("work_item_not_found", "That work item was not found.");
  const [lead, assigneeRows] = await Promise.all([
    db.from("agent_leads").select("id, values").eq("tenant_id", tenantId).eq("id", queue.data.lead_id).single(),
    db.from("tenant_users").select("user_id, role, users!inner(id, name, status)").eq("tenant_id", tenantId).in("role", ["owner", "producer", "assistant"]).not("accepted_at", "is", null),
  ]);
  if (lead.error || !lead.data) throw new DispositionError("lead_not_found", "That lead was not found.");
  if (assigneeRows.error) throw new DispositionError("disposition_unavailable", `Could not load callback assignees: ${assigneeRows.error.message}`);
  const values = (lead.data.values && typeof lead.data.values === "object" && !Array.isArray(lead.data.values) ? lead.data.values : {}) as Record<string, unknown>;
  const assignees = (assigneeRows.data ?? []).flatMap((row) => {
    const user = row.users as unknown as { id: string; name: string; status: string };
    return user?.status === "active" ? [{ id: user.id, name: user.name, role: row.role as string }] : [];
  });
  return {
    walk: { id: "", flow_id: "", status: "open", current_node_id: null, final_disposition_key: null, composed_note: null },
    flow: { id: "", tenant_id: tenantId, stage_id: "", stage_name: "", name: "", is_active: false, root_node_id: null, created_at: "", updated_at: "", nodes: [] },
    currentNode: null,
    steps: [],
    dispositions: [],
    lead: { id: lead.data.id, values },
    workItem: { id: queue.data.id, productLine: queue.data.product_line },
    customerTimezone: customerTimezone(values),
    customerName: customerName(values),
    assignees,
  };
}

export type CallModeWizard = DispositionWizard & {
  currentUserId: string;
  verification: { progress: number; complete: boolean } | null;
  outcomeOptions: CallOutcomeOption[];
  callMode: {
    attemptId: string;
    /** False when the lead's stage has no question flow: the dialog goes straight to the outcome. */
    walkAvailable: boolean;
    /** The walk (one per work item) was completed on an earlier call; its answers are shown, not re-asked. */
    earlierWalk: boolean;
  };
};

export async function getCallModeWizard(input: { tenantId: string; userId: string; attemptId: string }): Promise<CallModeWizard> {
  const { workItemId } = await readAttempt(input.tenantId, input.userId, input.attemptId);
  let wizard: DispositionWizard;
  let walkAvailable = true;
  try {
    wizard = await getDispositionWizard(input.tenantId, input.userId, workItemId);
  } catch (error) {
    if (!(error instanceof DispositionError) || error.code !== "flow_not_found") throw error;
    wizard = await flowlessWizard(input.tenantId, workItemId);
    walkAvailable = false;
  }
  const verification = await verificationStatus(input.tenantId, workItemId).catch(() => null);
  const outcomeOptions = await callOutcomeOptions(input.tenantId, verification);
  const earlierWalk = wizard.walk.status === "completed";
  return {
    ...wizard,
    // A walk finished on an earlier call is not re-asked: its answers belong to that call.
    currentNode: earlierWalk ? null : wizard.currentNode,
    currentUserId: input.userId,
    verification,
    outcomeOptions,
    callMode: { attemptId: input.attemptId, walkAvailable, earlierWalk },
  };
}

/** The work item for an answer posted in call mode (the attempt's own). */
export async function callModeWorkItem(input: { tenantId: string; userId: string; attemptId: string }) {
  return (await readAttempt(input.tenantId, input.userId, input.attemptId)).workItemId;
}

/**
 * After the dialer recorded the outcome: store the walked path with the attempt. The walk (one per
 * work item) is completed with the outcome and its composed note, and the answers are written to
 * the audit log against the attempt (tenant.dial_walk_recorded). Only an open walk with answers is
 * linked. Returns whether it was; a failure is logged, never turned into a failed outcome — the
 * outcome is already recorded.
 */
export async function linkWalkToAttempt(input: { tenantId: string; userId: string; attemptId: string; workItemId: string; walkId: string; disposition: string; request: Request }): Promise<boolean> {
  try {
    const db = getSupabaseServiceClient();
    const walk = await db.from("disposition_walks").select("id, status, work_item_id").eq("id", input.walkId).eq("tenant_id", input.tenantId).maybeSingle();
    if (walk.error || !walk.data || walk.data.status !== "open" || walk.data.work_item_id !== input.workItemId) return false;
    const steps = await db.from("disposition_walk_steps").select("sequence, node_id, answer, option_key, note_fragment").eq("walk_id", input.walkId).order("sequence");
    if (steps.error || !steps.data?.length) return false;
    const nodeIds = [...new Set(steps.data.map((step) => step.node_id))];
    const nodes = await db.from("disposition_nodes").select("id, label, prompt").in("id", nodeIds);
    const questions = new Map((nodes.data ?? []).map((node) => [node.id, node.prompt || node.label]));
    const note = steps.data.map((step) => (step.note_fragment ?? "").trim()).filter(Boolean).join(" ");
    const now = new Date().toISOString();
    const completed = await db.from("disposition_walks")
      .update({ status: "completed", completed_at: now, final_disposition_key: input.disposition, composed_note: note || null, updated_at: now })
      .eq("id", input.walkId).eq("tenant_id", input.tenantId).eq("status", "open");
    if (completed.error) throw new Error(completed.error.message);
    await audit({
      actorId: input.userId,
      actorType: "tenant",
      action: "tenant.dial_walk_recorded",
      targetType: "tenant_call_attempts",
      targetId: input.attemptId,
      metadata: {
        walkId: input.walkId,
        workItemId: input.workItemId,
        disposition: input.disposition,
        answers: steps.data.map((step) => ({ sequence: step.sequence, question: questions.get(step.node_id) ?? "Question", optionKey: step.option_key, answer: step.answer })),
      },
      request: input.request,
    });
    return true;
  } catch (error) {
    console.error(`[dialer] could not link the walk to the call: ${error instanceof Error ? error.message : "unknown"}`);
    return false;
  }
}
