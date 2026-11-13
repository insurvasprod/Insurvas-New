import { redirect } from "next/navigation";

import { NewLayout } from "@/components/admin/layout-maps/new-layout";
import { RouteSheet } from "@/components/app/route-sheet";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

/** A new layout map, opened from inside the console: a panel from the right (route-sheet.tsx); the same gate as its page. */
export default async function NewLayoutSheet() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  return (
    <RouteSheet title="New layout" subtitle="Read a carrier's file, check its columns, name it." wide>
      <NewLayout />
    </RouteSheet>
  );
}
