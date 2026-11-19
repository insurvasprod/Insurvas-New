import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { StateDisclosuresTable, type ProposalState } from "@/components/admin/state-disclosures-table";
import { PlatformPage } from "@/components/admin/platform/platform-page";
import { TitleActionButton } from "@/components/admin/platform/title-action";
import { PLATFORM_ACTION } from "@/lib/adminPlatform/titleActions";
import { fetchProducts } from "@/lib/products/queries";
import { quarterStart } from "@/lib/stateDisclosures/board";
import { countActiveTenants, listProposalsFor } from "@/lib/stateDisclosures/review";
import { earliestEffectiveDate } from "@/lib/stateDisclosures/schemas";
import { listStateDisclosures } from "@/lib/stateDisclosures/service";

export default async function StateDisclosuresPage({ searchParams }: { searchParams: Promise<{ show?: string | string[] }> }) {
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
  // The Platform workspace's rows open the table filtered (`?show=placeholders` / `?show=not_covered`).
  const show = (await searchParams).show;
  const initialView = show === "placeholders" || show === "not_covered" ? show : null;

  return (
    <PlatformPage
      step="disclosures"
      info="The state disclosure wording every agency's dialer reads before a call, by state and product. Platform-wide and effective-dated; a pair with no wording in force is a call the dialer refuses."
      actions={
        <>
          <TitleActionButton action={PLATFORM_ACTION.importPack} variant="outline">Import a pack</TitleActionButton>
          <TitleActionButton action={PLATFORM_ACTION.addDisclosure}>Add a disclosure</TitleActionButton>
        </>
      }
    >
      <StateDisclosuresTable
        initialView={initialView}
        disclosures={disclosures}
        catalog={products.map((product) => ({ code: product.code, name: product.name }))}
        proposals={proposals}
        activeTenants={activeTenants}
        currentAdminId={admin.id}
        earliest={earliestEffectiveDate(now)}
        quarterStart={quarterStart(now)}
      />
    </PlatformPage>
  );
}
