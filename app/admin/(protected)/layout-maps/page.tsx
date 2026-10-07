import { redirect } from "next/navigation";

import { LayoutMapsReview } from "@/components/admin/layout-maps-review";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { LAYOUT_MAPS_PENDING_MESSAGE, LayoutMapError, listLayoutMaps } from "@/lib/ingestion/layoutAdmin";

/**
 * LA-4.3 (Notion sprint) · the platform's carrier layout maps, for staff. They belong to the carrier
 * library, so they follow its access rule, as LA-3.13's field maps do.
 */
export default async function LayoutMapsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");

  const loaded = await listLayoutMaps().catch((error: unknown) => {
    if (error instanceof LayoutMapError && error.status === 503) return null;
    throw error;
  });
  if (!loaded) return <LayoutMapsReview initialMaps={[]} initialAssignments={[]} carriers={[]} notice={`${LAYOUT_MAPS_PENDING_MESSAGE} Apply it to write layout maps.`} />;
  return <LayoutMapsReview initialMaps={loaded.maps} initialAssignments={loaded.assignments} carriers={loaded.carriers} />;
}
