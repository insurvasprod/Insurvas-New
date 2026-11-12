"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputControl } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { bySignalOrder, pointsFigure, signalTone } from "@/lib/scoring/series";
import { CHART_TONES } from "@/components/ui/chart";

export type WeightRow = { signal: string; label: string; blurb: string; weight: number; isDefault: boolean; defaultWeight: number | null };
export type WeightsDraft = { holdout: string; weights: Record<string, string> };

/** The form as the saved settings hold it. */
export const draftOf = (weights: readonly WeightRow[], holdoutPct: number): WeightsDraft => ({
  holdout: String(holdoutPct),
  weights: Object.fromEntries(weights.map((weight) => [weight.signal, pointsFigure(weight.weight)])),
});

/**
 * Change weights (board 3·5, Reports round 7, 2026-11-11): the form left the table. Each signal's points, the holdout
 * and Reset all to default, in one lg dialog; Save applies them to the next lead served, Cancel discards the edit
 * (so the page needs no leave-guard: the dialog holds it). `focus` opens it at one signal (a weights legend row).
 */
export function ChangeWeightsDialog({
  open,
  onOpenChange,
  weights,
  holdoutPct,
  focus,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weights: readonly WeightRow[];
  holdoutPct: number;
  focus?: string | null;
  /** Resolves true when saved (the dialog closes), false to keep it open with the edit. */
  onSave: (draft: WeightsDraft) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={"lg"}>
        {/* Keyed on open, so every opening starts from what is saved. */}
        {open && <WeightsForm weights={weights} holdoutPct={holdoutPct} focus={focus ?? null} onCancel={() => onOpenChange(false)} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  );
}

function WeightsForm({ weights, holdoutPct, focus, onCancel, onSave }: { weights: readonly WeightRow[]; holdoutPct: number; focus: string | null; onCancel: () => void; onSave: (draft: WeightsDraft) => Promise<boolean> }) {
  const [draft, setDraft] = useState<WeightsDraft>(() => draftOf(weights, holdoutPct));
  const [saving, setSaving] = useState(false);
  const ordered = bySignalOrder(weights);
  const bad = ordered.find((weight) => { const value = Number(draft.weights[weight.signal]); return draft.weights[weight.signal]?.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100; });
  const holdout = Number(draft.holdout);
  const holdoutBad = draft.holdout.trim() === "" || !Number.isInteger(holdout) || holdout < 0 || holdout > 50;
  // A signal set to 0 that has a default above 0: it leaves the score, which the board says out loud.
  const zeroed = ordered.filter((weight) => Number(draft.weights[weight.signal]) === 0 && (weight.defaultWeight ?? 0) > 0);
  const allDefault = ordered.every((weight) => weight.defaultWeight === null || Number(draft.weights[weight.signal]) === weight.defaultWeight);

  const resetAll = () => setDraft((current) => ({
    ...current,
    weights: Object.fromEntries(ordered.map((weight) => [weight.signal, weight.defaultWeight === null ? current.weights[weight.signal] : pointsFigure(weight.defaultWeight)])),
  }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (bad || holdoutBad || saving) return;
        setSaving(true);
        try { await onSave(draft); } finally { setSaving(false); }
      }}
    >
      <DialogHeader>
        <DialogTitle>Change the weights</DialogTitle>
        <DialogDescription>Points out of the total each signal can give a lead. Save applies them to the next lead served.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {ordered.map((weight) => {
          const id = `weight-${weight.signal}`;
          return (
            <div key={weight.signal} className="flex min-w-0 items-center justify-between gap-3">
              <label htmlFor={id} className="flex min-w-0 items-center gap-2 text-sm text-[var(--body)]" title={weight.blurb}>
                <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", CHART_TONES[signalTone(weight.signal)])} />
                <span className="truncate">{weight.label}</span>
              </label>
              <input
                id={id}
                inputMode="decimal"
                autoFocus={focus === weight.signal}
                aria-label={`${weight.label} weight`}
                aria-invalid={bad?.signal === weight.signal || undefined}
                value={draft.weights[weight.signal] ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, weights: { ...current.weights, [weight.signal]: event.target.value } }))}
                className={cn(inputControl, "w-[84px] shrink-0 text-right tabular-nums")}
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <label htmlFor="weights-holdout" className="min-w-0 text-sm text-[var(--body)]">
          Holdout, % of serves
          <span className="block text-xs text-muted-foreground">Up to 50, served in plain order to measure against</span>
        </label>
        <input id="weights-holdout" inputMode="numeric" aria-invalid={holdoutBad || undefined} value={draft.holdout} onChange={(event) => setDraft((current) => ({ ...current, holdout: event.target.value }))} className={cn(inputControl, "w-[84px] shrink-0 text-right tabular-nums")} />
      </div>

      {(bad || holdoutBad || zeroed.length > 0) && (
        <p className="m-0 text-xs text-muted-foreground">
          {bad ? `${bad.label}: a weight is a number from 0 to 100.`
            : holdoutBad ? "The holdout is a whole number from 0 to 50."
              : `${zeroed.map((weight) => weight.label).join(", ")} at 0 ${zeroed.length === 1 ? "drops it" : "drops them"} from the score. Set ${zeroed.length === 1 ? "it" : "them"}, or Reset to default.`}
        </p>
      )}

      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="outline" disabled={allDefault} onClick={resetAll}>Reset all to default</Button>
        <span className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={Boolean(bad) || holdoutBad || saving}>{saving ? "Saving…" : "Save weights"}</Button>
        </span>
      </DialogFooter>
    </form>
  );
}
