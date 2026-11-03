import { redirect } from "next/navigation";

import { StatusMapsReview } from "@/components/admin/status-maps-review";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { listStatusQueue, STATUS_MAPS_PENDING_MESSAGE, StatusMapError } from "@/lib/ingestion/statusAdmin";

/** LA-4.5 (Notion sprint) · carrier status words waiting to be mapped, and the status map. Carrier-library access. */
export default async function StatusMapsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const loaded = await listStatusQueue().catch((error: unknown) => {
    if (error instanceof StatusMapError && error.status === 503) return null;
    throw error;
  });
  if (!loaded) return <StatusMapsReview initialQueue={[]} initialMappings={[]} notice={`${STATUS_MAPS_PENDING_MESSAGE} Apply it to map carrier statuses.`} />;
  return <StatusMapsReview initialQueue={loaded.queue} initialMappings={loaded.mappings} />;
}
