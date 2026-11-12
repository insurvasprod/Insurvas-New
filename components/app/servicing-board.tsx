"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ActiveFilters, ClearFiltersButton, DataToolbar, FilterField, FilterPopover, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { CARRIER_METHOD_LABELS, REQUEST_LABELS, REQUEST_TYPES, STATUS_LABELS, describeChange } from "@/lib/retention/servicing";
import type { ServicingRow } from "@/lib/retention/servicingStore";
import { LinkRow } from "@/components/app/book/setup/link-row";
import {
  BUCKETS, NEXT_WORDS, SERVICING_TONE, asServicingView, bucketOf, dayText, fileCheckText, localDay, policyHref, requestHref, rowsInView, servicingViewHref, waitedDays,
  type Bucket,
} from "@/components/app/retention/servicing-shared";

/**
 * Retention › Waiting on the carrier (LA-5.4; round 7, owner pick 2·A, 2026-11-10: "what you do next, as tabs").
 * The tabs on the title line (Open · Check it · Send it · Waiting · Not in the file · Proven · Cancelled, the
 * `?status=` address) choose the rows; the six cards went. The table fills the window; on Open its rows are grouped
 * by next step, the longest wait first. No buttons or menus in a row: each row opens its request, whose title line
 * holds Mark sent, Check it, Try again and Cancel the request. The last column says the next step in words.
 * Names and policies stay links: the name opens the request, the policy its page, "From a Retention case" the case.
 * A request closes only when a carrier file shows the change.
 */
export function ServicingBoard({ rows, readOnly }: { rows: ServicingRow[]; readOnly: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const view = asServicingView(params.get("status"));
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [paging, setPaging] = useState<{ view: string; page: number }>({ view, page: 1 });
  const page = paging.view === view ? paging.page : 1;
  const setPage = (next: number) => setPaging({ view, page: next });
  const today = localDay();

  const needle = search.trim().toLowerCase();
  const matching = useMemo(() => rows.filter((r) => (!type || r.type === type) && (!needle || [r.clientName, r.policyNumber, r.carrierName, r.carrierReference].some((v) => v?.toLowerCase().includes(needle)))), [rows, type, needle]);
  const visible = useMemo(() => rowsInView(matching, view, today), [matching, view, today]);
  const count = (b: Bucket) => matching.filter((r) => bucketOf(r, today) === b).length;
  const pageSize = useFittingPageSize(470, 57);
  const shown = paginate(visible, page, pageSize);
  const clear = () => { setType(""); setSearch(""); };
  const nameOf = (r: ServicingRow) => (r.clientName ? personName(r.clientName) : "No client linked");
  const filtered = Boolean(type || needle);
  const bucketMeta = view === "open" ? null : BUCKETS.find((b) => b.key === view)!;

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clear} />}
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
          <span className="text-sm text-foreground">{view === "open" ? "Grouped by what you do next, the longest wait first · a request closes only when a carrier file shows the change" : "A request closes only when a carrier file shows the change"}</span>
          <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="requests" onPage={setPage} />
        </div>
      ) : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState title="No servicing requests yet" hint="Start one from a Retention case, or with New request." action={readOnly ? undefined : <Button asChild><Link href="/app/servicing/new">New request</Link></Button>} />
      ) : visible.length === 0 ? (
        filtered ? <NoMatches noun="requests" onClear={clear} />
          : bucketMeta ? <EmptyState title={bucketMeta.empty.title} hint={bucketMeta.empty.hint} />
            : <EmptyState title="Nothing open" hint="Every request is proven or cancelled. A new one lands here until a carrier file shows the change." />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>Client</th>
              <th>Policy</th>
              <th>Change asked</th>
              <th className="text-right">Waiting</th>
              <th>Status</th>
              <th>Next step</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {shown.rows.map((r, i) => {
              const b = bucketOf(r, today);
              const head = view === "open" && (i === 0 || bucketOf(shown.rows[i - 1], today) !== b);
              const meta = BUCKETS.find((x) => x.key === b)!;
              const check = fileCheckText(r);
              const changes = r.changes.map((c) => describeChange(c)).join(" · ");
              const sent = r.status === "draft" ? "Not sent yet" : [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, dayText(r.submittedAt), r.carrierReference ? `ref ${r.carrierReference}` : null].filter(Boolean).join(" · ");
              const showBy = r.expectedEffectiveDate ? `show by ${dayText(r.expectedEffectiveDate)}` : "no date given";
              const waited = waitedDays(r);
              const href = requestHref(r.id, view);
              // One chip per row (one-line tables, owner 2026-11-11): a date already passed with no proof says so in the chip.
              const pastDate = Boolean(r.expectedEffectiveDate && r.expectedEffectiveDate < today && b === "check");
              const tone = pastDate ? "danger" : SERVICING_TONE[r.status] === "info" ? "warning" : SERVICING_TONE[r.status];
              // Read-only: the row still opens its request; no step is offered but Open.
              const next = (readOnly ? undefined : NEXT_WORDS[b]) ?? "Open";
              return (
                <Fragment key={r.id}>
                  {head && (
                    <tr aria-label={`${meta.label}: ${count(b)} requests`}>
                      <td colSpan={6} className="bg-[var(--surface-alt)] py-1.5">
                        <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
                          {meta.label}
                          <Link href={servicingViewHref(b)} className="tabular-nums hover:underline">{count(b)}</Link>
                        </span>
                      </td>
                    </tr>
                  )}
                  <LinkRow href={href} className="m-row">
                    <td className="whitespace-nowrap font-medium text-foreground">
                      <Link href={href} className="hover:underline" title={r.caseId ? "From a Retention case: the request page links to it" : undefined}>{nameOf(r)}</Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={policyHref(r)} className="hover:underline" title={r.requestedBy ? `Asked by ${r.requestedBy}, ${dayText(r.createdAt)}` : undefined}>{r.carrierName} {r.policyNumber}</Link>
                    </td>
                    <td className="whitespace-nowrap" title={changes ? (r.targetDraftReason ? `${changes} · "${r.targetDraftReason}"` : changes) : undefined}>{REQUEST_LABELS[r.type]}</td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={`${sent} · ${showBy}`}>{waited === null ? <span className="text-muted-foreground">—</span> : `${waited} ${waited === 1 ? "day" : "days"}`}</td>
                    <td><StatusChip tone={tone} title={check?.text ?? (pastDate ? showBy : undefined)}>{pastDate ? "Past its date" : STATUS_LABELS[r.status]}</StatusChip></td>
                    {/* The next step as a short verb (2·A); the whole row opens the request. */}
                    <td className="whitespace-nowrap">{next} ›</td>
                  </LinkRow>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
