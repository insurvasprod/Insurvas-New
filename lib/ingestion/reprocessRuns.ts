import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { parseCarrierFile } from "./parser";
import { readRawRows } from "./rawLayer";
import { reprocess, type ReprocessDeps, type ReprocessFile, type ReprocessResult, type ReprocessScope, type ReprocessTrigger } from "./reprocess";
import { REPROCESS_STAGES } from "./stages";

export { REPROCESS_STAGES };

/**
 * LA-4.2 / 4.3 (Notion sprint) · reprocess runs, server side: the files in scope, their raw rows,
 * a fresh parse with each file's CURRENT layout map (so a newer map version reads what an older one
 * ignored, with nothing uploaded again), then every downstream stage, and the run's record.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

function reprocessDeps(): ReprocessDeps {
  return {
    stages: REPROCESS_STAGES,
    async resolveFiles(tenantId: string, scope: ReprocessScope): Promise<ReprocessFile[]> {
      let query = db().from("file_registry").select("id, carrier_id, file_type, file_date, parser_version, row_count").eq("tenant_id", tenantId).not("raw_extracted_at", "is", null);
      query = scope.kind === "file"
        ? query.eq("id", scope.fileId)
        : query.eq("carrier_id", scope.carrierId).gte("file_date", scope.from).lte("file_date", scope.to).is("superseded_by_file_id", null);
      const { data, error } = await query.order("file_date").order("received_at");
      if (error) throw new Error(`Could not find the files to reprocess: ${error.message}`);
      return (data ?? []).map((row: Loose) => ({ id: row.id, carrierId: row.carrier_id, fileType: row.file_type, fileDate: row.file_date, parserVersion: row.parser_version, rowCount: row.row_count }));
    },
    readRows: (tenantId, file) => readRawRows(tenantId, file.id),
    async parse(tenantId, file, rows) {
      const outcome = await parseCarrierFile(tenantId, file.id, rows);
      if (outcome.outcome === "parsed") return { parserVersion: outcome.version, typedRows: outcome.passed, fatal: null };
      if (outcome.outcome === "failed") return { parserVersion: outcome.version, typedRows: null, fatal: outcome.reason };
      return { parserVersion: null, typedRows: null, fatal: outcome.outcome === "no_layout_map" ? "No layout map for this carrier and file type." : outcome.outcome };
    },
    async startRun({ tenantId, trigger, triggeredBy, scope, parserVersion }) {
      const { data, error } = await db().from("reprocess_runs").insert({ tenant_id: tenantId, trigger, triggered_by: triggeredBy, scope, parser_version: parserVersion }).select("id").single();
      if (error) throw new Error(`The reprocess could not be recorded: ${error.message}`);
      return data.id as string;
    },
    async finishRun(runId, result) {
      const { error } = await db().from("reprocess_runs").update({
        status: result.status,
        parser_version: result.parserVersion,
        file_ids: result.fileIds,
        rows_read: result.rowsRead,
        rows_changed: result.rowsChanged,
        stages: result.stages,
        error_detail: result.errorDetail,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);
      if (error) throw new Error(`The reprocess result could not be recorded: ${error.message}`);
    },
  };
}

export type ReprocessRunRow = {
  id: string;
  trigger: ReprocessTrigger;
  scope: ReprocessScope;
  parserVersion: string | null;
  fileCount: number;
  rowsRead: number;
  rowsChanged: number;
  status: "running" | "succeeded" | "failed";
  errorDetail: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export async function listReprocessRuns(tenantId: string, limit = 50): Promise<{ available: boolean; runs: ReprocessRunRow[] }> {
  const { data, error } = await db().from("reprocess_runs").select("id, trigger, scope, parser_version, file_ids, rows_read, rows_changed, status, error_detail, started_at, finished_at").eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(limit);
  if (error) {
    if (isSchemaGap(error)) return { available: false, runs: [] };
    throw new Error(`Could not load reprocess runs: ${error.message}`);
  }
  return {
    available: true,
    runs: (data ?? []).map((row: Loose) => ({ id: row.id, trigger: row.trigger, scope: row.scope, parserVersion: row.parser_version, fileCount: (row.file_ids ?? []).length, rowsRead: row.rows_read, rowsChanged: row.rows_changed, status: row.status, errorDetail: row.error_detail, startedAt: row.started_at, finishedAt: row.finished_at })),
  };
}

export async function reprocessCarrierFiles(tenantId: string, triggeredBy: string | null, scope: ReprocessScope, trigger: ReprocessTrigger = "manual"): Promise<ReprocessResult> {
  return reprocess(reprocessDeps(), { tenantId, scope, trigger, triggeredBy });
}
