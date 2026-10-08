/**
 * LA-4.19 (Notion sprint) · the orchestrated run, as a plain function over injected steps (tested
 * with fakes; the server wiring is dailyRunStore.ts).
 *
 *   1 COLLECT    new files detected            ← file monitor
 *   2 INGEST     registered, hashed, deduped   ← file monitor
 *   3 PARSE      rows extracted                ← parser guardian
 *   4 STORE      raw → snapshots → changes     ← parser guardian
 *   5 MATCH      policies linked to clients    ← matching agent
 *   6 RECONCILE  commissions → policies → discrepancies ← commission reconciler
 *   7 ANALYSE    the agency's day              ← insights analyst
 *
 * Stages run in order per file; different files run side by side. A failure stops that file at that
 * stage and leaves every earlier stage's output in place. Every stage is idempotent, and a file
 * that stopped is resumed by the next run after its last completed stage. Nothing here relies on a
 * stage running only once: the database's unique keys are what make a second run harmless.
 *
 * Pure (no I/O of its own).
 */

export const STAGES = ["collect", "ingest", "parse", "store", "match", "reconcile", "analyse"] as const;
export type Stage = (typeof STAGES)[number];
export const FILE_STAGES = ["collect", "ingest", "parse", "store", "match", "reconcile"] as const satisfies readonly Stage[];
export type FileStage = (typeof FILE_STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = { collect: "Collect", ingest: "Ingest", parse: "Parse", store: "Store", match: "Match", reconcile: "Reconcile", analyse: "Analyse" };

export type Trigger = "scheduled" | "manual" | "file_arrival" | "reprocess";
export type StageStatus = "succeeded" | "skipped" | "blocked" | "failed";
export type StageResult = { status: StageStatus; rowsIn?: number | null; rowsOut?: number | null; error?: string | null; note?: string | null; findings?: number };

export type PendingFile = {
  tenantId: string;
  fileId: string;
  fileType: string;
  /** Registered by this run's collect (or by the door that started it). */
  arrivedThisRun: boolean;
  /** Already parsed (status parsed) before this run. */
  parsed: boolean;
  /** Stages that succeeded for this file since it was last parsed, in earlier runs. */
  completed: FileStage[];
};

export type Passed = Array<{ rowNumber: number; values: Record<string, string | number | null> }>;

export type RunDeps = {
  now(): number;
  /** Runs that died mid-way are marked failed; their files are simply pending again. */
  recoverInterrupted(): Promise<number>;
  /** The bucket door: drops registered since the last run. */
  collect(): Promise<Array<{ tenantId: string; fileId: string }>>;
  pending(filter: { tenantId?: string; fileIds?: string[]; arrived: Set<string> }): Promise<PendingFile[]>;
  startRun(tenantId: string, trigger: Trigger): Promise<string>;
  finishRun(runId: string, summary: { status: RunStatus; total: number; succeeded: number; failed: number; error?: string | null }): Promise<void>;
  startStage(runId: string, tenantId: string, fileId: string | null, stage: Stage): Promise<string>;
  finishStage(stageRunId: string, result: StageResult): Promise<void>;
  parse(file: PendingFile): Promise<{ result: StageResult; passed: Passed | null }>;
  store(file: PendingFile, passed: Passed): Promise<StageResult>;
  match(file: PendingFile): Promise<StageResult>;
  reconcile(file: PendingFile, passed: Passed): Promise<StageResult>;
  complete(file: PendingFile): Promise<void>;
  analyse(tenantId: string, runId: string): Promise<StageResult>;
};

export type RunStatus = "succeeded" | "partial" | "failed";
export type RunSummary = { runId: string; tenantId: string; status: RunStatus; total: number; succeeded: number; failed: number; leftForNextRun: number };

/** Succeeded when every file went through; partial when some stopped; failed when none got through. */
export function runStatus(succeeded: number, failed: number): RunStatus {
  if (failed === 0) return "succeeded";
  return succeeded === 0 ? "failed" : "partial";
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2000);

/** One file through its stages. Returns whether it finished. */
async function runFile(deps: RunDeps, runId: string, file: PendingFile): Promise<boolean> {
  const done = new Set(file.completed);
  const record = async (stage: Stage, work: () => Promise<StageResult>): Promise<StageResult> => {
    const id = await deps.startStage(runId, file.tenantId, file.fileId, stage);
    let result: StageResult;
    try {
      result = await work();
    } catch (error) {
      result = { status: "failed", error: message(error) };
    }
    if ((result.status === "failed" || result.status === "blocked") && !result.error) result = { ...result, error: "The stage stopped without saying why." };
    await deps.finishStage(id, result);
    return result;
  };
  const stopAfter = async (from: FileStage, reason: string) => {
    for (const stage of FILE_STAGES.slice(FILE_STAGES.indexOf(from) + 1)) await record(stage, async () => ({ status: "skipped", note: `Not run: ${reason}` }));
  };

  await record("collect", async () => (file.arrivedThisRun ? { status: "succeeded", rowsOut: 1, note: "Detected in this run" } : { status: "skipped", note: "Arrived before this run" }));
  await record("ingest", async () => (file.arrivedThisRun ? { status: "succeeded", rowsOut: 1, note: "Registered and hashed; a duplicate is skipped at the door" } : { status: "skipped", note: "Registered before this run" }));

  const policyFile = file.fileType === "policies";
  const ledgerFile = file.fileType === "commissions";
  const needsRows = (!done.has("store") && policyFile) || (!done.has("reconcile") && (policyFile || ledgerFile));
  let passed = null as Passed | null;
  if (file.parsed && !needsRows) {
    await record("parse", async () => ({ status: "skipped", note: "Parsed in an earlier run" }));
  } else {
    const parse = await record("parse", async () => {
      const out = await deps.parse(file);
      passed = out.passed;
      return file.parsed && out.result.status === "succeeded" ? { ...out.result, note: out.result.note ?? "Read again from its raw rows, to resume" } : out.result;
    });
    if (parse.status === "failed" || parse.status === "blocked") { await stopAfter("parse", parse.status === "blocked" ? "the parse is blocked" : "the parse failed"); return false; }
    if (!policyFile && !ledgerFile) { await stopAfter("parse", "nothing is derived from this kind of file"); return true; }
  }
  const rows = passed ?? [];

  const store = done.has("store") ? await record("store", async () => ({ status: "skipped", note: "Done in an earlier run" }))
    : policyFile ? await record("store", () => deps.store(file, rows))
    : await record("store", async () => ({ status: "skipped", note: "A commission file has no snapshots; its lines are the ledger's (Reconcile)" }));
  if (store.status === "failed" || store.status === "blocked") { await stopAfter("store", "the store stage stopped"); return false; }

  const match = done.has("match") ? await record("match", async () => ({ status: "skipped", note: "Done in an earlier run" }))
    : policyFile ? await record("match", () => deps.match(file))
    : await record("match", async () => ({ status: "skipped", note: "Commission lines belong to their policy by carrier and number" }));
  if (match.status === "failed" || match.status === "blocked") { await stopAfter("match", "matching stopped"); return false; }

  const reconcile = done.has("reconcile") ? await record("reconcile", async () => ({ status: "skipped", note: "Done in an earlier run" })) : await record("reconcile", () => deps.reconcile(file, rows));
  if (reconcile.status === "failed" || reconcile.status === "blocked") return false;

  await deps.complete(file);
  return true;
}

/**
 * One run: collect, then every pending file (side by side, `concurrency` at a time) until the
 * deadline, then ANALYSE once per agency. Files not started before the deadline stay pending for the
 * next run; a file already started is finished.
 */
export async function runPipeline(deps: RunDeps, input: { trigger: Trigger; tenantId?: string; fileIds?: string[]; deadline: number; concurrency: number }): Promise<RunSummary[]> {
  await deps.recoverInterrupted();
  const arrivals = input.fileIds ? input.fileIds.map((fileId) => ({ tenantId: input.tenantId ?? "", fileId })) : await deps.collect();
  const files = await deps.pending({ tenantId: input.tenantId, fileIds: input.fileIds, arrived: new Set(arrivals.map((a) => a.fileId)) });

  const byTenant = new Map<string, PendingFile[]>();
  for (const file of files) byTenant.set(file.tenantId, [...(byTenant.get(file.tenantId) ?? []), file]);
  if (input.trigger === "manual" && input.tenantId && !byTenant.has(input.tenantId)) byTenant.set(input.tenantId, []);

  const runs = new Map<string, { runId: string; total: number; succeeded: number; failed: number; left: number }>();
  for (const tenantId of byTenant.keys()) runs.set(tenantId, { runId: await deps.startRun(tenantId, input.trigger), total: 0, succeeded: 0, failed: 0, left: 0 });

  const queue = [...byTenant.values()].flat();
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const run = runs.get(file.tenantId)!;
      if (deps.now() >= input.deadline) { run.left++; continue; }
      run.total++;
      let finished = false;
      try {
        finished = await runFile(deps, run.runId, file);
      } catch (error) {
        console.error("[daily-run]", file.fileId, error);
      }
      if (finished) run.succeeded++;
      else run.failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, input.concurrency) }, worker));

  const out: RunSummary[] = [];
  for (const [tenantId, run] of runs) {
    const analyse = await deps.startStage(run.runId, tenantId, null, "analyse");
    let result: StageResult;
    try {
      result = await deps.analyse(tenantId, run.runId);
    } catch (error) {
      result = { status: "failed", error: message(error) };
    }
    await deps.finishStage(analyse, result);
    const status = runStatus(run.succeeded, run.failed);
    await deps.finishRun(run.runId, { status, total: run.total, succeeded: run.succeeded, failed: run.failed, error: run.left ? `${run.left} ${run.left === 1 ? "file was" : "files were"} left for the next run (time ran out).` : null });
    out.push({ runId: run.runId, tenantId, status, total: run.total, succeeded: run.succeeded, failed: run.failed, leftForNextRun: run.left });
  }
  return out;
}
