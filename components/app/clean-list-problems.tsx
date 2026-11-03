"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { MapPinOff, Play, RefreshCw, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { RefreshButton, DataToolbar } from "@/components/ui/data-toolbar";
import { LeadListScrub } from "@/components/app/lead-list-scrub";

/**
 * Clean › List problems (owner 2026-10-29: "if there is any problem that is actually causing problems
 * for the campaigns, leave it as part of review or clean"). Every list that cannot be worked as it
 * stands, one row per problem, each with its one fix in place: the scrub (the same run, confirm and
 * owner-only gate as Lists, through LeadListScrub), the screening probe after a failed run, and the
 * licence a list's off-territory leads wait on. Read from GET /api/app/lead-lists, the Lists step's
 * own report; nothing about spend is shown, so an assistant sees the same rows.
 */

export type ListProblemsAccess = {
  /** The Source step's gate (outbound_dialing, owner or producer): LeadListScrub can read the run. */
  scrubPanel: boolean;
  /** Only an owner runs, resumes or probes a scrub (POST/GET /api/app/campaigns/[id]/scrub). */
  owner: boolean;
  /** Vendor returns open for this person (lead_import + true_cpa, owner or producer). */
  claim: boolean;
  readOnly: boolean;
};

export type ListProblemRow = {
  campaignId: string;
  campaignName: string;
  vendorName: string;
  leadsReceived: number;
  scrubStatus: string;
  offTerritory: number | null;
  offTerritoryStates: number;
  claimable: number;
};

type Problem = { key: string; list: ListProblemRow; kind: "unscrubbed" | "failed" | "territory" };

/** The licensed-states step of Settings › Carriers: where Lists sends "outside your states". */
const STATES_HREF = "/app/settings#carriers/carriers-states";
const OWNER_ONLY = "Ask an owner to run the scrub — it bills screening lookups.";
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The rows a list contributes: its scrub gate first (nothing is served until it passes), then territory. */
export function listProblemsOf(lists: ListProblemRow[]): Problem[] {
  const out: Problem[] = [];
  for (const list of lists) {
    if (list.leadsReceived > 0 && list.scrubStatus !== "scrubbed")
      out.push({ key: `${list.campaignId}:scrub`, list, kind: list.scrubStatus === "failed" ? "failed" : "unscrubbed" });
    if ((list.offTerritory ?? 0) > 0) out.push({ key: `${list.campaignId}:territory`, list, kind: "territory" });
  }
  return out;
}

type Probe = { state: "checking" } | { state: "answering" } | { state: "down" } | { state: "error"; message: string };

export function CleanListProblems({ lists, error, loading, access, onReload }: {
  lists: ListProblemRow[] | null;
  error: string | null;
  loading: boolean;
  access: ListProblemsAccess;
  onReload: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const problems = listProblemsOf(lists ?? []);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 73);
  const shown = paginate(problems, page, pageSize);

  // The screening service's read-only check (no vendor called, nothing billed): the Source step's "Check again".
  async function checkAgain(campaignId: string) {
    setProbes((was) => ({ ...was, [campaignId]: { state: "checking" } }));
    try {
      const response = await fetch(`/api/app/campaigns/${campaignId}/scrub`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.screening) throw new Error(body?.error ?? "Could not reach the screening check");
      setProbes((was) => ({ ...was, [campaignId]: { state: body.screening.answering ? "answering" : "down" } }));
    } catch (cause) {
      setProbes((was) => ({ ...was, [campaignId]: { state: "error", message: cause instanceof Error ? cause.message : "Could not reach the screening check" } }));
    }
  }

  const scrubBlocked = access.readOnly ? "Restore full access to your plan to scrub — it is read-only."
    : !access.owner ? OWNER_ONLY
      : !access.scrubPanel ? "Add Outbound dialing to your plan to scrub lists."
        : null;

  function fix(problem: Problem) {
    const { list } = problem;
    if (problem.kind === "territory") {
      return (
        <span className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild size="sm" variant="outline"><Link href={STATES_HREF}><MapPinOff aria-hidden="true" />Add a licence</Link></Button>
          {access.claim && list.claimable > 0 && (
            <Button asChild size="sm" variant="ghost"><Link href={`/app/lead-sources?list=${list.campaignId}&tab=removed`}>Claim credit</Link></Button>
          )}
        </span>
      );
    }
    const failed = problem.kind === "failed";
    const probe = probes[list.campaignId];
    const expanded = open === problem.key;
    return (
      <span className="flex flex-wrap items-center justify-end gap-2">
        {failed && !scrubBlocked && (
          <Button type="button" size="sm" variant="ghost" disabled={probe?.state === "checking"} onClick={() => void checkAgain(list.campaignId)}>
            <RefreshCw aria-hidden="true" />{probe?.state === "checking" ? "Checking…" : "Check again"}
          </Button>
        )}
        {!scrubBlocked ? (
          <Button type="button" size="sm" variant={expanded ? "outline" : "default"} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : problem.key)}>
            {failed ? <Play aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{expanded ? "Close" : failed ? "Resume" : "Run the scrub"}
          </Button>
        ) : (
          <span className="flex flex-col items-end gap-1">
            <Button type="button" size="sm" variant="outline" disabled title={scrubBlocked}>
              {failed ? <Play aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{failed ? "Resume" : "Run the scrub"}
            </Button>
            <span className="text-xs text-[var(--muted)]">{scrubBlocked}</span>
          </span>
        )}
      </span>
    );
  }

  function problemCell(problem: Problem) {
    const { list } = problem;
    if (problem.kind === "territory") {
      return (
        <span className="flex flex-col gap-1">
          <StatusChip tone="warning" dot={false}><MapPinOff aria-hidden className="size-3.5" />Outside your states</StatusChip>
          <span className="text-xs text-[var(--body)]">{plural(list.offTerritory ?? 0, "lead", "leads")} in {plural(list.offTerritoryStates, "state", "states")} nobody here is licensed in</span>
        </span>
      );
    }
    const probe = probes[list.campaignId];
    return (
      <span className="flex flex-col gap-1">
        {problem.kind === "failed"
          ? <StatusChip tone="danger" dot={false}><TriangleAlert aria-hidden className="size-3.5" />Scrub failed</StatusChip>
          : <StatusChip tone="danger" dot={false}><ShieldAlert aria-hidden className="size-3.5" />{list.scrubStatus === "unscrubbed" ? "Not scrubbed" : "Scrub not finished"}</StatusChip>}
        <span className="text-xs text-[var(--body)]">None of its {plural(list.leadsReceived, "lead is", "leads are")} served to the dialer</span>
        {probe && probe.state !== "checking" && (
          <span role="status" className={probe.state === "answering" ? "text-xs font-semibold text-[var(--success-ink)]" : "text-xs text-[var(--error-ink)]"}>
            {probe.state === "answering" ? "Screening service answers again. Resume the scrub." : probe.state === "down" ? "Screening service is still not answering." : probe.message}
          </span>
        )}
      </span>
    );
  }

  return (
    <TableCard
      className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 [&>.overflow-x-auto]:flex-1 lg:[&>.overflow-x-auto]:min-h-0 lg:[&>.overflow-x-auto]:overflow-y-auto"
      toolbar={<DataToolbar actions={<RefreshButton onClick={onReload} refreshing={loading} />} />}
      footer={!error && lists && problems.length ? <Pager page={shown.current} total={problems.length} noun={problems.length === 1 ? "problem" : "problems"} pageSize={pageSize} onPage={setPage} /> : undefined}
    >
      {error ? (
        <ErrorState detail={error} action={<Button type="button" variant="outline" onClick={onReload}>Try again</Button>} />
      ) : !lists ? (
        <SectionLoading rows={4} columns={3} label="Loading list problems" />
      ) : problems.length === 0 ? (
        <EmptyState title="No list problems" hint="Every list with leads is scrubbed and inside your licensed states." />
      ) : (
        <table aria-label="List problems" className="portal-lead-table w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col">List</th>
              <th scope="col" className="w-[300px]">Problem</th>
              <th scope="col" className="w-[300px] text-right">Fix</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {shown.rows.map((problem) => (
              <Fragment key={problem.key}>
                <tr className="m-row">
                  <td className="max-w-[280px]">
                    <Link href={`/app/lead-sources?list=${problem.list.campaignId}&tab=overview`} className="block truncate font-semibold text-[var(--ink)] hover:underline" title={problem.list.campaignName}>{problem.list.campaignName}</Link>
                    <span className="block truncate text-xs text-[var(--body)]">{problem.list.vendorName}</span>
                  </td>
                  <td>{problemCell(problem)}</td>
                  <td className="text-right">{fix(problem)}</td>
                </tr>
                {open === problem.key && (
                  <tr>
                    <td colSpan={3}>
                      <LeadListScrub
                        campaignId={problem.list.campaignId}
                        campaignName={problem.list.campaignName}
                        autoStart
                        onDone={onReload}
                      />
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
