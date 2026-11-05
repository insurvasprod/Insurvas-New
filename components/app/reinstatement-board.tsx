"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Callout } from "@/components/app/settings/primitives";
import { personName } from "@/lib/format/personName";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay } from "@/lib/ingestion/constants";
import { CASE_STATUS_LABELS, FORWARD, canMove, type CaseStatus, type Urgency } from "@/lib/retention/reinstatement";
import type { Reinstatement } from "@/lib/retention/reinstatementStore";

const money = (cents: number | null) => (cents === null ? null : `$${Math.round(cents / 100).toLocaleString("en-US")}`);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};
const DAYS_CLASS: Record<Urgency, string> = {
  pinned: "text-[var(--error-ink)]",
  red: "text-[var(--error-ink)]",
  amber: "text-[var(--warning-ink)]",
  plain: "text-foreground",
  no_window: "text-muted-foreground",
};
const TONE: Record<CaseStatus, StatusTone> = {
  identified: "action", contacted: "info", client_agreed: "info", submitted: "warning",
  reinstated: "good", declined_by_client: "neutral", declined_by_carrier: "neutral", expired: "danger",
};
const NEXT_LABEL: Partial<Record<CaseStatus, string>> = { contacted: "Called them", client_agreed: "Client agreed", submitted: "Sent to the carrier" };

/**
 * LA-5.6 (Notion sprint) · reinstatement. Fewest days first; red inside a week, pinned inside the
 * pin threshold; a carrier with no window sits in its own labelled group with no countdown — never a
 * guessed one. "Reinstated" comes from the carrier file, "Window closed" from the calendar.
 *
 * 2026-11-02 tidy (owner): Open and Closed are chips with their counts, a search finds a client, each fact is
 * one line, the table fits its card, and a window about to close goes to the bell rather than the page.
 *
 * RiA (2026-11-05): no pop-up. A case opens as its own page (/app/reinstatement/[id]); Open and Closed follow
 * the address (`?cases=closed`), so the Last 90 days tile links straight to the closed list.
 */
export function ReinstatementBoard({ data, readOnly }: { data: Reinstatement; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const params = useSearchParams();
  const view: "open" | "closed" = params.get("cases") === "closed" ? "closed" : "open";
  // The chip writes the address in place (no server round trip); a link to ?cases=closed lands on the same view.
  const setView = (next: "open" | "closed") => {
    const query = new URLSearchParams(params.toString());
    if (next === "closed") query.set("cases", "closed");
    else query.delete("cases");
    const text = query.toString();
    window.history.replaceState(null, "", text ? `?${text}` : window.location.pathname);
  };
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const needle = search.trim().toLowerCase();
  const rows = useMemo(() => (view === "open" ? data.open : data.closed).filter((r) => !needle || [r.clientName, r.policyNumber, r.phone, r.carrierName].some((v) => v?.toLowerCase().includes(needle))), [data, view, needle]);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(rows, page, pageSize);
  const { counts } = data;
  const advance = money(counts.advanceOpenCents);
  const pinned = useMemo(() => data.open.filter((r) => r.urgency === "pinned"), [data.open]);

  return (
    <>
      {pinned.length > 0 && <Callout tone="error" title={`${pinned.length === 1 ? "1 reinstatement window closes" : `${pinned.length} reinstatement windows close`} within ${data.settings.reinstatementPinDays} days. After that the policy is gone for good.`} />}
      {(data.open.length > 0 || data.closed.length > 0) && (
        <StatStrip label="Reinstatement">
          <StatTile href="/app/reinstatement" label="Open cases" value={counts.open.toLocaleString("en-US")} footnote={counts.noWindow ? `${counts.noWindow} with no carrier window` : "every one has a deadline"} />
          <StatTile href="/app/reinstatement" label={`Within ${data.settings.reinstatementRedDays} days`} value={data.open.filter((r) => r.urgency === "pinned" || r.urgency === "red").length.toLocaleString("en-US")} valueTone={pinned.length ? "danger" : undefined} footnote={`${pinned.length} within ${data.settings.reinstatementPinDays}`} />
          <StatTile label="Advance that revives" value={counts.advanceOpenCents > 0 ? advance : "Unknown"} footnote={counts.advanceUnknown ? `${counts.advanceUnknown} with no advance on file` : "if every case comes back"} />
          <StatTile href="/app/reinstatement?cases=closed" label="Last 90 days" value={`${counts.reinstated90} back`} footnote={`${counts.expired90} window closed · ${counts.declined90} declined`} />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {needle && <ClearFiltersButton onClick={() => { setSearch(""); setPage(1); }} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or phone" />
            <ToggleChip role="radio" selected={view === "open"} count={data.open.length} countTone={pinned.length ? "danger" : undefined} onClick={() => { setView("open"); setPage(1); }}>Open</ToggleChip>
            <ToggleChip role="radio" selected={view === "closed"} count={data.closed.length} onClick={() => { setView("closed"); setPage(1); }}>Closed, 90 days</ToggleChip>
          </DataToolbar>
        }
        footer={rows.length ? <Pager page={shown.current} pageSize={pageSize} total={rows.length} noun="cases" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          needle ? <NoMatches noun="cases" onClear={() => { setSearch(""); setPage(1); }} /> : <EmptyState title={view === "open" ? "Nothing to reinstate" : "Nothing closed lately"} hint={view === "open" ? "A case opens when a carrier file shows a lapse the carrier still takes back." : "Closed cases show here for 90 days."} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th className="w-[120px] text-right">{view === "open" ? "Days left" : "Closed"}</th>
                <th>Reinstate</th>
                <th>Where it stands</th>
                <th className="w-[150px] text-right"><span className="sr-only">Work it</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.flatMap((r, i) => {
                const out = [];
                // The labelled group starts at the first case with no carrier window (they sort last).
                if (view === "open" && r.urgency === "no_window" && (i === 0 || shown.rows[i - 1].urgency !== "no_window")) {
                  out.push(<tr key="group-no-window"><td colSpan={5} className="text-xs font-semibold text-muted-foreground">No reinstatement window yet · <span className="normal-case">Insurvas sets it per carrier</span></td></tr>);
                }
                const c = r.comparison.reinstate;
                const next = FORWARD.find((s) => canMove(r.status, s));
                out.push(
                  <tr key={r.id} className="m-row">
                    <td>
                      <Link href={`/app/reinstatement/${r.id}`} className="block truncate font-semibold text-foreground hover:underline" title={data.showOwners && r.owner ? `Owner: ${r.owner.name}${r.owner.escalated ? " · moved to the writing agent" : ""}` : undefined}>{r.clientName ? personName(r.clientName) : "No client linked"}</Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.phone ? <span className="select-all tabular-nums text-foreground" title="Check the calling window and do-not-call list before dialling">{phoneText(r.phone)}</span> : "No phone"}
                        {" · "}
                        <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="hover:underline">{r.carrierName} {r.policyNumber}</Link>
                      </span>
                    </td>
                    <td className="text-right">
                      {view === "open" ? (
                        r.daysRemaining === null ? <span className="text-sm text-muted-foreground">—</span> : (
                          <span className={`block text-base font-semibold tabular-nums ${DAYS_CLASS[r.urgency]}`}>{r.daysRemaining <= 0 ? "Today" : r.daysRemaining}</span>
                        )
                      ) : <span className="tabular-nums">{r.resolvedAt ? fileDay(r.resolvedAt.slice(0, 10)) : "—"}</span>}
                      <span className="block whitespace-nowrap text-xs text-muted-foreground" title={`Lapsed ${fileDay(r.lapsedOn)}`}>{r.deadline && view === "open" ? `closes ${fileDay(r.deadline)}` : `lapsed ${fileDay(r.lapsedOn)}`}</span>
                    </td>
                    <td>
                      <span className="block truncate text-foreground">{c.owedCents === null ? "Ask the carrier what is owed" : `Owes ${c.owedIsEstimate ? "about " : ""}${money(c.owedCents)}${c.months ? ` · ${c.months} ${c.months === 1 ? "month" : "months"}` : ""}`}</span>
                      {(c.advanceRevivesCents !== null || r.comparison.sellNew.olderNow) && (
                        <span className="block truncate text-xs text-muted-foreground" title={r.comparison.sellNew.olderNow ? `A new policy prices at ${r.comparison.sellNew.ageNow}, not ${r.comparison.sellNew.ageThen}` : undefined}>
                          {[c.advanceRevivesCents !== null ? `${money(c.advanceRevivesCents)} advance revives` : null, r.comparison.sellNew.olderNow ? `new policy at age ${r.comparison.sellNew.ageNow}` : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusChip tone={TONE[r.status]}>{CASE_STATUS_LABELS[r.status]}</StatusChip>
                      {(() => {
                        const line = [r.requiresHealthQuestions ? "Health questions" : null, r.requiresSignedForm ? "Signed form" : null, r.declineReason, r.workedBy].filter(Boolean).join(" · ");
                        return line ? <span className="mt-1 block truncate text-xs text-muted-foreground" title={line}>{line}</span> : null;
                      })()}
                    </td>
                    <td className="text-right">
                      {!readOnly && view === "open" && (
                        <Button asChild variant="outline" size="sm"><Link href={`/app/reinstatement/${r.id}`}>{next && NEXT_LABEL[next] ? "Work the case" : "Update"}</Link></Button>
                      )}
                    </td>
                  </tr>,
                );
                return out;
              })}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
