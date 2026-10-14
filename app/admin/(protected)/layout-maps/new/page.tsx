import { redirect } from "next/navigation";

import { NewLayout } from "@/components/admin/layout-maps/new-layout";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

/** A new layout map: from a carrier's sample file, or empty (redesign 2026-10-14). */
export default async function NewLayoutPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  return <NewLayout />;
}
