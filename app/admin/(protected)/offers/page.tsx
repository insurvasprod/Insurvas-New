import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { OfferNewButton } from "@/components/admin/billing/offer-new-button";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { OffersTable } from "@/components/admin/offers-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { fetchOffers } from "@/lib/offers/queries";
import { overlappingOffers, stateOf, type OfferState } from "@/lib/offers/present";
import { customerContexts } from "@/lib/offers/qualify";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchSubscriptions } from "@/lib/subscriptions/queries";

/**
 * Offers & discounts (admin round 1, docs/design/admin-r1/billing-r2.html screen 9), inside the Billing frame. The
 * per-section role map from SA-4.3 is still the authority on who may open this screen.
 */
export default async function OffersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "offers")) redirect("/admin");

  const [offers, plans, subscriptions] = await Promise.all([fetchOffers(), fetchPlans(), fetchSubscriptions()]);
  const now = new Date().getTime();

  const planType = new Map(plans.map((p) => [p.id, p.plan_type]));
  // Every subscription, cancelled ones included, decides who is a new customer; only live ones can qualify or be applied to.
  const customers = customerContexts(subscriptions, (id) => planType.get(id));

  const byState = (state: OfferState) => offers.filter((offer) => stateOf(offer, now) === state);
  const redemptions = (rows: typeof offers) => rows.reduce((sum, row) => sum + row.redeemed_count, 0);
  const active = byState("active");
  const scheduled = byState("scheduled");
  const ended = byState("ended");
  const overlapping = overlappingOffers(offers, now);
  const nextStart = scheduled.map((row) => row.starts_at).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
  const n = (value: number) => value.toLocaleString("en-US");

  return (
    <BillingPage
      step="offers"
      info="Promotions and automatic discount rules on top of coupons: who qualifies, when, and for how long."
      actions={<OfferNewButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Offers at a glance">
          <StatTile label="Active" value={n(active.length)} footnote={`${n(redemptions(active))} redemptions`} href="/admin/offers?status=active" />
          <StatTile label="Scheduled" value={n(scheduled.length)} footnote={nextStart ? `next starts ${fullDate(nextStart)}` : "nothing scheduled"} href="/admin/offers?status=scheduled" />
          <StatTile label="Ended" value={n(ended.length)} footnote={`${n(redemptions(ended))} redemptions`} href="/admin/offers?status=ended" />
          <StatTile
            label="Overlapping offers"
            value={n(overlapping.length)}
            valueTone={overlapping.length > 0 ? "warning" : undefined}
            footnote={overlapping.length > 0 ? "named in the status line" : "no two could apply at once"}
            labelTitle="Active or scheduled offers whose windows, plans, cycles and customer rules overlap, so both could apply to the same subscription."
          />
        </StatStrip>

        <OffersTable offers={offers} plans={plans} customers={customers} now={now} />
      </div>
    </BillingPage>
  );
}
