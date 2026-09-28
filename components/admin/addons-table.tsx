"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { Pill, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { BILLING_CYCLE_LABELS, BILLING_CYCLES, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import type { AddonRow } from "@/lib/addons/constants";
import { attachableTo, CYCLE_SUFFIX, type PlanRef } from "@/lib/addons/catalogView";
import type { PlanListRow } from "@/lib/plans/constants";
import { cn } from "@/lib/utils";
import { AddonDialog, type AddonFeatureOption, type AddonMeterOption } from "./addon-dialog";

const PAGE_SIZE = 25;

type StatusFilter = "all" | "active" | "retired";

/**
 * The Add-ons catalog (board p-adm-addons): header, the figures the server computed, then one
 * TableCard with its toolbar inside. A row click — or the name, for the keyboard —
 * opens the editor; the open row carries the brand tint.
 */
export function AddonsCatalog({
  addons,
  tiles,
  featureLabels,
  archivedFeatureKeys,
  meterLabels,
  features,
  meters,
  plans,
  planRefs,
  billedByAddon,
}: {
  addons: AddonRow[];
  tiles: ReactNode;
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
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; addon?: AddonRow } | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [cycle, setCycle] = useState<"all" | BillingCycle>("all");
  const [plan, setPlan] = useState<string>("all");
  const [page, setPage] = useState(1);

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
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setCycle("all");
    setPlan("all");
    setPage(1);
  }

  const openEdit = (addon: AddonRow) => setEditor({ mode: "edit", addon });

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Add-ons"
        description="Extras sold on top of a plan."
        actions={
          <Button type="button" onClick={() => setEditor({ mode: "create" })}>
            New add-on
          </Button>
        }
      />

      {tiles}

      <TableCard
        className="min-w-0"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder="Search add-ons"
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
              <option value="active">Active</option>
              <option value="retired">Retired</option>
            </select>
            <select
              aria-label="Billing cycle"
              value={cycle}
              onChange={(event) => {
                setCycle(event.target.value as "all" | BillingCycle);
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="all">Any cycle</option>
              {BILLING_CYCLES.map((item) => (
                <option key={item} value={item}>
                  {BILLING_CYCLE_LABELS[item]}
                </option>
              ))}
            </select>
            {planCodes.length > 0 && (
              <select
                aria-label="Attachable to"
                value={plan}
                onChange={(event) => {
                  setPlan(event.target.value);
                  setPage(1);
                }}
                className={cn(toolbarControl, "max-w-56")}
              >
                <option value="all">Attachable to any plan</option>
                {planCodes.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            )}
            {(activeFilters > 0 || query.trim() !== "") && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </DataToolbar>
        }
      >
          <table className={cn(st.table, "min-w-[1040px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Add-on</th>
                <th scope="col" className={cn(st.th, "w-[188px]")}>Code</th>
                <th scope="col" className={cn(st.th, "w-[128px]")}>Price</th>
                <th scope="col" className={cn(st.th, "w-[188px]")}>Grants features</th>
                <th scope="col" className={cn(st.th, "w-[154px]")}>Grants meters</th>
                <th scope="col" className={cn(st.th, "w-[154px]")}>Attachable to</th>
                <th scope="col" className={cn(st.th, "w-[96px]")}>Status</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {addons.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState
                      title="No add-ons yet"
                      hint="Create one and it becomes available to attach to a subscription."
                    />
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
                const selected = editor?.mode === "edit" && editor.addon?.id === addon.id;
                const offered = attachable.get(addon.id) ?? [];
                return (
                  <tr
                    key={addon.id}
                    onClick={() => openEdit(addon)}
                    data-selected={selected || undefined}
                    className={cn(
                      "m-row cursor-pointer",
                      selected ? "bg-[var(--brand-50)]" : "hover:bg-[var(--canvas)]",
                      !addon.is_active && !selected && "[&>td]:text-[var(--muted)]",
                    )}
                  >
                    <td className={st.td}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEdit(addon);
                        }}
                        className="cursor-pointer rounded-[4px] text-left text-inherit hover:text-[var(--accent-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                      >
                        {addon.name}
                        <span className="sr-only"> — edit</span>
                      </button>
                      {addon.description && <span className={st.sub}>{addon.description}</span>}
                    </td>
                    <td className={st.td}>
                      <code className="font-mono break-all">{addon.code}</code>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>
                      {formatCentsAsCurrency(addon.price_cents)} {CYCLE_SUFFIX[addon.billing_cycle]}
                    </td>
                    <td className={st.td}>
                      <div className="flex flex-wrap gap-1">
                        {addon.feature_keys.length === 0 ? (
                          <Pill tone="neutral">—</Pill>
                        ) : (
                          addon.feature_keys.map((key) => (
                            <span key={key} title={archived.has(key) ? `${featureLabels[key] ?? key} — archived since this add-on was written` : featureLabels[key] ?? key}>
                              <Pill tone={archived.has(key) ? "warning" : "success"}>{key}</Pill>
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className={st.td}>
                      {addon.meters.length === 0
                        ? "—"
                        : addon.meters.map((meter) => (
                            <span key={meter.meter_key} className="block">
                              {meterLabels[meter.meter_key] ?? meter.meter_key} +{meter.included_qty.toLocaleString("en-US")}
                            </span>
                          ))}
                    </td>
                    <td className={st.td}>
                      {offered.length === 0 ? (
                        <span title="Not offered on any plan. Attaching it needs an audited override.">—</span>
                      ) : (
                        offered.map((entry, index) => (
                          <span key={entry.code}>
                            {index > 0 && ", "}
                            {entry.label}
                            {entry.olderOnly && <span className="text-[var(--muted)]"> (older version)</span>}
                          </span>
                        ))
                      )}
                    </td>
                    <td className={st.td}>
                      <Pill tone={addon.is_active ? "success" : "neutral"}>{addon.is_active ? "Active" : "Retired"}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        {addons.length > 0 && (
          <BoardTableFooter
            page={current}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            itemLabel={filtered.length === 1 ? "add-on" : "add-ons"}
            order="by sort order, then name"
            onPageChange={setPage}
          />
        )}
      </TableCard>

      {editor && (
        <AddonDialog
          key={editor.addon?.id ?? "new"}
          mode={editor.mode}
          open
          addon={editor.addon}
          features={features}
          meters={meters}
          plans={plans}
          billedCount={editor.addon ? (billedByAddon ? billedByAddon[editor.addon.id] ?? 0 : null) : null}
          onClose={() => setEditor(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  );
}
