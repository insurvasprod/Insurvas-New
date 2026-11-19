"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { HEALTH_CHIP, ago } from "@/lib/adminDashboard/healthJobs";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { answerLabel, isRunnableSlug, jobSlugOf, type JobDetail } from "@/lib/adminMonitoring/jobsView";
import { formatUtc } from "@/lib/audit/logView";
import { cn } from "@/lib/utils";

type Calls = {
  calls: Array<{ at: string; skippedReason: string | null }>;
  latest: { at: string | null; httpStatus: number | null; timedOut: boolean | null; skippedReason: string | null; excerpt: string | null } | null;
};
type RunResult = { ok: boolean; status: number; ms: number; excerpt: string } | { error: string };

const H = "m-0 text-sm font-semibold text-foreground";
const DOT: Record<JobDetail["status"], string> = {
  failing: "bg-[var(--error)]",
  look: "bg-[var(--warning)]",
  unknown: "bg-muted-foreground",
  not_watched: "bg-muted-foreground",
  working: "bg-[var(--success)]",
};

function seconds(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * One job or service as a right sheet (admin round 1, docs/design/admin-r1/monitoring.html screen 6): what it does,
 * its schedule, the plain-words reason for its status, the database's recent calls with the answer to the latest
 * (GET /api/admin/monitoring/jobs/[key]), how to fix it, the page that deals with it, and — for an app job, to a
 * super admin — "Run now": asks first, then runs the job once through POST …/[key]/run and shows its answer here.
 */
export function JobsSheet({ job, role, canRun, now, onClose }: {
  job: JobDetail;
  role: AdminRole;
  /** Super admin: Run now is offered on app jobs. */
  canRun: boolean;
  /** The server's clock when the list was read. */
  now: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const slug = job.path ? jobSlugOf(job.path) : null;
  const runnable = Boolean(canRun && slug && isRunnableSlug(slug));
  const href = job.href && canOpenAdminHref(role, job.href) ? job.href : null;
  const chip = HEALTH_CHIP[job.status];

  const [calls, setCalls] = useState<Calls | null | "failed">(null);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    if (!slug) return;
    const controller = new AbortController();
    fetch(`/api/admin/monitoring/jobs/${slug}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setCalls((await res.json()) as Calls);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCalls("failed");
      });
    return () => controller.abort();
  }, [slug]);

  async function run() {
    if (!slug) return;
    setRunning(true);
    const res = await fetch(`/api/admin/monitoring/jobs/${slug}/run`, { method: "POST" }).catch(() => null);
    const body = res ? ((await res.json().catch(() => null)) as RunResult | null) : null;
    setRunning(false);
    setConfirming(false);
    if (!res) setResult({ error: "The app could not be reached, so the job was not run. Try again." });
    else if (!body) setResult({ error: `The run answered ${res.status} with nothing readable.` });
    else setResult(body);
    if (res?.ok) router.refresh();
  }

  return (
    <>
      <Sheet
        title={job.name}
        subtitle={[job.path, job.schedule?.words].filter(Boolean).join(" · ") || job.shouldRun}
        status={<StatusChip tone={chip.tone} dot>{chip.label}</StatusChip>}
        onClose={onClose}
        footer={<>
          {runnable && (
            <Button type="button" variant="outline" onClick={() => setConfirming(true)} disabled={running}>
              {running ? "Running…" : "Run now"}
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </>}
      >
        <p className="m-0 flex items-start gap-2 text-sm text-foreground" role="status">
          <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT[job.status])} aria-hidden="true" />
          <span>{job.reason}</span>
        </p>

        {result && (
          <section className="flex flex-col gap-1.5 rounded-md border border-border p-3" aria-live="polite">
            <h3 className={H}>Run now</h3>
            {"error" in result ? (
              <p className="m-0 text-sm text-[var(--error-ink)]">{result.error}</p>
            ) : (
              <>
                <p className="m-0 flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <StatusChip tone={result.ok ? "good" : "danger"} dot>{result.ok ? `Worked · ${result.status}` : `Failed · ${result.status}`}</StatusChip>
                  <span className="text-muted-foreground">took {seconds(result.ms)} · recorded in the audit log</span>
                </p>
                {result.excerpt && <pre className="m-0 max-h-40 overflow-auto rounded bg-[var(--surface-alt)] p-2 text-xs text-foreground">{result.excerpt}</pre>}
              </>
            )}
          </section>
        )}

        <FactTable
          rows={[
            ["What it does", job.does],
            ["Should run", job.shouldRun],
            ["Schedule", job.schedule ? <span key="s">{job.schedule.words} <code className="font-mono text-xs text-muted-foreground">{job.schedule.cron}</code></span> : "—"],
            ["Last worked", job.lastWorked],
            ...(job.path ? [["Route", <code key="p" className="font-mono text-xs break-all">{job.path}</code>] as [string, ReactNode]] : []),
          ]}
        />

        {job.fix && (
          <section className="flex flex-col gap-1.5">
            <h3 className={H}>How to fix</h3>
            <p className="m-0 text-sm leading-[1.5] text-foreground">{job.fix}</p>
          </section>
        )}

        {job.dbRun && (
          <section className="flex flex-col gap-2">
            <h3 className={H}>Last run in the database</h3>
            <FactTable
              rows={[
                ["Started", job.dbRun.lastStartAt ? formatUtc(job.dbRun.lastStartAt) : "None in the last week"],
                ["Result", job.dbRun.lastStatus ?? "—"],
                ["Message", <span key="m" className="break-words [overflow-wrap:anywhere]">{job.dbRun.lastMessage || "—"}</span>],
                ["Switched on", job.dbRun.active ? "Yes" : "No"],
              ]}
            />
          </section>
        )}

        {slug && (
          <section className="flex flex-col gap-2">
            <h3 className={H}>Recent calls</h3>
            {calls === null ? (
              <SectionLoading rows={4} columns={2} label="Loading recent calls" />
            ) : calls === "failed" ? (
              <EmptyState title="The calls could not be read" hint="Close and open the job again; the list beside it is still current." />
            ) : calls.calls.length === 0 ? (
              <EmptyState title="No call on record" hint="The database has not called this job. Its schedule is set by migration 20261015500000." />
            ) : (
              <>
                <div className="rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-3">Called (UTC)</TableHead>
                        <TableHead className="pr-3">Answer</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calls.calls.map((call, index) => {
                        const latest = index === 0 && calls.latest && calls.latest.at === call.at ? calls.latest : null;
                        const answer = answerLabel(latest ?? { httpStatus: null, timedOut: null, skippedReason: call.skippedReason });
                        return (
                          <TableRow key={`${call.at}-${index}`}>
                            <TableCell className="pl-3 tabular-nums" title={ago(call.at, now)}>{formatUtc(call.at)}</TableCell>
                            <TableCell className="pr-3" title={call.skippedReason ?? undefined}><StatusChip tone={answer.tone}>{answer.text}</StatusChip></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <p className="m-0 text-xs text-muted-foreground">The database keeps the answer to the latest call only, for about six hours.</p>
                {calls.latest?.excerpt && (
                  <pre className="m-0 max-h-32 overflow-auto rounded bg-[var(--surface-alt)] p-2 text-xs text-foreground">{calls.latest.excerpt}</pre>
                )}
              </>
            )}
          </section>
        )}

        {href && (
          <p className="m-0 text-sm">
            <Link href={href} className="font-medium text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]">Open the page that deals with it</Link>
          </p>
        )}
      </Sheet>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={run}
        busy={running}
        destructive={false}
        title={`Run ${job.name} now?`}
        description={`Calls ${job.path} once, now, with the app's own job password, as the database would. It does the job's real work (sends what is due, writes what is due); every job is safe to run twice. Recorded in the audit log.`}
        confirmLabel={running ? "Running…" : "Run now"}
        cancelLabel="Not now"
      />
    </>
  );
}
