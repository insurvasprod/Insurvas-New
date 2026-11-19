import { redirect } from "next/navigation";

import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { NewLayout } from "@/components/admin/layout-maps/new-layout";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

/**
 * A new layout map: from a carrier's sample file, or empty (redesign 2026-10-14). Opened from inside the console it is
 * a right sheet (@sheet/(.)layout-maps/new); loaded on its own it is this page, inside the Catalog frame.
 */
export default async function NewLayoutPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  return (
    <CatalogPage
      step="layouts"
      title="New layout"
      info="Read a carrier's file, check its columns, name it. It starts as a draft and reads nothing until it is published and a carrier is added."
      breadcrumbs={[{ label: "Catalog", href: "/admin/catalog" }, { label: "Layout maps", href: "/admin/layout-maps" }, { label: "New layout" }]}
    >
      <NewLayout />
    </CatalogPage>
  );
}
