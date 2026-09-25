"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

import { btn } from "@/components/app/settings/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { endOfUtcDay, planLabel, type CouponPlanRef } from "@/lib/coupons/format";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const PRIMARY_44 =
  "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-[8px] border border-transparent bg-[var(--primary)] px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--on-primary)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

const HINT = "text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";

type Cycle = "any" | "monthly" | "quarterly" | "yearly";

const EMPTY = {
  code: "",
  discount_type: "percent" as "percent" | "fixed",
  percent_off: "50",
  amount_off: "",
  duration: "n_periods" as "once" | "n_periods" | "forever",
  duration_periods: "3",
  billing_cycle: "monthly" as Cycle,
  max_redemptions: "",
  expires_on: "",
  plan_ids: [] as string[],
};

/**
 * "New coupon" in the page header and the dialog it opens. The same fields the old table's dialog
 * had, plus the three the board implies: an expiry date, a plan restriction and "Any cycle".
 *
 * `plans` is null when the plan list could not be read; the restriction is then unavailable rather
 * than silently empty.
 */
export function CouponCreateDialog({ plans }: { plans: CouponPlanRef[] | null }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  function togglePlan(planId: string) {
    setForm((f) => ({
      ...f,
      plan_ids: f.plan_ids.includes(planId) ? f.plan_ids.filter((p) => p !== planId) : [...f.plan_ids, planId],
    }));
  }

  const periodsNeedCycle = form.duration === "n_periods" && form.billing_cycle === "any";
  const expiresAt = form.expires_on ? endOfUtcDay(form.expires_on) : null;
  // Today in UTC, read once when the dialog mounts. An expiry of today is still valid until 23:59:59
  // UTC; the server re-checks against the real clock either way.
  const [todayUtc] = useState(() => new Date().toISOString().slice(0, 10));
  const expiryInvalid = form.expires_on !== "" && (!expiresAt || form.expires_on < todayUtc);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code.trim().toUpperCase(),
        discount_type: form.discount_type,
        percent_off: form.discount_type === "percent" ? Number(form.percent_off) : null,
        amount_off: form.discount_type === "fixed" ? form.amount_off.trim() : null,
        duration: form.duration,
        duration_periods: form.duration === "n_periods" ? Number(form.duration_periods) : null,
        billing_cycle: form.billing_cycle === "any" ? null : form.billing_cycle,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        expires_at: expiresAt,
        restricted_to_plan_ids: form.plan_ids,
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);

    if (!res || !res.ok) {
      setError(body?.error ?? "Could not create the coupon. Nothing was created.");
      return;
    }

    notify.done(`${form.code.trim().toUpperCase()} created`);
    setOpen(false);
    setForm(EMPTY);
    router.refresh();
  }

  return (
    <>
      <button type="button" className={PRIMARY_44} onClick={() => setOpen(true)}>
        New coupon
      </button>

      <Dialog open={open} onOpenChange={(value) => !busy && setOpen(value)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New coupon</DialogTitle>
            <DialogDescription>
              Creates a promo code at Whop, which is what reduces the charge when a customer enters the code at checkout.
              Whop is asked first; if it refuses, nothing is created here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-code`}>Code</Label>
              <Input
                id={`${id}-code`}
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="WELCOME50"
                className="font-mono uppercase"
              />
              <p className={HINT}>Letters, numbers, - and _. Stored in capitals, so it is typed the same way every time.</p>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`${id}-type`}>Type</Label>
                <Select value={form.discount_type} onValueChange={(v) => set("discount_type", v as "percent")}>
                  <SelectTrigger id={`${id}-type`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentage</SelectItem>
                    <SelectItem value="fixed">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`${id}-value`}>{form.discount_type === "percent" ? "Percent off" : "Amount off ($)"}</Label>
                {form.discount_type === "percent" ? (
                  <Input id={`${id}-value`} inputMode="numeric" value={form.percent_off} onChange={(e) => set("percent_off", e.target.value)} />
                ) : (
                  <Input
                    id={`${id}-value`}
                    inputMode="decimal"
                    value={form.amount_off}
                    onChange={(e) => set("amount_off", e.target.value)}
                    placeholder="25.00"
                  />
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`${id}-duration`}>Duration</Label>
                <Select value={form.duration} onValueChange={(v) => set("duration", v as "once")}>
                  <SelectTrigger id={`${id}-duration`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">One billing period</SelectItem>
                    <SelectItem value="n_periods">A number of periods</SelectItem>
                    <SelectItem value="forever">Forever</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.duration === "n_periods" && (
                <div className="w-28 space-y-1.5">
                  <Label htmlFor={`${id}-periods`}>Periods</Label>
                  <Input
                    id={`${id}-periods`}
                    inputMode="numeric"
                    value={form.duration_periods}
                    onChange={(e) => set("duration_periods", e.target.value)}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`${id}-cycle`}>Billing cycle</Label>
                <Select value={form.billing_cycle} onValueChange={(v) => set("billing_cycle", v as Cycle)}>
                  <SelectTrigger id={`${id}-cycle`} className="w-full" aria-describedby={`${id}-cycle-hint`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any cycle</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
                <p id={`${id}-cycle-hint`} className={cn(HINT, periodsNeedCycle && "text-[var(--error-ink)]")}>
                  {form.billing_cycle === "any"
                    ? periodsNeedCycle
                      ? "A number of periods needs a cycle: three periods is 3, 9 or 36 months depending on it. Choose a cycle, or use one period or forever."
                      : "Applies on every cycle. Whop counts one month for a single period, which is exactly the first invoice on any cycle."
                    : "Only subscriptions on this cycle can use it. Periods are converted to months for Whop, so 3 periods means 3 invoices on this cycle."}
                </p>
              </div>

              <div className="w-32 space-y-1.5">
                <Label htmlFor={`${id}-max`}>Max uses</Label>
                <Input
                  id={`${id}-max`}
                  inputMode="numeric"
                  value={form.max_redemptions}
                  onChange={(e) => set("max_redemptions", e.target.value)}
                  placeholder="∞"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-expires`}>Expires on (optional)</Label>
              <Input
                id={`${id}-expires`}
                type="date"
                min={todayUtc}
                value={form.expires_on}
                onChange={(e) => set("expires_on", e.target.value)}
                aria-describedby={`${id}-expires-hint`}
              />
              <p id={`${id}-expires-hint`} className={cn(HINT, expiryInvalid && "text-[var(--error-ink)]")}>
                {expiryInvalid
                  ? "Pick a date in the future."
                  : "Stops working at 23:59:59 UTC on this day, here and at Whop. Leave empty for no expiry."}
              </p>
            </div>

            <fieldset className="m-0 space-y-1.5 border-0 p-0">
              <legend className="text-sm leading-none font-semibold">Plans (optional)</legend>
              {plans === null ? (
                <p className={HINT}>The plan list could not be read, so this coupon can only be created for any plan.</p>
              ) : plans.length === 0 ? (
                <p className={HINT}>There are no plans to restrict it to.</p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-[8px] border border-[var(--border)] p-2.5">
                  {plans.map((plan) => (
                    <label key={plan.id} className="flex cursor-pointer items-center gap-2 text-[14px] leading-[1.5] text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={form.plan_ids.includes(plan.id)}
                        onChange={() => togglePlan(plan.id)}
                        className="size-4 accent-[var(--primary)]"
                      />
                      {planLabel(plan)}
                    </label>
                  ))}
                </div>
              )}
              <p className={HINT}>
                None ticked is any plan. Insurvas enforces this when checkout opens and when staff apply the coupon.
                Whop is not given the restriction, so Whop does not enforce it.
              </p>
            </fieldset>

            {error && (
              <p role="alert" className="m-0 text-[14px] leading-[1.5] text-[var(--error-ink)]">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <button type="button" className={btn("ghost")} onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className={btn("primary")}
              onClick={() => void create()}
              disabled={busy || form.code.trim().length < 3 || periodsNeedCycle || expiryInvalid}
            >
              {busy ? "Creating…" : "Create coupon"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
