import "server-only";

import { audit } from "@/lib/audit/log";
import { customerTimezone } from "@/lib/callbacks/timezone";
import { resolveSalesSettings } from "@/lib/salesSettings/schema";
import { auditAfterSubmit } from "./afterAudit";
import { isOpenStatus } from "./afterSubmitRules";
import type { ApplicationOutcome, RequirementKind, WaitingOn } from "./constants";
import { ApplicationError, db, isMissingSchema, rows, rpcError, SchemaPendingError } from "./db";
import { syncLeadStageForApplication } from "./stageSyncService";

/**
 * LA-3.18 pending requirements (and the LA-3.25 paramed-exam columns). What the carrier asked for
 * after submission, who it is waiting on, and how often it has been chased. Adding the first one
 * moves the attempt `submitted → pending_carrier`; satisfying the last one moves nothing — issue is
 * only ever recorded from the carrier's notice (STATUS-MODEL §4).
 */

export type Actor = { tenantId: string; userId: string; request: Request };

export type AttemptHead = { id: string; case_id: string; lead_id: string; insured_role: "primary" | "spouse"; attempt_no: number; status: string; carrier_id: string | null; quote_id: string | null };

const AFTER_SUBMIT = ["submitted", "pending_carrier", "counteroffer_pending"];

export function fail(error: { code?: string; message?: string } | null | undefined, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError(what);
  throw new ApplicationError("APPLICATION_UNAVAILABLE", `${what}: ${error?.message ?? "unknown error"}`, 500);
}

export async function attemptHead(tenantId: string, applicationId: string, opts: { allowClosed?: boolean } = {}): Promise<AttemptHead> {
  const q = await db().from("tenant_applications").select("id, case_id, lead_id, insured_role, attempt_no, status, carrier_id, quote_id").eq("tenant_id", tenantId).eq("id", applicationId).maybeSingle();
  if (isMissingSchema(q.error)) throw new SchemaPendingError("The application record");
  if (q.error) fail(q.error, "Could not load the application");
  if (!q.data) throw new ApplicationError("APPLICATION_NOT_FOUND", "That application could not be found.", 404);
  if (!opts.allowClosed && q.data.status === "closed") throw new ApplicationError("APPLICATION_CLOSED", "This attempt is closed. Start a new attempt instead.", 409);
  return q.data as AttemptHead;
}

/** A status change through the one SQL writer, audited the way transition() audits it. */
export async function moveAttempt(actor: Actor, applicationId: string, to: string, extra: { outcome?: ApplicationOutcome | null; reasonCode?: string | null; reasonText?: string | null; why?: string } = {}) {
  const { data, error } = await db().rpc("application_transition", {
    p_tenant_id: actor.tenantId, p_application_id: applicationId, p_actor: actor.userId, p_to: to,
    p_outcome: extra.outcome ?? null, p_reason_code: extra.reasonCode ?? null, p_reason_text: extra.reasonText ?? null,
  });
  if (error) rpcError(error, "Could not move the application");
  await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.application_transitioned", targetType: "tenant_application", targetId: applicationId, metadata: { to, outcome: extra.outcome ?? null, reasonCode: extra.reasonCode ?? null, why: extra.why ?? null }, request: actor.request });
  if (to === "closed") await waiveOpenRequirements(actor, applicationId);
  // The lead's pipeline card follows (LA-3.21), as it does after every other transition.
  await syncLeadStageForApplication(actor.tenantId, applicationId);
  return rows<{ application_id: string; status: string; outcome: string | null; case_status: string }>(data)[0] ?? null;
}

/**
 * A closed attempt is waiting on nobody: what the carrier still wanted from it is waived, so it
 * leaves Pending cases and the dashboard counts. The rows stay, on the timeline, as they were.
 */
export async function waiveOpenRequirements(actor: Actor, applicationId: string) {
  const { error } = await db().from("tenant_application_requirements")
    .update({ status: "waived", satisfied_at: new Date().toISOString().slice(0, 10), note: "Waived: the attempt was closed." })
    .eq("tenant_id", actor.tenantId).eq("application_id", applicationId).in("status", ["open", "in_progress"]);
  if (error && !isMissingSchema(error)) fail(error, "Could not close the open requirements");
}

type ExamInput = { exam_vendor?: string | null; exam_ordered_on?: string | null; exam_scheduled_on?: string | null; exam_completed_on?: string | null; exam_results_on?: string | null };
const EXAM_KEYS = ["exam_vendor", "exam_ordered_on", "exam_scheduled_on", "exam_completed_on", "exam_results_on"] as const;

function examPatch(kind: string, input: ExamInput): Record<string, unknown> {
  const given = EXAM_KEYS.filter((k) => input[k] !== undefined && input[k] !== null && input[k] !== "");
  if (kind !== "paramed_exam") {
    if (given.length) throw new ApplicationError("EXAM_ONLY_PARAMED", "Exam dates belong to a paramed exam requirement only.");
    return {};
  }
  const patch: Record<string, unknown> = {};
  for (const k of EXAM_KEYS) if (input[k] !== undefined) patch[k] = input[k] || null;
  return patch;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function ageingDays(tenantId: string): Promise<number> {
  const s = await db().from("tenant_sales_settings").select("settings").eq("tenant_id", tenantId).maybeSingle();
  return resolveSalesSettings(s.data?.settings).requirementAgeingDays;
}

// ── add ────────────────────────────────────────────────────────────────────

export async function addRequirement(actor: Actor, applicationId: string, input: {
  kind: Exclude<RequirementKind, "counteroffer">; description: string; waiting_on: WaitingOn; raised_at?: string | null; due_at?: string | null; note?: string | null;
} & ExamInput) {
  const a = await attemptHead(actor.tenantId, applicationId);
  if (!AFTER_SUBMIT.includes(a.status)) throw new ApplicationError("APPLICATION_NOT_SUBMITTED", "Requirements are what the carrier asks for after submission — record the submission first.", 409);
  const raised = input.raised_at || today();
  if (raised > today()) throw new ApplicationError("REQUIREMENT_RAISED_FUTURE", "The raised date can't be in the future.");
  if (input.due_at && input.due_at < raised) throw new ApplicationError("REQUIREMENT_DUE_BEFORE_RAISED", "The due date is before the date it was raised.");
  const ins = await db().from("tenant_application_requirements").insert({
    tenant_id: actor.tenantId, application_id: a.id, kind: input.kind, description: input.description.trim(), waiting_on: input.waiting_on,
    status: "open", raised_at: raised, due_at: input.due_at || null, note: input.note?.trim() || null, created_by: actor.userId,
    ...examPatch(input.kind, input),
  }).select("id").single();
  if (ins.error) fail(ins.error, "Could not add the requirement");
  // The first requirement is what makes the attempt "pending with the carrier" (STATUS-MODEL §4).
  let status = a.status;
  if (a.status === "submitted") {
    const moved = await moveAttempt(actor, a.id, "pending_carrier", { why: "requirement_added" });
    status = moved?.status ?? "pending_carrier";
  }
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_requirement_added", targetId: a.id, metadata: { requirementId: ins.data.id, kind: input.kind, waitingOn: input.waiting_on }, request: actor.request });
  return { id: ins.data.id as string, status };
}

// ── update ─────────────────────────────────────────────────────────────────

type RequirementRow = { id: string; application_id: string; kind: RequirementKind; status: string; raised_at: string; chase_count: number; description: string | null };

async function requirementRow(tenantId: string, applicationId: string, requirementId: string): Promise<RequirementRow> {
  const r = await db().from("tenant_application_requirements").select("id, application_id, kind, status, raised_at, chase_count, description").eq("tenant_id", tenantId).eq("application_id", applicationId).eq("id", requirementId).maybeSingle();
  if (r.error) fail(r.error, "Could not load the requirement");
  if (!r.data) throw new ApplicationError("REQUIREMENT_NOT_FOUND", "That requirement could not be found.", 404);
  return r.data as RequirementRow;
}

export async function updateRequirement(actor: Actor, applicationId: string, requirementId: string, input: {
  status?: "open" | "in_progress" | "satisfied" | "waived" | "expired"; description?: string; waiting_on?: WaitingOn; due_at?: string | null; note?: string | null;
} & ExamInput) {
  const a = await attemptHead(actor.tenantId, applicationId);
  const r = await requirementRow(actor.tenantId, a.id, requirementId);
  if (r.kind === "counteroffer" && input.status && input.status !== r.status) {
    throw new ApplicationError("REQUIREMENT_IS_COUNTEROFFER", "Answer the counteroffer instead — accepting or refusing it closes this.", 409);
  }
  if (input.due_at && input.due_at < r.raised_at) throw new ApplicationError("REQUIREMENT_DUE_BEFORE_RAISED", "The due date is before the date it was raised.");
  const patch: Record<string, unknown> = { ...examPatch(r.kind, input) };
  if (input.status) {
    patch.status = input.status;
    patch.satisfied_at = input.status === "satisfied" || input.status === "waived" ? today() : null;
  }
  if (input.description !== undefined) {
    if (r.kind === "other" && !input.description.trim()) throw new ApplicationError("REQUIREMENT_DESCRIPTION", "Say what the carrier asked for.");
    patch.description = input.description.trim() || null;
  }
  if (input.waiting_on) patch.waiting_on = input.waiting_on;
  if (input.due_at !== undefined) patch.due_at = input.due_at || null;
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (!Object.keys(patch).length) return { id: r.id, status: r.status };
  const u = await db().from("tenant_application_requirements").update(patch).eq("tenant_id", actor.tenantId).eq("id", r.id);
  if (u.error) fail(u.error, "Could not update the requirement");
  // Satisfying the last one leaves the attempt pending_carrier: nothing infers issue (LA-3.18).
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_requirement_updated", targetId: a.id, metadata: { requirementId: r.id, from: r.status, to: input.status ?? r.status, fields: Object.keys(patch) }, request: actor.request });
  return { id: r.id, status: (input.status ?? r.status) as string };
}

// ── chase: one click, chase_count + 1 and last_chased_at now ─────────────────

export async function chaseRequirement(actor: Actor, applicationId: string, requirementId: string) {
  const a = await attemptHead(actor.tenantId, applicationId);
  // Compare-and-set on the count, so two clicks at once are two chases, never one lost.
  for (let tries = 0; tries < 3; tries += 1) {
    const r = await requirementRow(actor.tenantId, a.id, requirementId);
    if (!isOpenStatus(r.status)) throw new ApplicationError("REQUIREMENT_CLOSED", "That requirement is already closed.", 409);
    const at = new Date().toISOString();
    const u = await db().from("tenant_application_requirements").update({ chase_count: r.chase_count + 1, last_chased_at: at })
      .eq("tenant_id", actor.tenantId).eq("id", r.id).eq("chase_count", r.chase_count).select("chase_count, last_chased_at");
    if (u.error) fail(u.error, "Could not log the chase");
    const hit = rows<{ chase_count: number; last_chased_at: string }>(u.data)[0];
    if (hit) {
      await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_requirement_chased", targetId: a.id, metadata: { requirementId: r.id, chaseCount: hit.chase_count }, request: actor.request });
      return { chaseCount: hit.chase_count, lastChasedAt: hit.last_chased_at };
    }
  }
  throw new ApplicationError("REQUIREMENT_BUSY", "Someone else just chased this — refresh and try again.", 409);
}

// ── a callback that links back ─────────────────────────────────────────────

const CALLBACK_ERRORS: Record<string, [string, number]> = {
  REQUIREMENT_NOT_FOUND: ["That requirement could not be found.", 404],
  REQUIREMENT_CLOSED: ["That requirement is already closed.", 409],
  CALLBACK_DATE_REQUIRED: ["Choose when to call back.", 400],
  CALLBACK_TIMEZONE_INVALID: ["That timezone isn't recognised.", 400],
  CALLBACK_DATE_PAST: ["Choose a time in the future.", 400],
  CALLBACK_NOTE_INVALID: ["Keep the note under 1,000 characters.", 400],
  CALLBACK_ASSIGNEE_INVALID: ["Your account can't take callbacks in this agency.", 403],
  CALLBACK_ASSIGNEE_ROLE_INVALID: ["Your role can't take callbacks.", 403],
  REQUIREMENT_CALLBACK_NO_WORK_ITEM: ["This lead has no work item to hang a callback on.", 409],
};

export async function bookRequirementCallback(actor: Actor, applicationId: string, requirementId: string, input: { local: string; timezone?: string | null; note?: string | null }) {
  const a = await attemptHead(actor.tenantId, applicationId);
  const r = await requirementRow(actor.tenantId, a.id, requirementId);
  let zone = input.timezone?.trim() || null;
  if (!zone) {
    const lead = await db().from("agent_leads").select("values").eq("tenant_id", actor.tenantId).eq("id", a.lead_id).maybeSingle();
    zone = customerTimezone((lead.data?.values ?? {}) as Record<string, unknown>);
  }
  const note = input.note?.trim() || `Chase: ${r.description ?? r.kind}`.slice(0, 1000);
  const { data, error } = await db().rpc("la3_requirement_callback", {
    p_tenant_id: actor.tenantId, p_requirement_id: r.id, p_actor: actor.userId, p_callback_local: `${input.local}:00`, p_customer_timezone: zone, p_note: note,
  });
  if (error) {
    if (isMissingSchema(error)) throw new SchemaPendingError("Requirement callbacks");
    const code = Object.keys(CALLBACK_ERRORS).find((k) => error.message?.includes(k));
    if (code) throw new ApplicationError(code, CALLBACK_ERRORS[code][0], CALLBACK_ERRORS[code][1]);
    fail(error, "Could not book the callback");
  }
  const row = rows<{ callback_id: string; scheduled_at_utc: string }>(data)[0];
  await auditAfterSubmit({ actorId: actor.userId, action: "tenant.application_requirement_chased", targetId: a.id, metadata: { requirementId: r.id, callbackId: row?.callback_id ?? null }, request: actor.request });
  return { callbackId: row?.callback_id ?? null, scheduledAtUtc: row?.scheduled_at_utc ?? null, timezone: zone };
}

// ── reads ──────────────────────────────────────────────────────────────────

/** The callback each requirement booked, for the "Callback on …" line. */
export async function requirementCallbacks(tenantId: string, applicationId: string) {
  const q = await db().from("tenant_application_requirements").select("id, callback_id").eq("tenant_id", tenantId).eq("application_id", applicationId).not("callback_id", "is", null);
  if (q.error) { if (isMissingSchema(q.error)) return []; fail(q.error, "Could not load the requirements"); }
  const links = rows<{ id: string; callback_id: string }>(q.data);
  if (!links.length) return [];
  const cb = await db().from("tenant_callbacks").select("id, scheduled_at_utc, customer_timezone, status").eq("tenant_id", tenantId).in("id", links.map((l) => l.callback_id));
  const byId = new Map(rows<{ id: string; scheduled_at_utc: string; customer_timezone: string; status: string }>(cb.data).map((c) => [c.id, c]));
  return links.map((l) => ({ requirementId: l.id, callbackId: l.callback_id, scheduledAtUtc: byId.get(l.callback_id)?.scheduled_at_utc ?? null, timezone: byId.get(l.callback_id)?.customer_timezone ?? null, status: byId.get(l.callback_id)?.status ?? null }));
}

