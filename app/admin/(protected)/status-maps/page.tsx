import { redirect } from "next/navigation";

import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { StatusMapsReview } from "@/components/admin/status-maps-review";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { listStatusQueue, STATUS_MAPS_PENDING_MESSAGE, StatusMapError } from "@/lib/ingestion/statusAdmin";

/**
 * LA-4.5 (Notion sprint) · carrier status words waiting to be mapped, and the status map, inside the Catalog frame
 * (admin round 1, catalog screen 11). Carrier-library access. The warning cards are the status line now; both tables
 * search and filter by carrier (`?carrier=<code>`, which the carrier record links to).
 */
export default async function StatusMapsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const loaded = await listStatusQueue().catch((error: unknown) => {
    if (error instanceof StatusMapError && error.status === 503) return null;
    throw error;
  });

  const queue = loaded?.queue ?? [];
  const mappings = loaded?.mappings ?? [];

  return (
    <CatalogPage step="status" info="Every carrier's status words, mapped to the nine statuses the book uses. A word nobody has mapped holds its rows back until it is mapped; an approved mapping never changes.">
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {!loaded && <BillingStatusLine tone="bad" lead={{ text: STATUS_MAPS_PENDING_MESSAGE }} parts={["apply it to map carrier statuses"]} />}
        <StatusMapsReview initialQueue={queue} initialMappings={mappings} pending={!loaded} />
      </div>
    </CatalogPage>
  );
}
