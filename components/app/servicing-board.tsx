"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ActiveFilters, ClearFiltersButton, DataToolbar, FilterField, FilterPopover, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { MoreMenu } from "@/components/ui/more-menu";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { CARRIER_METHOD_LABELS, REQUEST_LABELS, REQUEST_TYPES, STATUS_LABELS, WAITING_STATUSES, describeChange } from "@/lib/retention/servicing";
import type { ServicingRow } from "@/lib/retention/servicingStore";
import { CancelRequestDialog } from "@/components/app/retention/servicing-request-view";
import { RiskCards, type RiskCard } from "@/components/app/retention/risk-cards";
import { SERVICING_TONE, STEP_LABEL, TONE_CLASS, canCancel, dayText, fileCheckText, localDay, nextStepOf, policyHref, tryAgainHref } from "@/components/app/retention/servicing-shared";

/** Where a request stands, by what you do next (round 3, owner 2026-11-06). */
type Bucket = "check" | "send" | "waiting" | "failed" | "proven" | "cancelled";
const BUCKETS: Array<{ key: Bucket; label: string; ink: string }> = [
  { key: "check", label: "Check it", ink: "color-mix(in oklab, var(--warning-ink) 45%, var(--error-ink))" },
  { key: "send", label: "Send it", ink: "var(--warning-ink)" },
  { key: "waiting", label: "Waiting on the file", ink: "var(--info-ink)" },
  { key: "failed", label: "Not in the file", ink: "var(--error-ink)" },
  { key: "proven", label: "Proven", ink: "var(--success-ink)" },
  { key: "cancelled", label: "Cancelled", ink: "var(--muted-foreground)" },
];
/** The views: open (check, send, waiting, grouped) by default, or one bucket. */
type View = "open" | Bucket;
const asView = (value: string | null): View => (BUCKETS.some((b) => b.key === value) ? (value as Bucket) : "open");
const viewHref = (v: View) => (v === "open" ? "/app/servicing" : `/app/servicing?status=${v}`);

/**
 * Retention › Waiting on the carrier (LA-5.4; round 3, owner 2026-11-06: header A + table B). On top the same
 * cards as Cases, heavier when it needs you sooner: Waiting (nothing to do yet) › Send it › Check it (the file
 * doesn't show it, past its date or the field is missing) › Not in the file; Proven and Cancelled beside them.
 * The table groups the open ones by what you do next. A row is the request's page; Filters is a pop-over.
 * A request closes only when a carrier file shows the change.
 */
export function ServicingBoard({ rows, verifiedLast30, readOnly }: { rows: ServicingRow[]; verifiedLast30: number; readOnly: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const view = asView(params.get("status"));
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [paging, setPaging] = useState<{ view: View; page: number }>({ view, page: 1 });
  const page = paging.view === view ? paging.page : 1;
  const setPage = (next: number) => setPaging({ view, page: next });
  const [cancelling, setCancelling] = useState<ServicingRow | null>(null);
  const today = localDay();

  const bucketOf = (r: ServicingRow): Bucket => {
    if (r.status === "draft") return "send";
    if (r.status === "failed") return "failed";
    if (r.status === "verified_in_file") return "proven";
    if (r.status === "cancelled") return "cancelled";
    // Sent: it needs you once the carrier says done, the file can't show it, or its date has passed.
    return r.status === "confirmed_by_carrier" || r.unprovable.length > 0 || (r.expectedEffectiveDate !== null && r.expectedEffectiveDate < today) ? "check" : "waiting";
  };
  const needle = search.trim().toLowerCase();
  const matching = useMemo(() => rows.filter((r) => (!type || r.type === type) && (!needle || [r.clientName, r.policyNumber, r.carrierName, r.carrierReference].some((v) => v?.toLowerCase().includes(needle)))), [rows, type, needle]);
  const count = (b: Bucket) => matching.filter((r) => bucketOf(r) === b).length;
  const order: Bucket[] = ["check", "send", "waiting"];
  const visible = useMemo(() => (view === "open"
    ? matching.filter((r) => order.includes(bucketOf(r))).sort((a, b) => order.indexOf(bucketOf(a)) - order.indexOf(bucketOf(b)) || (waitedDays(b) ?? 0) - (waitedDays(a) ?? 0))
    : matching.filter((r) => bucketOf(r) === view)), [matching, view]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageSize = useFittingPageSize(470, 57);
  const shown = paginate(visible, page, pageSize);
  const clear = () => { setType(""); setSearch(""); };
  const nameOf = (r: ServicingRow) => (r.clientName ? personName(r.clientName) : "No client linked");
  const pastDate = matching.filter((r) => bucketOf(r) === "check" && r.expectedEffectiveDate !== null && r.expectedEffectiveDate < today).length;
  const cards: RiskCard[] = [
    { key: "waiting", level: 1, tag: "Waiting", name: "Sent, waiting on the file", count: count("waiting"), line: "nothing to do yet", foot: "a carrier file closes it", ink: "var(--info-ink)", href: viewHref(view === "waiting" ? "open" : "waiting"), on: view === "waiting" },
    { key: "send", level: 2, tag: "Send it", name: "Not sent yet", count: count("send"), line: "saved, never sent", foot: count("send") ? "mark it sent once the carrier has it" : "every request was sent", ink: "var(--warning-ink)", href: viewHref(view === "send" ? "open" : "send"), on: view === "send" },
    { key: "check", level: 3, tag: "Check it", name: "The file doesn't show it", count: count("check"), line: "past its date, or no such field", foot: pastDate ? `${pastDate} past its date` : "ask the carrier", warn: pastDate > 0, ink: BUCKETS[0].ink, href: viewHref(view === "check" ? "open" : "check"), on: view === "check" },
    { key: "failed", level: 4, tag: "Failed", name: "Not in the file", count: count("failed"), line: "the case is open again", foot: count("failed") ? "try again from the row" : "none failed", warn: count("failed") > 0, ink: "var(--error-ink)", href: viewHref(view === "failed" ? "open" : "failed"), on: view === "failed" },
  ];

  return (
    <>
      <RiskCards label="Where the requests stand" cards={cards} side={[
        { key: "proven", label: "Proven", count: verifiedLast30, line: "by a carrier file, last 30 days", ink: "var(--success-ink)", href: viewHref(view === "proven" ? "open" : "proven"), on: view === "proven" },
        { key: "cancelled", label: "Cancelled", count: count("cancelled"), line: "stopped by a person", ink: "var(--muted-foreground)", href: viewHref(view === "cancelled" ? "open" : "cancelled"), on: view === "cancelled" },
      ]} />

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(type || needle) && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or reference" />
            {/* Filters is a pop-over over the table (§6a, owner 2026-11-06); the applied one is a chip on this line. */}
            <FilterPopover count={type ? 1 : 0} onClear={() => setType("")}>
              <FilterField label="Kind of change" htmlFor="sv-type"><select id="sv-type" className={toolbarControl} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
                <option value="">Every change</option>
                {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_LABELS[t]}</option>)}
              </select></FilterField>
            </FilterPopover>
            <ActiveFilters inline filters={type ? [{ key: "type", label: "Change", value: REQUEST_LABELS[type as keyof typeof REQUEST_LABELS] ?? type, onRemove: () => setType("") }] : []} onClear={clear} />
          </DataToolbar>
        }
        footer={visible.length ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{view === "open" ? "Grouped by what you do next, the longest wait first · a request closes only when a carrier file shows the change" : "A request closes only when a carrier file shows the change"}</span>
            <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="requests" onPage={setPage} />
          </div>
        ) : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No servicing requests yet" hint="Start one from a Retention case, or with New request." />
        ) : visible.length === 0 ? (
          <NoMatches noun="requests" onClear={() => { clear(); router.replace(viewHref("open")); }} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client · policy</th>
                <th>Change asked</th>
                <th className="w-[140px]">Sent · show by</th>
                <th>What the latest file shows</th>
                <th className="w-[80px] text-right">Waiting</th>
                <th className="w-[150px] text-right"><span className="sr-only">Next step</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r, i) => {
                const b = bucketOf(r);
                const head = view === "open" && (i === 0 || bucketOf(shown.rows[i - 1]) !== b);
                const meta = BUCKETS.find((x) => x.key === b)!;
                const check = fileCheckText(r);
                const changes = r.changes.map((c) => describeChange(c)).join(" · ");
                const sent = r.status === "draft" ? "Not sent yet" : [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, dayText(r.submittedAt), r.carrierReference ? `ref ${r.carrierReference}` : null].filter(Boolean).join(" · ");
                const next = nextStepOf(r.status);
                const waited = waitedDays(r);
                return (
                  <Fragment key={r.id}>
                    {head && (
                      <tr aria-label={`${meta.label}: ${count(b)} requests`}>
                        <td colSpan={6} className="bg-[var(--surface-alt)] py-1.5">
                          <span className="inline-flex items-center gap-2 text-xs font-bold" style={{ color: meta.ink }}>
                            <i aria-hidden="true" className="block size-2 rounded-full" style={{ background: meta.ink }} />{meta.label}
                            <span className="rounded-full bg-[var(--surface)] px-1.5 text-foreground tabular-nums">{count(b)}</span>
                          </span>
                        </td>
                      </tr>
                    )}
                    <tr className="m-row">
                      <td>
                        <Link href={`/app/servicing/${r.id}`} className="block max-w-[180px] truncate font-semibold text-foreground underline-offset-2 hover:underline">{nameOf(r)}</Link>
                        <Link href={policyHref(r)} className="block max-w-[180px] truncate text-xs text-muted-foreground hover:underline" title={r.requestedBy ? `Asked by ${r.requestedBy}, ${dayText(r.createdAt)}` : undefined}>{r.carrierName} {r.policyNumber}</Link>
                        {r.caseId && <Link href={`/app/retention/${r.caseId}`} className="block text-xs font-semibold text-[var(--accent-ink)] hover:underline">From a Retention case</Link>}
                      </td>
                      <td>
                        <span className="block text-xs font-semibold text-foreground">{REQUEST_LABELS[r.type]}</span>
                        {changes && <span className="block max-w-[170px] truncate text-xs text-muted-foreground" title={r.targetDraftReason ? `${changes} · "${r.targetDraftReason}"` : changes}>{changes}</span>}
                      </td>
                      <td>
                        <span className="block max-w-[140px] truncate text-xs text-foreground" title={sent}>{sent}</span>
                        {/* When the file should show it: red once that day has passed. */}
                        <span className={`block text-xs tabular-nums ${r.expectedEffectiveDate && r.expectedEffectiveDate < today && b === "check" ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground"}`}>{r.expectedEffectiveDate ? `show by ${dayText(r.expectedEffectiveDate)}` : "no date given"}</span>
                      </td>
                      <td>
                        <StatusChip tone={SERVICING_TONE[r.status]}>{STATUS_LABELS[r.status]}</StatusChip>
                        {check && <span className={`mt-1 block max-w-[210px] truncate text-xs ${TONE_CLASS[check.tone]}`} title={check.text}>{check.text}</span>}
                      </td>
                      <td className="text-right">{waited === null ? <span className="text-xs text-muted-foreground">—</span> : <><b className={`text-sm tabular-nums ${waited >= 7 ? "text-[var(--error-ink)]" : waited >= 4 ? "text-[var(--warning-ink)]" : "text-foreground"}`}>{waited} {waited === 1 ? "day" : "days"}</b><span className="block text-xs text-muted-foreground">{r.status === "draft" ? "unsent" : "waiting"}</span></>}</td>
                      <td className="text-right">
                        {!readOnly && (
                          <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                            {next && <Button asChild variant={b === "check" || b === "send" ? "default" : "outline"} size="sm"><Link href={`/app/servicing/${r.id}?step=${next}`}>{STEP_LABEL[next]}</Link></Button>}
                            {r.status === "failed" && <Button asChild variant="outline" size="sm"><Link href={tryAgainHref(r)}>Try again</Link></Button>}
                            {canCancel(r.status) && <MoreMenu row label={`More for ${nameOf(r)}`} items={[{ label: "Cancel the request", onSelect: () => setCancelling(r) }]} />}
                          </span>
                        )}
                      </td>
                    </tr>
                  </Fragment>
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

/** Days since it was sent (or saved, if never sent); none once it is closed. */
function waitedDays(r: ServicingRow): number | null {
  if (!(WAITING_STATUSES.includes(r.status) || r.status === "draft")) return null;
  const from = r.submittedAt ?? r.createdAt;
  return Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 86_400_000));
}
