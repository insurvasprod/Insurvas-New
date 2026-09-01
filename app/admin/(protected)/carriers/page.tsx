import { redirect } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { CarriersTable } from "@/components/admin/carriers-table";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { CarrierRow } from "@/lib/carriers/constants";

export default async function CarriersPage() {
  const admin = await getCurrentAdmin(); if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const { data, error } = await getSupabaseServiceClient().from("carriers").select("id, code, name, is_active, sort_order, created_at, updated_at").order("sort_order").order("name");
  if (error) throw new Error("Could not load carriers");
  return <div className="space-y-6"><AdminPageHeader title="Carriers" subtitle="The platform carrier library agents use to configure their contracts." /><CarriersTable initialCarriers={(data ?? []) as CarrierRow[]} /></div>;
}
