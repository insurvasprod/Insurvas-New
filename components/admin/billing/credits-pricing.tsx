"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { CREDIT_METER_LABELS, type MeterPricing } from "@/lib/creditsLimits/constants";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/** Compact inputs for the pricing cells. */
const cellInput =
  "ml-auto box-border block h-8 w-28 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2.5 text-right text-sm leading-[1.43] tabular-nums text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

/**
 * The Meter pricing lens (kept): vendor cost, sell price, margin and the platform default allowance per meter, edited
 * in place and saved together from one bar at the card's foot (never a Save per row).
 *
 * Three states, not two. An unpriced meter is UNSET, not wrong — showing it in red meant the screen opened with every
 * row in an error state, which teaches people to ignore red. Only a real price at or below cost is a warning.
 */
export function CreditsPricing({ pricing, lenses, onSaved }: { pricing: MeterPricing[]; lenses: ReactNode; onSaved: () => void }) {
  // Unsaved edits, keyed by meter. Empty means nothing is dirty and the save bar is gone.
  const [draft, setDraft] = useState<Record<string, { sell: string; included: string }>>({});
  const [busy, setBusy] = useState(false);

  const draftFor = (row: MeterPricing) =>
    draft[row.meter_key] ?? { sell: String(row.sell_cents), included: row.default_included === null ? "" : String(row.default_included) };
  const isDirty = (row: MeterPricing) => {
    const edit = draft[row.meter_key];
    if (!edit) return false;
    const included = row.default_included === null ? "" : String(row.default_included);
    return edit.sell !== String(row.sell_cents) || edit.included !== included;
  };
  const editRow = (row: MeterPricing, patch: Partial<{ sell: string; included: string }>) =>
    setDraft((d) => ({ ...d, [row.meter_key]: { ...draftFor(row), ...patch } }));
  const dirtyRows = pricing.filter((row) => isDirty(row));
  const dirty = dirtyRows.length > 0;

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    setBusy(true);
    const failures: string[] = [];
    for (const row of dirtyRows) {
      const edit = draft[row.meter_key];
      const includedRaw = (edit?.included ?? "").trim();
      const response = await fetch("/api/admin/credits-limits/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meter_key: row.meter_key, sell_cents: Number(edit?.sell ?? row.sell_cents), default_included: includedRaw === "" ? null : Number(includedRaw) }),
      }).catch(() => null);
      if (!response || !response.ok) {
        const result = response ? await response.json().catch(() => null) : null;
        failures.push(`${CREDIT_METER_LABELS[row.meter_key]}: ${result?.error ?? "could not save"}`);
      }
    }
    setBusy(false);
    if (failures.length > 0) {
      // The draft is kept on a partial failure — discarding what somebody typed because one row was refused is how
      // people lose work.
      notify.fail(failures.join(" · "));
      return false;
    }
    notify.done(dirtyRows.length === 1 ? "Pricing saved" : `${dirtyRows.length} meters saved`);
    setDraft({});
    onSaved();
    return true;
  }

  return (
    <TableCard
      className="min-w-0"
      toolbar={<DataToolbar>{lenses}</DataToolbar>}
      footer={dirty ? (
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm">
            <span className="font-semibold text-foreground">{dirtyRows.length === 1 ? "1 unsaved change" : `${dirtyRows.length} unsaved changes`}</span>
            <span className="text-muted-foreground"> · {dirtyRows.map((row) => CREDIT_METER_LABELS[row.meter_key]).join(", ")}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft({})} disabled={busy}>Discard</Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      ) : undefined}
    >
      <LeaveGuard dirty={dirty} onSave={save} onDiscard={() => setDraft({})} what="the meter pricing" />
      <Table className="min-w-[720px]">
        <TableHeader>
          <TableRow>
            <TableHead>Meter</TableHead>
            <TableHead className="text-right">Vendor cost</TableHead>
            <TableHead className="text-right">Sell price (cents)</TableHead>
            <TableHead className="text-right">Margin</TableHead>
            <TableHead className="text-right">Platform default</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pricing.map((row) => {
            const edit = draftFor(row);
            const sell = Number(edit.sell) || 0;
            const unpriced = sell === 0;
            const belowCost = !unpriced && sell <= row.cost_cents;
            const margin = row.cost_cents > 0 && !unpriced ? Math.round(((sell - row.cost_cents) / row.cost_cents) * 100) : null;
            return (
              <TableRow key={row.meter_key} className={cn(belowCost && "bg-[var(--error-surface)]")}>
                <TableCell className="whitespace-nowrap font-medium" title={row.meter_key}>{CREDIT_METER_LABELS[row.meter_key]}</TableCell>
                <TableCell className="text-right tabular-nums" title={row.cost_source === "compliance_vendor" ? "The costliest enabled vendor" : "Set here"}>{formatCentsAsCurrency(row.cost_cents)}</TableCell>
                <TableCell>
                  <input
                    type="number"
                    min="0"
                    value={edit.sell}
                    aria-label={`${CREDIT_METER_LABELS[row.meter_key]} sell price in cents`}
                    aria-invalid={belowCost}
                    onChange={(event) => editRow(row, { sell: event.target.value })}
                    className={cn(cellInput, belowCost && "border-[var(--error)]")}
                  />
                </TableCell>
                <TableCell className="text-right">
                  {unpriced ? (
                    <span className="text-muted-foreground">Not priced</span>
                  ) : (
                    <span className={cn("font-semibold tabular-nums", belowCost ? "text-[var(--error-ink)]" : "text-foreground")} title={belowCost ? "At or below cost" : undefined}>
                      {margin === null ? "—" : `${margin > 0 ? "+" : ""}${margin}%`}{belowCost ? " · at or below cost" : ""}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <input
                    type="number"
                    min="0"
                    value={edit.included}
                    placeholder="Unlimited"
                    aria-label={`${CREDIT_METER_LABELS[row.meter_key]} platform default allowance`}
                    onChange={(event) => editRow(row, { included: event.target.value })}
                    className={cellInput}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}
