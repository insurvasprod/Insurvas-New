"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { EMPTY_OFFER_FORM, OfferFields, offerFormFrom, offerPayload, type OfferFormState } from "@/components/admin/billing/offer-form";
import { Button } from "@/components/ui/button";
import { inputControl } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import type { OfferRow } from "@/lib/offers/constants";
import { OFFER_STATE, ruleOf, stateOf } from "@/lib/offers/present";
import { whoQualifies, type OfferCustomer } from "@/lib/offers/qualify";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import type { PlanListRow } from "@/lib/plans/constants";

import { CheckBox } from "@/components/ui/check-box";
const WIDE = "lg:w-[640px]";
const SECTION = "flex flex-col gap-2 border-t border-border pt-4";
const H = "m-0 text-sm font-semibold text-foreground";
const QUALIFIERS_SHOWN = 8;

/**
 * One offer as a wide right sheet (admin round 1, billing-r2 screen 9), or a new one when `offer` is null: its
 * fields (the old Edit dialog's), who qualifies for it right now and which other offers those customers also qualify
 * for, Apply to a customer (asks before a plan-type mismatch, as the route always has), and Deactivate / Reactivate.
 * Every write goes through the routes the old dialogs used.
 */
export function OfferSheet({ offer, offers, overlapsWith, plans, customers, now, onClose, onSaved }: {
  offer: OfferRow | null;
  offers: OfferRow[];
  /** The live offers this one could apply together with. */
  overlapsWith: OfferRow[];
  plans: PlanListRow[];
  /** Every subscription that is not cancelled, with its offer context. */
  customers: OfferCustomer[];
  now: number;
  onClose: () => void;
  /** After any write; the page reads again. `created` opens the new offer. */
  onSaved: (created?: OfferRow) => void;
}) {
  const editing = offer !== null;
  const [form, setForm] = useState<OfferFormState>(() => (offer ? offerFormFrom(offer) : EMPTY_OFFER_FORM));
  const [busy, setBusy] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const state = offer ? stateOf(offer, now) : null;
  const qualifiers = useMemo(() => (offer ? whoQualifies(offer, offers, customers, new Date(now)) : []), [offer, offers, customers, now]);
  const doubled = qualifiers.filter((row) => row.alsoQualifiesFor.length > 0);
  const otherNames = [...new Set(doubled.flatMap((row) => row.alsoQualifiesFor))];

  async function save() {
    if (!form.name.trim()) {
      notify.block("Give the offer a name");
      return;
    }
    setBusy(true);
    const response = await fetch(offer ? `/api/admin/offers/${offer.id}` : "/api/admin/offers", {
      method: offer ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(offerPayload(form, editing)),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      notify.block(body?.error ?? "Could not save offer");
      return;
    }
    notify.done(offer ? "Offer updated" : "Offer created");
    onSaved(offer ? undefined : (body?.offer as OfferRow | undefined));
  }

  async function toggleActive() {
    if (!offer) return;
    setBusy(true);
    const response = await fetch(`/api/admin/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !offer.is_active }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      notify.block(body?.error ?? "Could not update offer");
      return;
    }
    notify.done(offer.is_active ? "Offer deactivated" : "Offer reactivated");
    onSaved();
  }

  async function apply() {
    if (!offer || !subscriptionId) {
      notify.block("Choose a customer");
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/admin/offers/${offer.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription_id: subscriptionId, confirmed }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(false);
    if (!response || !response.ok) {
      if (body?.code === "confirmation_required") {
        setWarning(body.warning);
        return;
      }
      notify.block(body?.error ?? "Could not apply offer");
      return;
    }
    notify.done("Offer applied");
    setSubscriptionId("");
    setWarning(null);
    setConfirmed(false);
    onSaved();
  }

  return (
    <Sheet
      title={offer ? offer.name : "New offer"}
      subtitle={offer ? <>{offer.coupon ? <code className="font-mono">{offer.coupon.code}</code> : "No coupon"} · {ruleOf(offer)} · {offer.auto_apply ? "applied automatically" : "manual only"}</> : "A campaign on top of the existing coupon arithmetic."}
      status={state ? (
        <>
          <StatusChip tone={overlapsWith.length > 0 ? "warning" : OFFER_STATE[state].tone} dot>
            {overlapsWith.length > 0 ? `Overlaps ${overlapsWith.map((o) => o.name).join(", ")}` : OFFER_STATE[state].label}
          </StatusChip>
          <span className="text-xs tabular-nums text-muted-foreground">
            {offer!.redeemed_count.toLocaleString("en-US")}{offer!.max_redemptions === null ? "" : ` of ${offer!.max_redemptions.toLocaleString("en-US")}`} redeemed · {formatCentsAsCurrency(offer!.discount_given_cents)} given
          </span>
        </>
      ) : undefined}
      className={WIDE}
      onClose={() => { if (!busy) onClose(); }}
      footer={<>
        {offer && (offer.is_active
          ? <Button type="button" variant="outline" className="text-[var(--error-ink)]" onClick={() => void toggleActive()} disabled={busy}>Deactivate</Button>
          : <Button type="button" variant="outline" onClick={() => void toggleActive()} disabled={busy}>Reactivate</Button>)}
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : offer ? "Save offer" : "Create offer"}</Button>
      </>}
    >
      {editing && (
        <p className="m-0 text-xs leading-[1.5] text-muted-foreground">Discount terms stay fixed after creation so existing applications remain truthful; the window, cap and rules can change.</p>
      )}
      <OfferFields form={form} onChange={setForm} editing={editing} plans={plans} />

      {offer && (
        <section className={SECTION} aria-labelledby="offer-qualify">
          <h3 id="offer-qualify" className={H}>Who qualifies now</h3>
          <p className="m-0 text-xs text-muted-foreground" role="status">
            {qualifiers.length === 0
              ? state === "active" ? "No current customer meets every rule." : `Nobody: the offer is ${OFFER_STATE[state!].label.toLowerCase()}.`
              : `${qualifiers.length.toLocaleString("en-US")} ${qualifiers.length === 1 ? "customer" : "customers"}${doubled.length > 0 ? ` · ${doubled.length.toLocaleString("en-US")} of them also qualify for ${otherNames.join(", ")}` : " · none qualifies for another offer"}`}
          </p>
          {qualifiers.length > 0 && (
            <ul className="m-0 list-none p-0" aria-label="Customers who qualify">
              {(showAll ? qualifiers : qualifiers.slice(0, QUALIFIERS_SHOWN)).map(({ customer, alsoQualifiesFor }) => (
                <li key={customer.subscriptionId} className="flex min-w-0 items-center gap-3 border-b border-border py-2 text-sm last:border-b-0">
                  <Link href={`/admin/tenants/${customer.tenantId}`} className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline">{customer.tenantName ?? "Unnamed customer"}</Link>
                  <span className="shrink-0 truncate text-muted-foreground">{customer.planName ?? "Plan"} · {customer.billingCycle}</span>
                  {alsoQualifiesFor.length > 0 && <StatusChip tone="warning" title={`Also qualifies for ${alsoQualifiesFor.join(", ")}`}>Also {alsoQualifiesFor.length}</StatusChip>}
                </li>
              ))}
            </ul>
          )}
          {qualifiers.length > QUALIFIERS_SHOWN && (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${qualifiers.length.toLocaleString("en-US")}`}
            </Button>
          )}
        </section>
      )}

      {offer && (
        <section className={SECTION} aria-labelledby="offer-apply">
          <h3 id="offer-apply" className={H}>Apply to a customer</h3>
          {/* User decision (25 Sep): applying to an existing subscription stays allowed, with the gap said plainly. Whop
              cannot attach a promo code to an existing membership through its API, so only our invoice changes — and
              the two then disagree, which the Invoices page reports as Mismatched. */}
          <p className="m-0 text-xs leading-[1.5] text-muted-foreground">
            Manual application bypasses the campaign rules, but asks before applying when the customer&apos;s plan type doesn&apos;t match. Our invoice gets the discount; Whop&apos;s charge does not change by itself — apply the same code{offer.coupon?.code ? <> (<code className="font-mono">{offer.coupon.code}</code>)</> : null} to their membership in Whop&apos;s dashboard, or the invoice shows as Mismatched.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="offer-customer">Customer subscription</Label>
              <select id="offer-customer" className={inputControl} value={subscriptionId} onChange={(event) => { setSubscriptionId(event.target.value); setWarning(null); setConfirmed(false); }}>
                <option value="">Pick a customer…</option>
                {customers.map((c) => <option key={c.subscriptionId} value={c.subscriptionId}>{c.tenantName ?? "Unnamed customer"} · {c.planName ?? "Plan"} · {c.billingCycle}</option>)}
              </select>
            </div>
            <Button type="button" variant="outline" onClick={() => void apply()} disabled={busy || !subscriptionId || Boolean(warning && !confirmed)}>
              {busy ? "Applying…" : "Apply offer"}
            </Button>
          </div>
          {warning && (
            <div className="flex flex-col gap-1.5" role="alert">
              <p className="m-0 text-sm text-[var(--warning-ink)]">{warning}</p>
              <label className="flex items-center gap-2 text-sm"><CheckBox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I understand and want to apply it anyway.</label>
            </div>
          )}
        </section>
      )}
    </Sheet>
  );
}
