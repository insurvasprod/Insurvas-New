"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { notify } from "@/lib/notify";

import { PlanCompareFrame } from "@/components/admin/catalog/plan-compare";
import { PlanSheetFrame } from "@/components/admin/catalog/plan-sheet";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip } from "@/components/ui/status-chip";
import { Button, buttonVariants } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { TableCard } from "@/components/ui/table-card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PLAN_TYPES, PLAN_TYPE_LABELS, type PlanListRow, type PlanType } from "@/lib/plans/constants";
import { availableBillingCycles, formatCentsAsCurrency, priceForCycle, type PlanPrices } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PlanDialog } from "./plan-dialog";

const CYCLE_SHORT = { monthly: "mo", quarterly: "qtr", yearly: "yr" } as const;
const th = "px-3 py-2 text-left text-xs leading-[1.33] font-semibold text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)] whitespace-nowrap";

/** The cheapest offered cycle, with the others on hover. A plan with no price on any cycle cannot be sold. */
function PriceCell({ prices }: { prices: PlanPrices | null }) {
  const cycles = availableBillingCycles(prices);
  if (cycles.length === 0) return <span className="text-[var(--warning-ink)]">Not sellable</span>;
  const first = cycles[0];
  return (
    <span className="whitespace-nowrap" title={cycles.map((c) => `${c}: ${formatCentsAsCurrency(priceForCycle(prices, c) ?? 0)}`).join(" · ")}>
      {formatCentsAsCurrency(priceForCycle(prices, first) ?? 0)} / {CYCLE_SHORT[first]}
      {cycles.length > 1 && <span className="text-xs text-[var(--muted)]"> +{cycles.length - 1} {cycles.length === 2 ? "cycle" : "cycles"}</span>}
    </span>
  );
}

/**
 * The plans list (admin round 1, catalog.html screen 2): one TableCard with its toolbar inside, inside the Catalog
 * frame (the page draws the status line and the figures). Search, type and the archived toggle live in the address,
 * written in place without a round trip; a row opens the plan's sheet (`?plan=`), a server read that brings its
 * versions, subscribers and history. Every row action is kept (the ⋯ menu and the sheet's footer).
 */
export function PlansTable({
  plans,
  prices,
  latestSubscribers,
  sheet,
  sheetFor,
  compare,
}: {
  plans: PlanListRow[];
  /** Keyed by plan id. A missing entry means pricing was never set — the plan isn't sellable. */
  prices: Record<string, PlanPrices>;
  /** Live subscribers on each plan's LATEST version, keyed by plan id; the rest are on older versions. */
  latestSubscribers: Record<string, number>;
  /** The server-rendered body of the open plan's sheet, when the address names one. */
  sheet: ReactNode;
  /** Which plan `sheet` was rendered for. */
  sheetFor: string | null;
  /** The server-rendered Compare plans body, when the address asks for it. */
  compare: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PlanListRow | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const query = params.get("q") ?? "";
  const typeParam = params.get("type");
  const type: "" | PlanType = typeParam && (PLAN_TYPES as readonly string[]).includes(typeParam) ? (typeParam as PlanType) : "";
  const includeArchived = params.get("archived") === "1";

  // The sheet opens (and closes) at once; the address follows. A local choice holds only while the address is still
  // the one it was made against, so Back and Forward always win.
  const urlOpen = params.get("plan");
  const [asked, setAsked] = useState<{ id: string | null; against: string | null } | null>(null);
  const openId = asked && asked.against === urlOpen ? asked.id : urlOpen;
  const urlCompare = params.get("compare") === "1";
  const [askedCompare, setAskedCompare] = useState<{ open: boolean; against: boolean } | null>(null);
  const comparing = askedCompare && askedCompare.against === urlCompare ? askedCompare.open : urlCompare;

  const archivedCount = plans.filter((p) => p.is_archived).length;
  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => plans
      .filter((p) => (includeArchived || !p.is_archived) && (!type || p.plan_type === type) && (!needle || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle)))
      .sort((a, b) => b.subscriber_count - a.subscriber_count || a.sort_order - b.sort_order),
    [plans, includeArchived, type, needle],
  );
  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(rows, page, pageSize);
  const anyFilter = Boolean(needle || type);

  function setFilters(patch: Record<string, string | null>) {
    setParamsInPlace(patch);
    setPage(1);
  }
  const clear = () => setFilters({ q: null, type: null });

  const open = (id: string) => {
    setAsked({ id, against: urlOpen });
    const next = new URLSearchParams(window.location.search);
    next.set("plan", id);
    next.delete("compare");
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const close = () => {
    setAsked({ id: null, against: urlOpen });
    setParamsInPlace({ plan: null });
  };
  const closeCompare = () => {
    setAskedCompare({ open: false, against: urlCompare });
    setParamsInPlace({ compare: null });
  };

  async function call(plan: PlanListRow, url: string, init: RequestInit, done: (body: { plan?: { version?: number } } | null) => string) {
    setPendingId(plan.id);
    const res = await fetch(url, init);
    const body = await res.json().catch(() => null);
    setPendingId(null);
    if (!res.ok) { notify.block(body?.error ?? "Could not change the plan"); return false; }
    notify.done(done(body));
    router.refresh();
    return true;
  }

  async function setArchived(plan: PlanListRow, is_archived: boolean) {
    if (is_archived && !(await confirmAction({
      title: `Archive ${plan.name}?`,
      description: plan.subscriber_count > 0
        ? `It leaves the pricing page and the assign-plan picker. The ${plan.subscriber_count.toLocaleString("en-US")} ${plan.subscriber_count === 1 ? "subscriber keeps" : "subscribers keep"} it until they change plans.`
        : "It leaves the pricing page and the assign-plan picker. It can be restored.",
      confirmLabel: "Archive plan",
      cancelLabel: "Keep it",
      destructive: true,
    }))) return;
    void call(plan, `/api/admin/plans/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: plan.code, name: plan.name, description: plan.description ?? "", is_public: plan.is_public, is_archived, sort_order: plan.sort_order }),
    }, () => `${plan.name} ${is_archived ? "archived" : "restored"}`);
  }

  async function newVersion(plan: PlanListRow) {
    const staying = plan.subscriber_count;
    if (!(await confirmAction({
      title: `Publish a new version of ${plan.name}?`,
      description: `A copy of the latest version is published as the next one, for new sign-ups. ${staying === 0 ? "Nobody is on an earlier version." : `The ${staying.toLocaleString("en-US")} existing ${staying === 1 ? "subscriber stays" : "subscribers stay"} where they are.`}`,
      confirmLabel: "Publish new version",
      cancelLabel: "Not now",
    }))) return;
    void call(plan, `/api/admin/plans/${plan.id}/new-version`, { method: "POST" }, (body) =>
      `${plan.name} v${body?.plan?.version ?? plan.version + 1} published — ${staying === 0 ? "nobody was on an earlier version" : `the ${staying.toLocaleString()} existing ${staying === 1 ? "subscriber stays" : "subscribers stay"} where they are`}`);
  }

  async function remove(plan: PlanListRow) {
    if (!(await confirmAction({ title: `Delete ${plan.name}?`, description: "Nobody has ever been on this plan, so it can be removed for good. This cannot be undone.", confirmLabel: "Delete plan", cancelLabel: "Keep it", destructive: true }))) return;
    if (await call(plan, `/api/admin/plans/${plan.id}`, { method: "DELETE" }, () => `${plan.name} deleted`)) close();
  }

  const openRow = openId ? plans.find((plan) => plan.id === openId) ?? null : null;

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={rows.length ? <Pager page={current} pageSize={pageSize} total={rows.length} noun={rows.length === 1 ? "plan" : "plans"} suffix="most subscribers first" onPage={setPage} /> : undefined}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch value={query} onChange={(value) => setFilters({ q: value || null })} placeholder="Search plan or code" />
            <select aria-label="Plan type" value={type} onChange={(event) => setFilters({ type: event.target.value || null })} className={toolbarControl}>
              <option value="">Every type</option>
              {PLAN_TYPES.map((value) => <option key={value} value={value}>{PLAN_TYPE_LABELS[value]}</option>)}
            </select>
            <select aria-label="Archived plans" value={includeArchived ? "include" : "hide"} onChange={(event) => setFilters({ archived: event.target.value === "include" ? "1" : null })} className={toolbarControl}>
              <option value="hide">Hide archived</option>
              <option value="include">Including archived{archivedCount > 0 ? ` (${archivedCount})` : ""}</option>
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={clear}>Clear</Button>}
          </DataToolbar>
        }
      >
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr className="bg-[var(--surface-alt)]">
                <th scope="col" className={th}>Plan</th>
                <th scope="col" className={cn(th, "w-[150px]")}>Code</th>
                <th scope="col" className={cn(th, "w-[160px]")}>Type</th>
                <th scope="col" className={cn(th, "w-[170px] text-right")}>Price</th>
                <th scope="col" className={cn(th, "w-[110px]")}>Visibility</th>
                <th scope="col" className={cn(th, "w-[170px] text-right")}>Subscribers</th>
                <th scope="col" className={cn(th, "w-[110px]")}>Status</th>
                <th scope="col" className={cn(th, "w-[56px]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.length === 0 ? (
                <tr><td colSpan={8} className="p-0">
                  {anyFilter ? <NoMatches noun="plans" onClear={clear} /> : (
                    <EmptyState title="No plans yet" hint="Nothing can be sold until one exists. Create the first with New plan." />
                  )}
                </td></tr>
              ) : shown.map((plan) => {
                const older = Math.max(0, plan.subscriber_count - (latestSubscribers[plan.id] ?? 0));
                const selected = plan.id === openId;
                return (
                  <tr key={plan.id} onClick={() => open(plan.id)} className={cn("m-row cursor-pointer hover:bg-[var(--hover-wash)]", selected && "bg-[var(--hover-wash)]", plan.is_archived && "[&>td]:text-[var(--muted)]")}>
                    <td className={td}>
                      <span className="flex min-w-0 items-center gap-2">
                        <button type="button" onClick={(event) => { event.stopPropagation(); open(plan.id); }} className="min-w-0 cursor-pointer truncate rounded-[4px] text-left font-semibold text-[var(--ink)] hover:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                          {plan.name}
                        </button>
                        <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]" title={`${plan.version_count} ${plan.version_count === 1 ? "version" : "versions"}`}>v{plan.version}</span>
                        {plan.is_default && <span className="shrink-0 text-xs text-[var(--muted)]">· Default</span>}
                      </span>
                    </td>
                    <td className={td}><code className="font-mono text-sm">{plan.code}</code></td>
                    <td className={td}>{PLAN_TYPE_LABELS[plan.plan_type]}</td>
                    <td className={cn(td, "text-right tabular-nums")}><PriceCell prices={prices[plan.id] ?? null} /></td>
                    <td className={td}>{plan.is_public ? "Public" : "Private"}</td>
                    <td className={cn(td, "text-right tabular-nums")}>
                      {plan.subscriber_count.toLocaleString()}
                      {older > 0 && <span className="text-xs text-[var(--muted)]"> · {older.toLocaleString()} on older</span>}
                    </td>
                    <td className={td}>
                      {plan.is_archived ? <StatusChip tone="neutral">Archived</StatusChip> : <StatusChip tone="good" dot>Live</StatusChip>}
                    </td>
                    <td className={cn(td, "text-right")} onClick={(event) => event.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${plan.name}`} disabled={pendingId === plan.id}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => open(plan.id)}>Open</DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href={`/admin/plans/${plan.id}/edit`}>Edit features &amp; pricing</Link></DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(plan)}>Edit details</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void newVersion(plan)}>Publish new version</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {plan.is_archived
                            ? <DropdownMenuItem onSelect={() => void setArchived(plan, false)}>Restore</DropdownMenuItem>
                            : <DropdownMenuItem variant="destructive" onSelect={() => void setArchived(plan, true)}>Archive</DropdownMenuItem>}
                          {/* Delete only for a plan nobody has ever been on — anything else is archived, and the API refuses it regardless. */}
                          {plan.ever_subscribed_count === 0 && <DropdownMenuItem variant="destructive" onSelect={() => void remove(plan)}>Delete</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </TableCard>

      {openId && (
        <PlanSheetFrame
          row={openRow}
          loading={sheetFor !== openId}
          onClose={close}
          footer={openRow ? (
            <>
              <Link href={`/admin/plans/${openRow.id}/edit`} className={buttonVariants({ variant: "default" })}>Edit Features &amp; Pricing ›</Link>
              <span className="flex-1" />
              <Button type="button" variant="outline" onClick={() => setEditing(openRow)}>Edit details…</Button>
              <Button type="button" variant="outline" disabled={pendingId === openRow.id} onClick={() => void newVersion(openRow)}>Publish new version…</Button>
              {openRow.is_archived
                ? <Button type="button" variant="outline" disabled={pendingId === openRow.id} onClick={() => void setArchived(openRow, false)}>Restore</Button>
                : <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={pendingId === openRow.id} onClick={() => void setArchived(openRow, true)}>Archive…</Button>}
              {openRow.ever_subscribed_count === 0 && <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={pendingId === openRow.id} onClick={() => void remove(openRow)}>Delete…</Button>}
            </>
          ) : (
            <>
              <span className="flex-1" />
              <Button type="button" variant="outline" onClick={close}>Close</Button>
            </>
          )}
        >
          {sheetFor === openId ? sheet : null}
        </PlanSheetFrame>
      )}

      {comparing && (
        <PlanCompareFrame loading={!urlCompare || !compare} onClose={closeCompare}>
          {urlCompare ? compare : null}
        </PlanCompareFrame>
      )}

      <PlanDialog key={`edit-${editing?.id ?? "none"}`} mode="edit" open={editing !== null} plan={editing} onClose={() => setEditing(null)} onSaved={() => router.refresh()} />
    </>
  );
}
