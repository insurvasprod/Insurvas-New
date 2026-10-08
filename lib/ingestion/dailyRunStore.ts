import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { AGENT_INFO, AGENTS, weeklyAccuracy, type AgentName } from "./agents";
import { FILE_STAGES, runPipeline, type FileStage, type PendingFile, type RunDeps, type RunSummary, type StageResult, type Trigger } from "./dailyRun";
import { parseCarrierFile, resolveLayoutMap } from "./parser";
import { extractRawRows } from "./rawLayer";
import { pollBucketDrops } from "./registry";
import type { ParsedFile, ReprocessFile } from "./reprocess";
import { filePolicyNumbers, linkFilePolicies, storeFileSnapshots } from "./snapshotStore";
import { REPROCESS_STAGES } from "./stages";

/**
 * LA-4.19 (Notion sprint) · the server side of the orchestrated run: what is pending, the run and
 * stage records, and each stage wired to the work LA-4.1–4.16 already do. Called by the five-minute
 * poll, by a door right after a file arrives, and by "Run now".
 *
 * Before 20261008280000 there are no run tables: `runPending` says so and the caller runs the
 * earlier sweeps instead, so files keep flowing either way.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const DAILY_RUN_PENDING_MESSAGE = "Run history needs a database update (20261008280000).";

/** A run still "running" this long after it started died with its process; the next run says so. */
const STALE_AFTER_MINUTES = 15;
/** A file whose stage failed is tried again on the hour, not on every five-minute poll. */
const RETRY_AFTER_MINUTES = 60;
/** At most this many files per run; the rest wait for the next. */
const FILES_PER_RUN = 20;
const CONCURRENCY = 4;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function available(): Promise<boolean> {
  const { error } = await db().from("pipeline_run").select("id").limit(1);
  if (!error) return true;
  if (isSchemaGap(error)) return false;
  throw new Error(`Could not read the run history: ${error.message}`);
}

type FileRow = { id: string; tenant_id: string; carrier_id: string | null; file_type: string; file_date: string | null; status: string; parsed_at: string | null; parser_version: number | null; row_count: number | null };

async function pending(filter: { tenantId?: string; fileIds?: string[]; arrived: Set<string> }): Promise<PendingFile[]> {
  const columns = "id, tenant_id, carrier_id, file_type, file_date, status, parsed_at, parser_version, row_count";
  const scoped = (query: Loose) => {
    let q = query;
    if (filter.tenantId) q = q.eq("tenant_id", filter.tenantId);
    if (filter.fileIds?.length) q = q.in("id", filter.fileIds);
    return q;
  };
  const [fresh, waiting, underway] = await Promise.all([
    // To read: a spreadsheet that arrived and hasn't been parsed.
    scoped(db().from("file_registry").select(columns).eq("status", "received").in("file_kind", ["csv", "xlsx"]).is("raw_error", null)).order("received_at").limit(FILES_PER_RUN),
    // Waiting for a layout map: picked up only once one exists.
    scoped(db().from("file_registry").select(columns).eq("status", "failed").eq("parse_block", "no_layout_map")).order("received_at").limit(FILES_PER_RUN),
    // Parsed, but not through every stage (a stage failed, or the run stopped).
    scoped(db().from("file_registry").select(columns).eq("status", "parsed").is("pipeline_completed_at", null)).order("received_at").limit(FILES_PER_RUN),
  ]);
  for (const read of [fresh, waiting, underway]) if (read.error) throw new Error(`Could not list the waiting files: ${read.error.message}`);

  const ready: FileRow[] = [];
  const maps = new Map<string, boolean>();
  for (const file of (waiting.data ?? []) as FileRow[]) {
    if (!file.carrier_id || (file.file_type !== "policies" && file.file_type !== "commissions")) continue;
    const key = `${file.tenant_id}|${file.carrier_id}|${file.file_type}`;
    if (!maps.has(key)) maps.set(key, Boolean(await resolveLayoutMap(file.tenant_id, file.carrier_id, file.file_type).catch(() => null)));
    if (maps.get(key)) ready.push(file);
  }
  const candidates = [...((fresh.data ?? []) as FileRow[]), ...ready, ...((underway.data ?? []) as FileRow[])].slice(0, FILES_PER_RUN);
  if (!candidates.length) return [];

  const { data: stageRows, error } = await db().from("pipeline_stage_run").select("file_id, stage, status, started_at, finished_at, pipeline_run!inner(status)").in("file_id", candidates.map((f) => f.id)).order("started_at");
  if (error) throw new Error(`Could not read the files' stage history: ${error.message}`);
  const history = new Map<string, Loose[]>();
  for (const row of (stageRows ?? []) as Loose[]) history.set(row.file_id, [...(history.get(row.file_id) ?? []), row]);

  const out: PendingFile[] = [];
  for (const file of candidates) {
    const rows = history.get(file.id) ?? [];
    // Another run has it in hand right now: leave it to that run.
    if (rows.some((r) => r.status === "running" && r.started_at > minutesAgo(STALE_AFTER_MINUTES))) continue;
    // A stage failed within the hour: wait for the next hourly try, unless the file was named.
    if (!filter.fileIds && rows.some((r) => r.status === "failed" && r.finished_at > minutesAgo(RETRY_AFTER_MINUTES))) continue;
    const since = file.parsed_at ?? "";
    const completed = FILE_STAGES.filter((stage) => rows.some((r) => r.stage === stage && r.status === "succeeded" && r.finished_at >= since && r.pipeline_run?.status !== "running")) as FileStage[];
    out.push({ tenantId: file.tenant_id, fileId: file.id, fileType: file.file_type, arrivedThisRun: filter.arrived.has(file.id), parsed: file.status === "parsed", completed });
  }
  return out;
}

async function fileRow(tenantId: string, fileId: string): Promise<ReprocessFile> {
  const { data, error } = await db().from("file_registry").select("id, carrier_id, file_type, file_date, parser_version, row_count").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error || !data) throw new Error(`Could not load the file: ${error?.message ?? "not found"}`);
  return { id: data.id, carrierId: data.carrier_id, fileType: data.file_type, fileDate: data.file_date, parserVersion: data.parser_version, rowCount: data.row_count };
}

const deps: RunDeps = {
  now: () => Date.now(),

  async recoverInterrupted() {
    const stale = minutesAgo(STALE_AFTER_MINUTES);
    const at = new Date().toISOString();
    await db().from("pipeline_stage_run").update({ status: "failed", finished_at: at, error_detail: "The run stopped before this stage finished. The next run picks the file up again from its last completed stage." }).eq("status", "running").lt("started_at", stale);
    const { data } = await db().from("pipeline_run").update({ status: "failed", finished_at: at, error_detail: "The run stopped before it finished; its files are picked up again by the next run." }).eq("status", "running").lt("started_at", stale).select("id");
    return (data ?? []).length;
  },

  async collect() {
    const poll = await pollBucketDrops(100);
    if (poll.errors.length) console.error(`[daily-run] ${poll.errors.length} drop(s) failed:`, poll.errors.slice(0, 5));
    return poll.registeredFiles ?? [];
  },

  pending,

  async startRun(tenantId, trigger) {
    const { data, error } = await db().from("pipeline_run").insert({ tenant_id: tenantId, trigger }).select("id").single();
    if (error) throw new Error(`Could not start the run: ${error.message}`);
    return data.id as string;
  },

  async finishRun(runId, s) {
    const { error } = await db().from("pipeline_run").update({ status: s.status, files_total: s.total, files_succeeded: s.succeeded, files_failed: s.failed, finished_at: new Date().toISOString(), error_detail: s.error ? s.error.slice(0, 2000) : null }).eq("id", runId);
    if (error) throw new Error(`Could not finish the run: ${error.message}`);
  },

  async startStage(runId, tenantId, fileId, stage) {
    const { data, error } = await db().from("pipeline_stage_run").insert({ run_id: runId, tenant_id: tenantId, file_id: fileId, stage }).select("id").single();
    if (error) throw new Error(`Could not record the ${stage} stage: ${error.message}`);
    return data.id as string;
  },

  async finishStage(id, r: StageResult) {
    const { error } = await db().from("pipeline_stage_run").update({
      status: r.status, finished_at: new Date().toISOString(), rows_in: r.rowsIn ?? null, rows_out: r.rowsOut ?? null,
      error_detail: r.error ? r.error.slice(0, 2000) : null, note: r.note ? r.note.slice(0, 500) : null, agent_findings_count: r.findings ?? 0,
    }).eq("id", id);
    if (error) throw new Error(`Could not finish the stage record: ${error.message}`);
  },

  async parse(file) {
    const extracted = await extractRawRows(file.tenantId, file.fileId);
    if (extracted.outcome === "failed") return { result: { status: "failed", error: extracted.reason }, passed: null };
    if (extracted.outcome === "pending_schema") return { result: { status: "failed", error: "A database update is pending." }, passed: null };
    if (extracted.outcome === "not_applicable") return { result: { status: "failed", error: `The rows can't be read: ${extracted.reason}.` }, passed: null };
    const rowsIn = extracted.outcome === "extracted" || extracted.outcome === "already" ? extracted.rowCount ?? null : null;
    const parsed = await parseCarrierFile(file.tenantId, file.fileId);
    if (parsed.outcome === "parsed") {
      return {
        result: { status: "succeeded", rowsIn, rowsOut: parsed.passed.length, findings: parsed.findings, note: parsed.heldRows ? `${parsed.heldRows} ${parsed.heldRows === 1 ? "row is" : "rows are"} held: an unmapped status (blocking for those rows)` : null },
        passed: parsed.passed,
      };
    }
    if (parsed.outcome === "no_layout_map") return { result: { status: "blocked", rowsIn, error: "No layout map for this carrier's file yet; it is read as soon as one is approved." }, passed: null };
    if (parsed.outcome === "failed") return { result: { status: "blocked", rowsIn, findings: parsed.result.findings.length, error: parsed.reason }, passed: null };
    if (parsed.outcome === "pending_schema") return { result: { status: "failed", error: "A database update is pending." }, passed: null };
    return { result: { status: "failed", error: `The file can't be parsed: ${parsed.reason}.` }, passed: null };
  },

  async store(file, passed) {
    const stored = await storeFileSnapshots(file.tenantId, file.fileId, passed);
    if (!stored.available) return { status: "failed", error: "A database update is pending." };
    return { status: "succeeded", rowsIn: passed.length, rowsOut: stored.snapshots, findings: stored.duplicates ? 1 : 0, note: `${stored.policies} ${stored.policies === 1 ? "policy" : "policies"}, ${stored.changed} changed${stored.duplicates ? `, ${stored.duplicates} listed twice` : ""}` };
  },

  async match(file) {
    const own = await filePolicyNumbers(file.tenantId, file.fileId);
    if (!own.carrierId) return { status: "skipped", note: "No policies in this file" };
    const linked = await linkFilePolicies(file.tenantId, file.fileId, { carrierId: own.carrierId, policies: own.policies });
    return { status: "succeeded", rowsIn: linked.policies, rowsOut: linked.policies, note: "Linked where the ladder is sure; the rest wait in Policy matching. AI review isn't configured yet." };
  },

  async reconcile(file, passed) {
    const reprocessFile = await fileRow(file.tenantId, file.fileId);
    const parsed: ParsedFile = { parserVersion: reprocessFile.parserVersion ?? 0, typedRows: passed, fatal: null };
    const parts: string[] = [];
    let changed = 0;
    for (const stage of REPROCESS_STAGES) {
      if (stage.name === "policy_snapshot") continue;
      const outcome = await stage.rebuild(file.tenantId, reprocessFile, [], parsed);
      changed += outcome.changed;
      if (outcome.changed) parts.push(`${stage.name.replaceAll("_", " ")} ${outcome.changed}`);
    }
    return { status: "succeeded", rowsIn: passed.length, rowsOut: changed, note: parts.length ? parts.join(", ") : "Nothing changed" };
  },

  async complete(file) {
    const { error } = await db().from("file_registry").update({ pipeline_completed_at: new Date().toISOString() }).eq("tenant_id", file.tenantId).eq("id", file.fileId);
    if (error) throw new Error(`Could not mark the file complete: ${error.message}`);
  },

  async analyse(tenantId, runId) {
    // Tie the run's findings to it, then count what is open.
    const { data: files } = await db().from("pipeline_stage_run").select("file_id").eq("run_id", runId).not("file_id", "is", null);
    const ids = [...new Set(((files ?? []) as Loose[]).map((f) => f.file_id))];
    if (ids.length) await db().from("agent_findings").update({ run_id: runId }).eq("tenant_id", tenantId).is("run_id", null).in("file_id", ids);
    const { count } = await db().from("agent_findings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open");
    return { status: "succeeded", rowsIn: ids.length, findings: count ?? 0, note: "Boards and scorecards are computed when they are opened. The written summary waits for an AI provider." };
  },
};

/** One run over what is waiting (or the named files). `available: false` before the migration. */
export async function runPending(trigger: Trigger, options: { tenantId?: string; fileIds?: string[]; budgetMs?: number } = {}): Promise<{ available: boolean; runs: RunSummary[] }> {
  if (!(await available())) return { available: false, runs: [] };
  const runs = await runPipeline(deps, { trigger, tenantId: options.tenantId, fileIds: options.fileIds, deadline: Date.now() + (options.budgetMs ?? 40_000), concurrency: CONCURRENCY });
  return { available: true, runs };
}

/** For after() in a door: the file that just arrived, through every stage; never fails the request. */
export async function runArrival(tenantId: string, fileId: string, fallback: () => Promise<void>): Promise<void> {
  try {
    const outcome = await runPending("file_arrival", { tenantId, fileIds: [fileId] });
    if (!outcome.available) await fallback();
  } catch (error) {
    console.error(`[daily-run] ${fileId} stopped; the next run picks it up:`, error);
  }
}

// ─── what the agency sees ───────────────────────────────────────────────────────────────────────

export type StageRow = { stage: string; status: string; fileId: string | null; rowsIn: number | null; rowsOut: number | null; error: string | null; note: string | null; findings: number; ms: number | null };
export type RunRow = { id: string; trigger: string; status: string; startedAt: string; finishedAt: string | null; total: number; succeeded: number; failed: number; error: string | null; files: Array<{ fileId: string; name: string; stages: StageRow[] }>; analyse: StageRow | null };

export async function listRuns(tenantId: string, limit = 15): Promise<{ available: boolean; runs: RunRow[] }> {
  const { data: runs, error } = await db().from("pipeline_run").select("id, trigger, status, started_at, finished_at, files_total, files_succeeded, files_failed, error_detail").eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(limit);
  if (error) {
    if (isSchemaGap(error)) return { available: false, runs: [] };
    throw new Error(`Could not load the runs: ${error.message}`);
  }
  const ids = ((runs ?? []) as Loose[]).map((r) => r.id);
  const { data: stages } = ids.length ? await db().from("pipeline_stage_run").select("run_id, file_id, stage, status, rows_in, rows_out, error_detail, note, agent_findings_count, started_at, finished_at").in("run_id", ids).order("started_at") : { data: [] };
  const fileIds = [...new Set(((stages ?? []) as Loose[]).map((s) => s.file_id).filter(Boolean))];
  const { data: names } = fileIds.length ? await db().from("file_registry").select("id, original_filename").eq("tenant_id", tenantId).in("id", fileIds) : { data: [] };
  const nameOf = new Map<string, string>(((names ?? []) as Loose[]).map((f) => [f.id, f.original_filename]));
  const toStage = (s: Loose): StageRow => ({ stage: s.stage, status: s.status, fileId: s.file_id, rowsIn: s.rows_in, rowsOut: s.rows_out, error: s.error_detail, note: s.note, findings: s.agent_findings_count, ms: s.finished_at ? Date.parse(s.finished_at) - Date.parse(s.started_at) : null });
  return {
    available: true,
    runs: ((runs ?? []) as Loose[]).map((r) => {
      const own = ((stages ?? []) as Loose[]).filter((s) => s.run_id === r.id);
      const byFile = new Map<string, StageRow[]>();
      for (const s of own) if (s.file_id) byFile.set(s.file_id, [...(byFile.get(s.file_id) ?? []), toStage(s)]);
      const analyse = own.find((s) => s.stage === "analyse");
      return {
        id: r.id, trigger: r.trigger, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, total: r.files_total, succeeded: r.files_succeeded, failed: r.files_failed, error: r.error_detail,
        files: [...byFile.entries()].map(([fileId, list]) => ({ fileId, name: nameOf.get(fileId) ?? "A file", stages: list })),
        analyse: analyse ? toStage(analyse) : null,
      };
    }),
  };
}

export type FindingRow = { id: string; agent: AgentName; agentLabel: string; findingType: string; severity: string; status: string; reasoning: string; confidence: number | null; modelId: string | null; promptVersion: string | null; fileId: string | null; fileName: string | null; createdAt: string; reviewedAt: string | null };

export async function listFindings(tenantId: string, limit = 200): Promise<{ available: boolean; findings: FindingRow[]; accuracy: ReturnType<typeof weeklyAccuracy> }> {
  const [{ data, error }, reviewed] = await Promise.all([
    db().from("agent_findings").select("id, agent_name, finding_type, severity, status, reasoning, confidence, model_id, prompt_version, file_id, created_at, reviewed_at, file_registry(original_filename)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit),
    db().from("agent_findings").select("agent_name, status, reviewed_at").eq("tenant_id", tenantId).in("status", ["approved", "rejected"]).gte("reviewed_at", minutesAgo(60 * 24 * 7 * 8)).limit(5000),
  ]);
  if (error) {
    if (isSchemaGap(error)) return { available: false, findings: [], accuracy: [] };
    throw new Error(`Could not load the findings: ${error.message}`);
  }
  return {
    available: true,
    findings: ((data ?? []) as Loose[]).filter((f) => (AGENTS as readonly string[]).includes(f.agent_name)).map((f) => ({
      id: f.id, agent: f.agent_name, agentLabel: AGENT_INFO[f.agent_name as AgentName].label, findingType: f.finding_type, severity: f.severity, status: f.status, reasoning: f.reasoning,
      confidence: f.confidence === null ? null : Number(f.confidence), modelId: f.model_id, promptVersion: f.prompt_version, fileId: f.file_id, fileName: f.file_registry?.original_filename ?? null, createdAt: f.created_at, reviewedAt: f.reviewed_at,
    })),
    accuracy: weeklyAccuracy(((reviewed.data ?? []) as Loose[]).map((f) => ({ agent: f.agent_name, status: f.status, reviewedAt: f.reviewed_at }))),
  };
}

export class FindingReviewError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "FindingReviewError";
  }
}

/** A person's verdict on an open finding: right (approved) or wrong (rejected). This is what accuracy is measured on. */
export async function reviewFinding(viewer: { tenantId: string; userId: string }, id: string, verdict: "approved" | "rejected"): Promise<void> {
  const { data, error } = await db().from("agent_findings").update({ status: verdict, reviewed_by: viewer.userId, reviewed_at: new Date().toISOString() }).eq("tenant_id", viewer.tenantId).eq("id", id).eq("status", "open").select("id");
  if (error) {
    if (isSchemaGap(error)) throw new FindingReviewError(DAILY_RUN_PENDING_MESSAGE, 503);
    throw new Error(`Could not record the review: ${message(error)}`);
  }
  if (!data?.length) throw new FindingReviewError("That finding isn't open on this agency (it may already have been reviewed).", 409);
}
