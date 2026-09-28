"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { TenantsListDate } from "@/components/admin/tenants-list-date";
import { Pill, st } from "@/components/app/settings/primitives";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { TableCard } from "@/components/ui/table-card";
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

/**
 * The tenants list below the figures (board p-adm-tenants): one table card with its toolbar and
 * footer.
 *
 * Every tenant is on the client already (the server read them all, in pages), so search, filters
 * and paging are instant and the counts are exact. Rows open the tenant record.
 */
export function TenantsTable({ rows }: { rows: TenantListRow[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [onboarding, setOnboarding] = useState<OnboardingFilter>("all");
  const [plan, setPlan] = useState<string>("all");
  const [page, setPage] = useState(1);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

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

  function clearAll() {
    setSearch("");
    setStatus("all");
    setOnboarding("all");
    setPlan("all");
    setPage(1);
  }

  return (
    <TableCard
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
          <ToolbarSearch
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search tenant, owner"
          />
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
            {LIST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {LIST_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <select
            aria-label="Onboarding"
            value={onboarding}
            onChange={(event) => {
              setOnboarding(event.target.value as OnboardingFilter);
              setPage(1);
            }}
            className={toolbarControl}
          >
            <option value="all">Any onboarding</option>
            <option value="complete">Onboarding complete</option>
            <option value="incomplete">Onboarding not complete</option>
          </select>
          <select
            aria-label="Plan"
            value={plan}
            onChange={(event) => {
              setPlan(event.target.value);
              setPage(1);
            }}
            className={toolbarControl}
          >
            {planOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </DataToolbar>
      }
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
                    hint="Agencies appear here when they sign up or a super admin creates one."
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
      <BoardTableFooter
        page={current}
        pageSize={PAGE_SIZE}
        total={filtered.length}
        itemLabel="tenants"
        order="newest first"
        onPageChange={setPage}
      />
    </TableCard>
  );
}
