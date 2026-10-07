/**
 * LA-4.2 (Notion sprint) · reprocessing: rebuild every layer above the raw rows, from the raw rows.
 *
 * reprocess(one file) or reprocess(one carrier, from a date, to a date) reads the files' raw rows
 * and hands them to each downstream stage in order — LA-4.6's snapshots and change log, then
 * LA-4.7's current state — which rewrite what they derive for exactly those files. Nothing is
 * uploaded again; the raw rows never change. A stage must be idempotent: running the same
 * reprocess twice changes nothing the second time.
 *
 * Every run is recorded (reprocess_runs): who or what triggered it, its scope, the parser version
 * it ran, the files, the rows read and the rows each stage changed. It never writes commission
 * entries directly — a commission reprocess writes corrections as new entries (LA-4.12).
 *
 * Until LA-4.6 registers a stage, a reprocess reads and counts and changes nothing, and says so.
 * Dependencies are injected; relative imports only.
 */

export type ReprocessTrigger = "manual" | "parser_update" | "status_map_approval" | "reissue" | "scheduled";

export type ReprocessScope =
  | { kind: "file"; fileId: string }
  | { kind: "carrier"; carrierId: string; from: string; to: string };

export type ReprocessFile = { id: string; carrierId: string | null; fileType: string | null; fileDate: string | null; parserVersion: number | null; rowCount: number };

export type ReprocessRow = { rowNumber: number; payload: Record<string, string> };

export type ReprocessStage = {
  /** e.g. "policy_snapshot" (LA-4.6), "policy_current" (LA-4.7). */
  name: string;
  /** Rewrites what this stage derives from one file's raw rows; returns how many of its rows changed. */
  rebuild(tenantId: string, file: ReprocessFile, rows: ReprocessRow[]): Promise<{ changed: number }>;
};

export type StageSummary = { name: string; files: number; changed: number };

export type ReprocessResult = {
  runId: string;
  status: "succeeded" | "failed";
  fileIds: string[];
  rowsRead: number;
  rowsChanged: number;
  stages: StageSummary[];
  errorDetail: string | null;
};

export type ReprocessDeps = {
  stages: ReprocessStage[];
  /** The files in scope whose raw rows exist, oldest file date first (so a later file wins). */
  resolveFiles(tenantId: string, scope: ReprocessScope): Promise<ReprocessFile[]>;
  readRows(tenantId: string, file: ReprocessFile): Promise<ReprocessRow[]>;
  startRun(input: { tenantId: string; trigger: ReprocessTrigger; triggeredBy: string | null; scope: ReprocessScope; parserVersion: string | null }): Promise<string>;
  finishRun(runId: string, result: Omit<ReprocessResult, "runId">): Promise<void>;
};

/** The parser version a run records: the newest any of its files was read with, or none yet (LA-4.3). */
export function runParserVersion(files: ReprocessFile[]): string | null {
  const versions = files.map((file) => file.parserVersion).filter((version): version is number => version !== null);
  return versions.length ? String(Math.max(...versions)) : null;
}

export async function reprocess(
  deps: ReprocessDeps,
  input: { tenantId: string; scope: ReprocessScope; trigger: ReprocessTrigger; triggeredBy: string | null },
): Promise<ReprocessResult> {
  const files = await deps.resolveFiles(input.tenantId, input.scope);
  const runId = await deps.startRun({ tenantId: input.tenantId, trigger: input.trigger, triggeredBy: input.triggeredBy, scope: input.scope, parserVersion: runParserVersion(files) });
  const stages: StageSummary[] = deps.stages.map((stage) => ({ name: stage.name, files: 0, changed: 0 }));
  let rowsRead = 0;
  try {
    for (const file of files) {
      const rows = await deps.readRows(input.tenantId, file);
      if (rows.length !== file.rowCount) throw new Error(`File ${file.id} has ${rows.length} raw rows, but its registry row says ${file.rowCount}.`);
      rowsRead += rows.length;
      for (const [index, stage] of deps.stages.entries()) {
        const { changed } = await stage.rebuild(input.tenantId, file, rows);
        stages[index].files += 1;
        stages[index].changed += changed;
      }
    }
    const result = { status: "succeeded" as const, fileIds: files.map((file) => file.id), rowsRead, rowsChanged: stages.reduce((sum, stage) => sum + stage.changed, 0), stages, errorDetail: null };
    await deps.finishRun(runId, result);
    return { runId, ...result };
  } catch (error) {
    const result = { status: "failed" as const, fileIds: files.map((file) => file.id), rowsRead, rowsChanged: stages.reduce((sum, stage) => sum + stage.changed, 0), stages, errorDetail: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
    await deps.finishRun(runId, result);
    return { runId, ...result };
  }
}
