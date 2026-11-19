import Link from "next/link";
import { redirect } from "next/navigation";

import { BillingStatusLine } from "@/components/admin/billing/rev-status-line";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { LayoutList } from "@/components/admin/layout-maps/layout-list";
import { groupLayouts } from "@/components/admin/layout-maps/shared";
import { Button } from "@/components/ui/button";
import { ViewTabs } from "@/components/ui/view-tabs";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { LAYOUT_MAPS_PENDING_MESSAGE, LayoutMapError, listLayoutMaps } from "@/lib/ingestion/layoutAdmin";

type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The list's own URL with a view, keeping the carrier it is narrowed to. */
function viewHref(view: "layouts" | "carriers", carrier: string) {
  const params = new URLSearchParams();
  if (view === "carriers") params.set("view", "carriers");
  if (carrier) params.set("carrier", carrier);
  const search = params.toString();
  return `/admin/layout-maps${search ? `?${search}` : ""}`;
}

/**
 * LA-4.3 (Notion sprint) · the platform's carrier layout maps, for staff, inside the Catalog frame (admin round 1,
 * docs/design/admin-r1/catalog.html screen 10). They belong to the carrier library, so they follow its access rule,
 * as LA-3.13's field maps do. Layouts | Carriers on the title line; `?carrier=<code>` narrows the list to one carrier
 * (the carrier record links here). A layout opens on its own page (redesign 2026-10-14).
 */
export default async function LayoutMapsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");

  const query = await searchParams;
  // `?tab=carriers` is the Catalog workspace's spelling of the same view.
  const view = one(query.view) === "carriers" || one(query.tab) === "carriers" ? "carriers" : "layouts";
  const carrier = one(query.carrier).trim();

  const loaded = await listLayoutMaps().catch((error: unknown) => {
    if (error instanceof LayoutMapError && error.status === 503) return null;
    throw error;
  });
  const maps = loaded?.maps ?? [];
  const assignments = loaded?.assignments ?? [];
  const carriers = loaded?.carriers ?? [];
  const layouts = groupLayouts(maps);

  return (
    <CatalogPage
      step="layouts"
      info="How each carrier's files are read, column by column. A layout is a draft until it is published; a carrier's files are read with the live version of the layout assigned to it."
      tabs={
        <ViewTabs
          label="Layout map views"
          value={view}
          tabs={[
            { key: "layouts", label: "Layouts", count: layouts.filter((layout) => layout.live || layout.draft).length, href: viewHref("layouts", carrier) },
            { key: "carriers", label: "Carriers", count: carriers.length, href: viewHref("carriers", carrier) },
          ]}
        />
      }
      actions={loaded ? <Button asChild><Link href="/admin/layout-maps/new">New layout</Link></Button> : <Button type="button" disabled title={LAYOUT_MAPS_PENDING_MESSAGE}>New layout</Button>}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        {!loaded && <BillingStatusLine tone="bad" lead={{ text: LAYOUT_MAPS_PENDING_MESSAGE }} parts={["apply it to write layout maps"]} />}
        <LayoutList view={view} maps={maps} assignments={assignments} carriers={carriers} pending={!loaded} />
      </div>
    </CatalogPage>
  );
}
