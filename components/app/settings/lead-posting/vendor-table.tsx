"use client";

import { ChevronRight } from "lucide-react";

import { ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { st } from "@/components/app/settings/primitives";
import { dollars, STATUS_LABEL, STATUS_TONE, statusInFilter, wholeDollars, type LeadPostBoard, type StatusFilter, type VendorRow } from "@/lib/leadPost/board";
import { cn } from "@/lib/utils";
import { ago, InlineLink } from "./shared";

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * Vendors (board A1): one figure strip, then every vendor on one table — one line a row, one chip —
 * and a click opens the vendor's sheet.
 */
export function VendorTable({
  board,
  filter,
  onFilter,
  query,
  onQuery,
  selectedVendorId,
  onOpen,
  firstDialSeconds,
  connectButton,
  onGuide,
}: {
  board: LeadPostBoard;
  filter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  selectedVendorId: string | null;
  onOpen: (row: VendorRow) => void;
  firstDialSeconds: number | null;
  connectButton: React.ReactNode;
  onGuide: () => void;
}) {
  const needle = query.trim().toLowerCase();
  const campaignName = (row: VendorRow) => {
    const campaign = row.key.campaignId ? board.campaigns.find((item) => item.id === row.key.campaignId) : board.campaigns.find((item) => item.vendorId === row.vendorId && item.servable);
    return campaign ? `${campaign.name}` : row.key.campaignId ? "Campaign removed" : "No open campaign";
  };
  const count = (key: StatusFilter) => board.vendors.filter((row) => statusInFilter(row.status, key)).length;
  const shown = board.vendors.filter((row) => statusInFilter(row.status, filter) && (!needle || row.vendorName.toLowerCase().includes(needle) || campaignName(row).toLowerCase().includes(needle)));
  const f = board.figures;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatRow label="Lead posting today">
        <StatCard label="Posts today" value={f.postsToday.toLocaleString("en-US")} />
        <StatCard label="Accepted" value={<>{f.acceptedToday.toLocaleString("en-US")} <span className="text-sm font-normal text-[var(--muted)]">{pct(f.acceptedToday, f.postsToday)}</span></>} />
        <StatCard label="Refused" value={f.refusedToday.toLocaleString("en-US")} tone={f.refusedToday ? "warn" : "default"} period="never charged" />
        <StatCard label="Lead spend today" value={f.spendTodayCents === null ? "—" : wholeDollars(f.spendTodayCents)} period={f.spendTodayCents === null ? "needs a database update" : undefined} />
        <StatCard label="First dial, median" value={firstDialSeconds === null ? "—" : firstDialSeconds < 60 ? `${Math.round(firstDialSeconds)} s` : `${Math.round(firstDialSeconds / 60)} min`} />
      </StatRow>

      <TableCard
        title="Vendors"
        toolbar={
          <>
            <Segmented
              label="Show vendors"
              options={[
                { key: "all", label: "All", count: count("all") },
                { key: "live", label: "Live", count: count("live") },
                { key: "needs_you", label: "Needs you", count: count("needs_you"), tone: "danger" },
                { key: "testing", label: "Testing", count: count("testing") },
                { key: "off", label: "Off", count: count("off") },
              ]}
              value={filter}
              onChange={onFilter}
            />
            <div className="ml-auto w-full sm:w-[220px]"><ToolbarSearch value={query} onChange={onQuery} placeholder="Find a vendor" /></div>
          </>
        }
        footer={board.vendors.length ? <p className="m-0 px-4 py-3 text-xs text-[var(--muted)]">Click a vendor to open its sheet · Today counts reset at midnight, your time</p> : undefined}
      >
        <div className="max-h-[calc(100vh-420px)] min-h-[200px] overflow-y-auto">
          {board.vendors.length === 0 ? (
            <EmptyState
              title="No vendors yet"
              hint="Connect a vendor and their leads arrive in your campaign the moment someone fills in their form."
              action={<div className="flex flex-col items-center gap-2">{connectButton}<InlineLink onClick={onGuide}>Read the vendor guide</InlineLink></div>}
            />
          ) : shown.length === 0 ? (
            <NoMatches noun="vendors" onClear={() => { onQuery(""); onFilter("all"); }} />
          ) : (
            <table className={st.table} aria-label="Vendors">
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Vendor</th>
                  <th scope="col" className={st.th}>Campaign</th>
                  <th scope="col" className={st.th}>Status</th>
                  <th scope="col" className={cn(st.th, "text-right")}>Today</th>
                  <th scope="col" className={cn(st.th, "text-right")}>Accepted, 7 days</th>
                  <th scope="col" className={cn(st.th, "text-right")}>Per lead</th>
                  <th scope="col" className={st.th}>Last post</th>
                  <th scope="col" className={cn(st.th, "w-[40px]")}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const on = row.vendorId === selectedVendorId;
                  return (
                    <tr key={row.vendorId} className={cn("cursor-pointer hover:bg-[var(--hover-wash)]", on && "bg-[var(--primary-soft)]")} onClick={() => onOpen(row)}>
                      <td className={cn(st.td, st.strong, "max-w-[220px] truncate")}>
                        <button type="button" className="max-w-full truncate border-0 bg-transparent p-0 text-left font-semibold text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]" aria-label={`Open ${row.vendorName}`} onClick={(event) => { event.stopPropagation(); onOpen(row); }}>{row.vendorName}</button>
                      </td>
                      <td className={cn(st.td, "max-w-[220px] truncate")}>{campaignName(row)}</td>
                      <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}{row.needsYou ? ` · ${row.needsYou}` : ""}</StatusChip></td>
                      <td className={cn(st.td, st.num)}>{row.today.posts.toLocaleString("en-US")}</td>
                      <td className={cn(st.td, st.num)}>{pct(row.week.accepted, row.week.posts)}</td>
                      <td className={cn(st.td, st.num)}>{dollars(row.settings?.priceCents ?? null)}</td>
                      <td className={cn(st.td, "whitespace-nowrap")}>{row.lastPostAt ? `${row.lastPostWasTest ? "Test, " : ""}${ago(row.lastPostAt)}` : "Never"}</td>
                      <td className={cn(st.td, "text-[var(--muted)]")}><ChevronRight aria-hidden="true" className="size-4" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </TableCard>
    </div>
  );
}
