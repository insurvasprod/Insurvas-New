import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { StateDisclosuresTable, type ProposalState } from "@/components/admin/state-disclosures-table";
import { fetchProducts } from "@/lib/products/queries";
import { quarterStart } from "@/lib/stateDisclosures/board";
import { countActiveTenants, listProposalsFor } from "@/lib/stateDisclosures/review";
import { earliestEffectiveDate } from "@/lib/stateDisclosures/schemas";
import { listStateDisclosures } from "@/lib/stateDisclosures/service";

export default async function StateDisclosuresPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "state-disclosures")) redirect("/admin");

  const [disclosures, products, proposals, activeTenants] = await Promise.all([
    listStateDisclosures(),
    // Coverage is measured against the platform catalog. If it cannot be read, the board still
    // shows every product that has disclosure rows, rather than failing the page.
    fetchProducts({ includeArchived: false }).catch(() => []),
    listProposalsFor(admin.id).then(
      (list): ProposalState => ({ ...list, error: null }),
      (error: unknown): ProposalState => ({
        available: true,
        pending: [],
        recent: [],
        selfApprovalAllowed: false,
        error: error instanceof Error ? error.message : "Could not load proposals",
      }),
    ),
    countActiveTenants(),
  ]);

  // Dates are computed here, once, so the server render and the browser agree on "tomorrow".
  const now = new Date();

  return (
    <StateDisclosuresTable
      disclosures={disclosures}
      catalog={products.map((product) => ({ code: product.code, name: product.name }))}
      proposals={proposals}
      activeTenants={activeTenants}
      currentAdminId={admin.id}
      earliest={earliestEffectiveDate(now)}
      quarterStart={quarterStart(now)}
    />
  );
}
