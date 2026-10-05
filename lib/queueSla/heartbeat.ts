export type SlaHeartbeat = {
  healthy: boolean;
  reason: "ok" | "never_run" | "stale" | "last_run_failed";
  lastRunAt: string | null;
  ageSeconds: number | null;
  lastReport: unknown;
};

type HeartbeatRow = { action: string; metadata: unknown; created_at: string };

export function heartbeatState(row: HeartbeatRow | null, nowMs: number, maxAgeSeconds: number): SlaHeartbeat {
  if (!row) return { healthy: false, reason: "never_run", lastRunAt: null, ageSeconds: null, lastReport: null };
  const runMs = Date.parse(row.created_at);
  const ageSeconds = Number.isFinite(runMs) ? Math.max(0, Math.floor((nowMs - runMs) / 1000)) : Number.POSITIVE_INFINITY;
  if (row.action === "system.unclaimed_sla_run_failed") return { healthy: false, reason: "last_run_failed", lastRunAt: row.created_at, ageSeconds, lastReport: row.metadata };
  if (ageSeconds > maxAgeSeconds) return { healthy: false, reason: "stale", lastRunAt: row.created_at, ageSeconds, lastReport: row.metadata };
  return { healthy: true, reason: "ok", lastRunAt: row.created_at, ageSeconds, lastReport: row.metadata };
}

/** pg_cron's run row (unclaimed_sla_job_runs, source 'database', 20260925709910) as a heartbeat row. */
export function databaseHeartbeatRow(run: { ok: boolean; report: unknown; error: string | null; started_at: string; finished_at: string | null } | null): HeartbeatRow | null {
  if (!run) return null;
  return {
    action: run.ok ? "system.unclaimed_sla_run_succeeded" : "system.unclaimed_sla_run_failed",
    metadata: { source: "database", report: run.report, error: run.error },
    created_at: run.finished_at ?? run.started_at,
  };
}
