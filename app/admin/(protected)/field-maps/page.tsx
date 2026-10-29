import { redirect } from "next/navigation";

import { FieldMapsReview } from "@/components/admin/field-maps-review";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { db, rows, SchemaPendingError } from "@/lib/applications/db";
import { FIELD_MAP_CARRIERS, FIXTURE_FIELD_MAPS } from "@/lib/applications/listFixtures";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";
import { carrierOptions, listMaps } from "@/lib/extension/maps";
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

/**
 * "Last filled" on the board: the newest fill_rate event per platform map, across every agency
 * (a platform map is filled for all of them). Only the time is read — no tenant or application.
 */
async function lastFilledByMap(mapIds: string[]): Promise<Record<string, string>> {
  if (!mapIds.length) return {};
  const { data, error } = await db().from("carrier_field_map_events").select("map_id, at").eq("kind", "fill_rate").in("map_id", mapIds).order("at", { ascending: false }).limit(2000);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const r of rows<{ map_id: string; at: string }>(data)) if (!out[r.map_id]) out[r.map_id] = r.at;
  return out;
}

export default async function FieldMapsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  // Field maps belong to the carrier library, so they follow its access rule.
  if (!canAccessConfigurationSection(admin.role, "carriers")) redirect("/admin");

  const query = await searchParams;
  if (query.preview === "sample" && process.env.NODE_ENV !== "production") {
    return <FieldMapsReview initialMaps={sampleMaps()} carriers={SAMPLE_CARRIERS} sample />;
  }
  // The platform-default maps (tenant_id is null) and their map_miss events.
  const scope = { plane: "admin" as const, adminId: admin.id };
  const loaded = await Promise.all([listMaps(scope), carrierOptions(scope)]).catch((error: unknown) => {
    if (error instanceof SchemaPendingError) return null;
    throw error;
  });
  if (!loaded) return <FieldMapsReview initialMaps={[]} carriers={[]} sample={false} notice="Field maps aren't set up yet. Apply the latest database migrations to review them." />;
  const lastFilled = await lastFilledByMap(loaded[0].map((m) => m.id));
  return <FieldMapsReview initialMaps={loaded[0]} carriers={loaded[1]} lastFilled={lastFilled} sample={false} />;
}
