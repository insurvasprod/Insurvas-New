import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { AdminPageHeader } from "@/components/admin/page-header";
import { TemplatesTable } from "@/components/admin/templates-table";
import { fetchTemplates } from "@/lib/templates/queries";
import { fetchProducts } from "@/lib/products/queries";

export default async function TemplatesPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // The per-section role map from SA-4.3 is still the authority on who may open this screen; only
  // the hub that used to wrap it is gone.
  if (!canAccessConfigurationSection(admin.role, "templates")) redirect("/admin");

  const [templates, products] = await Promise.all([fetchTemplates(), fetchProducts()]);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Templates" subtitle="Lead fields, pipelines, application forms, and reusable question sets." />
      <TemplatesTable initialTemplates={templates} products={products} />
    </div>
  );
}
