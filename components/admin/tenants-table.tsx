"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { TenantsListDate } from "@/components/admin/tenants-list-date";
import { Pill, SearchBox, btn, st } from "@/components/app/settings/primitives";
import {
  LIST_STATUSES,
  LIST_STATUS_LABELS,
  LIST_STATUS_TONES,
  matchesTenantSearch,
  onboardingComplete,
  onboardingLabel,
  onboardingTone,
  type ListStatus,
  type TenantListRow,
} from "@/lib/tenantsList/present";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const NO_PLAN = "__none__";

type StatusFilter = "all" | ListStatus;
type OnboardingFilter = "all" | "complete" | "incomplete";

const OUTLINE =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

/**
 * The tenants list below the figures (board p-adm-tenants): the toolbar card, the table card with
 * its footer. Rendered as siblings so the page's 24px rhythm spaces them, as on the board.
 *
 * Every tenant is on the client already (the server read them all, in pages), so search, filters
 * and paging are instant and the counts are exact. Rows open the tenant record.
 */
export function TenantsTable({ rows }: { rows: TenantListRow[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [onboarding, setOnboarding] = useState<OnboardingFilter>("all");
  const [plan, setPlan] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const id = useId();

  const planOptions = useMemo(() => {
    const names = new Set<string>();
    let unsold = false;
    for (const row of rows) {
      if (row.plan) names.add(row.plan.name);
      else unsold = true;
    }
    return [
      { value: "all", label: "Every plan" },
      ...[...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name })),
      ...(unsold ? [{ value: NO_PLAN, label: "No subscription" }] : []),
    ];
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (status !== "all" && row.status !== status) return false;
        if (onboarding === "complete" && !onboardingComplete(row.onboardingState)) return false;
        if (onboarding === "incomplete" && onboardingComplete(row.onboardingState)) return false;
        if (plan === NO_PLAN && row.plan) return false;
        if (plan !== "all" && plan !== NO_PLAN && row.plan?.name !== plan) return false;
        return matchesTenantSearch(row, search);
      }),
    [rows, status, onboarding, plan, search],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const panelFilters = (onboarding === "all" ? 0 : 1) + (plan === "all" ? 0 : 1);

  function clearAll() {
    setSearch("");
    setStatus("all");
    setOnboarding("all");
    setPlan("all");
    setPage(1);
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative inline-flex">
            <select
              aria-label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setPage(1);
              }}
              className={cn(OUTLINE, "appearance-none pr-9")}
            >
              <option value="all">All statuses</option>
              {LIST_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {LIST_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
            <svg
              aria-hidden
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--ink)]"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search tenant, owner"
            label="Search tenant, owner"
          />
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={`${id}-filters`}
            onClick={() => setFiltersOpen((open) => !open)}
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
              id={`${id}-onboarding`}
              label="Onboarding"
              value={onboarding}
              onChange={(value) => {
                setOnboarding(value as OnboardingFilter);
                setPage(1);
              }}
              options={[
                { value: "all", label: "Every state" },
                { value: "complete", label: "Complete" },
                { value: "incomplete", label: "Not complete" },
              ]}
            />
            <FilterSelect
              id={`${id}-plan`}
              label="Plan"
              value={plan}
              onChange={(value) => {
                setPlan(value);
                setPage(1);
              }}
              options={planOptions}
            />
            {panelFilters > 0 && (
              <button
                type="button"
                className={btn("row")}
                onClick={() => {
                  setOnboarding("all");
                  setPlan("all");
                  setPage(1);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <section
        aria-label="Tenants"
        className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[860px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Tenant &amp; owner</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Status</th>
                <th scope="col" className={cn(st.th, "w-[110px]")}>Plan</th>
                <th scope="col" className={cn(st.th, "w-[190px]")}>Onboarding</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Created</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Suspended</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <EmptyState
                      title="No tenants yet"
                      hint="An agency appears here when it signs up, or when a super admin creates one with Create tenant."
                    />
                  </td>
                </tr>
              )}
              {rows.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="border-t border-[var(--border)] p-0">
                    <NoMatches noun="tenants" onClear={clearAll} />
                  </td>
                </tr>
              )}
              {shown.map((row) => (
                <tr key={row.id} className="m-row hover:bg-[var(--brand-50)]">
                  <td className={st.td}>
                    <Link
                      href={`/admin/tenants/${row.id}`}
                      className="rounded-sm text-inherit no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                    >
                      {row.name}
                    </Link>
                    <br />
                    <span className="text-[12px] text-[var(--muted)]" title={row.owner ? `${row.owner.name} · ${row.owner.email}` : undefined}>
                      {row.owner ? row.owner.email : "No owner yet"}
                    </span>
                  </td>
                  <td className={st.td}>
                    <Pill tone={LIST_STATUS_TONES[row.status]} dot>
                      {LIST_STATUS_LABELS[row.status]}
                    </Pill>
                  </td>
                  <td className={st.td}>
                    {row.plan ? (
                      <span title={row.plan.version === null ? row.plan.name : `${row.plan.name} v${row.plan.version}`}>{row.plan.name}</span>
                    ) : (
                      <span className="text-[var(--muted)]">None</span>
                    )}
                  </td>
                  <td className={st.td}>
                    <Pill tone={onboardingTone(row.onboardingState)}>{onboardingLabel(row.onboardingState)}</Pill>
                  </td>
                  <td className={st.td}>
                    <TenantsListDate iso={row.createdAt} />
                  </td>
                  <td className={st.td}>
                    <TenantsListDate iso={row.status === "suspended" ? row.suspendedAt : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grow" />
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel="tenants"
          order="newest first"
          onPageChange={setPage}
        />
      </section>
    </>
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
