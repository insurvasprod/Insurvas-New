"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inputControl } from "@/components/ui/field";
import {
  BILLING_CYCLE_LABELS,
  OFFER_DURATION_LABELS,
  PLAN_TYPES,
  PLAN_TYPE_LABELS,
  type BillingCycle,
  type CouponDuration,
  type DiscountType,
  type OfferRow,
  type PlanType,
} from "@/lib/offers/constants";
import type { PlanListRow } from "@/lib/plans/constants";

import { CheckBox } from "@/components/ui/check-box";
export type OfferFormState = {
  name: string;
  discount_type: DiscountType;
  percent_off: string;
  amount_off: string;
  duration: CouponDuration;
  duration_periods: string;
  starts_at: string;
  ends_at: string;
  max_redemptions: string;
  auto_apply: boolean;
  eligible_plan_types: PlanType[];
  eligible_plan_ids: string[];
  new_customers_only: boolean;
  existing_customers_only: boolean;
  eligible_cycles: BillingCycle[];
};

export const EMPTY_OFFER_FORM: OfferFormState = {
  name: "",
  discount_type: "percent",
  percent_off: "50",
  amount_off: "",
  duration: "n_periods",
  duration_periods: "3",
  starts_at: "",
  ends_at: "",
  max_redemptions: "",
  auto_apply: false,
  eligible_plan_types: [],
  eligible_plan_ids: [],
  new_customers_only: false,
  existing_customers_only: false,
  eligible_cycles: [],
};

function inputDate(value: string | null): string {
  return value ? value.slice(0, 16) : "";
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function offerFormFrom(offer: OfferRow): OfferFormState {
  return {
    ...EMPTY_OFFER_FORM,
    name: offer.name,
    discount_type: offer.coupon?.discount_type ?? "percent",
    percent_off: String(offer.coupon?.percent_off ?? 50),
    amount_off: offer.coupon?.amount_off_cents ? String(offer.coupon.amount_off_cents / 100) : "",
    duration: offer.coupon?.duration ?? "n_periods",
    duration_periods: String(offer.coupon?.duration_periods ?? 3),
    starts_at: inputDate(offer.starts_at),
    ends_at: inputDate(offer.ends_at),
    max_redemptions: offer.max_redemptions === null ? "" : String(offer.max_redemptions),
    auto_apply: offer.auto_apply,
    eligible_plan_types: offer.eligible_plan_types,
    eligible_plan_ids: offer.eligible_plan_ids,
    new_customers_only: offer.new_customers_only,
    existing_customers_only: offer.existing_customers_only,
    eligible_cycles: offer.eligible_cycles,
  };
}

/** The body the offer routes take: the discount terms only on create (they stay fixed after, as before). */
export function offerPayload(form: OfferFormState, editing: boolean) {
  return {
    name: form.name,
    ...(editing ? {} : {
      discount_type: form.discount_type,
      percent_off: form.discount_type === "percent" ? Number(form.percent_off) : null,
      amount_off: form.discount_type === "fixed" ? form.amount_off : null,
      duration: form.duration,
      duration_periods: form.duration === "n_periods" ? Number(form.duration_periods) : null,
    }),
    starts_at: toIso(form.starts_at),
    ends_at: toIso(form.ends_at),
    max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
    auto_apply: form.auto_apply,
    eligible_plan_types: form.eligible_plan_types,
    eligible_plan_ids: form.eligible_plan_ids,
    new_customers_only: form.new_customers_only,
    existing_customers_only: form.existing_customers_only,
    eligible_cycles: form.eligible_cycles,
  };
}

const CHECK = "flex items-center gap-2 text-sm";

/**
 * The offer's fields (the old dialog's, unchanged), drawn inside the offer sheet and the New offer sheet. Editing an
 * offer keeps its discount terms fixed so existing applications remain truthful.
 */
export function OfferFields({ form, onChange, editing, plans }: {
  form: OfferFormState;
  onChange: (next: OfferFormState) => void;
  editing: boolean;
  plans: PlanListRow[];
}) {
  const set = <K extends keyof OfferFormState>(key: K, value: OfferFormState[K]) => onChange({ ...form, [key]: value });
  const toggle = (key: "eligible_plan_types" | "eligible_plan_ids" | "eligible_cycles", value: string) => {
    const values = form[key] as readonly string[];
    onChange({ ...form, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] } as OfferFormState);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2"><Label htmlFor="offer-name">Name</Label><Input id="offer-name" value={form.name} onChange={(event) => set("name", event.target.value)} /></div>
      {!editing && <>
        <div className="space-y-2"><Label htmlFor="offer-discount-type">Discount</Label><select id="offer-discount-type" className={inputControl} value={form.discount_type} onChange={(event) => set("discount_type", event.target.value as DiscountType)}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></div>
        <div className="space-y-2"><Label htmlFor="offer-discount-value">{form.discount_type === "percent" ? "Percent off" : "Amount off"}</Label><Input id="offer-discount-value" inputMode="decimal" value={form.discount_type === "percent" ? form.percent_off : form.amount_off} onChange={(event) => set(form.discount_type === "percent" ? "percent_off" : "amount_off", event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="offer-duration">Duration</Label><select id="offer-duration" className={inputControl} value={form.duration} onChange={(event) => set("duration", event.target.value as CouponDuration)}>{Object.entries(OFFER_DURATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        {form.duration === "n_periods" && <div className="space-y-2"><Label htmlFor="offer-duration-periods">Number of billing periods</Label><Input id="offer-duration-periods" type="number" min={1} max={60} value={form.duration_periods} onChange={(event) => set("duration_periods", event.target.value)} /></div>}
      </>}
      <div className="space-y-2"><Label htmlFor="offer-starts">Starts at</Label><Input id="offer-starts" type="datetime-local" value={form.starts_at} onChange={(event) => set("starts_at", event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="offer-ends">Ends at</Label><Input id="offer-ends" type="datetime-local" value={form.ends_at} onChange={(event) => set("ends_at", event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="offer-cap">Maximum redemptions</Label><Input id="offer-cap" type="number" min={1} value={form.max_redemptions} onChange={(event) => set("max_redemptions", event.target.value)} placeholder="Unlimited" /></div>
      <label className={`${CHECK} sm:self-end sm:pb-2`}><CheckBox checked={form.auto_apply} onChange={(event) => set("auto_apply", event.target.checked)} /> Auto-apply to qualifying assignments</label>
      <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Plan types (empty means all)</legend><div className="grid gap-2 sm:grid-cols-2">{PLAN_TYPES.map((type) => <label key={type} className={CHECK}><CheckBox checked={form.eligible_plan_types.includes(type)} onChange={() => toggle("eligible_plan_types", type)} /> {PLAN_TYPE_LABELS[type]}</label>)}</div></fieldset>
      <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Specific plans (empty means all)</legend><div className="grid max-h-32 gap-2 overflow-y-auto sm:grid-cols-2">{plans.map((plan) => <label key={plan.id} className={CHECK}><CheckBox checked={form.eligible_plan_ids.includes(plan.id)} onChange={() => toggle("eligible_plan_ids", plan.id)} /> {plan.name} <span className="text-xs text-muted-foreground">({plan.code})</span></label>)}</div></fieldset>
      <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Billing cycles (empty means all)</legend><div className="flex flex-wrap gap-4">{(Object.keys(BILLING_CYCLE_LABELS) as BillingCycle[]).map((cycle) => <label key={cycle} className={CHECK}><CheckBox checked={form.eligible_cycles.includes(cycle)} onChange={() => toggle("eligible_cycles", cycle)} /> {BILLING_CYCLE_LABELS[cycle]}</label>)}</div></fieldset>
      <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Customer eligibility</legend><div className="flex flex-wrap gap-4"><label className={CHECK}><CheckBox checked={form.new_customers_only} onChange={(event) => onChange({ ...form, new_customers_only: event.target.checked, existing_customers_only: event.target.checked ? false : form.existing_customers_only })} /> New signups only</label><label className={CHECK}><CheckBox checked={form.existing_customers_only} onChange={(event) => onChange({ ...form, existing_customers_only: event.target.checked, new_customers_only: event.target.checked ? false : form.new_customers_only })} /> Existing customers only</label></div></fieldset>
    </div>
  );
}
