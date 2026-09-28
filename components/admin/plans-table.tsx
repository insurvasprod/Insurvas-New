"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { notify } from "@/lib/notify";

import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip } from "@/components/admin/status-chip";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PLAN_TYPES, PLAN_TYPE_LABELS, type PlanListRow, type PlanType } from "@/lib/plans/constants";
import { availableBillingCycles, formatCentsAsCurrency, priceForCycle, type PlanPrices } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PlanDialog } from "./plan-dialog";

const PAGE = 25;
const CYCLE_SHORT = { monthly: "mo", quarterly: "qtr", yearly: "yr" } as const;
const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

/** The cheapest offered cycle, with the others on hover. A plan with no price on any cycle cannot be sold. */
function PriceCell({ prices }: { prices: PlanPrices | null }) {
  const cycles = availableBillingCycles(prices);
  if (cycles.length === 0) return <span className="text-[var(--warning-ink)]">Not sellable</span>;
  const first = cycles[0];
  return (
    <span className="whitespace-nowrap" title={cycles.map((c) => `${c}: ${formatCentsAsCurrency(priceForCycle(prices, c) ?? 0)}`).join(" · ")}>
      {formatCentsAsCurrency(priceForCycle(prices, first) ?? 0)} / {CYCLE_SHORT[first]}
      {cycles.length > 1 && <span className="text-[12px] text-[var(--muted)]"> +{cycles.length - 1} {cycles.length === 2 ? "cycle" : "cycles"}</span>}
    </span>
  );
}

/**
 * The plans board (p-adm-plans): header with New plan, the figure strip, then one TableCard with its toolbar inside.
 *
 * Reads its rows from the page (server props) and refreshes through the router after a change, so
 * the figures, the table and a plan created from the header can never disagree.
 */
export function PlansTable({
  plans,
  prices,
  latestSubscribers,
}: {
  plans: PlanListRow[];
  /** Keyed by plan id. A missing entry means pricing was never set — the plan isn't sellable. */
  prices: Record<string, PlanPrices>;
  /** Live subscribers on each plan's LATEST version, keyed by plan id; the rest are on older versions. */
  latestSubscribers: Record<string, number>;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | PlanType>("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PlanListRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const archivedCount = plans.filter((p) => p.is_archived).length;
  const publicCount = plans.filter((p) => p.is_public && !p.is_archived).length;
  const subscribers = plans.reduce((sum, p) => sum + p.subscriber_count, 0);
  const onOld = plans.reduce((sum, p) => sum + Math.max(0, p.subscriber_count - (latestSubscribers[p.id] ?? 0)), 0);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => plans
      .filter((p) => (includeArchived || !p.is_archived) && (!type || p.plan_type === type) && (!needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle)))
      .sort((a, b) => b.subscriber_count - a.subscriber_count || a.sort_order - b.sort_order),
    [plans, includeArchived, type, needle],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const anyFilter = Boolean(needle || type);

  async function call(plan: PlanListRow, url: string, init: RequestInit, done: (body: { plan?: { version?: number } } | null) => string) {
    setPendingId(plan.id);
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    setPendingId(null);
    if (!res.ok) { notify.block(body?.error ?? "Could not change the plan"); return; }
    notify.done(done(body));
    router.refresh();
  }

  function setArchived(plan: PlanListRow, is_archived: boolean) {
    void call(plan, `/api/admin/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: plan.code, name: plan.name, description: plan.description ?? "", is_public: plan.is_public, is_archived, sort_order: plan.sort_order }),
    }, () => `${plan.name} ${is_archived ? "archived" : "restored"}`);
  }

  function newVersion(plan: PlanListRow) {
    const staying = plan.subscriber_count;
    void call(plan, `/api/admin/plans/${plan.id}/new-version`, { method: "POST" }, (body) =>
      `${plan.name} v${body?.plan?.version ?? plan.version + 1} published — ${staying === 0 ? "nobody was on an earlier version" : `the ${staying.toLocaleString()} existing ${staying === 1 ? "subscriber stays" : "subscribers stay"} where they are`}`);
  }

  function remove(plan: PlanListRow) {
    void call(plan, `/api/admin/plans/${plan.id}`, { method: "DELETE" }, () => `${plan.name} deleted`);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Plans"
        description="Existing subscribers keep the version they bought."
        actions={<Button type="button" onClick={() => setCreating(true)}>New plan</Button>}
      />

      <BoardStatGrid>
        <BoardStatTile label="Plans" value={(plans.length - archivedCount).toLocaleString()} footnote={archivedCount > 0 ? `${archivedCount} archived` : "none archived"} />
        <BoardStatTile label="Public" value={publicCount.toLocaleString()} footnote="on the pricing page" />
        <BoardStatTile label="Subscribers" value={subscribers.toLocaleString()} footnote="across all versions" />
        <BoardStatTile label="On an old version" value={onOld.toLocaleString()} footnote={subscribers > 0 ? `${((onOld / subscribers) * 100).toFixed(1)}%` : "nobody subscribed yet"} />
      </BoardStatGrid>

      <TableCard
        className="min-w-0"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search plan or code" />
            <select aria-label="Plan type" value={type} onChange={(event) => { setType(event.target.value as "" | PlanType); setPage(1); }} className={toolbarControl}>
              <option value="">Every type</option>
              {PLAN_TYPES.map((value) => <option key={value} value={value}>{PLAN_TYPE_LABELS[value]}</option>)}
            </select>
            <select aria-label="Archived plans" value={includeArchived ? "include" : "hide"} onChange={(event) => { setIncludeArchived(event.target.value === "include"); setPage(1); }} className={toolbarControl}>
              <option value="hide">Hide archived</option>
              <option value="include">Including archived{archivedCount > 0 ? ` (${archivedCount})` : ""}</option>
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={() => { setQuery(""); setType(""); setPage(1); }}>Clear</Button>}
          </DataToolbar>
        }
      >
          <table className="w-full min-w-[880px] border-collapse">
            <thead>
              <tr className="bg-[var(--surface-alt)]">
                <th scope="col" className={th}>Plan</th>
                <th scope="col" className={cn(th, "w-[150px]")}>Code</th>
                <th scope="col" className={cn(th, "w-[170px]")}>Type</th>
                <th scope="col" className={cn(th, "w-[170px]")}>Price</th>
                <th scope="col" className={cn(th, "w-[130px]")}>Visibility</th>
                <th scope="col" className={cn(th, "w-[170px] text-right")}>Subscribers</th>
                <th scope="col" className={cn(th, "w-[56px]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={7} className="p-0">
                  {anyFilter ? <NoMatches noun="plans" onClear={() => { setQuery(""); setType(""); }} /> : (
                    <EmptyState title="No plans yet" hint="Nothing can be sold until one exists. Create the first with New plan." />
                  )}
                </td></tr>
              ) : shown.map((plan) => {
                const older = Math.max(0, plan.subscriber_count - (latestSubscribers[plan.id] ?? 0));
                return (
                  <tr key={plan.id} className={cn("hover:bg-[color-mix(in_srgb,var(--primary),transparent_95%)]", plan.is_archived && "opacity-60")}>
                    <td className={td}>
                      <span className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/plans/${plan.id}/edit`} className="font-semibold text-[var(--ink)] hover:underline">{plan.name}</Link>
                        <span className="rounded-full bg-[var(--surface-alt)] px-2 py-[1px] text-[12px] font-semibold tabular-nums text-[var(--body)]" title={`${plan.version_count} ${plan.version_count === 1 ? "version" : "versions"}`}>v{plan.version}</span>
                        {plan.is_default && <StatusChip tone="info">Default</StatusChip>}
                      </span>
                    </td>
                    <td className={td}><code className="font-mono text-[14px]">{plan.code}</code></td>
                    <td className={td}>{PLAN_TYPE_LABELS[plan.plan_type]}</td>
                    <td className={cn(td, "tabular-nums")}><PriceCell prices={prices[plan.id] ?? null} /></td>
                    <td className={td}>
                      {plan.is_archived ? <StatusChip tone="neutral">Archived</StatusChip> : plan.is_public ? <StatusChip tone="good" dot>Public</StatusChip> : <StatusChip tone="neutral" dot>Private</StatusChip>}
                    </td>
                    <td className={cn(td, "text-right tabular-nums")}>
                      {plan.subscriber_count.toLocaleString()} {plan.subscriber_count === 1 ? "subscriber" : "subscribers"}
                      {older > 0 && <span className="block text-[12px] text-[var(--muted)]">{older.toLocaleString()} on older versions</span>}
                    </td>
                    <td className={cn(td, "text-right")}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${plan.name}`} disabled={pendingId === plan.id}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild><Link href={`/admin/plans/${plan.id}/edit`}>Edit features &amp; pricing</Link></DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(plan)}>Edit details</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => newVersion(plan)}>Publish new version</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {plan.is_archived
                            ? <DropdownMenuItem onSelect={() => setArchived(plan, false)}>Restore</DropdownMenuItem>
                            : <DropdownMenuItem variant="destructive" onSelect={() => setArchived(plan, true)}>Archive</DropdownMenuItem>}
                          {/* Delete only for a plan nobody has ever been on — anything else is archived, and the API refuses it regardless. */}
                          {plan.ever_subscribed_count === 0 && <DropdownMenuItem variant="destructive" onSelect={() => remove(plan)}>Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        {rows.length > 0 && <BoardTableFooter page={current} pageSize={PAGE} total={rows.length} itemLabel={rows.length === 1 ? "plan" : "plans"} order="most subscribers first" onPageChange={setPage} />}
      </TableCard>

      <PlanDialog mode="create" open={creating} onClose={() => setCreating(false)} onSaved={() => router.refresh()} />
      <PlanDialog key={`edit-${editing?.id ?? "none"}`} mode="edit" open={editing !== null} plan={editing} onClose={() => setEditing(null)} onSaved={() => router.refresh()} />
    </div>
  );
}
