import { notFound, redirect } from "next/navigation";

import { LayoutDetail } from "@/components/admin/layout-maps/layout-detail";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { listLayoutMaps } from "@/lib/ingestion/layoutAdmin";

/** One layout map, every version of it, and the carriers it reads for (redesign 2026-10-14). */
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
  return <LayoutDetail key={layoutKey} layoutKey={layoutKey} initialVersions={versions} initialAssignments={loaded.assignments.filter((row) => row.layoutKey === layoutKey)} carriers={loaded.carriers} />;
}
