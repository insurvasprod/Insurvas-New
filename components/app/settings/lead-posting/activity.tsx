"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { st } from "@/components/app/settings/primitives";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { fixForReason, REASON_CHIP, REASON_WORDS, type VendorRow } from "@/lib/leadPost/board";
import type { CampaignSpeedRow } from "@/lib/leadPost/campaignSpeed";
import type { PostActivity, RecentPost } from "@/lib/leadPost/types";
import { cn } from "@/lib/utils";

/**
 * Every post, newest first (page tab "Activity") and one vendor's (sheet › Activity). Payloads stay
 * out of sight; an accepted post opens its lead. One line a row, one chip.
 */
export function PostsTable({ rows, vendorName, withVendor, label }: { rows: RecentPost[]; vendorName: (id: string | null) => string; withVendor: boolean; label: string }) {
  return (
    <table className={st.table} aria-label={label}>
      <thead>
        <tr className={st.headRow}>
          <th scope="col" className={cn(st.th, "w-[170px]")}>Arrived</th>
          {withVendor && <th scope="col" className={st.th}>Vendor</th>}
          <th scope="col" className={st.th}>Outcome</th>
          <th scope="col" className={cn(st.th, "w-[80px] text-right")}>Took</th>
          <th scope="col" className={cn(st.th, "w-[100px]")}><span className="sr-only">Lead</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.receivedAt}-${index}`}>
            <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{dateTime(row.receivedAt, viewerTimeZone())}</td>
            {withVendor && <td className={cn(st.td, "max-w-[220px] truncate")}>{vendorName(row.vendorId)}</td>}
            <td className={cn(st.td, "whitespace-nowrap")}>
              {row.isTest
                ? <StatusChip tone="info">{row.outcome === "accepted" ? "Test · accepted" : `Test · ${(REASON_WORDS[row.reasonCode] ?? row.reasonCode).toLowerCase()}`}</StatusChip>
                : row.outcome === "accepted"
                  ? <StatusChip tone="good">Accepted</StatusChip>
                  : <StatusChip tone={row.outcome === "error" ? "warning" : REASON_CHIP[row.reasonCode] ?? "danger"}>{REASON_WORDS[row.reasonCode] ?? row.reasonCode}</StatusChip>}
            </td>
            <td className={cn(st.td, st.num)}>{row.processingMs === null ? "—" : `${(row.processingMs / 1000).toFixed(1)} s`}</td>
            <td className={cn(st.td, "text-right")}>{row.leadId && !row.isTest && <Link href={`/app/leads/${row.leadId}`} className="text-sm font-semibold text-[var(--accent-ink)] hover:underline">Open lead</Link>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const seconds = (value: number | null) => {
  if (value === null) return "—";
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  return minutes < 60 ? `${minutes} min ${Math.round(value % 60)} s` : `${Math.round(minutes / 60)} h`;
};

/** Vendor sheet › Activity: its last posts, why its posts bounced this week with the fix, and its speed to lead. */
export function SheetActivityTab({
  row,
  activity,
  activityError,
  speed,
  onFixMap,
  onRotate,
  onTellVendor,
}: {
  row: VendorRow;
  activity: PostActivity | null;
  activityError: string | null;
  speed: CampaignSpeedRow[] | null;
  onFixMap: () => void;
  onRotate: () => void;
  onTellVendor: (reasonCode: string, count: number) => void;
}) {
  const posts = (activity?.recent ?? []).filter((post) => post.vendorId === row.vendorId);
  const vendorSpeed = (speed ?? []).filter((item) => item.vendorId === row.vendorId && item.postedLeads > 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Posts, 7 days", row.week.posts.toLocaleString("en-US")],
          ["Accepted", row.week.posts ? `${Math.round((row.week.accepted / row.week.posts) * 100)}%` : "—"],
          ["Refused", row.week.refused.toLocaleString("en-US")],
          ["First dial, median", vendorSpeed.length ? seconds(vendorSpeed[0].medianSeconds) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-[10px] bg-[var(--surface-alt)] px-3 py-2">
            <div className="text-xs text-[var(--muted)]">{label}</div>
            <div className="text-sm font-semibold tabular-nums text-[var(--ink)]">{value}</div>
          </div>
        ))}
      </div>

      {row.weekReasons.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">Why posts were refused, 7 days</h3>
          {row.weekReasons.map((reason) => {
            const fix = fixForReason(reason.reasonCode, row.key.campaignId);
            return (
              <div key={reason.reasonCode} className="flex min-w-0 items-center gap-3 border-t border-[var(--border)] py-2 first:border-t-0">
                <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--ink)]">{reason.count}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--body)]">{REASON_WORDS[reason.reasonCode] ?? reason.reasonCode}</span>
                {fix.kind === "map" ? <Button type="button" size="sm" onClick={onFixMap}>{fix.label}</Button>
                  : fix.kind === "rotate" ? <Button type="button" variant="outline" size="sm" onClick={onRotate}>{fix.label}</Button>
                  : fix.kind === "tell" ? <Button type="button" variant="outline" size="sm" onClick={() => onTellVendor(reason.reasonCode, reason.count)}>{fix.label}</Button>
                  : fix.kind === "licence" || fix.kind === "campaign" ? <Button asChild variant="outline" size="sm"><Link href={fix.href}>{fix.label}</Link></Button>
                  : <span className="shrink-0 text-xs text-[var(--muted)]">{fix.label}</span>}
              </div>
            );
          })}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">Recent posts</h3>
        {activityError ? (
          <ErrorState title="Posts didn't load" detail={activityError} />
        ) : !activity ? (
          <SectionLoading label="Loading recent posts" rows={4} columns={3} />
        ) : posts.length === 0 ? (
          <EmptyState title={`No posts from ${row.vendorName} yet`} hint="Send a test post from the Test tab to see what theirs would get." />
        ) : (
          <TableCard><PostsTable rows={posts.slice(0, 25)} vendorName={() => row.vendorName} withVendor={false} label={`${row.vendorName}'s recent posts`} /></TableCard>
        )}
      </section>

      {vendorSpeed.length > 1 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">Speed to lead by campaign</h3>
          {vendorSpeed.map((item) => (
            <div key={item.campaignId} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-[var(--ink)]">{item.campaignName}</span>
              <span className="shrink-0 tabular-nums text-[var(--body)]">{seconds(item.medianSeconds)} · {item.dialledWithin60sPct ?? 0}% inside a minute</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
