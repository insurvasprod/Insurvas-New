"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Pill, SearchBox, btn, st } from "@/components/app/settings/primitives";
import { ErrorState } from "@/components/ui/page-states";
import { BILLING_CYCLES, BILLING_CYCLE_LABELS, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import { LIST_ORDER, LIST_STATUS, LIST_STATUS_ORDER, type QueuedKind, type SubscriptionListRow } from "@/lib/subscriptionsList/model";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

type StatusFilter = "all" | "current" | SubscriptionStatus;
type QueuedFilter = "any" | "plan" | "ends" | "trial" | "none";

const OUTLINE =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

const CYCLE_UNIT: Record<BillingCycle, string> = { monthly: "month", quarterly: "quarter", yearly: "year" };

/**
 * The subscriptions list (board p-adm-subscriptions): the toolbar card, then the table card with its
 * footer. Siblings, so the page's 24px rhythm spaces them as on the board.
 *
 * Read-only on purpose, as the board's callout says: assigning, changing, pausing and cancelling
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
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cycle, setCycle] = useState<"any" | BillingCycle>("any");
  const [queued, setQueued] = useState<QueuedFilter>("any");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const panelFilters = (status === "all" ? 0 : 1) + (cycle === "any" ? 0 : 1) + (queued === "any" ? 0 : 1);

  function clearPanel() {
    setStatus("all");
    setCycle("any");
    setQueued("any");
    setPage(1);
  }

  function clearAll() {
    clearPanel();
    setSearch("");
    setPlan("all");
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative inline-flex">
            <select
              aria-label="Plan"
              value={plan}
              onChange={(event) => {
                setPlan(event.target.value);
                setPage(1);
              }}
              className={cn(OUTLINE, "appearance-none pr-9")}
            >
              <option value="all">All plans</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <Chevron className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--ink)]" />
          </span>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search tenant"
            label="Search tenant"
          />
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={`${id}-filters`}
            onClick={() => setFiltersOpen((value) => !value)}
            className={OUTLINE}
          >
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M3 5h18M6 12h12M10 19h4" />
            </svg>
            Filters
            {panelFilters > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] tabular-nums">
                {panelFilters}
              </span>
            )}
          </button>
          <span className="grow" />
        </div>

        {filtersOpen && (
          <div id={`${id}-filters`} className="flex flex-wrap items-end gap-4 border-t border-[var(--border)] pt-3">
            <FilterSelect
              id={`${id}-status`}
              label="Status"
              value={status}
              onChange={(value) => {
                setStatus(value as StatusFilter);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All, including expired" },
                { value: "current", label: "Everything but expired" },
                ...LIST_STATUS_ORDER.map((s) => ({ value: s, label: LIST_STATUS[s].label })),
              ]}
            />
            <FilterSelect
              id={`${id}-cycle`}
              label="Cycle"
              value={cycle}
              onChange={(value) => {
                setCycle(value as "any" | BillingCycle);
                setPage(1);
              }}
              options={[{ value: "any", label: "Any" }, ...BILLING_CYCLES.map((c) => ({ value: c, label: BILLING_CYCLE_LABELS[c] }))]}
            />
            <FilterSelect
              id={`${id}-queued`}
              label="Queued change"
              value={queued}
              onChange={(value) => {
                setQueued(value as QueuedFilter);
                setPage(1);
              }}
              options={[
                { value: "any", label: "Any" },
                { value: "plan", label: `Plan change at renewal (${queuedCounts.plan})` },
                { value: "ends", label: `Ends at period end (${queuedCounts.ends})` },
                { value: "trial", label: `Trial ending (${queuedCounts.trial})` },
                { value: "none", label: "Nothing queued" },
              ]}
            />
            {panelFilters > 0 && (
              <button type="button" className={btn("row")} onClick={clearPanel}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <section
        aria-label="Subscriptions"
        className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="min-w-0 overflow-x-auto">
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
                      hint="A subscription is what puts a tenant on a plan and starts their billing period. Assign one from a tenant's page."
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
        </div>
        <div className="grow" />
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel="subscriptions"
          order={LIST_ORDER}
          onPageChange={setPage}
        />
      </section>
    </>
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
        <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
          Assign, change plan, pause and cancel live on the tenant record.
        </span>
        <Link
          href={`/admin/tenants/${row.tenantId}?tab=subscription`}
          className="ml-auto rounded-sm text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--accent-ink)] no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
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

function Chevron({ className }: { className?: string }) {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <span className="flex min-w-[200px] flex-col gap-1">
      <label htmlFor={id} className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] tracking-[-0.02em] text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
