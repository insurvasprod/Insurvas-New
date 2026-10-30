"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { AGENT_INFO, AGENTS, type AgentName } from "@/lib/ingestion/agents";
import { FILE_STAGES, STAGE_LABELS } from "@/lib/ingestion/dailyRun";
import type { FindingRow, RunRow, StageRow } from "@/lib/ingestion/dailyRunStore";
import { notify } from "@/lib/notify";

/**
 * LA-4.19 (Notion sprint) · Carrier files › Runs and › Agent findings. A run lists each file with
 * its six stages (and the day's Analyse); a stage that stopped says why. Findings are what the
 * agents raised; a person marks each right or wrong, which is how every agent's accuracy is kept.
 */

const RUN_TONE: Record<string, StatusTone> = { succeeded: "good", partial: "warning", failed: "danger", running: "info" };
const STAGE_TONE: Record<string, StatusTone> = { succeeded: "good", skipped: "neutral", blocked: "warning", failed: "danger", running: "info" };
const SEVERITY_TONE: Record<string, StatusTone> = { blocking: "danger", warning: "warning", info: "neutral" };
const STATUS_WORD: Record<string, string> = { open: "Open", approved: "Marked right", rejected: "Marked wrong", auto_resolved: "Resolved itself" };
const TRIGGER_WORD: Record<string, string> = { file_arrival: "Files arrived", scheduled: "Scheduled", manual: "Run by hand", reprocess: "Reprocess" };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const duration = (ms: number | null) => (ms === null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/app/carrier-files/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as { error?: string; run?: { status: string; total: number } };
  if (!response.ok) throw new Error(data.error ?? "That could not be done.");
  return data;
}

function StageChip({ stage }: { stage: StageRow }) {
  const label = `${STAGE_LABELS[stage.stage as keyof typeof STAGE_LABELS] ?? stage.stage}: ${stage.status}`;
  const title = [stage.error, stage.note, stage.rowsIn !== null || stage.rowsOut !== null ? `rows ${stage.rowsIn ?? "—"} → ${stage.rowsOut ?? "—"}` : null, duration(stage.ms), stage.findings ? `${stage.findings} finding${stage.findings === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  return <span title={title || undefined}><StatusChip tone={STAGE_TONE[stage.status] ?? "neutral"}>{label}</StatusChip></span>;
}

export function PipelineRuns({ runs, available, canRun }: { runs: RunRow[]; available: boolean; canRun: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(runs[0]?.id ?? null);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  const shown = paginate(runs, page, pageSize);

  async function runNow() {
    setBusy(true);
    try {
      const data = await post({ action: "run_now" });
      notify.done(data.run?.total ? `Run finished: ${data.run.total} ${data.run.total === 1 ? "file" : "files"}, ${data.run.status}.` : "Run finished: no file was waiting.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The run could not start.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<>
          {canRun && available && <Button type="button" variant="outline" disabled={busy} onClick={() => void runNow()}>{busy ? "Running…" : "Run now"}</Button>}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <span className="text-sm text-muted-foreground">Each file goes through {FILE_STAGES.map((s) => STAGE_LABELS[s]).join(", ")}, then the day is analysed</span>
        </DataToolbar>
      }
      footer={available && runs.length ? <Pager page={shown.current} pageSize={pageSize} total={runs.length} noun="runs" onPage={setPage} /> : undefined}
    >
      {!available ? <EmptyState title="Run history isn't available yet" hint="It appears once the database update (20261008280000) is applied." />
        : runs.length === 0 ? <EmptyState title="No run yet" hint="A run starts when a file arrives, every five minutes for anything waiting, or with Run now." />
        : (
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead><tr><th className="w-[170px]">Started</th><th className="w-[140px]">Why</th><th className="w-[120px]">Result</th><th className="w-[160px] text-right">Files</th><th>Notes</th></tr></thead>
            <tbody>
              {shown.rows.map((run) => (
                <Fragment key={run.id}>
                  <tr>
                    <td className="font-semibold text-foreground"><button type="button" className="text-left hover:underline" aria-expanded={open === run.id} onClick={() => setOpen(open === run.id ? null : run.id)}>{when(run.startedAt)}</button></td>
                    <td>{TRIGGER_WORD[run.trigger] ?? run.trigger}</td>
                    <td><StatusChip tone={RUN_TONE[run.status] ?? "neutral"}>{run.status === "running" ? "Running" : run.status[0].toUpperCase() + run.status.slice(1)}</StatusChip></td>
                    <td className="text-right tabular-nums">{run.total ? `${run.succeeded} of ${run.total} through` : "none waiting"}{run.failed ? <span className="block text-xs text-[var(--warning-ink)]">{run.failed} stopped</span> : null}</td>
                    <td className="text-xs text-muted-foreground">{run.error ?? (run.finishedAt ? `Took ${duration(Date.parse(run.finishedAt) - Date.parse(run.startedAt))}` : "")}</td>
                  </tr>
                  {open === run.id && (
                    <tr>
                      <td colSpan={5} className="bg-[var(--surface-alt)]">
                        <ul className="m-0 grid list-none gap-2 p-0 py-1">
                          {run.files.map((file) => (
                            <li key={file.fileId} className="grid gap-1">
                              <span className="text-sm font-semibold text-foreground">{file.name}</span>
                              <span className="flex flex-wrap gap-1">{file.stages.map((stage) => <StageChip key={stage.stage} stage={stage} />)}</span>
                              {file.stages.filter((s) => s.status === "failed" || s.status === "blocked").map((s) => <span key={s.stage} className="text-xs text-[var(--warning-ink)]">{STAGE_LABELS[s.stage as keyof typeof STAGE_LABELS]}: {s.error}</span>)}
                            </li>
                          ))}
                          {run.analyse && <li className="flex flex-wrap items-center gap-2"><StageChip stage={run.analyse} /><span className="text-xs text-muted-foreground">{run.analyse.note}</span></li>}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}

export function AgentFindings({ findings, accuracy, available, canReview }: { findings: FindingRow[]; accuracy: Array<{ agent: string; week: string; approved: number; rejected: number; accuracyPct: number }>; available: boolean; canReview: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const visible = useMemo(() => findings.filter((f) => (!agent || f.agent === agent) && (!status || f.status === status)), [findings, agent, status]);
  const pageSize = useFittingPageSize(420, 45);
  const shown = paginate(visible, page, pageSize);

  async function review(id: string, verdict: "approved" | "rejected") {
    setBusy(id);
    try {
      await post({ action: "review", id, verdict });
      notify.done(verdict === "approved" ? "Marked right." : "Marked wrong. It counts against the agent's accuracy.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The review could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  const clear = () => { setAgent(""); setStatus("open"); setPage(1); };
  return (
    <>
      <TableCard
        toolbar={
          <DataToolbar actions={<>{(agent || status !== "open") && <ClearFiltersButton onClick={clear} />}<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} /></>}>
            <select aria-label="Filter by agent" className={toolbarControl} value={agent} onChange={(e) => { setAgent(e.target.value); setPage(1); }}>
              <option value="">Every agent</option>
              {AGENTS.map((a) => <option key={a} value={a}>{AGENT_INFO[a].label}</option>)}
            </select>
            <select aria-label="Filter by status" className={toolbarControl} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any status</option>
              {Object.entries(STATUS_WORD).map(([key, word]) => <option key={key} value={key}>{word}</option>)}
            </select>
          </DataToolbar>
        }
        footer={available && visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="findings" onPage={setPage} /> : undefined}
      >
        {!available ? <EmptyState title="Findings aren't available yet" hint="They appear once the database update (20261008280000) is applied." />
          : findings.length === 0 ? <EmptyState title="No findings yet" hint="Agents note what they see in each run: a missing file, an unknown column, a status nobody has mapped." />
          : visible.length === 0 ? <NoMatches noun="findings" onClear={clear} />
          : (
            <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
              <thead><tr><th className="w-[160px]">Agent</th><th>What it saw</th><th className="w-[110px]">Severity</th><th className="w-[130px]">When</th><th className="w-[200px] text-right">Was it right?</th></tr></thead>
              <tbody>
                {shown.rows.map((f) => (
                  <tr key={f.id}>
                    <td><span className="block font-semibold text-foreground">{f.agentLabel}</span><span className="block text-xs text-muted-foreground">{f.modelId ? `${f.modelId} · prompt ${f.promptVersion}` : "No model: a fixed check"}</span></td>
                    <td><span className="block text-foreground">{f.reasoning}</span>{f.fileName && <span className="block text-xs text-muted-foreground">{f.fileName}</span>}{f.confidence !== null && <span className="block text-xs text-muted-foreground">Confidence {Math.round(f.confidence * 100)}%</span>}</td>
                    <td><StatusChip tone={SEVERITY_TONE[f.severity] ?? "neutral"}>{f.severity === "blocking" ? "Blocking" : f.severity === "warning" ? "Warning" : "Note"}</StatusChip></td>
                    <td className="text-xs tabular-nums">{when(f.createdAt)}</td>
                    <td className="text-right">
                      {f.status === "open" && canReview ? (
                        <span className="inline-flex gap-2">
                          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void review(f.id, "approved")}>Right</Button>
                          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void review(f.id, "rejected")}>Wrong</Button>
                        </span>
                      ) : <span className="text-xs text-muted-foreground">{STATUS_WORD[f.status] ?? f.status}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </TableCard>

      {available && accuracy.length > 0 && (
        <TableCard title="Accuracy by week" description="Of the findings people marked, how many were right. Unmarked and self-resolved findings don't count.">
          <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
            <thead><tr><th>Week of</th><th>Agent</th><th className="text-right">Right</th><th className="text-right">Wrong</th><th className="text-right">Accuracy</th></tr></thead>
            <tbody>
              {accuracy.map((a) => (
                <tr key={`${a.agent}-${a.week}`}>
                  <td className="tabular-nums">{a.week}</td>
                  <td className="font-semibold text-foreground">{AGENT_INFO[a.agent as AgentName]?.label ?? a.agent}</td>
                  <td className="text-right tabular-nums">{a.approved}</td>
                  <td className="text-right tabular-nums">{a.rejected}</td>
                  <td className="text-right font-semibold tabular-nums">{a.accuracyPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </>
  );
}
