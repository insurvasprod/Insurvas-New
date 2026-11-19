"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { inputControl } from "@/components/ui/field";
import type { CouponRow } from "@/lib/coupons/constants";
import { endOfUtcDay, planLabel, type CouponPlanRef } from "@/lib/coupons/format";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { CheckBox } from "@/components/ui/check-box";
const HINT = "text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";

type Cycle = "any" | "monthly" | "quarterly" | "yearly";

type CouponForm = {
  code: string;
  discount_type: "percent" | "fixed";
  percent_off: string;
  amount_off: string;
  duration: "once" | "n_periods" | "forever";
  duration_periods: string;
  billing_cycle: Cycle;
  max_redemptions: string;
  expires_on: string;
  plan_ids: string[];
};

const EMPTY: CouponForm = {
  code: "",
  discount_type: "percent",
  percent_off: "50",
  amount_off: "",
  duration: "n_periods",
  duration_periods: "3",
  billing_cycle: "monthly",
  max_redemptions: "",
  expires_on: "",
  plan_ids: [],
};

/**
 * "Duplicate as new code" (admin round 1): the same terms as an existing coupon under a code still to be typed. Whop
 * fixes a promo code's amount once it exists, so changing the terms means a new code; the expiry is left for the
 * person to pick again, since the old one may already have passed.
 */
function formFrom(source: CouponRow | null): CouponForm {
  if (!source) return EMPTY;
  return {
    ...EMPTY,
    discount_type: source.discount_type,
    percent_off: source.percent_off === null ? EMPTY.percent_off : String(source.percent_off),
    amount_off: source.amount_off_cents === null ? "" : (source.amount_off_cents / 100).toFixed(2),
    duration: source.duration,
    duration_periods: source.duration_periods === null ? EMPTY.duration_periods : String(source.duration_periods),
    billing_cycle: (source.billing_cycle as Cycle | null) ?? "any",
    max_redemptions: source.max_redemptions === null ? "" : String(source.max_redemptions),
    plan_ids: source.restricted_to_plan_ids ?? [],
  };
}

/**
 * "New coupon" as a right sheet (admin round 1, billing-r2 screen 8): the same fields and the same POST
 * /api/admin/coupons as the old dialog — an expiry date, a plan restriction and "Any cycle" included. `duplicateOf`
 * fills the terms from an existing coupon. Render it only while it is open.
 *
 * `plans` is null when the plan list could not be read; the restriction is then unavailable rather than silently
 * empty.
 */
export function CouponCreateSheet({ plans, duplicateOf, onClose, onCreated }: {
  plans: CouponPlanRef[] | null;
  duplicateOf: CouponRow | null;
  onClose: () => void;
  onCreated: (code: string) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CouponForm>(() => formFrom(duplicateOf));

  function set<K extends keyof CouponForm>(key: K, value: CouponForm[K]) {
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
  // Today in UTC, read once when the sheet mounts. An expiry of today is still valid until 23:59:59 UTC; the server
  // re-checks against the real clock either way.
  const [todayUtc] = useState(() => new Date().toISOString().slice(0, 10));
  const expiryInvalid = form.expires_on !== "" && (!expiresAt || form.expires_on < todayUtc);

  async function create() {
    setBusy(true);
    setError(null);
    const code = form.code.trim().toUpperCase();
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
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

    notify.done(`${code} created`);
    onCreated(code);
  }

  return (
    <Sheet
      title={duplicateOf ? `Duplicate ${duplicateOf.code}` : "New coupon"}
      subtitle="A promo code at Whop. Whop is asked first; if it refuses, nothing is created here."
      onClose={() => { if (!busy) onClose(); }}
      footer={<>
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={() => void create()} disabled={busy || form.code.trim().length < 3 || periodsNeedCycle || expiryInvalid}>
          {busy ? "Creating…" : "Create coupon"}
        </Button>
      </>}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-code`}>Code</Label>
        <Input id={`${id}-code`} value={form.code} onChange={(e) => set("code", e.target.value)} placeholder={duplicateOf ? `${duplicateOf.code}2` : "WELCOME50"} className="font-mono uppercase" autoFocus />
        <p className={HINT}>Letters, numbers, - and _. Stored in capitals, so it is typed the same way every time.</p>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`${id}-type`}>Type</Label>
          <select id={`${id}-type`} className={inputControl} value={form.discount_type} onChange={(event) => set("discount_type", event.target.value as CouponForm["discount_type"])}>
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`${id}-value`}>{form.discount_type === "percent" ? "Percent off" : "Amount off ($)"}</Label>
          {form.discount_type === "percent" ? (
            <Input id={`${id}-value`} inputMode="numeric" value={form.percent_off} onChange={(e) => set("percent_off", e.target.value)} />
          ) : (
            <Input id={`${id}-value`} inputMode="decimal" value={form.amount_off} onChange={(e) => set("amount_off", e.target.value)} placeholder="25.00" />
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`${id}-duration`}>Duration</Label>
          <select id={`${id}-duration`} className={inputControl} value={form.duration} onChange={(event) => set("duration", event.target.value as CouponForm["duration"])}>
            <option value="once">One billing period</option>
            <option value="n_periods">A number of periods</option>
            <option value="forever">Forever</option>
          </select>
        </div>
        {form.duration === "n_periods" && (
          <div className="w-28 space-y-1.5">
            <Label htmlFor={`${id}-periods`}>Periods</Label>
            <Input id={`${id}-periods`} inputMode="numeric" value={form.duration_periods} onChange={(e) => set("duration_periods", e.target.value)} />
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`${id}-cycle`}>Billing cycle</Label>
          <select id={`${id}-cycle`} aria-describedby={`${id}-cycle-hint`} className={inputControl} value={form.billing_cycle} onChange={(event) => set("billing_cycle", event.target.value as Cycle)}>
            <option value="any">Any cycle</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
          <p id={`${id}-cycle-hint`} className={cn(HINT, periodsNeedCycle && "text-[var(--error-ink)]")}>
            {form.billing_cycle === "any"
              ? periodsNeedCycle
                ? "A number of periods needs a cycle: three periods is 3, 9 or 36 months depending on it. Choose a cycle, or use one period or forever."
                : "Applies on every cycle. Whop counts one month for a single period, which is exactly the first invoice on any cycle."
              : "Only subscriptions on this cycle can use it. Periods are converted to months for Whop, so 3 periods means 3 invoices on this cycle."}
          </p>
        </div>
        <div className="w-28 space-y-1.5">
          <Label htmlFor={`${id}-max`}>Max uses</Label>
          <Input id={`${id}-max`} inputMode="numeric" value={form.max_redemptions} onChange={(e) => set("max_redemptions", e.target.value)} placeholder="∞" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-expires`}>Expires on (optional)</Label>
        <Input id={`${id}-expires`} type="date" min={todayUtc} value={form.expires_on} onChange={(e) => set("expires_on", e.target.value)} aria-describedby={`${id}-expires-hint`} />
        <p id={`${id}-expires-hint`} className={cn(HINT, expiryInvalid && "text-[var(--error-ink)]")}>
          {expiryInvalid ? "Pick a date in the future." : "Stops working at 23:59:59 UTC on this day, here and at Whop. Leave empty for no expiry."}
        </p>
      </div>

      <fieldset className="m-0 space-y-1.5 border-0 p-0">
        <legend className="text-sm leading-none font-semibold">Plans (optional)</legend>
        {plans === null ? (
          <p className={HINT}>The plan list could not be read, so this coupon can only be created for any plan.</p>
        ) : plans.length === 0 ? (
          <p className={HINT}>There are no plans to restrict it to.</p>
        ) : (
          <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-[8px] border border-[var(--border)] p-2.5">
            {plans.map((plan) => (
              <label key={plan.id} className="flex cursor-pointer items-center gap-2 text-sm leading-[1.5] text-[var(--ink)]">
                <CheckBox checked={form.plan_ids.includes(plan.id)} onChange={() => togglePlan(plan.id)} />
                {planLabel(plan)}
              </label>
            ))}
          </div>
        )}
        <p className={HINT}>
          None ticked is any plan. Insurvas enforces this when checkout opens and when staff apply the coupon. Whop is not given the restriction, so Whop does not enforce it.
        </p>
      </fieldset>

      {error && <p role="alert" className="m-0 text-sm leading-[1.5] text-[var(--error-ink)]">{error}</p>}
    </Sheet>
  );
}
