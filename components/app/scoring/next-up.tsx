"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BarList, ChartHeading, ChartLegend } from "@/components/ui/chart";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { cn } from "@/lib/utils";
import { heldBackSentence, type PreviewRow, type QueuePreview } from "@/lib/scoring/preview";
import { bySignalOrder, pointsFigure, scoreFigure, signalTone, SIGNAL_ORDER } from "@/lib/scoring/series";
import { showHref, type ShowMode } from "@/lib/reports/show";

import { LeadScoreDialog } from "@/components/app/scoring/lead-score-dialog";

type Agent = { userId: string; name: string; role: string };
type PreviewResponse = { agents: Agent[]; agentId: string | null; preview: QueuePreview | null; available: boolean };

const ROLE_LABEL: Record<string, string> = { owner: "Owner", producer: "Producer", setter: "Setter" };
const sentence = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
const n = (value: number) => value.toLocaleString("en-US");
/** "Raymond Caldwell · AZ": the lead as one cell (the attempt is its own column). */
const leadName = (row: { name: string | null; state: string | null }) => [row.name ?? "Unnamed lead", row.state].filter(Boolean).join(" · ");
/** The one reason a reader chooses by: the scorer's first, else the tier's. The rest is the cell's hover. */
const whyOf = (row: PreviewRow) => sentence(row.reasons[0] ?? row.tierReason.replace(/ \(assigned to you\)$/, ""));
const whyAll = (row: PreviewRow) => [row.tierReason, ...row.reasons.map(sentence)].filter(Boolean).join(" · ");
/** The row's one chip: the holdout says so; otherwise the tier it was served from ("Retry", "Callback"). */
const chipOf = (row: PreviewRow) => (row.cohort === "control" ? { text: "Plain order", tone: "neutral" as const } : { text: sentence(row.tierName) || "Due", tone: "neutral" as const });

const SIGNAL_LABEL: Record<string, string> = {
  recency: "Lead age", attempt_position: "Attempt number", time_of_day_fit: "Time-of-day fit", slot_freshness: "Slot freshness",
  vendor_contact_rate: "Vendor contact rate", completeness: "Data completeness", consent_artefact: "Consent artefact",
};

/** The address of a lead's score dialog (`?lead=<work item>`), every other parameter kept. */
function withLead(pathname: string, query: URLSearchParams, lead: string | null) {
  const params = new URLSearchParams(query.toString());
  if (lead) params.set("lead", lead);
  else params.delete("lead");
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

/**
 * Next up (Reports round 7, boards 3·2 and 3·3, 2026-11-11). Who Serve next would hand the chosen agent, and why:
 * - Chart (3·3, the owner: "This thing is awesome"): each lead's score as one bar split by signal, in queue order,
 *   out of the total points; a bar opens that lead's score dialog.
 * - Table (3·2): one line a lead (#, Lead, Attempt, Score, Why, Status); a row opens the score dialog (‹ › through the
 *   queue). Held back (leads waiting on the calling window) is a toolbar chip that filters the list to them.
 *
 * "Preview the queue" is read-only: scoring_queue_preview claims nothing and records no scoring decision, so looking
 * never moves the holdout comparison. The open lead is in the address (`?lead=`), so a bar is a link.
 */
export function QueueNextUp({ show, onCount }: { show: ShowMode; onCount?: (servable: number | null) => void }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const [agentId, setAgentId] = useState<string>("");
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True from the start: the first load runs from the effect, and a setState there would cascade.
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<"next" | "held">("next");

  const load = useCallback((agent: string) => {
    const search = agent ? `?agent=${encodeURIComponent(agent)}` : "";
    return fetch(`/api/app/scoring/preview${search}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not preview the queue");
        const next = body as PreviewResponse;
        setError(null);
        setData(next);
        if (next.agentId) setAgentId(next.agentId);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not preview the queue"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { void load(""); }, [load]);

  const preview = data?.available ? data.preview : null;
  useEffect(() => { onCount?.(preview ? preview.servableCount : null); }, [preview, onCount]);

  const rows = preview?.rows ?? [];
  const agentName = data?.agents.find((agent) => agent.userId === agentId)?.name ?? "this agent";

  // The lead whose score is open: from the address, so a chart's bar (a link) and a row (in place) open the same way.
  const openId = query.get("lead");
  const openIndex = openId ? rows.findIndex((row) => row.workItemId === openId) : -1;
  const setOpen = useCallback((lead: string | null) => {
    try { window.history.replaceState(window.history.state, "", withLead(pathname, new URLSearchParams(window.location.search), lead)); } catch { /* the dialog still follows */ }
  }, [pathname]);

  const refresh = () => { setLoading(true); void load(agentId); };
  const chooseAgent = (next: string) => { setAgentId(next); setLoading(true); setOpen(null); void load(next); };

  const agentSelect = (
    <select
      id="preview-agent"
      aria-label="Agent"
      value={agentId}
      disabled={!data || data.agents.length === 0 || loading}
      onChange={(event) => chooseAgent(event.target.value)}
      className={cn(toolbarControl, "max-w-[260px]")}
    >
      {(data?.agents ?? []).map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name} · {ROLE_LABEL[agent.role] ?? agent.role}</option>)}
    </select>
  );

  const state = error && !data ? (
    <ErrorState title="The preview did not load" detail={error} action={<Button variant="outline" onClick={refresh}>Try again</Button>} />
  ) : !data ? (
    <SectionLoading rows={6} label="Loading the queue preview" />
  ) : data.agents.length === 0 ? (
    <EmptyState title="No queue to preview" hint="No active owner, producer or setter can dial yet." />
  ) : !data.available || !preview ? (
    <EmptyState title="Preview unavailable" hint="The queue preview needs a database update that has not been applied yet." />
  ) : null;

  const dialog = <LeadScoreDialog rows={rows} index={openIndex >= 0 ? openIndex : null} onIndex={(index) => setOpen(rows[index]?.workItemId ?? null)} agentName={agentName} onClose={() => setOpen(null)} />;
  // A refresh that failed over a kept answer goes to the bell's line under the card, not a box on the page.
  const stale = error && data ? ` · the last refresh failed: ${error}` : "";

  if (show === "chart") {
    const tableHref = showHref(withLead(pathname, new URLSearchParams(query.toString()), null), "table");
    const total = preview?.totalWeight ?? 0;
    return (
      <section id="queue-preview" aria-label="Preview the queue" className="flex min-w-0 flex-col gap-4">
        <Card className="px-4">
          <ChartHeading
            title="Why these leads are next"
            period={preview ? `Next up for ${agentName} · the first ${n(rows.length)} of ${n(preview.servableCount)} · out of ${pointsFigure(total)} points${stale}` : undefined}
            action={<span className="flex flex-wrap items-center gap-2">{agentSelect}<RefreshButton onClick={refresh} refreshing={loading} /><Link href={tableHref} className="whitespace-nowrap text-sm text-foreground underline-offset-2 hover:underline">Open as a table ›</Link></span>}
          />
          {state ?? (rows.length === 0 ? (
            <EmptyState title="Nothing to serve" hint={`Nothing is servable to ${agentName} right now.`} />
          ) : (
            <>
              <BarList
                summary={`Next up for ${agentName}, in queue order: each lead's score out of ${pointsFigure(total)} points, split by signal`}
                unit="points"
                max={total > 0 ? total : undefined}
                labelWidth="14rem"
                rows={rows.map((row) => {
                  const parts = bySignalOrder(row.breakdown ?? []);
                  return {
                    key: row.workItemId,
                    label: `${row.position}. ${leadName(row)}`,
                    value: row.score ?? 0,
                    segments: parts.length ? parts.map((part) => ({ key: part.signal, label: part.label, value: part.points, tone: signalTone(part.signal) })) : undefined,
                    tone: parts.length ? undefined : "faint",
                    figure: scoreFigure(row.score),
                    caption: row.cohort === "control" ? "plain order" : `attempt ${row.attemptsMade + 1}`,
                    href: withLead(pathname, new URLSearchParams(query.toString()), row.workItemId),
                  };
                })}
              />
              <ChartLegend items={SIGNAL_ORDER.map((signal) => ({ key: signal, label: SIGNAL_LABEL[signal], tone: signalTone(signal), href: showHref(pathname, "table", { tab: "weights" }) }))} />
            </>
          ))}
        </Card>
        {dialog}
      </section>
    );
  }

  const held = preview?.heldBack ?? [];
  const footerText = preview
    ? <>{n(preview.servableCount)} servable to {agentName} · {n(preview.heldBackCount)} held back by the calling window{list === "held" && preview.heldBackCount > held.length ? ` · the ${n(held.length)} soonest to open are shown` : " · a row opens the lead's score"} · looking claims nothing{stale}</>
    : undefined;

  return (
    <section id="queue-preview" aria-label="Preview the queue">
      <PagedTableCard
        total={preview ? (list === "held" ? held.length : rows.length) : 0}
        noun="leads"
        suffix={footerText}
        title={`Next up for ${agentName}`}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => { setLoading(true); void load(agentId); }} refreshing={loading} />}>
            {agentSelect}
            {preview && (
              <ToggleChip selected={list === "held"} count={preview.heldBackCount} onClick={() => setList(list === "held" ? "next" : "held")}>Held back</ToggleChip>
            )}
          </DataToolbar>
        }
        footer={footerText ? <span>{footerText}</span> : undefined}
      >
        {state ?? (list === "held" ? (
          held.length === 0 ? (
            <EmptyState title="Nothing held back" hint="No due lead is waiting on the calling window." />
          ) : (
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th>Lead</th><th className="text-right">Attempt</th><th>Why it waits</th><th>Status</th></tr></thead>
              <PagedBody>
                {held.map((row) => (
                  <tr key={row.workItemId}>
                    <td className="max-w-[320px] truncate whitespace-nowrap font-medium text-foreground" title={leadName(row)}>{leadName(row)}</td>
                    <td className="text-right tabular-nums">{n(row.attemptsMade + 1)}</td>
                    <td className="max-w-[520px] truncate whitespace-nowrap" title={heldBackSentence(row)}>{heldBackSentence(row).replace(/^Not served — /, "")}</td>
                    <td><StatusChip tone="warning">Held back</StatusChip></td>
                  </tr>
                ))}
              </PagedBody>
            </table>
          )
        ) : rows.length === 0 ? (
          <EmptyState title="Nothing to serve" hint={`Nothing is servable to ${agentName} right now.`} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead><tr>
              <th className="w-10 text-right">#</th>
              <th>Lead</th>
              <th className="text-right">Attempt</th>
              <th className="text-right">Score</th>
              <th>Why</th>
              <th>Status</th>
            </tr></thead>
            <PagedBody>
              {rows.map((row) => {
                const chip = chipOf(row);
                return (
                  <tr key={row.workItemId} className="cursor-pointer" onClick={() => setOpen(row.workItemId)}>
                    <td className="text-right tabular-nums">{row.position}</td>
                    <td className="max-w-[300px] truncate whitespace-nowrap font-medium text-foreground" title={leadName(row)}>
                      <button type="button" className="max-w-full truncate text-left hover:underline" onClick={(event) => { event.stopPropagation(); setOpen(row.workItemId); }}>{leadName(row)}</button>
                    </td>
                    <td className="text-right tabular-nums">{n(row.attemptsMade + 1)}</td>
                    <td className="text-right tabular-nums" title={row.score === null ? "No score" : `${scoreFigure(row.score)} of ${pointsFigure(preview?.totalWeight ?? 0)} points`}>{scoreFigure(row.score)}</td>
                    <td className="max-w-[420px] truncate whitespace-nowrap" title={whyAll(row)}>{whyOf(row) || <span className="text-muted-foreground">—</span>}</td>
                    <td><StatusChip tone={chip.tone} dot={false}>{chip.text}</StatusChip></td>
                  </tr>
                );
              })}
            </PagedBody>
          </table>
        ))}
      </PagedTableCard>
      {dialog}
    </section>
  );
}
