"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { notify } from "@/lib/notify";
import type { GoalFor, GoalKind } from "@/lib/dashboard/goalRules";

/**
 * "Set goal" / "Set target" on the compact Home (roles r1, owner 2026-11-18): a right sheet with one amount, saved to
 * /api/app/goals. Until the goals table is applied (`needsUpdate`) the sheet says so on its status line and the save
 * stays off; the ring keeps last month's figure meanwhile.
 */
export function GoalSheetButton({ kind, whose, label, title, unit, current, fallback, needsUpdate }: {
  kind: GoalKind;
  whose: GoalFor;
  /** The button: "Set goal", "Set target". */
  label: string;
  /** The sheet's title: "November goal", "Weekly target". */
  title: string;
  /** "$" for a premium goal, else what is counted: "policies", "appointments", "saves". */
  unit: string;
  /** The stored goal as typed (dollars or a count), or null. */
  current: number | null;
  /** What the ring uses without one ("Last month: $12,400"). */
  fallback: string;
  needsUpdate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current === null ? "" : String(current));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const money = unit === "$";

  const send = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/goals", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, for: whose, target: value }) });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? "The goal could not be saved.");
        return;
      }
      notify.done(method === "POST" ? `${title} saved` : `${title} cleared`);
      setOpen(false);
      router.refresh();
    } catch {
      setError("The goal could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>{label}</Button>
      {/* Into the body: the card it is opened from clips and transforms (its rise-in motion), which would trap a fixed sheet. */}
      {open && typeof document !== "undefined" && createPortal(
        <Sheet
          title={title}
          subtitle={whose === "agency" ? "For the whole agency, every month until you change it." : kind === "booked" ? "Yours, every week until you change it." : "Yours, every month until you change it."}
          status={needsUpdate ? <span className="text-xs text-[var(--warning-ink)]">Goals need a database update before they can be saved. Until then the ring uses last month.</span> : undefined}
          onClose={() => setOpen(false)}
          footer={
            <div className="flex w-full items-center gap-2">
              {current !== null && !needsUpdate && <Button type="button" variant="ghost" disabled={busy} onClick={() => void send("DELETE")}>Clear goal</Button>}
              <span className="flex-1" />
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="button" disabled={busy || needsUpdate || !value.trim()} onClick={() => void send("POST")}>{busy ? "Saving…" : "Save"}</Button>
            </div>
          }
        >
          <Field label={money ? "Issued premium a month" : kind === "booked" ? "Appointments booked a week" : kind === "saves" ? "Saves a month" : "Policies issued a month"} htmlFor="goal-target" hint={fallback} error={error ?? undefined}>
            <div className="relative mt-1.5">
              {money && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>}
              <Input
                id="goal-target"
                inputMode="numeric"
                autoComplete="off"
                className={money ? "pl-7" : undefined}
                value={value}
                disabled={needsUpdate}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !needsUpdate && value.trim()) void send("POST"); }}
              />
            </div>
          </Field>
          {!money && <p className="m-0 text-xs text-muted-foreground">Counted in {unit}.</p>}
        </Sheet>,
        document.body,
      )}
    </>
  );
}
