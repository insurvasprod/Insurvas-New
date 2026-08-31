"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency } from "@/lib/money";
import { PLAN_TYPES, PLAN_TYPE_LABELS, BILLING_CYCLE_LABELS, OFFER_DURATION_LABELS, type OfferRow, type PlanType, type BillingCycle, type DiscountType, type CouponDuration } from "@/lib/offers/constants";
import type { PlanListRow } from "@/lib/plans/constants";
import type { SubscriptionRow } from "@/lib/subscriptions/queries";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

type FormState = {
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

const emptyForm: FormState = {
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

function formFromOffer(offer: OfferRow): FormState {
  return {
    ...emptyForm,
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

function displayDiscount(offer: OfferRow): string {
  if (!offer.coupon) return "Unavailable";
  return offer.coupon.discount_type === "percent"
    ? `${offer.coupon.percent_off ?? 0}% off`
    : `${formatCentsAsCurrency(offer.coupon.amount_off_cents ?? 0)} off`;
}

function displayWindow(offer: OfferRow): string {
  const start = offer.starts_at ? new Date(offer.starts_at).toLocaleDateString() : "Now";
  const end = offer.ends_at ? new Date(offer.ends_at).toLocaleDateString() : "No end";
  return `${start} → ${end}`;
}

export function OffersTable({
  initialOffers,
  plans,
  subscriptions,
}: {
  initialOffers: OfferRow[];
  plans: PlanListRow[];
  subscriptions: SubscriptionRow[];
}) {
  const [offers, setOffers] = useState(initialOffers);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<OfferRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [applyOffer, setApplyOffer] = useState<OfferRow | null>(null);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleArray(
    key: "eligible_plan_types" | "eligible_plan_ids" | "eligible_cycles",
    value: PlanType | BillingCycle | string,
  ) {
    setForm((current) => {
      const values = current[key] as readonly string[];
      const next = values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value];
      return { ...current, [key]: next } as FormState;
    });
  }

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(offer: OfferRow) {
    setEditing(offer);
    setForm(formFromOffer(offer));
    setFormOpen(true);
  }

  function payload() {
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

  async function save() {
    if (!form.name.trim()) {
      toast.error("Give the offer a name");
      return;
    }
    setBusy(true);
    const response = await fetch(editing ? `/api/admin/offers/${editing.id}` : "/api/admin/offers", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      toast.error(body?.error ?? "Could not save offer");
      return;
    }
    const saved = body.offer as OfferRow;
    setOffers((current) => editing ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
    setFormOpen(false);
    toast.success(editing ? "Offer updated" : "Offer created");
  }

  async function apply() {
    if (!applyOffer || !subscriptionId) {
      toast.error("Choose a customer");
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/admin/offers/${applyOffer.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription_id: subscriptionId, confirmed }),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      if (body?.code === "confirmation_required") {
        setWarning(body.warning);
        return;
      }
      toast.error(body?.error ?? "Could not apply offer");
      return;
    }
    toast.success("Offer applied");
    setApplyOffer(null);
    setSubscriptionId("");
    setWarning(null);
    setConfirmed(false);
  }

  async function toggleActive(offer: OfferRow) {
    setBusy(true);
    const response = await fetch(`/api/admin/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !offer.is_active }),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      toast.error(body?.error ?? "Could not update offer");
      return;
    }
    setOffers((current) => current.map((item) => item.id === offer.id ? { ...item, is_active: !offer.is_active } : item));
    toast.success(offer.is_active ? "Offer deactivated" : "Offer reactivated");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{offers.length} offer{offers.length === 1 ? "" : "s"}</p>
        <Button size="sm" onClick={openNew}>New offer</Button>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader><TableRow className={tableHeaderRow}>
            <TableHead className={tableHeadCell}>Offer</TableHead>
            <TableHead className={tableHeadCell}>Discount</TableHead>
            <TableHead className={tableHeadCell}>Window</TableHead>
            <TableHead className={tableHeadCell}>Redemptions</TableHead>
            <TableHead className={tableHeadCell}>Discount given</TableHead>
            <TableHead className={tableHeadCell}>Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {offers.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">No offers yet. An offer applies a discount to whoever qualifies, without touching each customer.</TableCell></TableRow> : offers.map((offer) => (
              <TableRow key={offer.id}>
                <TableCell><div className="font-medium">{offer.name}</div><div className="text-xs text-muted-foreground">{offer.auto_apply ? "Auto-apply" : "Manual only"}{offer.is_active ? " · Active" : " · Inactive"}</div></TableCell>
                <TableCell>{displayDiscount(offer)}<div className="text-xs text-muted-foreground">{offer.coupon ? OFFER_DURATION_LABELS[offer.coupon.duration] : ""}</div></TableCell>
                <TableCell className="whitespace-nowrap text-sm">{displayWindow(offer)}</TableCell>
                <TableCell>{offer.redeemed_count}{offer.max_redemptions === null ? "" : ` / ${offer.max_redemptions}`}<div className="text-xs text-muted-foreground">{offer.remaining_redemptions === null ? "Unlimited left" : `${offer.remaining_redemptions} left`}</div></TableCell>
                <TableCell>{formatCentsAsCurrency(offer.discount_given_cents)}</TableCell>
                <TableCell><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openEdit(offer)}>Edit</Button><Button size="sm" variant="outline" onClick={() => { setApplyOffer(offer); setSubscriptionId(""); setWarning(null); setConfirmed(false); }}>Apply</Button><Button size="sm" variant="ghost" onClick={() => toggleActive(offer)} disabled={busy}>{offer.is_active ? "Deactivate" : "Reactivate"}</Button></div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit offer" : "New offer"}</DialogTitle><DialogDescription>{editing ? "Update the campaign rules and window. Discount terms stay fixed after creation so existing applications remain truthful." : "Create a campaign on top of the existing coupon arithmetic."}</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="offer-name">Name</Label><Input id="offer-name" value={form.name} onChange={(event) => set("name", event.target.value)} /></div>
            {!editing && <>
              <div className="space-y-2"><Label htmlFor="offer-discount-type">Discount</Label><select id="offer-discount-type" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={form.discount_type} onChange={(event) => set("discount_type", event.target.value as DiscountType)}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></div>
              <div className="space-y-2"><Label htmlFor="offer-discount-value">{form.discount_type === "percent" ? "Percent off" : "Amount off"}</Label><Input id="offer-discount-value" inputMode="decimal" value={form.discount_type === "percent" ? form.percent_off : form.amount_off} onChange={(event) => set(form.discount_type === "percent" ? "percent_off" : "amount_off", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="offer-duration">Duration</Label><select id="offer-duration" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={form.duration} onChange={(event) => set("duration", event.target.value as CouponDuration)}>{Object.entries(OFFER_DURATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
              {form.duration === "n_periods" && <div className="space-y-2"><Label htmlFor="offer-duration-periods">Number of billing periods</Label><Input id="offer-duration-periods" type="number" min={1} max={60} value={form.duration_periods} onChange={(event) => set("duration_periods", event.target.value)} /></div>}
            </>}
            <div className="space-y-2"><Label htmlFor="offer-starts">Starts at</Label><Input id="offer-starts" type="datetime-local" value={form.starts_at} onChange={(event) => set("starts_at", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="offer-ends">Ends at</Label><Input id="offer-ends" type="datetime-local" value={form.ends_at} onChange={(event) => set("ends_at", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="offer-cap">Maximum redemptions</Label><Input id="offer-cap" type="number" min={1} value={form.max_redemptions} onChange={(event) => set("max_redemptions", event.target.value)} placeholder="Unlimited" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.auto_apply} onChange={(event) => set("auto_apply", event.target.checked)} /> Auto-apply to qualifying assignments</label>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Plan types (empty means all)</legend><div className="grid gap-2 sm:grid-cols-2">{PLAN_TYPES.map((type) => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.eligible_plan_types.includes(type)} onChange={() => toggleArray("eligible_plan_types", type)} /> {PLAN_TYPE_LABELS[type]}</label>)}</div></fieldset>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Specific plans (empty means all)</legend><div className="grid max-h-32 gap-2 overflow-y-auto sm:grid-cols-2">{plans.map((plan) => <label key={plan.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.eligible_plan_ids.includes(plan.id)} onChange={() => toggleArray("eligible_plan_ids", plan.id)} /> {plan.name} <span className="text-xs text-muted-foreground">({plan.code})</span></label>)}</div></fieldset>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Billing cycles (empty means all)</legend><div className="flex flex-wrap gap-4">{(Object.keys(BILLING_CYCLE_LABELS) as BillingCycle[]).map((cycle) => <label key={cycle} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.eligible_cycles.includes(cycle)} onChange={() => toggleArray("eligible_cycles", cycle)} /> {BILLING_CYCLE_LABELS[cycle]}</label>)}</div></fieldset>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Customer eligibility</legend><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.new_customers_only} onChange={(event) => { set("new_customers_only", event.target.checked); if (event.target.checked) set("existing_customers_only", false); }} /> New signups only</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.existing_customers_only} onChange={(event) => { set("existing_customers_only", event.target.checked); if (event.target.checked) set("new_customers_only", false); }} /> Existing customers only</label></div></fieldset>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create offer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(applyOffer)} onOpenChange={(open) => { if (!open) setApplyOffer(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply {applyOffer?.name}</DialogTitle><DialogDescription>Choose a named customer subscription. Manual application bypasses campaign rules, but a plan-type mismatch always requires confirmation.</DialogDescription></DialogHeader>
          <div className="space-y-4"><div className="space-y-2"><Label htmlFor="offer-customer">Customer subscription</Label><select id="offer-customer" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={subscriptionId} onChange={(event) => { setSubscriptionId(event.target.value); setWarning(null); setConfirmed(false); }}><option value="">Choose a customer</option>{subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.tenant_name ?? "Unnamed customer"} · {subscription.plan_name ?? "Plan"} · {subscription.billing_cycle}</option>)}</select></div>{warning && <Card className="border-[var(--color-warning)]/50"><CardContent className="space-y-2"><p className="text-sm font-medium text-[var(--color-warning)]">Confirmation required</p><p className="text-sm">{warning}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I understand and want to apply it anyway.</label></CardContent></Card>}</div>
          <DialogFooter><Button variant="outline" onClick={() => setApplyOffer(null)}>Cancel</Button><Button onClick={apply} disabled={busy || !subscriptionId || Boolean(warning && !confirmed)}>{busy ? "Applying…" : "Apply offer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
