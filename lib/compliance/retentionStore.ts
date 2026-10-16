import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { AUTOMATIC_REASONS, HOLD_REASONS, HOLD_SCOPES, type HoldReason, type HoldScope, type RuleRow } from "./retention";
import { getUsPhone10Digits } from "./scrub";

/**
 * LA-6.6 (Notion sprint, Module 6 — Compliance) · retention rules, legal holds and runs, server side.
 * The engine is retention_execute (20261015150000): a dry run reports, a live run deletes, and the
 * database refuses a live run with no dry run inside the tenant's window.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const RETENTION_PENDING_MESSAGE = "Retention needs a database update (20261015150000).";

export class RetentionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RetentionError";
  }
}

function check(error: { code?: string; message: string } | null) {
  if (error && (isSchemaGap(error) || error.code === "PGRST202" || error.code === "42883")) throw new RetentionError(RETENTION_PENDING_MESSAGE, 503);
  if (error?.code === "23514" || /check_violation|needs a dry run|still open|stays released|rules changed|summary/i.test(error?.message ?? "")) throw new RetentionError(error!.message.replace(/^[a-z_]+: /, ""), 409);
  if (error) throw new Error(error.message);
}

export type Hold = { id: string; scope: HoldScope; scopeValue: string | null; reason: HoldReason; sourceId: string | null; note: string | null; placedBy: string | null; placedAt: string; releasedAt: string | null; releaseNote: string | null; automatic: boolean };
export type Run = {
  id: string; mode: "dry_run" | "live"; startedAt: string; finishedAt: string | null;
  results: { record_type: string; table: string | null; rows_matched: number; rows_held: number; rows_purged: number; oldest?: string | null; newest?: string | null; note?: string }[];
  heldCount: number; unruled: string[]; triggeredBy: string;
  /** A dry run's summary: how many people it reached, and whether someone acknowledged it (20261015630000). */
  summaryDelivered: number | null; acknowledgedAt: string | null;
  /** Set on a dry run whose scheduled live run was skipped, and why. */
  liveSkippedReason: string | null;
};

const RUN_BASE = "id, mode, started_at, finished_at, results_json, held_count, unruled, triggered_by";
const RUN_COLUMNS = `${RUN_BASE}, summary_delivered_count, summary_acknowledged_at, live_skipped_reason`;

export async function listRules(tenantId: string): Promise<RuleRow[]> {
  const { data, error } = await db().from("retention_rule").select("id, tenant_id, record_type, state, retain_days, action, basis, notes, set_at").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).order("record_type").order("state", { nullsFirst: true });
  check(error);
  return ((data ?? []) as Loose[]).map((r) => ({ id: r.id, tenantId: r.tenant_id ?? null, recordType: r.record_type, state: r.state ?? null, retainDays: r.retain_days ?? null, action: r.action, basis: r.basis, notes: r.notes ?? null, setAt: r.set_at }));
}

export async function listHolds(tenantId: string): Promise<Hold[]> {
  const { data, error } = await db().from("legal_hold").select("id, scope, scope_value, reason, source_id, note, placed_by, placed_at, released_at, release_note").eq("tenant_id", tenantId).order("placed_at", { ascending: false }).limit(500);
  check(error);
  return ((data ?? []) as Loose[]).map((h) => ({ id: h.id, scope: h.scope, scopeValue: h.scope_value ?? null, reason: h.reason, sourceId: h.source_id ?? null, note: h.note ?? null, placedBy: h.placed_by ?? null, placedAt: h.placed_at, releasedAt: h.released_at ?? null, releaseNote: h.release_note ?? null, automatic: AUTOMATIC_REASONS.includes(h.reason) }));
}

export async function listRuns(tenantId: string, limit = 20): Promise<Run[]> {
  const read = (cols: string) => db().from("retention_run").select(cols).eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(limit);
  let { data, error } = await read(RUN_COLUMNS);
  // Before 20261015630000 the summary columns are not there yet.
  if (error && (error.code === "42703" || /summary_|live_skipped/.test(error.message))) ({ data, error } = await read(RUN_BASE));
  check(error);
  return ((data ?? []) as Loose[]).map((r) => ({
    id: r.id, mode: r.mode, startedAt: r.started_at, finishedAt: r.finished_at ?? null, results: Array.isArray(r.results_json) ? r.results_json : [], heldCount: Number(r.held_count ?? 0), unruled: r.unruled ?? [], triggeredBy: r.triggered_by,
    summaryDelivered: r.summary_delivered_count ?? null, acknowledgedAt: r.summary_acknowledged_at ?? null, liveSkippedReason: r.live_skipped_reason ?? null,
  }));
}

/**
 * Run the engine: a dry run reports; a live run deletes. The database refuses a live run unless a dry
 * run finished inside the window, its summary reached someone (or was acknowledged), and the rules
 * have not changed since it. A dry run the owner runs here is shown to them, so it is acknowledged
 * by them.
 */
export async function runRetention(tenantId: string, mode: "dry_run" | "live", userId: string): Promise<Run> {
  const { data, error } = await db().rpc("retention_execute", { p_tenant_id: tenantId, p_mode: mode, p_triggered_by: "manual" });
  check(error);
  if (mode === "dry_run") await acknowledgeDryRun(tenantId, userId, data as string).catch((e) => console.error("[retention] could not record the acknowledgement", e));
  const runs = await listRuns(tenantId, 5);
  const run = runs.find((r) => r.id === data);
  if (!run) throw new Error("The run did not record");
  return run;
}

/** Someone with authority has read this dry run's summary: the live run may follow it. */
export async function acknowledgeDryRun(tenantId: string, userId: string, runId: string): Promise<void> {
  const { data, error } = await db().from("retention_run").update({ summary_acknowledged_at: new Date().toISOString(), summary_acknowledged_by: userId })
    .eq("tenant_id", tenantId).eq("id", runId).eq("mode", "dry_run").is("summary_acknowledged_at", null).select("id");
  check(error);
  if (!data?.length) {
    const { data: run } = await db().from("retention_run").select("id").eq("tenant_id", tenantId).eq("id", runId).eq("mode", "dry_run").maybeSingle();
    if (!run) throw new RetentionError("That dry run isn't here.", 404);
  }
}

export async function placeHold(tenantId: string, userId: string, input: { scope: string; value: string | null; reason: string; note: string | null }): Promise<void> {
  if (!(HOLD_SCOPES as readonly string[]).includes(input.scope)) throw new RetentionError("Choose what the hold covers.", 400);
  if (!(HOLD_REASONS as readonly string[]).includes(input.reason) || AUTOMATIC_REASONS.includes(input.reason as HoldReason)) throw new RetentionError("Complaint and dispute holds are placed by their source; choose litigation, a regulator inquiry or manual.", 400);
  let value: string | null = null;
  if (input.scope === "phone_digits") {
    try {
      value = getUsPhone10Digits(input.value);
    } catch (e) {
      throw new RetentionError(e instanceof Error ? e.message : "Enter a valid US phone number", 400);
    }
  } else if (input.scope === "contact_id") {
    if (!/^[0-9a-f-]{36}$/i.test(input.value ?? "")) throw new RetentionError("Choose the client.", 400);
    value = input.value;
  } else if (input.scope === "policy_number") {
    value = (input.value ?? "").trim();
    if (!value || value.length > 120) throw new RetentionError("Enter the policy number.", 400);
  }
  if (!input.note?.trim()) throw new RetentionError("Say why the hold is placed.", 400);
  const { error } = await db().from("legal_hold").insert({ tenant_id: tenantId, scope: input.scope, scope_value: value, reason: input.reason, note: input.note.trim().slice(0, 2000), placed_by: userId });
  check(error);
}

/** Releasing is a deliberate, logged act; an automatic hold waits for its source to close (the database refuses it). */
export async function releaseHold(tenantId: string, userId: string, id: string, note: string): Promise<void> {
  if (!note.trim()) throw new RetentionError("Say why the hold is released.", 400);
  const { data, error } = await db().from("legal_hold").update({ released_at: new Date().toISOString(), released_by: userId, release_note: note.trim().slice(0, 2000) }).eq("tenant_id", tenantId).eq("id", id).is("released_at", null).select("id");
  check(error);
  if (!data?.length) throw new RetentionError("That hold isn't active.", 404);
}

/** Dry runs whose summary has not gone out: the scheduled-run email (LA-6.6). */
export async function pendingDryRunSummaries() {
  const { data, error } = await db().from("retention_run").select("id, tenant_id, results_json, held_count, unruled, finished_at").eq("mode", "dry_run").eq("triggered_by", "schedule").is("summary_emailed_at", null).not("finished_at", "is", null).limit(200);
  if (error) return [];
  return (data ?? []) as Loose[];
}

/**
 * The summary went out. `delivered` is how many people actually received it: zero means nobody saw
 * it, and the scheduled live run will not follow it (retention_scheduled skips and says so).
 */
export async function markSummarySent(runId: string, delivered: number) {
  const { error } = await db().from("retention_run").update({ summary_emailed_at: new Date().toISOString(), summary_delivered_count: delivered }).eq("id", runId);
  if (error && (error.code === "42703" || /summary_delivered_count/.test(error.message))) {
    // Before 20261015630000: there is no count to keep, and the live run is still gated the old way.
    await db().from("retention_run").update({ summary_emailed_at: new Date().toISOString() }).eq("id", runId);
  } else if (error) throw new Error(error.message);
}
