import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { catalogStepsFor } from "@/lib/adminCatalog/steps";
import { layoutGaps, type CatalogQueues } from "@/lib/adminCatalog/needs";
import { listFactReportQueue } from "@/lib/carriers/factReports";
import { listMaps } from "@/lib/extension/maps";
import { fetchFeatureGrants } from "@/lib/features/grants";
import { fetchAllSwitches } from "@/lib/features/killSwitch";
import { switchCounts } from "@/lib/features/killSwitchRules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadGuidance } from "@/lib/ingestion/bookImport";
import { loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";
import { listLayoutMaps } from "@/lib/ingestion/layoutAdmin";
import { listStatusQueue } from "@/lib/ingestion/statusAdmin";
import { loadGuides } from "@/lib/retention/servicingStore";
import { fetchTemplatePublication } from "@/lib/templates/usage";
import { templateState } from "@/lib/templates/catalog";

type Viewer = { id: string; role: AdminRole };

/** A queue's read: undefined when the role may not open its page, null (logged) when the read failed. */
async function queue<T>(open: boolean, label: string, load: () => Promise<T | null>): Promise<T | null | undefined> {
  if (!open) return undefined;
  try {
    return await load();
  } catch (error) {
    console.error(`[admin-catalog] ${label}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Live features sold by no plan version and no add-on: nobody can buy them. Two small key reads, not the catalog. */
async function featureQueue(): Promise<NonNullable<CatalogQueues["features"]>> {
  const [switches, features, grants] = await Promise.all([
    fetchAllSwitches(),
    getSupabaseServiceClient().from("features").select("feature_key").eq("is_archived", false),
    fetchFeatureGrants(),
  ]);
  if (features.error) throw new Error(features.error.message);
  const sold = new Set(Object.keys(grants));
  const counts = switchCounts([...switches.values()]);
  return { off: counts.off, beta: counts.beta, unsold: (features.data ?? []).filter((row) => !sold.has(row.feature_key)).length };
}

/**
 * Every Catalog queue the viewer's role may open, read at once (each page's own loader, so the counts match the
 * pages), each failing on its own. Shared by the workspace and the rail's badge route.
 */
export async function catalogQueues(viewer: Viewer): Promise<CatalogQueues> {
  const steps = new Set<string>(catalogStepsFor(viewer.role).map((step) => step.key));
  const scope = { plane: "admin" as const, adminId: viewer.id };
  const [status, reports, fields, rules, layouts, guidance, servicing, templates, features] = await Promise.all([
    queue(steps.has("status"), "status queue", async () => {
      const { queue: words } = await listStatusQueue();
      return {
        words: words.length,
        rows: words.reduce((sum, word) => sum + word.rows, 0),
        // Agencies are counted per word; the most any one word holds is the honest floor across words.
        agencies: words.reduce((most, word) => Math.max(most, word.agencies), 0),
        oldest: words.reduce<string | null>((first, word) => (!first || word.firstSeenAt < first ? word.firstSeenAt : first), null),
      };
    }),
    queue(steps.has("reports"), "fact reports", async () => {
      const loaded = await listFactReportQueue();
      if (!loaded.available) return { waiting: 0, oldest: null };
      const open = loaded.reports.filter((report) => report.status === "open");
      return { waiting: open.length, oldest: open.reduce<string | null>((first, report) => (!first || report.createdAt < first ? report.createdAt : first), null) };
    }),
    queue(steps.has("fields"), "field maps", async () => {
      const maps = await listMaps(scope);
      return {
        drafts: maps.filter((map) => map.status === "draft").length,
        inReview: maps.filter((map) => map.status === "in_review").length,
        needsReview: maps.filter((map) => map.status === "needs_review").length,
      };
    }),
    queue(steps.has("rules"), "carrier rules", async () => {
      const view = await loadCarrierRules({ plane: "platform", adminId: viewer.id });
      if (!view.available) return null;
      return { missing: view.carriers.filter((carrier) => carrier.gaps.length > 0).length, carriers: view.carriers.length };
    }),
    queue(steps.has("layouts"), "layout maps", async () => layoutGaps(await listLayoutMaps())),
    queue(steps.has("guidance"), "portal guidance", async () => {
      const view = await loadGuidance();
      if (!view.available) return null;
      return { missing: view.carriers.filter((carrier: { guidance: unknown }) => !carrier.guidance).length, carriers: view.carriers.length };
    }),
    queue(steps.has("servicing"), "servicing instructions", async () => {
      const view = await loadGuides();
      if (!view.available) return null;
      return { missing: view.carriers.filter((carrier) => Object.keys(carrier.guides).length === 0).length, carriers: view.carriers.length };
    }),
    queue(steps.has("templates"), "template drafts", async () => {
      const [rows, publication] = await Promise.all([getSupabaseServiceClient().from("templates").select("id, is_active"), fetchTemplatePublication()]);
      if (rows.error) throw new Error(rows.error.message);
      return { drafts: (rows.data ?? []).filter((row) => templateState(row.is_active, publication.publishedAt[row.id], publication.draftsSupported) === "draft").length };
    }),
    queue(steps.has("features"), "features", featureQueue),
  ]);
  return { status, reports, fields, rules, layouts, guidance, servicing, templates, features };
}
