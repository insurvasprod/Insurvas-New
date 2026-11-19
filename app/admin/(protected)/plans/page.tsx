import { redirect } from "next/navigation";

import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { PlanCompareBody } from "@/components/admin/catalog/plan-compare";
import { PlanHeaderActions } from "@/components/admin/catalog/plan-header-actions";
import { PlanSheetBody } from "@/components/admin/catalog/plan-sheet";
import { PlansTable } from "@/components/admin/plans-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { fetchSubscribersByVersion } from "@/lib/plans/listReads";
import { canManagePlans } from "@/lib/plans/permissions";
import { fetchPlans } from "@/lib/plans/queries";
import { fetchPlanCompare, fetchPlanSheet } from "@/lib/plans/sheet";
import { fetchPricesForPlans } from "@/lib/plans/versionEditor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (value: number) => value.toLocaleString("en-US");

/**
 * Admin › Catalog › Plans (admin round 1, docs/design/admin-r1/catalog.html screen 2). The same tiles, columns,
 * filters and row actions, inside the Catalog frame. A plan opens a sheet (`?plan=`) with its details, every version
 * with what changed and who is on it, its subscribers and its history; Compare plans (`?compare=1`) sets the latest
 * versions side by side. Both are server reads, so they arrive with the sheet. Super admin only, as before.
 */
export default async function PlansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManagePlans(admin.role)) redirect("/admin");

  const params = await searchParams;
  const planParam = typeof params.plan === "string" && UUID.test(params.plan) ? params.plan : null;
  const compare = params.compare === "1";
  const viewer = { id: admin.id, role: admin.role };

  const plans = await fetchPlans();
  const latestIds = plans.map((p) => p.id);
  const [priceMap, latestSubscribers, sheet, compared] = await Promise.all([
    fetchPricesForPlans(latestIds),
    fetchSubscribersByVersion(latestIds),
    planParam
      ? fetchPlanSheet(planParam, viewer).then(
          (data) => ({ data, failed: false }),
          (error: unknown) => {
            console.error("[admin/plans] sheet read failed:", error instanceof Error ? error.message : error);
            return { data: null, failed: true };
          },
        )
      : Promise.resolve(null),
    compare
      ? fetchPlanCompare(plans).catch((error: unknown) => {
          console.error("[admin/plans] compare read failed:", error instanceof Error ? error.message : error);
          return null;
        })
      : Promise.resolve(undefined),
  ]);

  const archived = plans.filter((p) => p.is_archived).length;
  const live = plans.length - archived;
  const publicCount = plans.filter((p) => p.is_public && !p.is_archived).length;
  const subscribers = plans.reduce((sum, p) => sum + p.subscriber_count, 0);
  const onOld = plans.reduce((sum, p) => sum + Math.max(0, p.subscriber_count - (latestSubscribers[p.id] ?? 0)), 0);

  const sheetBody = !planParam || !sheet
    ? null
    : sheet.failed || !sheet.data
      ? <p className="m-0 p-4 text-sm text-muted-foreground">{sheet.failed ? "This plan could not be read just now. Close the sheet and open it again." : "This plan no longer exists."}</p>
      : <PlanSheetBody data={sheet.data} />;
  const compareBody = compared === undefined ? null : compared === null
    ? <p className="m-0 p-4 text-sm text-muted-foreground">The plans could not be read just now. Close and open Compare plans again.</p>
    : <PlanCompareBody data={compared} />;

  return (
    <CatalogPage
      step="plans"
      info="What customers buy. Existing subscribers keep the version they bought; saving features or prices on a version people are on publishes the next one."
      actions={<PlanHeaderActions />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Plans at a glance">
          <StatTile label="Plans" value={n(live)} footnote={archived > 0 ? `${n(archived)} archived` : "none archived"} />
          <StatTile label="Public" value={n(publicCount)} footnote="on the pricing page" />
          <StatTile label="Subscribers" value={n(subscribers)} footnote="across all versions" />
          <StatTile label="On an old version" value={subscribers > 0 ? `${((onOld / subscribers) * 100).toFixed(1)}%` : "0%"} footnote={subscribers > 0 ? `${n(onOld)} ${onOld === 1 ? "subscriber" : "subscribers"}` : "nobody subscribed yet"} />
        </StatStrip>

        <PlansTable
          plans={plans}
          prices={Object.fromEntries(priceMap)}
          latestSubscribers={latestSubscribers}
          sheet={sheetBody}
          sheetFor={planParam}
          compare={compareBody}
        />
      </div>
    </CatalogPage>
  );
}
