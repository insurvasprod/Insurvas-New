"use client";

import { useCallback, useMemo, useState } from "react";
import { MoreHorizontal, SlidersHorizontal } from "lucide-react";

import { notify } from "@/lib/notify";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { btn, Callout, Pill, SearchBox, st } from "@/components/app/settings/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import type { CarrierRow } from "@/lib/carriers/constants";
import {
  CARRIER_IN_USE_CODE,
  USAGE_UNKNOWN_TITLE,
  usageLine,
  usageTitle,
  type CarrierBlockingUsage,
  type CarrierUsageSnapshot,
} from "@/lib/carriers/usage";
import { recordDate, recordDateTime } from "@/lib/tenants/recordFormat";
import { cn } from "@/lib/utils";
import { CarrierDialog } from "./carrier-dialog";
import { CarrierDeactivateDialog } from "./carrier-deactivate-dialog";

const PAGE_SIZE = 25;
const TOOL_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const MENU_ITEM = "text-[14px] tracking-[-0.02em] text-[var(--ink)]";

type StateFilter = "all" | "active" | "inactive";
type UsageFilter = "any" | "in_use" | "unused";
const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "Active and inactive" },
  { value: "active", label: "Active only" },
  { value: "inactive", label: "Inactive only" },
];
const USAGE_OPTIONS: { value: UsageFilter; label: string }[] = [
  { value: "any", label: "Any usage" },
  { value: "in_use", label: "In use by a tenant" },
  { value: "unused", label: "Not in use" },
];

/**
 * The Carriers board (p-adm-carriers): header, four figures, toolbar, the platform library table,
 * its footer and the deactivation callout. Rows, usage and figures are refreshed from
 * /api/admin/carriers after every change.
 */
export function CarriersTable({
  initialCarriers,
  initialUsage,
  canOverride,
}: {
  initialCarriers: CarrierRow[];
  initialUsage: CarrierUsageSnapshot;
  /** super_admin: may deactivate a carrier tenants use, with a reason. */
  canOverride: boolean;
}) {
  const [carriers, setCarriers] = useState(initialCarriers);
  const [usage, setUsage] = useState<CarrierUsageSnapshot>(initialUsage);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("any");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CarrierRow | null>(null);
  const [blocked, setBlocked] = useState<{ carrier: CarrierRow; usage: CarrierBlockingUsage | null } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/carriers", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json()) as { carriers: CarrierRow[]; usage: CarrierUsageSnapshot };
    setCarriers(body.carriers);
    setUsage(body.usage);
  }, []);

  const usageFor = (id: string) => (usage.available ? usage.byCarrier[id] : undefined);

  async function deactivate(carrier: CarrierRow) {
    setPending(carrier.id);
    const response = await fetch(`/api/admin/carriers/${carrier.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: false }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPending(null);
    if (response?.status === 409 && body?.code === CARRIER_IN_USE_CODE) {
      setBlocked({ carrier, usage: body.usage ?? null });
      return;
    }
    if (!response?.ok) {
      notify.block(body?.error ?? "Could not deactivate carrier");
      return;
    }
    notify.done(`${carrier.name} deactivated`);
    refresh();
  }

  async function reactivate(carrier: CarrierRow) {
    setPending(carrier.id);
    const response = await fetch(`/api/admin/carriers/${carrier.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    }).catch(() => null);
    const body = await response?.json().catch(() => null);
    setPending(null);
    if (!response?.ok) {
      notify.block(body?.error ?? "Could not reactivate carrier");
      return;
    }
    notify.done(`${carrier.name} reactivated`);
    refresh();
  }

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      carriers.filter((carrier) => {
        if (stateFilter === "active" && !carrier.is_active) return false;
        if (stateFilter === "inactive" && carrier.is_active) return false;
        if (usage.available && usageFilter !== "any") {
          const inUse = (usage.byCarrier[carrier.id]?.tenants ?? 0) > 0;
          if (usageFilter === "in_use" ? !inUse : inUse) return false;
        }
        return !term || carrier.name.toLowerCase().includes(term) || carrier.code.toLowerCase().includes(term);
      }),
    [carriers, stateFilter, usageFilter, usage, term],
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const changedFilters = (stateFilter !== "all" ? 1 : 0) + (usageFilter !== "any" ? 1 : 0);

  function clearAll() {
    setSearch("");
    setStateFilter("all");
    setUsageFilter("any");
    setPage(1);
  }

  // Figures. Usage-based ones read "—" until migration 20260924357000 — never a 0 that means "unknown".
  const inactive = carriers.filter((carrier) => !carrier.is_active).length;
  const inUseCount = usage.available ? carriers.filter((carrier) => (usage.byCarrier[carrier.id]?.tenants ?? 0) > 0).length : null;
  const blockedCount = usage.available
    ? carriers.filter((carrier) => carrier.is_active && (usage.byCarrier[carrier.id]?.tenants ?? 0) > 0).length
    : null;
  const unknown = "—";

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Carriers"
        subtitle="The platform carrier library agents pick from when configuring their contracts."
        actions={
          <button type="button" className={btn("primary", "h-11")} onClick={() => setCreating(true)}>
            New carrier
          </button>
        }
      />

      <BoardStatGrid>
        <BoardStatTile label="Carriers" value={carriers.length.toLocaleString("en-US")} footnote={`${inactive.toLocaleString("en-US")} inactive`} />
        <BoardStatTile
          label="In use"
          value={inUseCount === null ? unknown : inUseCount.toLocaleString("en-US")}
          tone={inUseCount ? "success" : "default"}
          footnote={usage.available ? `by ${usage.totals.tenants.toLocaleString("en-US")} ${usage.totals.tenants === 1 ? "tenant" : "tenants"}` : "usage not available yet"}
          title={usage.available ? "Carriers with at least one tenant holding an active contract or an open appointment" : USAGE_UNKNOWN_TITLE}
        />
        <BoardStatTile
          label="Appointments recorded"
          value={usage.available ? usage.totals.appointments.toLocaleString("en-US") : unknown}
          footnote="across all tenants"
          title={usage.available ? `${usage.totals.openAppointments.toLocaleString("en-US")} open, the rest terminated` : USAGE_UNKNOWN_TITLE}
        />
        <BoardStatTile
          label="Deactivations blocked"
          value={blockedCount === null ? unknown : blockedCount.toLocaleString("en-US")}
          tone={blockedCount ? "warning" : "default"}
          footnote="active carriers tenants still use"
          title={
            usage.available
              ? canOverride
                ? "Deactivating one of these needs a recorded reason"
                : "Only a super admin can deactivate one of these, with a recorded reason"
              : USAGE_UNKNOWN_TITLE
          }
        />
      </BoardStatGrid>

      <div className="flex w-full flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Search carriers"
          label="Search carriers by name or code"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={TOOL_BUTTON} aria-label={changedFilters > 0 ? `Filters, ${changedFilters} changed` : "Filters"}>
              <SlidersHorizontal className="size-[15px]" strokeWidth={2.2} aria-hidden="true" />
              Filters
              {changedFilters > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] tabular-nums">
                  {changedFilters}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[220px]">
            <DropdownMenuLabel className="text-[12px]">State</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={stateFilter}
              onValueChange={(value) => {
                setStateFilter(value as StateFilter);
                setPage(1);
              }}
            >
              {STATE_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value} className={MENU_ITEM}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {usage.available && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[12px]">Usage</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={usageFilter}
                  onValueChange={(value) => {
                    setUsageFilter(value as UsageFilter);
                    setPage(1);
                  }}
                >
                  {USAGE_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value} className={MENU_ITEM}>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
      </div>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[860px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-[120px]")}>Code</th>
                <th scope="col" className={st.th}>Carrier</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>State</th>
                <th scope="col" className={cn(st.th, "w-[90px]")}>Sort</th>
                <th scope="col" className={cn(st.th, "w-[230px]")}>Usage</th>
                <th scope="col" className={cn(st.th, "w-[140px]")}>Created</th>
                <th scope="col" className={cn(st.th, "w-12")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    {carriers.length === 0 ? (
                      <EmptyState title="No carriers yet" hint="Add the platform library before agents configure appointments." />
                    ) : (
                      <NoMatches noun="carriers" onClear={clearAll} />
                    )}
                  </td>
                </tr>
              )}
              {rows.map((carrier) => {
                const rowUsage = usageFor(carrier.id);
                return (
                  <tr key={carrier.id} className="m-row hover:bg-[var(--brand-50)]">
                    <td className={st.td}>
                      <code className="font-mono text-[14px]">{carrier.code}</code>
                    </td>
                    <td className={st.td}>{carrier.name}</td>
                    <td className={st.td}>
                      <Pill tone={carrier.is_active ? "success" : "neutral"} dot>
                        {carrier.is_active ? "Active" : "Inactive"}
                      </Pill>
                    </td>
                    <td className={cn(st.td, "tabular-nums")}>{carrier.sort_order}</td>
                    <td className={cn(st.td, "tabular-nums")} title={usage.available ? usageTitle(rowUsage) : USAGE_UNKNOWN_TITLE}>
                      {usage.available ? usageLine(rowUsage) : "Usage unknown"}
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap")} title={recordDateTime(carrier.created_at)}>
                      {recordDate(carrier.created_at)}
                    </td>
                    <td className={cn(st.td, "py-1 text-right")}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className={btn("row", "w-[30px] px-0")}
                            disabled={pending === carrier.id}
                            aria-label={`Actions for ${carrier.name}`}
                          >
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className={MENU_ITEM} onSelect={() => setEditing(carrier)}>
                            Edit
                          </DropdownMenuItem>
                          {carrier.is_active ? (
                            <DropdownMenuItem variant="destructive" className="text-[14px] tracking-[-0.02em]" onSelect={() => deactivate(carrier)}>
                              Deactivate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className={MENU_ITEM} onSelect={() => reactivate(carrier)}>
                              Reactivate
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex-1" />
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={visible.length}
          itemLabel={visible.length === 1 ? "carrier" : "carriers"}
          order="by sort order, then name"
          onPageChange={setPage}
        />
      </section>

      <Callout tone="warning" title="Deactivating hides a carrier from every tenant">
        This library is what an agent picks from in Settings › Carrier library, so deactivating a carrier affects live tenants.
        One that tenants still use — an active contract or an open appointment — can only be deactivated by a super admin with a
        recorded reason. Carriers are never deleted here.
      </Callout>

      <CarrierDialog open={creating} onClose={() => setCreating(false)} onSaved={refresh} />
      <CarrierDialog key={editing?.id ?? "edit-none"} open={Boolean(editing)} carrier={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      <CarrierDeactivateDialog
        key={blocked?.carrier.id ?? "blocked-none"}
        carrier={blocked?.carrier ?? null}
        usage={blocked?.usage ?? null}
        canOverride={canOverride}
        onClose={() => setBlocked(null)}
        onDeactivated={(name) => {
          setBlocked(null);
          notify.done(`${name} deactivated`);
          refresh();
        }}
      />
    </div>
  );
}
