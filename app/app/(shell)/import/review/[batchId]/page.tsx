import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { sectionForPath } from "@/lib/menu/definition";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ImportAlreadyImported, ImportReviewBridge, ImportScreeningBridge } from "@/components/app/import-review-bridge";
import { loadImportReview, planBuckets } from "@/lib/agentTemplates/importPreflight";
import { licensedStates } from "@/lib/leadLists/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Module 2 §6 · the review step, on its own route.
 *
 * A route rather than a step inside the upload screen, so it survives a refresh and can be linked
 * to — a file with nine hundred duplicates is not a decision somebody makes in one sitting.
 *
 * The plan is loaded server-side and tenant-scoped, so a batch id is not a capability: pasting
 * somebody else's id returns a 404 rather than their file's contents.
 */
export default async function ImportReviewPage({ params }: { params: Promise<{ batchId: string }> }) {
  const guard = await guardPage("lead_import");
  if (!guard.entitled)
    return <FeatureGateNotice guard={guard} featureLabel="List import" description="Review a lead list before it is imported." eyebrow={sectionForPath("/app/import") ?? undefined} />;
  if (!("owner" === guard.role || "producer" === guard.role || "assistant" === guard.role))
    return <RoleGateNotice featureLabel="List import" detail="Only owners, producers and assistants can import leads." eyebrow={sectionForPath("/app/import") ?? undefined} />;

  // `guardPage` already resolved the tenant to decide entitlement, so re-resolving it here would
  // be a second answer to a question already answered.
  const tenantId = guard.context.tenantId;

  const { batchId } = await params;
  const { plan, state, progress } = await loadImportReview(tenantId, batchId);
  // LA-2.2-10: the scrub is still running. The screen drives it and reloads into the review.
  if (state === "screening" && progress) return <ImportScreeningBridge progress={progress} />;
  if (!plan) {
    // An id that was never staged, or is not this tenant's, is genuinely not found. One that was
    // already imported is not — and showing the framework's 404 for it reads as though the import
    // was lost rather than finished.
    if (state !== "committed") return notFound();
    return <ImportAlreadyImported />;
  }

  // The campaign's and vendor's names, so the screen can say what these leads will be attributed
  // to rather than showing a uuid. LA-2.1's rule is that `campaign_id` travels with the lead
  // forever, and this is the last moment anybody can check it is the right one.
  //
  // Loosely typed like the other tenant-plane reads in this repository: neither table is in the
  // generated types.
  type LooseQuery = PromiseLike<{ data: unknown; error: unknown }> & {
    select(columns: string): LooseQuery;
    eq(column: string, value: unknown): LooseQuery;
    maybeSingle(): Promise<{ data: unknown; error: unknown }>;
  };
  const db = getSupabaseServiceClient() as unknown as { from(table: string): LooseQuery };
  const campaign = plan.campaignId
    ? ((await db.from("tenant_campaigns").select("name, status, vendor_id").eq("tenant_id", tenantId).eq("id", plan.campaignId).maybeSingle()).data as { name?: string; status?: string; vendor_id?: string } | null)
    : null;
  const vendorId = plan.vendorId ?? campaign?.vendor_id ?? null;
  const vendor = vendorId
    ? ((await db.from("tenant_lead_vendors").select("name").eq("tenant_id", tenantId).eq("id", vendorId).maybeSingle()).data as { name?: string } | null)
    : null;

  const { buckets, rows, dncBreakdown } = planBuckets(plan);

  // Territory, as the lead lists count it, so the review can say before the commit how much of the
  // file is in states nobody here is licensed in. A loss, not a vendor credit (user decision).
  const territory = await licensedStates(tenantId).catch(() => null);
  // The file's column that carries the state: the mapped one, or a header literally named "state"
  // when the file was staged without a saved mapping (the parser's by-name match).
  const stateHeader = plan.mapping
    ? Object.entries(plan.mapping).find(([, field]) => field === "state")?.[0] ?? null
    : "state";

  return <ImportReviewBridge plan={{
    batchId,
    fileName: plan.fileName ?? null,
    totalRows: plan.totalRows,
    buckets,
    rows,
    rowDetails: plan.rowDetails ?? {},
    dncBreakdown,
    samples: plan.samples,
    campaignName: campaign?.name ?? null,
    campaignStatus: campaign?.status ?? null,
    vendorName: vendor?.name ?? null,
    costCents: plan.costCents ?? null,
    recordsPurchased: plan.recordsPurchased ?? null,
    licensedStates: territory,
    stateHeader,
    noState: plan.noState ?? null,
  }} />;
}
