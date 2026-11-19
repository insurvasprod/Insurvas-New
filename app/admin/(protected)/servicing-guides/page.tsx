import { redirect } from "next/navigation";

import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { ServicingGuideEditor } from "@/components/admin/servicing-guide-editor";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { REQUEST_TYPES } from "@/lib/retention/servicing";
import { loadGuides, SERVICING_PENDING_MESSAGE } from "@/lib/retention/servicingStore";

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Catalog › Servicing instructions (LA-5.4; admin round 1, docs/design/admin-r1/catalog.html screen 13), inside the
 * Catalog frame: how each carrier takes a payment-date, payment, bill-to-draft or address change, in plain words,
 * for agents opening a request. A coverage grid of carriers × the four requests, with search and "missing only"; a
 * carrier opens the same four-request editor in a sheet.
 */
export default async function AdminServicingGuidesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const [view, query] = await Promise.all([loadGuides(), searchParams]);
  const all = view.carriers.filter((c) => REQUEST_TYPES.every((type) => c.guides[type])).length;
  const writtenAny = view.carriers.filter((c) => Object.keys(c.guides).length > 0).length;
  const none = view.carriers.length - writtenAny;

  return (
    <CatalogPage step="servicing" info="How each carrier takes a payment-date, payment, bill-to-draft or address change, in plain words, for agents opening a request. Nothing is pre-filled: a wrong instruction is worse than none.">
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {!view.available && <BillingStatusLine tone="warn" lead={{ text: "Needs a database update" }} parts={[SERVICING_PENDING_MESSAGE]} />}
        {view.available && (
          <StatStrip label="Servicing instruction totals">
            <StatTile label="Carriers" value={count(view.carriers.length)} reserveFootnote />
            <StatTile label="With instructions" value={count(writtenAny)} footnote={view.carriers.length ? `${Math.round((writtenAny / view.carriers.length) * 100)}% of carriers · ${count(all)} with all four` : "no carriers"} />
            <StatTile label="Missing" value={count(none)} footnote={none > 0 ? "agents see no help" : "every carrier covered"} href={none > 0 ? "/admin/servicing-guides?missing=1" : undefined} />
          </StatStrip>
        )}
        {view.available && <ServicingGuideEditor key={query.missing === "1" ? "missing" : "all"} rows={view.carriers} initialMissingOnly={query.missing === "1"} />}
      </div>
    </CatalogPage>
  );
}
