import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageCoupons } from "@/lib/coupons/permissions";
import { fetchCoupons } from "@/lib/coupons/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { CouponsTable } from "@/components/admin/coupons-table";

export default async function CouponsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageCoupons(admin.role)) redirect("/admin");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Coupons"
        subtitle="Price breaks that apply at the payment provider, so the customer is actually charged less"
      />
      <CouponsTable initialCoupons={await fetchCoupons()} />
    </div>
  );
}
