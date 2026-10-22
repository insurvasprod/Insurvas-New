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

/** What the file's layout map read from its raw rows (LA-4.3), handed to every stage. */
export type ParsedFile = { parserVersion: number | null; typedRows: Array<{ rowNumber: number; values: Record<string, string | number | null> }> | null; fatal: string | null };

export type ReprocessStage = {
  /** e.g. "policy_snapshot" (LA-4.6), "policy_current" (LA-4.7). */
  name: string;
  /** Rewrites what this stage derives from one file; returns how many of its rows changed. */
  rebuild(tenantId: string, file: ReprocessFile, rows: ReprocessRow[], parsed: ParsedFile | null): Promise<{ changed: number }>;
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
  /** LA-4.3: re-read the raw rows with the file's current layout map, before any stage sees them. */
  parse?(tenantId: string, file: ReprocessFile, rows: ReprocessRow[]): Promise<ParsedFile>;
  startRun(input: { tenantId: string; trigger: ReprocessTrigger; triggeredBy: string | null; scope: ReprocessScope; parserVersion: string | null }): Promise<string>;
  finishRun(runId: string, result: Omit<ReprocessResult, "runId"> & { parserVersion: string | null }): Promise<void>;
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
  // A file that cannot be read with its map fails the run, and says so: its stages still run (they
  // reverse what it wrote before, LA-4.4) but the run is not reported as a success.
  const unread: string[] = [];
  const versions: Array<number | null> = files.map((file) => file.parserVersion);
  const version = () => runParserVersion(versions.map((parserVersion) => ({ parserVersion })) as ReprocessFile[]);
  try {
    for (const [position, file] of files.entries()) {
      const rows = await deps.readRows(input.tenantId, file);
      if (rows.length !== file.rowCount) throw new Error(`File ${file.id} has ${rows.length} raw rows, but its registry row says ${file.rowCount}.`);
      rowsRead += rows.length;
      const parsed = deps.parse ? await deps.parse(input.tenantId, file, rows) : null;
      if (parsed) versions[position] = parsed.parserVersion;
      if (parsed?.fatal) unread.push(`File ${file.id} could not be read: ${parsed.fatal}`);
      for (const [index, stage] of deps.stages.entries()) {
        const { changed } = await stage.rebuild(input.tenantId, file, rows, parsed);
        stages[index].files += 1;
        stages[index].changed += changed;
      }
    }
    const result = { status: unread.length ? ("failed" as const) : ("succeeded" as const), fileIds: files.map((file) => file.id), rowsRead, rowsChanged: stages.reduce((sum, stage) => sum + stage.changed, 0), stages, errorDetail: unread.length ? unread.join(" ").slice(0, 2000) : null };
    await deps.finishRun(runId, { ...result, parserVersion: version() });
    return { runId, ...result };
  } catch (error) {
    const result = { status: "failed" as const, fileIds: files.map((file) => file.id), rowsRead, rowsChanged: stages.reduce((sum, stage) => sum + stage.changed, 0), stages, errorDetail: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
    await deps.finishRun(runId, { ...result, parserVersion: version() });
    return { runId, ...result };
  }
}
