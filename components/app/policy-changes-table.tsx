"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
import { fileDay } from "@/lib/ingestion/constants";
import { changeWindow, TRACKED_FIELD_LABELS, type TrackedField } from "@/lib/ingestion/snapshots";
import type { ChangeRow } from "@/lib/ingestion/snapshotStore";
import { fileHref } from "@/lib/ingestion/trace";
import { isNormalizedStatus, shownWord, STATUS_LABELS } from "@/lib/ingestion/statuses";

function shown(field: TrackedField, value: string | null): string {
  if (value === null) return "—";
  if (field === "status_normalized") return isNormalizedStatus(value) ? STATUS_LABELS[value].label : value;
  if (field === "carrier_status_raw") return shownWord(value);
  if (field === "premium_cents" || field === "face_amount_cents") {
    const cents = Number(value);
    return Number.isFinite(cents) ? `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value;
  }
  if (field === "paid_to_date" || field === "termination_date") return fileDay(value);
  return value.replace(/_/g, " ");
}

/**
 * LA-4.6 (Notion sprint) · what moved between a carrier's files, policy by policy. A change is known
 * only as precisely as the files arrive: on a monthly file it happened somewhere between the two
 * files' dates, and each row says exactly which two.
 */
export function PolicyChangesTable({ changes, emptyTitle, emptyHint }: { changes: ChangeRow[]; emptyTitle: string; emptyHint: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [field, setField] = useState<"" | TrackedField>("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 49);

  const carriers = useMemo(() => [...new Set(changes.map((change) => change.carrierName))].sort((a, b) => a.localeCompare(b)), [changes]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return changes.filter((change) => (!needle || change.policyNumber.toLowerCase().includes(needle)) && (!carrier || change.carrierName === carrier) && (!field || change.fieldName === field));
  }, [changes, query, carrier, field]);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier || field);
  const clear = () => { setQuery(""); setCarrier(""); setField(""); setPage(1); };

  return (
    <TableCard
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-300px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search policy numbers" />
          <select aria-label="Filter changes by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
            <option value="">All carriers</option>
            {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select aria-label="Filter changes by field" className={toolbarControl} value={field} onChange={(event) => { setField(event.target.value as typeof field); setPage(1); }}>
            <option value="">Every field</option>
            {(Object.keys(TRACKED_FIELD_LABELS) as TrackedField[]).map((key) => <option key={key} value={key}>{TRACKED_FIELD_LABELS[key]}</option>)}
          </select>
        </DataToolbar>
      }
      footer={changes.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "change" : "changes"} suffix="newest file first" /> : undefined}
    >
      {changes.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : visible.length === 0 ? (
        <NoMatches noun="changes" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[130px]">Policy</th>
              <th className="w-[180px]">Carrier</th>
              <th className="w-[150px]">Field</th>
              <th className="w-[160px]">Was</th>
              <th className="w-[160px]">Now</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((change) => (
              <tr key={change.id} className="m-row">
                <td className="font-semibold tabular-nums text-foreground"><Link href={`/app/policies/carrier/${change.carrierId}/${encodeURIComponent(change.policyNumber)}`} className="hover:underline">{change.policyNumber}</Link></td>
                <td><span className="block whitespace-normal break-words leading-snug">{change.carrierName}</span></td>
                <td>{TRACKED_FIELD_LABELS[change.fieldName]}</td>
                <td className="text-muted-foreground" title={change.oldValue ?? ""}><span className="block max-w-[160px] truncate">{shown(change.fieldName, change.oldValue)}</span></td>
                <td className="font-semibold text-foreground" title={change.newValue ?? ""}><span className="block max-w-[160px] truncate">{shown(change.fieldName, change.newValue)}</span></td>
                <td className="tabular-nums text-muted-foreground"><Link href={fileHref(change.toFileId)} className="hover:text-foreground hover:underline" title="Open the file that showed the new value">{changeWindow(change.fromDate, change.toDate, fileDay)}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
