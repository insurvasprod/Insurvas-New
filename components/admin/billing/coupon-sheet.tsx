"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import type { CouponRow } from "@/lib/coupons/constants";
import {
  COUPON_STATUS_LABEL,
  describeDiscount,
  describeDuration,
  describeRedemptions,
  describeRestrictions,
  statusOf,
  utcDay,
  utcDayTime,
  type CouponPlanRef,
} from "@/lib/coupons/format";
import type { CouponStatus } from "@/lib/coupons/discount";
import type { CouponOfferRef, CouponRedemption } from "@/lib/coupons/queries";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";

type Part = "details" | "redemptions" | "offers";

export const COUPON_CHIP: Record<CouponStatus, StatusTone> = { active: "good", deactivated: "neutral", expired: "neutral", exhausted: "warning" };

const ROW = "flex min-w-0 items-center gap-3 border-b border-border py-2.5 text-sm last:border-b-0";

/**
 * One coupon as a right sheet (admin round 1, billing-r2 screen 8): Details (its terms, what it has given, and what
 * can change), Redemptions (who it was applied to, when, and the first invoice it took money off) and Offers (the
 * offers built on it). Duplicate opens the create sheet with the same terms; Deactivate asks first, through the same
 * route as before.
 *
 * Extend expiry is not offered: the Whop integration (lib/payments/whop/provider.ts) can create, read and deactivate
 * a promo code but has no update call, and changing our row alone would leave Whop's code working on its old date.
 */
export function CouponSheet({ coupon, now, planMap, givenCents, redemptions, offers, onClose, onDuplicate, onChanged }: {
  coupon: CouponRow;
  now: Date;
  planMap: Map<string, CouponPlanRef> | null;
  /** Undefined when the invoices could not be read. */
  givenCents: number | undefined;
  /** Null when the applications could not be read. */
  redemptions: CouponRedemption[] | null;
  /** Null when the offers could not be read. */
  offers: CouponOfferRef[] | null;
  onClose: () => void;
  onDuplicate: () => void;
  onChanged: () => void;
}) {
  const [part, setPart] = useState<Part>("details");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const state = statusOf(coupon, now);

  async function deactivate() {
    setBusy(true);
    setDialogError(null);
    const res = await fetch(`/api/admin/coupons/${coupon.id}/deactivate`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) {
      // Kept in the dialog: the answer says whether anything changed, and that must be read.
      setDialogError(body?.error ?? "Whop could not be reached, so nothing was changed. Try again.");
      return;
    }
    notify.done(body?.message ?? `${coupon.code} deactivated`);
    setConfirming(false);
    onChanged();
  }

  return (
    <>
      <Sheet
        title={coupon.code}
        subtitle={`${describeDiscount(coupon)} · ${describeDuration(coupon)}`}
        status={<StatusChip tone={COUPON_CHIP[state]} dot>{COUPON_STATUS_LABEL[state]}</StatusChip>}
        onClose={onClose}
        bodyClassName="flex flex-col gap-4 px-4 pb-4"
        footer={<>
          {coupon.is_active && (
            <Button type="button" variant="outline" className="text-[var(--error-ink)]" onClick={() => { setDialogError(null); setConfirming(true); }}>
              Deactivate…
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </>}
      >
        <UnderlineTabs
          label={`${coupon.code} sections`}
          className="sticky top-0 z-10 bg-card"
          value={part}
          onChange={setPart}
          tabs={[
            { key: "details", label: "Details" },
            { key: "redemptions", label: "Redemptions", count: redemptions?.length ?? null },
            { key: "offers", label: "Offers", count: offers?.length ?? null },
          ]}
        />

        {part === "details" && (
          <>
            <FactTable
              rows={[
                ["Discount", describeDiscount(coupon)],
                ["Lasts", describeDuration(coupon)],
                ["Given so far", givenCents === undefined ? "Could not be read" : formatCentsAsCurrency(givenCents)],
                ["Redemptions", describeRedemptions(coupon.redeemed_count, coupon.max_redemptions)],
                ["Restrictions", describeRestrictions(coupon, planMap)],
                ["Expires", coupon.expires_at ? utcDayTime(coupon.expires_at) : "Never"],
                ["Created", utcDay(coupon.created_at)],
                ["Whop promo code", coupon.whop_promo_code_id ? <code className="font-mono text-xs">{coupon.whop_promo_code_id}</code> : "None on record"],
              ]}
            />
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-semibold text-foreground">Change</h3>
              <p className="m-0 text-xs leading-[1.5] text-muted-foreground">
                Whop fixes a code&apos;s amount and expiry once it is created, and this integration cannot change either. Different terms or a later date mean a new code: duplicate this one and deactivate it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onDuplicate}>Duplicate as new code</Button>
              </div>
            </section>
          </>
        )}

        {part === "redemptions" && (
          redemptions === null ? (
            <EmptyState title="The redemptions could not be read" hint="Reload the page; if it keeps failing, the error is in the server log." />
          ) : redemptions.length === 0 ? (
            <EmptyState title="Not applied here yet" hint="Codes redeemed at Whop's checkout are not recorded here; this lists coupons applied by staff or by an offer." />
          ) : (
            <ul className="m-0 list-none p-0" aria-label={`Who used ${coupon.code}`}>
              {redemptions.map((r) => (
                <li key={r.id} className={ROW}>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {r.tenantId ? <Link href={`/admin/tenants/${r.tenantId}`} className="hover:underline">{r.tenantName ?? "Unnamed customer"}</Link> : r.tenantName ?? "Unnamed customer"}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground" title={utcDayTime(r.appliedAt)}>{utcDay(r.appliedAt)}</span>
                  <span className="w-24 shrink-0 truncate text-right tabular-nums">
                    {r.invoice ? <Link href={`/admin/invoices/${r.invoice.id}`} className="hover:underline" title={`${formatCentsAsCurrency(r.givenCents)} off so far`}>{r.invoice.number}</Link> : <span className="text-muted-foreground" title="No invoice has carried it yet">No invoice</span>}
                  </span>
                  <StatusChip tone={r.isActive ? "good" : "neutral"}>{r.isActive ? "On" : r.removedAt ? "Removed" : "Used up"}</StatusChip>
                </li>
              ))}
            </ul>
          )
        )}

        {part === "offers" && (
          offers === null ? (
            <EmptyState title="The offers could not be read" hint="Reload the page; if it keeps failing, the error is in the server log." />
          ) : offers.length === 0 ? (
            <EmptyState title="No offer uses this code" hint="An offer applies a coupon to whoever qualifies. Build one on Offers & discounts." />
          ) : (
            <ul className="m-0 list-none p-0" aria-label={`Offers built on ${coupon.code}`}>
              {offers.map((offer) => (
                <li key={offer.id} className={ROW}>
                  <Link href={`/admin/offers?offer=${offer.id}`} className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline">{offer.name}</Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{offer.startsAt ? utcDay(offer.startsAt) : "Now"} – {offer.endsAt ? utcDay(offer.endsAt) : "no end"}</span>
                  <StatusChip tone={offer.isActive ? "good" : "neutral"}>{offer.isActive ? "On" : "Off"}</StatusChip>
                </li>
              ))}
            </ul>
          )
        )}
      </Sheet>

      <Dialog open={confirming} onOpenChange={(value) => { if (!value && !busy) setConfirming(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {coupon.code}</DialogTitle>
            <DialogDescription>
              {coupon.whop_promo_code_id
                ? "Whop is asked to switch the promo code off first, so it can no longer be entered at checkout. Only when Whop confirms is it marked deactivated here; if Whop refuses or does not answer, nothing changes."
                : "This coupon has no Whop promo code on record, so only this record changes."}{" "}
              Subscriptions already carrying it keep their discount until it runs out. The coupon stays on this list.
            </DialogDescription>
          </DialogHeader>
          {dialogError && <p role="alert" className="m-0 text-sm leading-[1.5] text-[var(--error-ink)]">{dialogError}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void deactivate()} disabled={busy}>
              {busy ? "Deactivating…" : "Deactivate coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
