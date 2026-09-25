import { redirect } from "next/navigation";

import { CarriersTable } from "@/components/admin/carriers-table";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { listPlatformCarriers, readCarrierUsage } from "@/lib/carriers/adminService";
import type { CarrierUsageSnapshot } from "@/lib/carriers/usage";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

export default async function CarriersPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");

  // The platform library only (organization_id is null) — the rows tenants actually pick from.
  const carriers = await listPlatformCarriers();
  // Usage is garnish for the table but the guard's evidence for the figures: a failed read shows
  // "unknown", never a 0 that would read as "safe to deactivate".
  let usage: CarrierUsageSnapshot = { available: false };
  try {
    usage = await readCarrierUsage();
  } catch (error) {
    console.error("carrier usage read failed", error);
  }

  return <CarriersTable initialCarriers={carriers} initialUsage={usage} canOverride={admin.role === "super_admin"} />;
}
