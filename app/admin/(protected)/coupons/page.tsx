import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageCoupons } from "@/lib/coupons/permissions";
import { fetchCouponList, fetchCouponPlans, fetchDiscountGivenByCoupon } from "@/lib/coupons/queries";
import { EXPIRING_SOON_DAYS, expiresSoon, statusOf, utcDay } from "@/lib/coupons/format";
import { BillingTabs } from "@/components/admin/billing-tabs";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { CouponCreateDialog } from "@/components/admin/coupon-create-dialog";
import { CouponsTable } from "@/components/admin/coupons-table";
import { PageHeader } from "@/components/ui/page-header";

const USD_WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * Coupons (board p-adm-coupons). Super admins and billing admins only — offering a discount is a
 * billing action (lib/coupons/permissions.ts), the same list the create and deactivate routes check.
 */
export default async function CouponsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageCoupons(admin.role)) redirect("/admin");

  const [{ coupons, failed }, plans] = await Promise.all([fetchCouponList(), fetchCouponPlans()]);
  const discountGiven = failed ? null : await fetchDiscountGivenByCoupon(coupons);

  const now = new Date();
  const active = coupons.filter((c) => statusOf(c, now) === "active").length;
  const redemptions = coupons.reduce((sum, c) => sum + (c.redeemed_count ?? 0), 0);
  const givenCents = discountGiven ? [...discountGiven.values()].reduce((sum, cents) => sum + cents, 0) : null;
  const soon = coupons
    .filter((c) => expiresSoon(c, now))
    .map((c) => c.expires_at as string)
    .sort();

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Coupons"
        description="Whop promo codes that lower what the customer is charged."
        actions={<CouponCreateDialog plans={plans ? plans.filter((p) => !p.is_archived) : null} />}
      />
      <BillingTabs />

      <BoardStatGrid>
        <BoardStatTile
          label="Active"
          value={failed ? "—" : active}
          tone={!failed && active > 0 ? "success" : "default"}
          footnote={failed ? "Could not be read" : `of ${coupons.length.toLocaleString("en-US")} ${coupons.length === 1 ? "coupon" : "coupons"}`}
          title="Usable today: not deactivated, not expired and not at its redemption limit"
        />
        <BoardStatTile
          label="Redemptions"
          value={failed ? "—" : redemptions.toLocaleString("en-US")}
          footnote={failed ? "Could not be read" : "All time · applied by staff or offers"}
          title="Times a coupon was applied to a subscription here. Codes redeemed at Whop's checkout are not counted."
        />
        <BoardStatTile
          label="Discount given"
          value={givenCents === null ? "—" : USD_WHOLE.format(givenCents / 100)}
          footnote={givenCents === null ? "Could not be read" : "All time · applied by staff or offers"}
          title={
            givenCents === null
              ? "The invoices could not be read"
              : `${USD.format(givenCents / 100)} in coupon lines on our invoices. Codes redeemed at Whop's checkout are not in this figure.`
          }
        />
        <BoardStatTile
          label={`Expiring in ${EXPIRING_SOON_DAYS} days`}
          value={failed ? "—" : soon.length}
          footnote={failed ? "Could not be read" : soon.length > 0 ? `Next on ${utcDay(soon[0])} UTC` : "—"}
        />
      </BoardStatGrid>

      <CouponsTable
        coupons={coupons}
        plans={plans}
        discountGiven={discountGiven ? Object.fromEntries(discountGiven) : null}
        nowIso={now.toISOString()}
        listError={failed}
      />
    </div>
  );
}
