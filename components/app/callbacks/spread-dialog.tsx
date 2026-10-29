"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inputControl } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { localParts, dayTitle } from "./time";

/**
 * Clear the overdue (Callbacks A, owner pick 2026-10-28): spread many callbacks into the next open
 * times, each inside its own customer's calling window, no hour holding more than the agent sets.
 * Step one shows the plan (how many land each day, which could not be placed and why); nothing is
 * booked until "Spread" is pressed. The server does both steps (lib/callbacks/spread.ts).
 */
type Item = { callbackId: string; utc: string; customerLocal: string };
type Miss = { callbackId: string; reason: string };

const SPANS = [
  { days: 3, label: "Over the next 3 days" },
  { days: 7, label: "Over the next week" },
  { days: 1, label: "In the next 24 hours" },
] as const;

export function SpreadDialog({ open, onOpenChange, ids, names, yourZone, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The callbacks to spread, oldest first. */
  ids: string[];
  /** Customer names by callback id, for the plan's misses. */
  names: Record<string, string>;
  yourZone: string;
  onDone: () => void;
}) {
  const [days, setDays] = useState<number>(3);
  const [perHour, setPerHour] = useState(6);
  const [plan, setPlan] = useState<{ placed: Item[]; missed: Miss[] } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState("");

  // A changed choice drops the plan: the agent sees a fresh one before booking.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the plan belongs to the choices it was made from
  useEffect(() => { setPlan(null); setError(""); }, [days, perHour, open, ids.length]);

  async function call(body: Record<string, unknown>) {
    const response = await fetch("/api/app/callbacks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error ?? "The callbacks could not be spread.");
    return result;
  }
  async function makePlan() {
    setPlanning(true); setError("");
    try { setPlan((await call({ action: "spread_plan", callback_ids: ids.slice(0, 100), days, per_hour: perHour })).plan); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The plan could not be made."); }
    finally { setPlanning(false); }
  }
  async function book() {
    if (!plan?.placed.length) return;
    setBooking(true); setError("");
    try {
      const { result } = await call({ action: "spread_commit", items: plan.placed.map((item) => ({ callback_id: item.callbackId, callback_local: item.customerLocal })) });
      const failed = (result?.failed ?? []) as Miss[];
      if (failed.length) notify.warn(`${result.booked} callbacks moved`, { detail: `${failed.length} could not be moved: ${failed.slice(0, 3).map((miss) => `${names[miss.callbackId] ?? "a callback"} (${miss.reason})`).join(", ")}${failed.length > 3 ? "…" : ""}` });
      else notify.done(`${result.booked} callbacks moved into open times`);
      onOpenChange(false);
      onDone();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The callbacks could not be moved."); }
    finally { setBooking(false); }
  }

  // The plan by day, in the agent's own clock.
  const byDay = new Map<string, number>();
  for (const item of plan?.placed ?? []) { const day = localParts(item.utc, yourZone).date; byDay.set(day, (byDay.get(day) ?? 0) + 1); }
  const over = ids.length > 100;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!booking) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear {ids.length === 1 ? "1 callback" : `${ids.length} callbacks`}</DialogTitle>
          <DialogDescription>Each one is booked into the next open time inside its customer&apos;s calling window, oldest first. Nothing is moved until you press Spread.</DialogDescription>
        </DialogHeader>

        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 text-label text-[var(--body)]">When</legend>
          {SPANS.map((span) => (
            <label key={span.days} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm", days === span.days ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-border hover:bg-[var(--surface-alt)]")}>
              <input type="radio" name="spread-span" className="accent-[var(--primary)]" checked={days === span.days} onChange={() => setDays(span.days)} />
              <span className="flex-1 font-medium text-foreground">{span.label}</span>
              <span className="text-xs text-muted-foreground">about {Math.max(1, Math.ceil(Math.min(ids.length, 100) / span.days))} a day</span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-center justify-between gap-4 text-label text-[var(--body)]">
          At most per hour
          <input type="number" min={1} max={30} value={perHour} onChange={(event) => setPerHour(Math.min(30, Math.max(1, Number(event.target.value) || 1)))} className={cn(inputControl, "w-24 text-right")} />
        </label>

        {over && <p className="m-0 text-xs text-[var(--warning-ink)]">The oldest 100 are spread now; run it again for the rest.</p>}

        {plan && (
          <div className="flex flex-col gap-2 rounded-lg bg-[var(--surface-alt)] p-3">
            <span className="text-label text-[var(--body)]">The plan</span>
            {plan.placed.length > 0
              ? <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">{[...byDay.entries()].map(([day, count]) => <li key={day} className="rounded-md bg-card px-2 py-1 text-sm text-foreground"><span className="text-muted-foreground">{dayTitle(day)}</span> <strong className="font-semibold tabular-nums">{count}</strong></li>)}</ul>
              : <p className="m-0 text-sm text-foreground">No open times were found. Try a longer span or more per hour.</p>}
            {plan.missed.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{plan.missed.length} stay where they are</summary>
                <ul className="m-0 mt-1 list-disc pl-5">{plan.missed.slice(0, 12).map((miss) => <li key={miss.callbackId}>{names[miss.callbackId] ?? "A callback"}: {miss.reason}</li>)}</ul>
              </details>
            )}
          </div>
        )}
        {error && <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={booking} onClick={() => onOpenChange(false)}>Cancel</Button>
          {plan
            ? <Button type="button" disabled={booking || plan.placed.length === 0} onClick={() => void book()}>{booking ? <><Loader2 className="animate-spin" aria-hidden="true" />Moving…</> : `Spread ${plan.placed.length} callbacks`}</Button>
            : <Button type="button" disabled={planning || ids.length === 0} onClick={() => void makePlan()}>{planning ? <><Loader2 className="animate-spin" aria-hidden="true" />Finding times…</> : "Show the plan"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
