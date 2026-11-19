import { notFound, redirect } from "next/navigation";

import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { LAYOUT_ACTIONS_SLOT, LAYOUT_TABS_SLOT } from "@/components/admin/catalog/layout-slots";
import { LayoutDetail } from "@/components/admin/layout-maps/layout-detail";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { listLayoutMaps } from "@/lib/ingestion/layoutAdmin";

/**
 * One layout map, every version of it, and the carriers it reads for (redesign 2026-10-14), inside the Catalog frame
 * (admin round 1, catalog screen 10): the layout's name is the title, Catalog › Layout maps › name the trail, and its
 * Columns · File settings · Carriers · Versions bar and its buttons sit on the title line (the client board fills the
 * two slots, since both hang on the draft being edited).
 */
export default async function LayoutMapPage({ params }: { params: Promise<{ key: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");
  const { key } = await params;
  const layoutKey = decodeURIComponent(key);
  if (!/^[a-z][a-z0-9_]{2,60}$/.test(layoutKey)) notFound();

  const loaded = await listLayoutMaps();
  const versions = loaded.maps.filter((map) => map.layoutKey === layoutKey);
  if (!versions.length) notFound();
  const name = [...versions].sort((a, b) => b.version - a.version)[0].name;
  return (
    <CatalogPage
      step="layouts"
      title={name}
      info="Every column of the carrier's file: a column the software uses is mapped to one of its fields; every other column is kept as information and shown to the agent with the row. A live version is frozen; changing it starts the next version."
      breadcrumbs={[{ label: "Catalog", href: "/admin/catalog" }, { label: "Layout maps", href: "/admin/layout-maps" }, { label: name }]}
      // The tabs' place takes the room between the title and the buttons, so a long bar scrolls instead of running under them.
      tabs={<div id={LAYOUT_TABS_SLOT} className="flex min-w-0 flex-1 items-end gap-2 empty:hidden [&>[role=tablist]]:flex-1" />}
      actions={<StepSlotTarget id={LAYOUT_ACTIONS_SLOT} />}
    >
      <LayoutDetail key={layoutKey} layoutKey={layoutKey} initialVersions={versions} initialAssignments={loaded.assignments.filter((row) => row.layoutKey === layoutKey)} carriers={loaded.carriers} />
    </CatalogPage>
  );
}
