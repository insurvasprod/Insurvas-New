import { redirect } from "next/navigation";

import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { CarrierGuidanceEditor } from "@/components/admin/carrier-guidance-editor";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { BOOK_IMPORT_PENDING_MESSAGE, loadGuidance } from "@/lib/ingestion/bookImport";

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Catalog › Portal guidance (LA-4.10; admin round 1, docs/design/admin-r1/catalog.html screen 13), inside the
 * Catalog frame: where each carrier keeps its policy file, in plain words, for agencies importing their book. The
 * same figures, inline table, per-row Save, search and "only missing" as before.
 */
export default async function AdminCarrierGuidancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const [view, query] = await Promise.all([loadGuidance(), searchParams]);
  const missing = view.carriers.filter((c: { guidance: unknown }) => !c.guidance).length;
  const withGuidance = view.carriers.length - missing;

  return (
    <CatalogPage step="guidance" info="Where each carrier keeps its policy file, in plain words, for agencies importing their book. Agencies see it on the import screen the moment it is saved.">
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {!view.available && <BillingStatusLine tone="warn" lead={{ text: "Needs a database update" }} parts={[BOOK_IMPORT_PENDING_MESSAGE]} />}
        {view.available && (
          <StatStrip label="Guidance totals">
            <StatTile label="Carriers" value={count(view.carriers.length)} reserveFootnote />
            <StatTile label="With guidance" value={count(withGuidance)} footnote={view.carriers.length > 0 ? `${Math.round((withGuidance / view.carriers.length) * 100)}% of carriers` : "no carriers"} />
            <StatTile label="Missing" value={count(missing)} footnote={missing > 0 ? "agencies see no help" : "every carrier covered"} href={missing > 0 ? "/admin/carrier-guidance?missing=1" : undefined} />
          </StatStrip>
        )}
        {view.available && <CarrierGuidanceEditor key={query.missing === "1" ? "missing" : "all"} rows={view.carriers} initialMissingOnly={query.missing === "1"} />}
      </div>
    </CatalogPage>
  );
}
