"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { STAGE_LABELS } from "@/lib/ingestion/dailyRun";
import type { RunRow, StageRow } from "@/lib/ingestion/dailyRunStore";

const RUN_TONE: Record<string, StatusTone> = { succeeded: "good", partial: "warning", failed: "danger", running: "info" };
const STEP_TONE: Record<string, StatusTone> = { skipped: "neutral", blocked: "warning", failed: "danger", running: "info" };
const STEP_WORD: Record<string, string> = { skipped: "Not run", blocked: "Held", failed: "Failed", running: "Running" };
const TRIGGER_WORD: Record<string, string> = { file_arrival: "Files arrived", scheduled: "Scheduled", manual: "Run by hand", reprocess: "Read again" };
const PAGE = 10;

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const took = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const n = (value: number) => value.toLocaleString("en-US");

type Step = { key: string; name: string; inner: string; stage: StageRow; rows: string };

/**
 * The run's steps in the stage bar's words (round 4, owner 2026-11-02: "is this a good representation of the data
 * inside?"): Collect and Ingest are the file arriving (Uploaded), Parse reads it (Read), Store writes its History,
 * Match links it (Linked), Reconcile moves cards (Pipeline) or posts lines (Commissions); then the day's analysis.
 * The pipeline's own name stays in the tooltip.
 */
function stepsOf(file: RunRow["files"][number] | undefined, analyse: StageRow | null, fileType: string | null): Step[] {
  const by = new Map((file?.stages ?? []).map((s) => [s.stage, s]));
  const rows = (s: StageRow) => (s.rowsIn === null && s.rowsOut === null ? "—" : s.rowsIn === null ? n(s.rowsOut ?? 0) : `${n(s.rowsIn)} → ${s.rowsOut === null ? "—" : n(s.rowsOut)}`);
  const out: Step[] = [];
  const collect = by.get("collect");
  const ingest = by.get("ingest");
  if (collect || ingest) {
    // Arriving is one step to a person: the worse of the two, its time the sum.
    const worst = [ingest, collect].find((s) => s && s.status !== "succeeded") ?? ingest ?? collect!;
    const ms = (collect?.ms ?? 0) + (ingest?.ms ?? 0);
    out.push({ key: "uploaded", name: "Uploaded", inner: "Collect and Ingest", stage: { ...worst, ms: collect?.ms === null && ingest?.ms === null ? null : ms, findings: (collect?.findings ?? 0) + (ingest?.findings ?? 0) }, rows: "—" });
  }
  const named: Array<[string, string]> = [["parse", "Read"], ["store", "History"], ["match", "Linked"], ["reconcile", fileType === "commissions" ? "Commissions" : "Pipeline"]];
  for (const [key, name] of named) {
    const stage = by.get(key);
    if (stage) out.push({ key, name, inner: STAGE_LABELS[key as keyof typeof STAGE_LABELS], stage, rows: rows(stage) });
  }
  if (analyse) out.push({ key: "analyse", name: "The day’s analysis", inner: "Analyse", stage: analyse, rows: "—" });
  return out;
}

/**
 * Book of business › Files › a file › Run history (round 4): every time the system read this file. Each run is one
 * line (when, why, its result, how long); open it for its steps, one row each with the rows it took in and gave
 * out, how long it took and what it found. A step that worked shows a tick; only one that didn't says why. The
 * newest run is open. Reads only; Read again is in the page header.
 */
export function FileRuns({ runs, available, fileId, fileType }: { runs: RunRow[]; available: boolean; fileId: string; fileType: string | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(runs[0] ? [runs[0].id] : []));
  const [page, setPage] = useState(1);
  const shown = paginate(runs, page, PAGE);
  const toggle = (id: string) => setOpen((now) => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <TableCard
      toolbar={<DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>{null}</DataToolbar>}
      footer={available && runs.length > PAGE ? <Pager page={shown.current} pageSize={PAGE} total={runs.length} noun="runs" onPage={setPage} /> : undefined}
    >
      {!available ? <EmptyState title="Run history isn't available yet" hint="It appears once the database update (20261008280000) is applied." />
        : runs.length === 0 ? <EmptyState title="Not read by a run yet" hint="A run starts when a file arrives, every five minutes for anything waiting, or with Read again." />
        : (
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr>
                <th>Step</th>
                <th className="text-right">Rows in → out</th>
                <th className="text-right">Took</th>
                <th className="text-right">Found</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((run) => {
                const isOpen = open.has(run.id);
                const steps = stepsOf(run.files.find((f) => f.fileId === fileId) ?? run.files[0], run.analyse, fileType);
                const ms = run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null;
                return (
                  <Fragment key={run.id}>
                    <tr className="bg-[var(--surface-alt)]">
                      <td colSpan={2}>
                        <button type="button" aria-expanded={isOpen} onClick={() => toggle(run.id)} className="inline-flex items-center gap-2 whitespace-nowrap text-left font-medium text-foreground hover:underline">
                          {isOpen ? <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" /> : <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />}
                          {when(run.startedAt)}
                          <span className="font-normal">· {TRIGGER_WORD[run.trigger] ?? run.trigger}</span>
                        </button>
                      </td>
                      <td className="text-right tabular-nums text-foreground">{run.status === "running" ? "…" : took(ms)}</td>
                      <td className="text-right tabular-nums text-foreground">{steps.reduce((sum, s) => sum + (s.stage.findings ?? 0), 0) || "—"}</td>
                      <td>
                        {/* One line, one chip (owner 2026-11-11): the run's error is the chip's tooltip. */}
                        <StatusChip tone={RUN_TONE[run.status] ?? "neutral"} title={run.error ?? undefined}>{run.status === "running" ? "Running" : run.status[0].toUpperCase() + run.status.slice(1)}</StatusChip>
                      </td>
                    </tr>
                    {isOpen && steps.map((step) => {
                      const s = step.stage;
                      const ok = s.status === "succeeded";
                      const why = s.error ?? s.note ?? "";
                      return (
                        <tr key={`${run.id}:${step.key}`}>
                          <td className="whitespace-nowrap pl-10 text-foreground" title={`${step.inner} in the pipeline`}>{step.name}</td>
                          <td className="text-right tabular-nums text-foreground">{step.rows}</td>
                          <td className="text-right tabular-nums">{took(s.ms)}</td>
                          <td className="text-right tabular-nums text-foreground">{s.findings || "—"}</td>
                          <td>
                            {/* A step that worked is a plain tick; one that didn't says so in its chip, the reason its tooltip. */}
                            {ok ? <span title={why || undefined} className="inline-flex items-center gap-1.5 text-muted-foreground"><Check aria-hidden="true" className="size-4" /><span className="sr-only">Succeeded</span></span>
                              : <StatusChip tone={STEP_TONE[s.status] ?? "neutral"} title={why || undefined}>{STEP_WORD[s.status] ?? s.status}</StatusChip>}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
    </TableCard>
  );
}
