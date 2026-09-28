"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Pill, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { BILLING_CYCLES, BILLING_CYCLE_LABELS, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import { LIST_ORDER, LIST_STATUS, LIST_STATUS_ORDER, type QueuedKind, type SubscriptionListRow } from "@/lib/subscriptionsList/model";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

type StatusFilter = "all" | "current" | SubscriptionStatus;
type QueuedFilter = "any" | "plan" | "ends" | "trial" | "none";

const CYCLE_UNIT: Record<BillingCycle, string> = { monthly: "month", quarterly: "quarter", yearly: "year" };

/**
 * The subscriptions list (board p-adm-subscriptions): one TableCard, its toolbar inside, the pager
 * at its foot.
 *
 * Read-only on purpose: assigning, changing, pausing and cancelling
 * stay on the tenant record, next to the customer they affect. A row opens in place to show the
 * dates to the second, the cancellation reason and what the plan is worth a month, with the way
 * through to that tenant's Subscription & billing tab.
 */
export function SubscriptionsList({
  rows,
  plans,
  listError,
}: {
  rows: SubscriptionListRow[];
  plans: { id: string; label: string }[];
  listError: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cycle, setCycle] = useState<"any" | BillingCycle>("any");
  const [queued, setQueued] = useState<QueuedFilter>("any");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const queuedCounts = useMemo(() => {
    const counts: Record<QueuedKind, number> = { plan: 0, ends: 0, trial: 0, ended: 0, none: 0 };
    for (const row of rows) counts[row.queuedKind] += 1;
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (plan !== "all" && row.planId !== plan) return false;
      if (status === "current" && row.status === "cancelled") return false;
      if (status !== "all" && status !== "current" && row.status !== status) return false;
      if (cycle !== "any" && row.cycle !== cycle) return false;
      if (queued === "none" && row.queuedKind !== "none" && row.queuedKind !== "ended") return false;
      if (queued !== "any" && queued !== "none" && row.queuedKind !== queued) return false;
      if (!needle) return true;
      return row.tenantName.toLowerCase().includes(needle) || row.tenantId.toLowerCase() === needle;
    });
  }, [rows, search, plan, status, cycle, queued]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const anyFilter = status !== "all" || cycle !== "any" || queued !== "any" || plan !== "all" || search.trim() !== "";

  function clearAll() {
    setStatus("all");
    setCycle("any");
    setQueued("any");
    setSearch("");
    setPlan("all");
    setPage(1);
  }

  return (
    <TableCard
      className="min-w-0"
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
          <ToolbarSearch
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search tenant"
          />
          <select
            aria-label="Plan"
            value={plan}
            onChange={(event) => {
              setPlan(event.target.value);
              setPage(1);
            }}
            className={cn(toolbarControl, "max-w-48")}
          >
            <option value="all">All plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPage(1);
            }}
            className={toolbarControl}
          >
            <option value="all">All statuses</option>
            <option value="current">Everything but expired</option>
            {LIST_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {LIST_STATUS[s].label}
              </option>
            ))}
          </select>
          <select
            aria-label="Cycle"
            value={cycle}
            onChange={(event) => {
              setCycle(event.target.value as "any" | BillingCycle);
              setPage(1);
            }}
            className={toolbarControl}
          >
            <option value="any">Any cycle</option>
            {BILLING_CYCLES.map((c) => (
              <option key={c} value={c}>
                {BILLING_CYCLE_LABELS[c]}
              </option>
            ))}
          </select>
          <select
            aria-label="Queued change"
            value={queued}
            onChange={(event) => {
              setQueued(event.target.value as QueuedFilter);
              setPage(1);
            }}
            className={toolbarControl}
          >
            <option value="any">Any queued change</option>
            <option value="plan">Plan change at renewal ({queuedCounts.plan})</option>
            <option value="ends">Ends at period end ({queuedCounts.ends})</option>
            <option value="trial">Trial ending ({queuedCounts.trial})</option>
            <option value="none">Nothing queued</option>
          </select>
          {anyFilter && (
            <Button type="button" variant="ghost" onClick={clearAll}>
              Clear
            </Button>
          )}
        </DataToolbar>
      }
    >
          <table className={cn(st.table, "min-w-[900px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Tenant</th>
                <th scope="col" className={cn(st.th, "w-[180px]")}>Plan</th>
                <th scope="col" className={cn(st.th, "w-[100px]")}>Cycle</th>
                <th scope="col" className={cn(st.th, "w-[140px]")}>Status</th>
                <th scope="col" className={cn(st.th, "w-[190px]")}>Current period</th>
                <th scope="col" className={cn(st.th, "w-[200px]")}>Queued change</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {listError && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <ErrorState
                      title="The subscriptions could not be read"
                      detail="The list did not load, so nothing below is a count of zero. Reload the page; if it keeps failing, the error is in the server log."
                    />
                  </td>
                </tr>
              )}
              {!listError && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <EmptyState
                      title="No subscriptions yet"
                      hint="Assign one from a tenant's page."
                    />
                  </td>
                </tr>
              )}
              {rows.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <NoMatches noun="subscriptions" onClear={clearAll} />
                  </td>
                </tr>
              )}
              {shown.map((row) => {
                const expanded = open === row.id;
                const detailId = `${id}-detail-${row.id}`;
                const state = LIST_STATUS[row.status];
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={cn("m-row cursor-pointer hover:bg-[var(--brand-50)]", expanded && "bg-[var(--brand-50)]")}
                      onClick={() => setOpen(expanded ? null : row.id)}
                    >
                      <td className={st.td}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpen(expanded ? null : row.id);
                          }}
                          className="cursor-pointer rounded-sm border-0 bg-transparent p-0 text-left text-inherit hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                        >
                          {row.tenantName}
                        </button>
                      </td>
                      <td className={st.td}>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          {row.planName}
                          {row.planVersion !== null && <Pill tone="neutral">v{row.planVersion}</Pill>}
                        </span>
                      </td>
                      <td className={st.td}>{BILLING_CYCLE_LABELS[row.cycle]}</td>
                      <td className={st.td}>
                        <Pill tone={state.tone} dot>
                          {state.label}
                        </Pill>
                      </td>
                      <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>
                        <UtcHover full={row.periodFull} isos={[row.periodStart, row.periodEnd]}>
                          {row.periodText}
                        </UtcHover>
                      </td>
                      <td className={cn(st.td, "whitespace-nowrap")}>{row.queuedText}</td>
                    </tr>
                    {expanded && (
                      <tr id={detailId} className="bg-[var(--canvas)]">
                        <td colSpan={6} className="border-t border-[var(--border)] px-4 py-4">
                          <SubscriptionDetail row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel="subscriptions"
          order={LIST_ORDER}
          onPageChange={setPage}
        />
    </TableCard>
  );
}

/** What opens under a row: the facts the columns abbreviate, and the way to the tenant's billing tab. */
function SubscriptionDetail({ row }: { row: SubscriptionListRow }) {
  const state = LIST_STATUS[row.status];
  const facts: { label: string; value: ReactNode }[] = [
    { label: "Started", value: <UtcHover full={row.startedFull} isos={[row.startedAt]}>{row.startedFull}</UtcHover> },
    {
      label: "Current period",
      value: <UtcHover full={row.periodFull} isos={[row.periodStart, row.periodEnd]}>{row.periodFull}</UtcHover>,
    },
    {
      label: "Monthly equivalent",
      value:
        row.monthlyCents === null
          ? "Could not be read"
          : row.countsTowardMrr
            ? `${formatCentsAsCurrency(row.monthlyCents)} / month, counted in MRR`
            : `${formatCentsAsCurrency(row.monthlyCents)} / month, not counted (${state.label.toLowerCase()})`,
    },
    { label: "Billed", value: `Every ${CYCLE_UNIT[row.cycle]}` },
  ];
  if (row.trialEndsAt && row.trialEndsFull) {
    facts.push({ label: "Trial ends", value: <UtcHover full={row.trialEndsFull} isos={[row.trialEndsAt]}>{row.trialEndsFull}</UtcHover> });
  }
  if (row.pendingPlanLabel) facts.push({ label: "Queued plan", value: `${row.pendingPlanLabel}, at renewal` });
  if (row.cancelledAt && row.cancelledFull) {
    facts.push({ label: "Access ended", value: <UtcHover full={row.cancelledFull} isos={[row.cancelledAt]}>{row.cancelledFull}</UtcHover> });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{fact.label}</dt>
            <dd className="m-0 mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {(row.status === "cancelling" || row.status === "cancelled" || row.cancelReason) && (
        <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
          <span className="font-semibold text-[var(--ink)]">Cancellation reason:</span> {row.cancelReason ?? "None recorded"}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/admin/tenants/${row.tenantId}?tab=subscription`}
          className="rounded-sm text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--accent-ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          Open Subscription &amp; billing
        </Link>
      </div>
    </div>
  );
}

/**
 * Text printed by the server in UTC, with the same instants in the reader's local time added to the
 * hover after mount — so the server and first client render are identical.
 */
function UtcHover({ full, isos, children }: { full: string; isos: (string | null)[]; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = isos.join("|");
  useEffect(() => {
    const local = key
      .split("|")
      .filter(Boolean)
      .map((iso) => new Date(iso))
      .filter((date) => !Number.isNaN(date.getTime()))
      .map((date) => date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }));
    if (ref.current && local.length > 0) ref.current.title = `${full} · ${local.join(" to ")} your time`;
  }, [key, full]);
  return (
    <span ref={ref} title={full}>
      {children}
    </span>
  );
}
