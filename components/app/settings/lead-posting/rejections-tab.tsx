"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { st } from "@/components/app/settings/primitives";
import { fixForReason, REASON_CHIP, REASON_WORDS, type LeadPostBoard } from "@/lib/leadPost/board";
import type { RefusedPost } from "@/lib/leadPost/boardStore";
import { cn } from "@/lib/utils";

export type RejectionWindow = 1 | 7 | 30;
export type Refused = { rows: RefusedPost[]; capped: boolean };

/** The reasons that repeat, per vendor, most first. */
export function repeatingReasons(rows: RefusedPost[]) {
  const tally = new Map<string, { vendorId: string; vendorName: string; reasonCode: string; count: number }>();
  for (const row of rows) {
    const key = `${row.vendorId}|${row.reasonCode}`;
    const entry = tally.get(key) ?? { vendorId: row.vendorId, vendorName: row.vendorName, reasonCode: row.reasonCode, count: 0 };
    entry.count += 1;
    tally.set(key, entry);
  }
  return [...tally.values()].sort((a, b) => b.count - a.count);
}

const time = (value: string, days: RejectionWindow) =>
  days === 1
    ? new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : new Date(value).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Rejections (board A9): a one-line log of refused posts and, beside it, the reasons that keep
 * happening, each with its fix. A refused post is never charged; the log says so per row.
 */
export function RejectionsTab({
  board,
  days,
  onDays,
  vendorFilter,
  onVendorFilter,
  refused,
  error,
  onRetry,
  onFixMap,
  onTellVendor,
  onRotate,
}: {
  board: LeadPostBoard;
  days: RejectionWindow;
  onDays: (days: RejectionWindow) => void;
  vendorFilter: string;
  onVendorFilter: (vendorId: string) => void;
  refused: Refused | null;
  error: string | null;
  onRetry: () => void;
  onFixMap: (vendorId: string) => void;
  onTellVendor: (vendorId: string, reasonCode: string, count: number) => void;
  onRotate: (vendorId: string) => void;
}) {
  const rows = (refused?.rows ?? []).filter((row) => !vendorFilter || row.vendorId === vendorFilter);
  const reasons = repeatingReasons(rows);
  const vendors = [...new Map((refused?.rows ?? []).map((row) => [row.vendorId, row.vendorName])).entries()];
  const period = days === 1 ? "today" : `${days} days`;

  return (
    <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start">
      <TableCard
        className="min-w-0 flex-1"
        title="Refused posts"
        toolbar={
          <>
            <Segmented label="Window" options={[{ key: "1", label: "Today" }, { key: "7", label: "7 days" }, { key: "30", label: "30 days" }]} value={String(days) as "1" | "7" | "30"} onChange={(next) => onDays(Number(next) as RejectionWindow)} />
            <select aria-label="Vendor" className={cn(toolbarControl, "ml-auto")} value={vendorFilter} onChange={(event) => onVendorFilter(event.target.value)}>
              <option value="">All vendors</option>
              {vendors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </>
        }
        footer={refused?.capped ? <p className="m-0 px-4 py-3 text-xs text-[var(--muted)]">The newest 500 are shown; export the CSV for these too.</p> : undefined}
      >
        <div className="max-h-[560px] overflow-y-auto">
          {error ? (
            <ErrorState title="Refused posts didn't load" detail="Posts are still being accepted; only this list failed to load." action={<Button type="button" variant="outline" onClick={onRetry}>Try again</Button>} />
          ) : !refused ? (
            <SectionLoading label="Loading refused posts" rows={6} columns={5} />
          ) : refused.rows.length === 0 ? (
            <EmptyState title={`Nothing refused ${days === 1 ? "today" : `in ${period}`}`} hint="A refused post is a lead you are not billed for. When one is refused, it shows here with the reason and the fix." />
          ) : rows.length === 0 ? (
            <NoMatches noun="refused posts" onClear={() => onVendorFilter("")} />
          ) : (
            <table className={st.table} aria-label="Refused posts">
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={cn(st.th, "w-[150px]")}>Time</th>
                  <th scope="col" className={st.th}>Vendor</th>
                  <th scope="col" className={st.th}>Lead</th>
                  <th scope="col" className={st.th}>Why</th>
                  <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Charged</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.receivedAt}-${index}`}>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{time(row.receivedAt, days)}</td>
                    <td className={cn(st.td, "max-w-[180px] truncate")}>{row.vendorName}</td>
                    <td className={cn(st.td, "max-w-[160px] truncate")}>{row.lead}</td>
                    <td className={cn(st.td, "whitespace-nowrap")}><StatusChip tone={REASON_CHIP[row.reasonCode] ?? "danger"}>{REASON_WORDS[row.reasonCode] ?? row.reasonCode}</StatusChip></td>
                    <td className={cn(st.td, st.num)}>$0.00</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </TableCard>

      <TableCard className="w-full shrink-0 xl:w-[380px]" title="What keeps happening" action={<span className="text-xs text-[var(--muted)]">{period}</span>} footer={<p className="m-0 px-4 py-3 text-xs text-[var(--muted)]">&ldquo;Tell vendor&rdquo; opens an email to them with the refused posts and the rule they broke.</p>}>
        {reasons.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-sm text-[var(--muted)]">Nothing repeats.</p>
        ) : (
          <ul className="m-0 flex max-h-[480px] list-none flex-col overflow-y-auto p-0">
            {reasons.map((reason, index) => {
              const vendor = board.vendors.find((row) => row.vendorId === reason.vendorId);
              const fix = fixForReason(reason.reasonCode, vendor?.key.campaignId ?? null);
              const guess = reason.reasonCode === "invalid_phone" || reason.reasonCode === "unknown_state" || reason.reasonCode === "missing_required_field" ? vendor?.unreadGuesses[0] : undefined;
              const detail = guess ? `their ${guess.theirs} isn't read` : fix.kind === "none" ? fix.label : null;
              return (
                <li key={`${reason.vendorId}-${reason.reasonCode}`} className="flex min-w-0 items-center gap-3 border-t border-[var(--border)] px-4 py-2.5 first:border-t-0">
                  <span className="w-7 shrink-0 text-right text-base font-semibold tabular-nums text-[var(--ink)]">{reason.count}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{REASON_WORDS[reason.reasonCode] ?? reason.reasonCode}</span>
                    <span className="block truncate text-xs text-[var(--muted)]">{reason.vendorName}{detail ? ` · ${detail}` : ""}</span>
                  </span>
                  {fix.kind === "map" ? <Button type="button" size="sm" variant={index === 0 ? "default" : "outline"} disabled={!vendor} onClick={() => onFixMap(reason.vendorId)}>{fix.label}</Button>
                    : fix.kind === "tell" ? <Button type="button" size="sm" variant="outline" onClick={() => onTellVendor(reason.vendorId, reason.reasonCode, reason.count)}>{fix.label}</Button>
                    : fix.kind === "rotate" ? <Button type="button" size="sm" variant="outline" disabled={!vendor} onClick={() => onRotate(reason.vendorId)}>{fix.label}</Button>
                    : fix.kind === "licence" || fix.kind === "campaign" ? <Button asChild size="sm" variant="outline"><Link href={fix.href}>{fix.label}</Link></Button>
                    : <span className="shrink-0 text-xs text-[var(--muted)]">Nothing to fix</span>}
                </li>
              );
            })}
          </ul>
        )}
      </TableCard>
    </div>
  );
}
