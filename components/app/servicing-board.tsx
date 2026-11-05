"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { MoreMenu } from "@/components/ui/more-menu";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { CARRIER_METHOD_LABELS, OPEN_STATUSES, REQUEST_LABELS, REQUEST_TYPES, STATUS_LABELS, WAITING_STATUSES, describeChange } from "@/lib/retention/servicing";
import type { ServicingRow } from "@/lib/retention/servicingStore";
import { CancelRequestDialog } from "@/components/app/retention/servicing-request-view";
import { SERVICING_TONE, STEP_LABEL, TONE_CLASS, canCancel, dayText, fileCheckText, nextStepOf, policyHref, tryAgainHref } from "@/components/app/retention/servicing-shared";

const VIEWS = { open: "Open", failed: "Not in the file", verified: "Verified", all: "All" } as const;
type View = keyof typeof VIEWS;
const asView = (value: string | null): View => (value === "failed" || value === "verified" || value === "all" ? value : "open");
const viewHref = (v: View) => (v === "open" ? "/app/servicing" : `/app/servicing?status=${v}`);

/**
 * LA-5.4 (Notion sprint) · servicing requests. Open by default; "Carrier says done" is still open —
 * only a carrier file closes it. A change the file can't show waits and says why; one the file
 * contradicts past its date is "Not in the file", with the reason, and is back on the save queue.
 *
 * 2026-11-02 tidy (owner): views are chips with their counts, each row is one line per fact and fits the
 * card, the next step is the row's one button, and a search finds a client or policy.
 *
 * SvA (2026-11-05): list → request page → tabs. The client opens `/app/servicing/[id]`, the row's step opens
 * that page's step form (`?step=`), New request and Try again are `/app/servicing/new`; the only pop-up left
 * is the cancel confirm. The view chip is the address's `?status=`, so the tiles' links and Back land on it.
 */
export function ServicingBoard({ rows, verifiedLast30, readOnly }: { rows: ServicingRow[]; verifiedLast30: number; readOnly: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const view = asView(params.get("status"));
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  // The page resets when the view changes, by a chip or by a tile's link.
  const [paging, setPaging] = useState<{ view: View; page: number }>({ view, page: 1 });
  const page = paging.view === view ? paging.page : 1;
  const setPage = (next: number) => setPaging({ view, page: next });
  const [cancelling, setCancelling] = useState<ServicingRow | null>(null);
  // A chip changes the address without a server round trip (Next keeps useSearchParams in step with history).
  const setView = (v: View) => { window.history.replaceState(null, "", viewHref(v)); setPaging({ view: v, page: 1 }); };

  const inView = (r: ServicingRow, v: View) => v === "all" || (v === "open" ? OPEN_STATUSES.includes(r.status) : v === "failed" ? r.status === "failed" : r.status === "verified_in_file");
  const counts = useMemo(() => Object.fromEntries((Object.keys(VIEWS) as View[]).map((v) => [v, rows.filter((r) => inView(r, v)).length])) as Record<View, number>, [rows]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => (!type || r.type === type) && inView(r, view)
    && (!needle || [r.clientName, r.policyNumber, r.carrierName, r.carrierReference].some((v) => v?.toLowerCase().includes(needle)))), [rows, view, type, needle]);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(visible, page, pageSize);
  const waiting = rows.filter((r) => WAITING_STATUSES.includes(r.status));
  const unprovable = waiting.filter((r) => r.unprovable.length > 0).length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const verified30 = verifiedLast30;
  const drafts = rows.filter((r) => r.status === "draft").length;
  const clear = () => { setType(""); setSearch(""); setView("open"); };
  const nameOf = (r: ServicingRow) => (r.clientName ? personName(r.clientName) : "No client linked");

  return (
    <>
      {rows.length > 0 && (
        <StatStrip label="Servicing">
          <StatTile href={viewHref("open")} label="Waiting on the file" value={waiting.length.toLocaleString("en-US")} footnote={drafts ? `${drafts} not sent yet` : "sent, not in a file yet"} />
          <StatTile href={viewHref("open")} label="Can't be proven" value={unprovable.toLocaleString("en-US")} valueTone={unprovable ? "warning" : undefined} labelTitle="The carrier's file doesn't carry the field that changed (most files have no draft day). These wait; map the column in the carrier's layout if the file has one." footnote={unprovable ? "the file has no such field" : "every change can be checked"} />
          <StatTile href={viewHref("failed")} label="Not in the file" value={failed.toLocaleString("en-US")} valueTone={failed ? "danger" : undefined} footnote={failed ? "back on the save queue" : "no change has failed"} />
          <StatTile href={viewHref("verified")} label="Verified" value={verified30.toLocaleString("en-US")} valueTone={verified30 ? "good" : undefined} footnote="by a carrier file, last 30 days" />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(type || needle || view !== "open") && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
            {!readOnly && <Button asChild><Link href="/app/servicing/new">New request</Link></Button>}
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or reference" />
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <ToggleChip key={v} role="radio" selected={view === v} count={counts[v]} countTone={v === "failed" && counts.failed ? "danger" : undefined} onClick={() => setView(v)}>{VIEWS[v]}</ToggleChip>
            ))}
            <select aria-label="Kind of change" className={toolbarControl} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">Every change</option>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_LABELS[t]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="requests" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No servicing requests yet" hint="Start one from a Save queue card, or with New request." />
        ) : visible.length === 0 ? (
          <NoMatches noun="requests" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th>Change</th>
                <th>Where it stands</th>
                <th className="w-[200px] text-right"><span className="sr-only">Next step</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r) => {
                // The one line under the status: why it failed, what proved it, why it can't be proven, or what it waits on.
                const check = fileCheckText(r);
                const changes = r.changes.map((c) => describeChange(c)).join(" · ");
                const carrier = r.status === "draft" ? "" : [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, r.carrierReference ? `Ref ${r.carrierReference}` : null, r.submittedAt ? `Sent ${dayText(r.submittedAt)}` : null].filter(Boolean).join(" · ");
                const next = nextStepOf(r.status);
                return (
                  <tr key={r.id} className="m-row">
                    <td>
                      <Link href={`/app/servicing/${r.id}`} className="block max-w-[220px] truncate font-semibold text-foreground underline-offset-2 hover:underline">{nameOf(r)}</Link>
                      <Link href={policyHref(r)} className="block truncate text-xs text-muted-foreground hover:underline" title={r.requestedBy ? `Asked by ${r.requestedBy}, ${dayText(r.createdAt)}` : undefined}>{r.carrierName} {r.policyNumber}</Link>
                    </td>
                    <td>
                      <span className="block font-medium text-foreground">{REQUEST_LABELS[r.type]}</span>
                      {changes && <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={r.targetDraftReason ? `${changes} · "${r.targetDraftReason}"` : changes}>{changes}</span>}
                    </td>
                    <td>
                      <StatusChip tone={SERVICING_TONE[r.status]}>{STATUS_LABELS[r.status]}</StatusChip>
                      {/* What it waits on, then how it went to the carrier (both in the title). */}
                      {(check || carrier) && <span className={`mt-1 block max-w-[300px] truncate text-xs ${check ? TONE_CLASS[check.tone] : "text-muted-foreground"}`} title={[check?.text, carrier].filter(Boolean).join(" · ")}>{check?.text ?? carrier}</span>}
                    </td>
                    <td className="text-right">
                      {!readOnly && (
                        <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                          {next && <Button asChild variant="outline" size="sm"><Link href={`/app/servicing/${r.id}?step=${next}`}>{STEP_LABEL[next]}</Link></Button>}
                          {r.status === "failed" && <Button asChild variant="outline" size="sm"><Link href={tryAgainHref(r)}>Try again</Link></Button>}
                          {canCancel(r.status) && <MoreMenu row label={`More for ${nameOf(r)}`} items={[{ label: "Cancel the request", onSelect: () => setCancelling(r) }]} />}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {cancelling && (
        <CancelRequestDialog
          key={cancelling.id}
          id={cancelling.id}
          name={nameOf(cancelling)}
          open
          onOpenChange={(open) => { if (!open) setCancelling(null); }}
          onDone={() => { setCancelling(null); router.refresh(); }}
        />
      )}
    </>
  );
}
