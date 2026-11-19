"use client";

import { Check, Minus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { DetailPanel } from "@/components/ui/detail-panel";
import { inputControl } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-states";
import type { PlanCompareData } from "@/lib/plans/sheet";
import { LIMIT_FIELDS, PRICE_FIELDS, limitWords, priceWords, type PlanVersionSnapshot } from "@/lib/plans/versionDiff";
import { cn } from "@/lib/utils";
import { SheetLoading } from "./plan-sheet";

import { CheckBox } from "@/components/ui/check-box";
export function PlanCompareFrame({ loading, onClose, children }: { loading: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <DetailPanel
      mode="overlay"
      className="lg:w-[min(960px,calc(100vw-80px))]"
      title="Compare plans"
      subtitle="The latest version of each, side by side"
      onClose={onClose}
      closeLabel="Close Compare plans"
      bodyClassName="flex flex-col"
    >
      {loading || !children ? <SheetLoading label="Loading the plans" /> : children}
    </DetailPanel>
  );
}

const MAX = 3;

/**
 * Compare plans (catalog.html screen 2, new): two or three plans side by side — price, limits, features and usage
 * allowances — each at its latest version. Rows where the picked plans differ are marked; "Only differences" hides
 * the rest.
 */
export function PlanCompareBody({ data }: { data: PlanCompareData }) {
  const live = data.plans.filter((plan) => !plan.isArchived);
  const initial = (live.length >= 2 ? live : data.plans).slice(0, MAX).map((plan) => plan.id);
  const [picked, setPicked] = useState<string[]>(initial);
  const [onlyDiff, setOnlyDiff] = useState(false);

  if (data.plans.length < 2) return <EmptyState title="Nothing to compare yet" hint="Comparing needs at least two plans. Create another with New plan." />;

  const columns = picked.map((id) => data.plans.find((plan) => plan.id === id)).filter((plan): plan is PlanVersionSnapshot => Boolean(plan));
  const featureKeys = [...new Set(columns.flatMap((plan) => plan.features))].sort((a, b) => (data.labels.features[a] ?? a).localeCompare(data.labels.features[b] ?? b));
  const meterKeys = [...new Set(columns.flatMap((plan) => plan.meters.map((meter) => meter.meter_key)))].sort();

  type Row = { key: string; label: string; cells: ReactNode[]; words: string[] };
  const rows = (group: string, entries: Row[]) => ({ group, entries: onlyDiff ? entries.filter((row) => new Set(row.words).size > 1) : entries });
  const tick = (on: boolean) => (on ? <Check aria-label="Included" className="size-4 text-[var(--success-ink)]" /> : <Minus aria-label="Not included" className="size-4 text-muted-foreground" />);

  const groups = [
    rows("Price", PRICE_FIELDS.map(([field, label]) => {
      const words = columns.map((plan) => priceWords(plan.prices, field));
      return { key: `price:${field}`, label, cells: words, words };
    })),
    rows("Limits", LIMIT_FIELDS.map(([field, label]) => {
      const words = columns.map((plan) => limitWords(plan.limits, field));
      return { key: `limit:${field}`, label, cells: words, words };
    })),
    rows("Features", featureKeys.map((key) => {
      const on = columns.map((plan) => plan.features.includes(key));
      return { key: `feature:${key}`, label: data.labels.features[key] ?? key, cells: on.map(tick), words: on.map(String) };
    })),
    rows("Usage allowances", meterKeys.map((key) => {
      const words = columns.map((plan) => {
        const grant = plan.meters.find((meter) => meter.meter_key === key);
        if (!grant) return "Platform default";
        return `${grant.included_qty === null ? "Unlimited" : grant.included_qty.toLocaleString("en-US")}${grant.hard_cap ? ", hard cap" : ""}`;
      });
      return { key: `meter:${key}`, label: data.labels.meters[key] ?? key, cells: words, words };
    })),
  ];

  const grid = { gridTemplateColumns: `minmax(140px,1.2fr) repeat(${columns.length}, minmax(0,1fr))` };

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
        {Array.from({ length: MAX }, (_, slot) => (
          <select
            key={slot}
            aria-label={`Plan ${slot + 1}`}
            className={cn(inputControl, "w-auto min-w-40")}
            value={picked[slot] ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              setPicked((current) => {
                const next = [...current];
                if (value) next[slot] = value;
                else next.splice(slot, 1);
                return next.filter((id, index) => id && next.indexOf(id) === index);
              });
            }}
          >
            {slot >= 2 && <option value="">No third plan</option>}
            {data.plans.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name} v{plan.version}{plan.isArchived ? " (archived)" : ""}</option>
            ))}
          </select>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-foreground">
          <CheckBox checked={onlyDiff} onChange={(event) => setOnlyDiff(event.target.checked)} />
          Only differences
        </label>
      </div>

      <div role="table" aria-label="Plans side by side" className="flex flex-col pb-4">
        <div role="row" className="grid items-center gap-3 border-b border-border px-4 py-2" style={grid}>
          <span role="columnheader" className="text-xs font-semibold text-muted-foreground">Plan</span>
          {columns.map((plan) => (
            <span key={plan.id} role="columnheader" className="min-w-0 truncate text-sm font-semibold text-foreground">{plan.name} <span className="font-normal text-muted-foreground">v{plan.version}</span></span>
          ))}
        </div>
        {groups.map(({ group, entries }) => (
          <div key={group} role="rowgroup" className="flex flex-col">
            <div role="row" className="border-b border-border bg-[var(--surface-alt)] px-4 py-1.5">
              <span role="rowheader" className="text-xs font-semibold text-foreground">{group}</span>
            </div>
            {entries.length === 0 ? (
              <p className="m-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">{onlyDiff ? "The same on every plan picked." : "None set."}</p>
            ) : entries.map((row) => {
              const differs = new Set(row.words).size > 1;
              return (
                <div key={row.key} role="row" className="grid min-h-9 items-center gap-3 border-b border-border px-4 py-1.5 text-sm" style={grid}>
                  <span role="rowheader" className={cn("min-w-0 truncate", differs ? "font-medium text-foreground" : "text-muted-foreground")} title={row.label}>{row.label}</span>
                  {row.cells.map((cell, index) => <span key={index} role="cell" className="min-w-0 truncate tabular-nums text-foreground">{cell}</span>)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
