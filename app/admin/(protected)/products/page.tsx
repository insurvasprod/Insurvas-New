import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProductsTable } from "@/components/admin/products-table";
import { fetchProducts } from "@/lib/products/queries";

export default async function ProductsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "products")) redirect("/admin");

  const products = await fetchProducts();

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Products" subtitle="The product catalog shared by the platform." />
      <ProductsTable initialProducts={products} />
    </div>
  );
}
