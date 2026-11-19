"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { TableCard } from "@/components/ui/table-card";
import { BILLING_CYCLE_LABELS, BILLING_CYCLES, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import type { AddonRow } from "@/lib/addons/constants";
import { attachableTo, CYCLE_SUFFIX, type PlanRef } from "@/lib/addons/catalogView";
import type { AddonSheetData } from "@/lib/addons/sheet";
import type { PlanListRow } from "@/lib/plans/constants";
import { cn } from "@/lib/utils";
import { AddonDialog, type AddonFeatureOption, type AddonMeterOption } from "./addon-dialog";

type StatusFilter = "all" | "active" | "retired";
const STATUSES: readonly StatusFilter[] = ["all", "active", "retired"];

/**
 * The Add-ons list (admin round 1, catalog.html screen 3): one TableCard with its toolbar inside, inside the
 * Catalog frame (the page draws the status line and the figures). Search (names, codes and feature keys), status,
 * cycle and attachable-to live in the address, written in place. A row opens the add-on's sheet (`?addon=`, a
 * server read for who has it and its history); `?new=1` opens the create sheet.
 */
export function AddonsCatalog({
  addons,
  featureLabels,
  archivedFeatureKeys,
  meterLabels,
  features,
  meters,
  plans,
  planRefs,
  billedByAddon,
  sheet,
}: {
  addons: AddonRow[];
  featureLabels: Record<string, string>;
  archivedFeatureKeys: string[];
  meterLabels: Record<string, string>;
  features: AddonFeatureOption[];
  meters: AddonMeterOption[];
  /** Latest version of each plan code — what the editor offers. */
  plans: PlanListRow[];
  /** Every plan version — availability rows point at versions. */
  planRefs: PlanRef[];
  /** Null when the attachment counts could not be read. */
  billedByAddon: Record<string, number> | null;
  /** Who has the add-on the address names, and its history; read on the server. */
  sheet: AddonSheetData | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);

  const query = params.get("q") ?? "";
  const statusParam = params.get("status");
  const status: StatusFilter = statusParam && (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as StatusFilter) : "all";
  const cycleParam = params.get("cycle");
  const cycle: "all" | BillingCycle = cycleParam && (BILLING_CYCLES as readonly string[]).includes(cycleParam) ? (cycleParam as BillingCycle) : "all";
  const plan = params.get("plan") ?? "all";
  const creating = params.get("new") === "1";

  // The sheet opens (and closes) at once; the address follows. A local choice holds only while the address is still
  // the one it was made against, so Back and Forward always win.
  const urlOpen = params.get("addon");
  const [asked, setAsked] = useState<{ id: string | null; against: string | null } | null>(null);
  const openId = asked && asked.against === urlOpen ? asked.id : urlOpen;
  const openAddon = openId ? addons.find((addon) => addon.id === openId) ?? null : null;

  const archived = useMemo(() => new Set(archivedFeatureKeys), [archivedFeatureKeys]);
  const attachable = useMemo(
    () => new Map(addons.map((addon) => [addon.id, attachableTo(addon.plan_ids, planRefs)])),
    [addons, planRefs],
  );
  const planCodes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of plans) seen.set(row.code, row.name);
    return [...seen.entries()];
  }, [plans]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return addons.filter((addon) => {
      if (status === "active" && !addon.is_active) return false;
      if (status === "retired" && addon.is_active) return false;
      if (cycle !== "all" && addon.billing_cycle !== cycle) return false;
      if (plan !== "all" && !(attachable.get(addon.id) ?? []).some((entry) => entry.code === plan)) return false;
      if (!needle) return true;
      const haystack = [
        addon.name,
        addon.code,
        addon.description ?? "",
        ...addon.feature_keys,
        ...addon.feature_keys.map((key) => featureLabels[key] ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [addons, query, status, cycle, plan, attachable, featureLabels]);

  const activeFilters = (status !== "all" ? 1 : 0) + (cycle !== "all" ? 1 : 0) + (plan !== "all" ? 1 : 0);
  const { current, rows: visible } = paginate(filtered, page, pageSize);

  function setFilters(patch: Record<string, string | null>) {
    setParamsInPlace(patch);
    setPage(1);
  }
  const clearFilters = () => setFilters({ q: null, status: null, cycle: null, plan: null });

  const open = (id: string) => {
    setAsked({ id, against: urlOpen });
    const next = new URLSearchParams(window.location.search);
    next.set("addon", id);
    next.delete("new");
    router.replace(`?${next.toString()}`, { scroll: false });
  };
  const close = () => {
    setAsked({ id: null, against: urlOpen });
    setParamsInPlace({ addon: null, new: null });
  };

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={addons.length > 0 ? <Pager page={current} pageSize={pageSize} total={filtered.length} noun={filtered.length === 1 ? "add-on" : "add-ons"} suffix="by sort order, then name" onPage={setPage} /> : undefined}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch value={query} onChange={(value) => setFilters({ q: value || null })} placeholder="Search name, code or feature" />
            <select aria-label="Status" value={status} onChange={(event) => setFilters({ status: event.target.value === "all" ? null : event.target.value })} className={toolbarControl}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </select>
            <select aria-label="Billing cycle" value={cycle} onChange={(event) => setFilters({ cycle: event.target.value === "all" ? null : event.target.value })} className={toolbarControl}>
              <option value="all">Any cycle</option>
              {BILLING_CYCLES.map((item) => (
                <option key={item} value={item}>{BILLING_CYCLE_LABELS[item]}</option>
              ))}
            </select>
            {planCodes.length > 0 && (
              <select aria-label="Attachable to" value={plan} onChange={(event) => setFilters({ plan: event.target.value === "all" ? null : event.target.value })} className={cn(toolbarControl, "max-w-56")}>
                <option value="all">Attachable to any plan</option>
                {planCodes.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            )}
            {(activeFilters > 0 || query.trim() !== "") && (
              <Button type="button" variant="ghost" onClick={clearFilters}>Clear</Button>
            )}
          </DataToolbar>
        }
      >
          <table className={cn(st.table, "min-w-[1040px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Add-on</th>
                <th scope="col" className={cn(st.th, "w-[160px]")}>Code</th>
                <th scope="col" className={cn(st.th, "w-[120px] text-right")}>Price</th>
                <th scope="col" className={cn(st.th, "w-[220px]")}>Grants</th>
                <th scope="col" className={cn(st.th, "w-[180px]")}>Attachable to</th>
                <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Attached</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Status</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {addons.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState title="No add-ons yet" hint="Create one and it becomes available to attach to a subscription." />
                  </td>
                </tr>
              )}
              {addons.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <NoMatches noun="add-ons" onClear={clearFilters} />
                  </td>
                </tr>
              )}
              {visible.map((addon) => {
                const selected = addon.id === openId;
                const offered = attachable.get(addon.id) ?? [];
                const offersArchived = addon.feature_keys.filter((key) => archived.has(key));
                const grants = [
                  ...addon.feature_keys.map((key) => (archived.has(key) ? `${key} (archived)` : key)),
                  ...addon.meters.map((meter) => `${meterLabels[meter.meter_key] ?? meter.meter_key} +${meter.included_qty.toLocaleString("en-US")}`),
                ];
                const grantsTitle = [
                  ...addon.feature_keys.map((key) => `${featureLabels[key] ?? key}${archived.has(key) ? " — archived since this add-on was written" : ""}`),
                  ...addon.meters.map((meter) => `${meterLabels[meter.meter_key] ?? meter.meter_key}: +${meter.included_qty.toLocaleString("en-US")}`),
                ].join("\n");
                const offeredText = offered.map((entry) => `${entry.label}${entry.olderOnly ? " (older version)" : ""}`).join(", ");
                const attached = billedByAddon ? billedByAddon[addon.id] ?? 0 : null;
                return (
                  <tr
                    key={addon.id}
                    onClick={() => open(addon.id)}
                    data-selected={selected || undefined}
                    className={cn("m-row cursor-pointer", selected ? "bg-[var(--hover-wash)]" : "hover:bg-[var(--hover-wash)]", !addon.is_active && !selected && "[&>td]:text-[var(--muted)]")}
                  >
                    <td className={cn(st.td, "max-w-0")}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          open(addon.id);
                        }}
                        title={addon.description ?? undefined}
                        className="block max-w-full cursor-pointer truncate rounded-[4px] text-left font-semibold text-inherit hover:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                      >
                        {addon.name}
                        <span className="sr-only"> — open</span>
                      </button>
                    </td>
                    <td className={cn(st.td, "max-w-0 truncate")}>
                      <code className="font-mono">{addon.code}</code>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap text-right tabular-nums")}>
                      {formatCentsAsCurrency(addon.price_cents)} {CYCLE_SUFFIX[addon.billing_cycle]}
                    </td>
                    <td className={cn(st.td, "max-w-0 truncate")} title={grantsTitle || undefined}>
                      {grants.length === 0 ? "—" : grants.join(", ")}
                    </td>
                    <td className={cn(st.td, "max-w-0 truncate")} title={offered.length === 0 ? "Not offered on any plan. Attaching it needs an audited override." : offeredText}>
                      {offered.length === 0 ? "—" : offeredText}
                    </td>
                    <td className={cn(st.td, "text-right tabular-nums")} title="Live attachments on subscriptions that are not cancelled">
                      {attached === null ? "—" : attached.toLocaleString("en-US")}
                    </td>
                    <td className={st.td}>
                      {offersArchived.length > 0 && addon.is_active
                        ? <StatusChip tone="warning" dot>Archived feature</StatusChip>
                        : <StatusChip tone={addon.is_active ? "good" : "neutral"} dot>{addon.is_active ? "Active" : "Retired"}</StatusChip>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </TableCard>

      {(creating || openAddon) && (
        <AddonDialog
          key={openAddon?.id ?? "new"}
          mode={openAddon ? "edit" : "create"}
          addon={openAddon}
          features={features}
          meters={meters}
          plans={plans}
          billedCount={openAddon ? (billedByAddon ? billedByAddon[openAddon.id] ?? 0 : null) : null}
          sheet={openAddon && sheet?.addonId === openAddon.id ? sheet : null}
          sheetLoading={Boolean(openAddon) && urlOpen !== openId}
          onClose={close}
          onSaved={() => router.refresh()}
        />
      )}
    </>
  );
}
