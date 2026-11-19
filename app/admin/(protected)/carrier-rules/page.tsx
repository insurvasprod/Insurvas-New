import { redirect } from "next/navigation";

import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { CarrierRulesWorkspace } from "@/components/app/carrier-rules-workspace";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { CARRIER_RULES_PENDING_MESSAGE, loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Catalog › Carrier rules (LA-4.17; admin round 1, docs/design/admin-r1/catalog.html screen 9), inside the Catalog
 * frame: the platform's default save windows and carrier settings. Same figures, columns and editor; the editor opens
 * as a right sheet and its "Finding its files" block links to the carrier's record.
 */
export default async function AdminCarrierRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const [view, query] = await Promise.all([loadCarrierRules({ plane: "platform", adminId: admin.id }), searchParams]);
  const withGap = view.carriers.filter((carrier) => carrier.gaps.length > 0).length;
  const gaps = view.carriers.reduce((sum, carrier) => sum + carrier.gaps.length, 0);
  const rules = view.carriers.flatMap((carrier) => Object.values(carrier.rules).filter((rule) => rule !== null));
  const unverified = rules.filter((rule) => !rule.verified).length;

  return (
    <CatalogPage step="rules" info="The platform's default save windows and carrier settings. An agency's own rule overrides these; nothing falls back to a guess.">
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {!view.available && <BillingStatusLine tone="warn" lead={{ text: "Needs a database update" }} parts={[CARRIER_RULES_PENDING_MESSAGE]} />}
        {view.available && (
          <StatStrip label="Carrier rule totals">
            <StatTile label="Carriers" value={count(view.carriers.length)} footnote="active in the library" />
            <StatTile label="Missing a rule" labelTitle="Active carriers with at least one kind of save that has no window set" value={count(withGap)} footnote={gaps > 0 ? `${count(gaps)} windows not set` : "every window set"} href={withGap > 0 ? "/admin/carrier-rules?missing=1" : undefined} />
            <StatTile label="Rules set" value={count(rules.length)} reserveFootnote />
            <StatTile label="Unverified" value={count(unverified)} footnote={rules.length > 0 ? `of ${count(rules.length)} rules` : "no rules yet"} />
          </StatStrip>
        )}
        {view.available && (
          <CarrierRulesWorkspace
            key={query.missing === "1" ? "missing" : "all"}
            carriers={view.carriers}
            plane="platform"
            endpoint="/api/admin/carrier-rules"
            readOnly={false}
            asOf={view.asOf}
            editor="sheet"
            recordHrefBase="/admin/carriers/"
            initialGapsOnly={query.missing === "1"}
          />
        )}
      </div>
    </CatalogPage>
  );
}
