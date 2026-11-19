"use client";

import type { ReactNode } from "react";

import { SettingsMeter } from "@/components/app/settings/primitives";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { forecastHit, forecastLabel, tenantsOverLabel, type LimitState, type MonitorEntry } from "@/lib/creditsLimits/present";

export type UsageShow = "all" | "watch" | "over";

const count = (value: number) => value.toLocaleString("en-US");
const METER_TONE: Record<LimitState, "error" | "warning" | "success"> = { over: "error", near: "warning", ok: "success" };
const CHIP: Record<LimitState, StatusTone> = { over: "danger", near: "warning", ok: "neutral" };

export function usageState(entry: MonitorEntry): { tone: StatusTone; label: string } {
  if (entry.state === "over") return { tone: CHIP.over, label: "Over" };
  const pct = entry.limit > 0 ? Math.round((entry.used / entry.limit) * 100) : 0;
  return { tone: CHIP[entry.state], label: `${pct}%` };
}

/**
 * The Usage lens of Credits & limits (admin round 1, billing-r2 screen 10): every finite limit, nearest first, one
 * line a row, with "Hits the limit" from this month's pace. All, at the warn threshold or more (the old "Over N%"),
 * or strictly over; a row opens the customer's limit as a sheet (grant, add a pack, email the owner).
 */
export function CreditsUsage({ entries, warnPercent, overCount, show, onShow, page, onPage, lenses, refreshing, onRefresh, onOpen, now }: {
  entries: MonitorEntry[];
  warnPercent: number;
  overCount: number;
  show: UsageShow;
  onShow: (show: UsageShow) => void;
  page: number;
  onPage: (page: number) => void;
  /** The lens switch, first in the toolbar. */
  lenses: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  onOpen: (entry: MonitorEntry) => void;
  now: Date;
}) {
  const pageSize = useFittingPageSize(480, 45);
  const visible = show === "over" ? entries.filter((e) => e.state === "over") : show === "watch" ? entries.filter((e) => e.state !== "ok") : entries;
  const { current, rows } = paginate(visible, page, pageSize);
  const atOrOver = entries.filter((e) => e.state !== "ok").length;
  const over = entries.filter((e) => e.state === "over").length;

  return (
    <TableCard
      className="min-w-0"
      footer={visible.length ? <Pager page={current} pageSize={pageSize} total={visible.length} noun={visible.length === 1 ? "limit" : "limits"} suffix={`nearest the limit first · ${tenantsOverLabel(overCount).toLowerCase()}`} onPage={onPage} /> : undefined}
      toolbar={
        <DataToolbar actions={<RefreshButton refreshing={refreshing} onClick={onRefresh} />}>
          {lenses}
          <Segmented
            label="Show limits"
            value={show}
            onChange={onShow}
            options={[
              { key: "all", label: "All", count: entries.length },
              { key: "watch", label: `${warnPercent}% or more`, count: atOrOver },
              { key: "over", label: "Over", count: over, tone: "danger" },
            ]}
          />
        </DataToolbar>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          title={show === "all" ? "No limit to watch" : show === "over" ? "Nobody is over a limit" : `Nobody is at ${warnPercent}% of a limit`}
          hint={show === "all" ? "No tenant has a finite limit to watch. Unlimited meters are not listed." : "The rows come back here as use grows."}
        />
      ) : (
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Meter</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead className="w-[160px]">Use</TableHead>
              <TableHead>Hits the limit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><span className="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry) => {
              const chip = usageState(entry);
              const extra = [entry.addonQty > 0 ? `incl. ${count(entry.addonQty)} from add-ons` : null, entry.grantQty > 0 ? `incl. ${count(entry.grantQty)} granted` : null].filter(Boolean).join(" · ");
              return (
                <TableRow key={entry.key} className="cursor-pointer" onClick={() => onOpen(entry)}>
                  <TableCell className="max-w-[16rem] truncate font-medium text-foreground" title={entry.tenantStatus !== "active" ? `${entry.tenantName} · ${entry.tenantStatus}` : entry.tenantName}>
                    <button type="button" className="hover:underline" onClick={(event) => { event.stopPropagation(); onOpen(entry); }}>{entry.tenantName}</button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{entry.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{count(entry.used)}</TableCell>
                  <TableCell className="text-right tabular-nums" title={extra || undefined}>{count(entry.limit)}</TableCell>
                  <TableCell>
                    <SettingsMeter value={entry.used} max={entry.limit} tone={METER_TONE[entry.state]} ariaLabel={`${entry.tenantName}, ${entry.label}: ${count(entry.used)} of ${count(entry.limit)}`} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{forecastLabel(forecastHit(entry, now))}</TableCell>
                  <TableCell><StatusChip tone={chip.tone} dot>{chip.label}</StatusChip></TableCell>
                  <TableCell className="text-right text-muted-foreground" aria-hidden="true">›</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
