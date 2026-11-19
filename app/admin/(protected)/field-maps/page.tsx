import { redirect } from "next/navigation";

import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { FmapProposeButton } from "@/components/admin/catalog/fmap-propose-button";
import { FieldMapsReview } from "@/components/admin/field-maps-review";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { SchemaPendingError } from "@/lib/applications/db";
import { FIELD_MAP_CARRIERS, FIXTURE_FIELD_MAPS } from "@/lib/applications/listFixtures";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { carrierOptions, listMaps } from "@/lib/extension/maps";
import { fieldMapExtras } from "@/lib/extension/mapsAdmin";
import type { FieldMapCarrierOption, FieldMapView } from "@/lib/extension/types";

/** The design fixtures in the API's shape (`?preview=sample`, outside production). */
function sampleMaps(): FieldMapView[] {
  return FIXTURE_FIELD_MAPS.map((m) => ({
    id: m.id, carrierId: m.carrierName, carrierName: m.carrierName, productId: m.productLabel, productLabel: m.productLabel, version: m.version, status: m.status,
    origin: m.origin, platform: true, proposalSource: "manual", approvedAt: null, updatedAt: m.updatedAt, misses: m.misses,
    steps: [...new Set(m.entries.map((e) => e.pageKey))].map((pageKey, i) => ({ pageKey, urlPattern: "*", sortOrder: i })),
    entries: m.entries.map((e) => ({ ...e, optionMap: null })),
  }));
}

const SAMPLE_CARRIERS: FieldMapCarrierOption[] = FIELD_MAP_CARRIERS.map((name) => ({ id: name, name, portalOrigin: null, products: [] }));

const INFO = "Where each carrier's application form keeps each of our fields, for the browser extension. One published map per carrier and product; a draft never fills anything, and publishing waits until every sensitive field is verified.";

/**
 * Admin › Catalog › Field maps (LA-3.13; admin round 1, catalog screen 12): the platform-default maps (tenant_id is
 * null), inside the Catalog frame. Field maps belong to the carrier library, so they follow its access rule. Beside
 * each map: when it last filled and its misses in the last 30 days, read across agencies (lib/extension/mapsAdmin.ts).
 */
export default async function FieldMapsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");

  const query = await searchParams;
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") {
    return (
      <CatalogPage step="fields" info={INFO} actions={<FmapProposeButton />}>
        <FieldMapsReview initialMaps={sampleMaps()} carriers={SAMPLE_CARRIERS} sample />
      </CatalogPage>
    );
  }
  const scope = { plane: "admin" as const, adminId: admin.id };
  const loaded = await Promise.all([listMaps(scope), carrierOptions(scope)]).catch((error: unknown) => {
    if (error instanceof SchemaPendingError) return null;
    throw error;
  });
  if (!loaded) {
    return (
      <CatalogPage step="fields" info={INFO} actions={<FmapProposeButton disabledReason="Field maps aren't set up yet." />}>
        <FieldMapsReview initialMaps={[]} carriers={[]} sample={false} pending />
      </CatalogPage>
    );
  }
  const [maps, carriers] = loaded;
  const extras = await fieldMapExtras(maps.map((m) => m.id), [...new Set([...maps.map((m) => m.carrierId), ...carriers.map((c) => c.id)])]);
  return (
    <CatalogPage step="fields" info={INFO} actions={<FmapProposeButton />}>
      <FieldMapsReview initialMaps={maps} carriers={carriers} sample={false} lastFilled={extras.lastFilled} misses30={extras.misses30} carrierCodes={extras.carrierCodes} />
    </CatalogPage>
  );
}
