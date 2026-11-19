import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageCoupons } from "@/lib/coupons/permissions";
import { fetchCouponList, fetchCouponPlans, fetchCouponUsage, fetchOffersByCoupon } from "@/lib/coupons/queries";
import { EXPIRING_SOON_DAYS, expiresSoon, statusOf, utcDay } from "@/lib/coupons/format";
import { BillingPage } from "@/components/admin/billing/billing-page";
import { CouponNewButton } from "@/components/admin/billing/coupon-new-button";
import { CouponsTable } from "@/components/admin/coupons-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * Coupons (admin round 1, docs/design/admin-r1/billing-r2.html screen 8), inside the Billing frame. Super admins and
 * billing admins only — offering a discount is a billing action (lib/coupons/permissions.ts), the same list the
 * create and deactivate routes check.
 */
export default async function CouponsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageCoupons(admin.role)) redirect("/admin");

  const [{ coupons, failed }, plans, offersByCoupon] = await Promise.all([fetchCouponList(), fetchCouponPlans(), fetchOffersByCoupon()]);
  const usage = failed ? null : await fetchCouponUsage(coupons);

  const now = new Date();
  const active = coupons.filter((c) => statusOf(c, now) === "active").length;
  const redemptions = coupons.reduce((sum, c) => sum + (c.redeemed_count ?? 0), 0);
  const givenCents = usage ? [...usage.given.values()].reduce((sum, cents) => sum + cents, 0) : null;
  const soon = coupons.filter((c) => expiresSoon(c, now)).sort((a, b) => (a.expires_at as string).localeCompare(b.expires_at as string));

  return (
    <BillingPage
      step="coupons"
      info="Whop promo codes that lower what the customer is charged. A code's terms are fixed at Whop once it exists."
      actions={<CouponNewButton />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Coupons at a glance">
          <StatTile
            label="Active"
            value={failed ? "—" : active.toLocaleString("en-US")}
            footnote={failed ? "Could not be read" : `of ${coupons.length.toLocaleString("en-US")} ${coupons.length === 1 ? "coupon" : "coupons"}`}
            labelTitle="Usable today: not deactivated, not expired and not at its redemption limit"
            href="/admin/coupons?status=active"
          />
          <StatTile
            label="Redemptions"
            value={failed ? "—" : redemptions.toLocaleString("en-US")}
            footnote={failed ? "Could not be read" : "All time · applied by staff or offers"}
            labelTitle="Times a coupon was applied to a subscription here. Codes redeemed at Whop's checkout are not counted."
          />
          <StatTile
            label="Discount given"
            value={givenCents === null ? "—" : formatCentsAsCurrency(givenCents)}
            footnote={givenCents === null ? "Could not be read" : "From our invoice lines"}
            labelTitle="Coupon lines on our invoices, all time. Codes redeemed at Whop's checkout are not in this figure."
          />
          <StatTile
            label={`Expiring in ${EXPIRING_SOON_DAYS} days`}
            value={failed ? "—" : soon.length.toLocaleString("en-US")}
            footnote={failed ? "Could not be read" : soon.length > 0 ? `Next on ${utcDay(soon[0].expires_at as string)} UTC` : "—"}
            href="/admin/coupons?expiry=soon"
          />
        </StatStrip>

        <CouponsTable
          coupons={coupons}
          plans={plans}
          discountGiven={usage ? Object.fromEntries(usage.given) : null}
          redemptions={usage ? Object.fromEntries(usage.redemptions) : null}
          offersByCoupon={offersByCoupon ? Object.fromEntries(offersByCoupon) : null}
          nowIso={now.toISOString()}
          listError={failed}
        />
      </div>
    </BillingPage>
  );
}
