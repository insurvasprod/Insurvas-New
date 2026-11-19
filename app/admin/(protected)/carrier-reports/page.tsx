import { redirect } from "next/navigation";

import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { CarrierFactReports } from "@/components/admin/carrier-fact-reports";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { ViewTabs } from "@/components/ui/view-tabs";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { listPlatformCarriers } from "@/lib/carriers/adminService";
import { FACT_REPORTS_PENDING_MESSAGE } from "@/lib/carriers/factReportConstants";
import { listFactReportQueue } from "@/lib/carriers/factReports";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

const count = (n: number) => n.toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });

/**
 * Catalog › Fact reports (20261027200000; admin round 1, docs/design/admin-r1/catalog.html screen 14), inside the
 * Catalog frame: wrong carrier facts reported by agencies. Carrier-library access. Waiting and Closed are lenses on
 * the title line; a report opens as a sheet that also links to the carrier's record.
 */
export default async function CarrierReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const [loaded, carriers, query] = await Promise.all([listFactReportQueue(), listPlatformCarriers().catch(() => []), searchParams]);
  const lens = query.lens === "closed" ? "closed" : "waiting";
  const now = new Date();

  const waiting = loaded.reports.filter((r) => r.status === "open");
  const closed = loaded.reports.filter((r) => r.status !== "open");
  const agencies = new Set(waiting.map((r) => r.tenantId)).size;
  const carrierCount = new Set(waiting.map((r) => r.carrierId)).size;
  const oldest = waiting[0]?.createdAt ?? null;
  const oldestDays = oldest ? Math.max(0, Math.floor((now.getTime() - new Date(oldest).getTime()) / 86_400_000)) : null;
  const age = (days: number) => (days === 0 ? "today" : days === 1 ? "1 day" : `${count(days)} days`);

  const tabs = (
    <ViewTabs
      label="Fact report lenses"
      value={lens}
      tabs={[
        { key: "waiting", label: "Waiting", count: waiting.length, href: "/admin/carrier-reports" },
        { key: "closed", label: "Closed", count: closed.length, href: "/admin/carrier-reports?lens=closed" },
      ]}
    />
  );

  return (
    <CatalogPage step="reports" info="Carrier facts agencies say are wrong. Fixing one changes it for every agency." tabs={tabs}>
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {!loaded.available && <BillingStatusLine tone="warn" lead={{ text: "Needs a database update" }} parts={[`${FACT_REPORTS_PENDING_MESSAGE} Agencies' Tell us opens an email until then.`]} />}

        <StatStrip label="Fact report totals">
          <StatTile label="Waiting" value={count(waiting.length)} footnote={waiting.length ? `${count(carrierCount)} ${carrierCount === 1 ? "carrier" : "carriers"}` : "none waiting"} href="/admin/carrier-reports" />
          <StatTile label="Agencies waiting" value={count(agencies)} footnote={waiting.length ? "reported at least one" : "none"} />
          <StatTile label="Oldest waiting" value={oldestDays === null ? "—" : age(oldestDays)} footnote={oldest ? `reported on ${day(oldest)}` : "nothing open"} />
          <StatTile label="Closed" value={count(closed.length)} footnote="the latest 100" href="/admin/carrier-reports?lens=closed" />
        </StatStrip>

        <CarrierFactReports reports={loaded.reports} carrierCodes={Object.fromEntries(carriers.map((c) => [c.id, c.code]))} nowIso={now.toISOString()} />
      </div>
    </CatalogPage>
  );
}
