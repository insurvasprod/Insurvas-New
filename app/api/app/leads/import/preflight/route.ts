import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAgentTemplate } from "@/lib/agentTemplates/service";
import { recordImportFailure } from "@/lib/agentTemplates/errors";
import {
  advancePreflightScreening,
  commitImport,
  ImportConflictError,
  ImportNeedsDatabaseUpdateError,
  MAX_STEP_NUMBERS,
  preflightImport,
  type ImportDecisions,
} from "@/lib/agentTemplates/importPreflight";
import { MAX_BATCH_COST_CENTS, MAX_RECORDS_PURCHASED } from "@/lib/agentTemplates/importReviewModel";
import { IMPORT_DATE_ORDERS } from "@/lib/agentTemplates/csv";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listPipelines } from "@/lib/pipelines/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { outboundLimitResponse, recordOutboundUsage } from "@/lib/metering/outbound";

/**
 * Module 2 §6 · POST stages a file for review; PUT commits it with the decisions.
 *
 * Two calls rather than one, because the documentation's pipeline has a human in it. Steps ④⑤⑥
 * produce facts — what is unreadable, what is a duplicate, what cannot legally be dialled — and
 * step ⑧ is a decision made in the light of them.
 */
const LEAD_IMPORT_ROLES = ["owner", "producer", "assistant"] as const;

/**
 * LA-2.2-10. Each request screens for at most STEP_BUDGET_MS (20 s) and then hands back; this is the
 * ceiling a platform may enforce on one request, with room for the plan to be built on the last one.
 */
export const maxDuration = 60;

const preflightSchema = z.object({
  csv: z.string().min(1),
  // Required. Every lead knows its campaign, and every campaign knows its cost (§5) — a list with
  // no campaign is invisible to every cost report, and the importer no longer offers that.
  campaign_id: z.string().uuid(),
  vendor_id: z.string().uuid().nullable().optional(),
  mapping: z.record(z.string(), z.string().nullable()).optional(),
  file_name: z.string().trim().min(1).max(255).nullable().optional(),
  // Integer cents, never a float: the screen converts dollars and cents to cents before sending.
  cost_cents: z.number().int().min(0).max(MAX_BATCH_COST_CENTS).nullable().optional(),
  records_purchased: z.number().int().min(0).max(MAX_RECORDS_PURCHASED).nullable().optional(),
  // How slash dates are read, picked once for the whole file on the mapping dialog.
  date_order: z.enum(IMPORT_DATE_ORDERS).nullable().optional(),
}).strict();

const commitSchema = z.object({
  batch_id: z.string().uuid(),
  csv: z.string().min(1),
  decisions: z.object({
    duplicates_in_file: z.enum(["first", "skip"]),
    existing_leads: z.enum(["attach", "skip"]),
    // No third option. A DNC number is never made dialable from an import screen — Module 2 §8.1
    // permits dialling one only with a documented prior relationship or written consent, and a
    // checkbox is neither.
    dnc: z.enum(["exclude", "suppress"]),
  }),
  add_to_campaign_spend: z.boolean().optional(),
}).strict();

/** PATCH: the review screen's poll, which screens the next slice of a batch's scrub. */
const stepSchema = z.object({
  batch_id: z.string().uuid(),
  // Sent once every number has an answer: the plan is built from the file's rows.
  csv: z.string().min(1).optional(),
  // How many numbers this step may screen; the screen sends nothing and gets the default.
  limit: z.number().int().min(1).max(MAX_STEP_NUMBERS).optional(),
}).strict();

type LooseQuery = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  select(columns: string): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  in(column: string, values: string[]): LooseQuery;
};

async function context() {
  const auth = await requireFeatureRole("lead_import", LEAD_IMPORT_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
  const pipelines = await listPipelines(auth.context.tenantId);
  const pipeline =
    pipelines.find((item) => item.partner_type === null && item.is_default) ??
    pipelines.find((item) => item.partner_type === "marketing" && item.is_default) ??
    pipelines.find((item) => item.is_default) ??
    pipelines[0];
  return { auth, template, stages: pipeline?.stages ?? [] };
}

function conflict(error: unknown) {
  if (error instanceof ImportConflictError)
    return NextResponse.json({ error: error.message, code: "import_conflict", batchId: error.batchId }, { status: 409 });
  if (error instanceof ImportNeedsDatabaseUpdateError)
    return NextResponse.json({ error: error.message, code: "needs_database_update" }, { status: 503 });
  return null;
}

export async function POST(request: NextRequest) {
  const result = await context();
  if (result instanceof NextResponse) return result;
  const parsed = preflightSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const message =
      field === "campaign_id" ? "Choose the campaign this list belongs to"
        : field === "cost_cents" ? "Enter the batch cost as dollars and cents, up to $1,000,000"
          : field === "records_purchased" ? "Enter how many rows were purchased as a whole number"
            : field === "date_order" ? "Pick how the file's dates are written: month first or day first"
              : "Choose a CSV file to review";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    // A campaign is verified here rather than trusted, because the whole cost chain hangs off it:
    // LA-2.1's rule is that `campaign_id` travels with the lead forever. The vendor follows the
    // campaign — a campaign belongs to exactly one vendor — so a vendor that does not own it is
    // refused rather than quietly replaced.
    const db = getSupabaseServiceClient() as unknown as { from(table: string): LooseQuery };
    const campaign = await db
      .from("tenant_campaigns")
      .select("id, vendor_id, status")
      .eq("tenant_id", result.auth.context.tenantId)
      .eq("id", parsed.data.campaign_id);
    const campaignRow = Array.isArray(campaign.data) ? (campaign.data[0] as { id: string; vendor_id: string; status: string } | undefined) : undefined;
    if (campaign.error || !campaignRow)
      return NextResponse.json({ error: "Choose a campaign that belongs to you" }, { status: 400 });
    if (campaignRow.status === "exhausted")
      return NextResponse.json({ error: "This campaign is marked exhausted. Choose another, or reopen it on Vendors & campaigns." }, { status: 400 });
    if (parsed.data.vendor_id && parsed.data.vendor_id !== campaignRow.vendor_id)
      return NextResponse.json({ error: "The selected vendor does not own this campaign" }, { status: 400 });

    const { batchId, plan, progress } = await preflightImport({
      tenantId: result.auth.context.tenantId,
      userId: result.auth.context.userId,
      template: result.template,
      csv: parsed.data.csv,
      stages: result.stages,
      vendorId: campaignRow.vendor_id,
      campaignId: campaignRow.id,
      mapping: parsed.data.mapping,
      fileName: parsed.data.file_name ?? null,
      costCents: parsed.data.cost_cents ?? null,
      recordsPurchased: parsed.data.records_purchased ?? null,
      dateOrder: parsed.data.date_order ?? null,
    });

    // Still screening: 202, and the review screen carries the job on with PATCH. Nothing is staged.
    if (!plan)
      return NextResponse.json(
        { batchId, state: "screening", progress, campaignId: campaignRow.id },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );

    return NextResponse.json(
      {
        batchId,
        state: "staged",
        counts: plan.counts,
        buckets: plan.buckets,
        noState: plan.noState?.length ?? 0,
        totalRows: plan.totalRows,
        campaignId: plan.campaignId,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const refused = conflict(error);
    if (refused) return refused;
    const limit = outboundLimitResponse(error);
    if (limit) return NextResponse.json(limit, { status: 403 });
    const failure = recordImportFailure(error, "preflight stage");
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}

/**
 * LA-2.2-10 · one step of a batch's scrub. The progress is the batch row's, so a closed tab, a
 * refresh or a second tab carries on from the same place; nothing is staged until every number has
 * an answer and the file has been sent to build the plan from.
 */
export async function PATCH(request: NextRequest) {
  const result = await context();
  if (result instanceof NextResponse) return result;
  const parsed = stepSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name the import to carry on checking" }, { status: 400 });
  try {
    const step = await advancePreflightScreening({
      tenantId: result.auth.context.tenantId,
      userId: result.auth.context.userId,
      template: result.template,
      stages: result.stages,
      batchId: parsed.data.batch_id,
      csv: parsed.data.csv ?? null,
      limit: parsed.data.limit,
    });
    if (step.state === "missing") return NextResponse.json({ error: "This import is not on file. Upload the file again.", state: "missing" }, { status: 404 });
    if (step.state === "committed") return NextResponse.json({ state: "committed", batchId: parsed.data.batch_id }, { headers: { "Cache-Control": "no-store" } });
    if (step.state === "staged")
      return NextResponse.json(
        { state: "staged", batchId: parsed.data.batch_id, buckets: step.plan.buckets, totalRows: step.plan.totalRows, noState: step.plan.noState?.length ?? 0 },
        { headers: { "Cache-Control": "no-store" } },
      );
    return NextResponse.json({ state: "screening", progress: step.progress, needsFile: step.needsFile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const refused = conflict(error);
    if (refused) return refused;
    const failure = recordImportFailure(error, "preflight screening step");
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}

export async function PUT(request: NextRequest) {
  const result = await context();
  if (result instanceof NextResponse) return result;
  const parsed = commitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Choose what to do with each group before importing" }, { status: 400 });

  const decisions: ImportDecisions = {
    duplicatesInFile: parsed.data.decisions.duplicates_in_file,
    existingLeads: parsed.data.decisions.existing_leads,
    dnc: parsed.data.decisions.dnc,
  };
  // Ticked by default on the screen, so a caller that says nothing gets the same default.
  const addToCampaignSpend = parsed.data.add_to_campaign_spend ?? true;

  try {
    const summary = await commitImport({
      tenantId: result.auth.context.tenantId,
      userId: result.auth.context.userId,
      template: result.template,
      csv: parsed.data.csv,
      stages: result.stages,
      batchId: parsed.data.batch_id,
      decisions,
      addToCampaignSpend,
    });

    if (summary.imported > 0)
      await recordOutboundUsage(
        result.auth.context.tenantId,
        "monthly_leads_imported",
        summary.imported,
        `${parsed.data.batch_id}:monthly_leads_imported`,
        parsed.data.batch_id,
      );

    // One audit row for the decision, because the decision is the auditable act: which groups were
    // excluded, which were suppressed, and who chose.
    await audit({
      actorType: "tenant", actorId: result.auth.context.userId,
      action: "tenant.lead_import_committed",
      targetType: "agent_lead_import_batch", targetId: parsed.data.batch_id,
      metadata: { ...summary, decisions, addToCampaignSpend }, request,
    });
    // The spend is money on a campaign, so it is audited against the campaign as well — the place
    // somebody looking at a changed total will look.
    if (summary.spendAddedCents > 0 || summary.recordsAdded > 0)
      await audit({
        actorType: "tenant", actorId: result.auth.context.userId,
        action: "tenant.campaign_spend_added_by_import",
        targetType: "tenant_campaign", targetId: summary.campaignId,
        metadata: { batchId: parsed.data.batch_id, costCents: summary.spendAddedCents, recordsPurchased: summary.recordsAdded },
        request,
      });

    return NextResponse.json({ summary, redirect: `/app/lead-lists/${summary.campaignId}` });
  } catch (error) {
    const refused = conflict(error);
    if (refused) return refused;
    const limit = outboundLimitResponse(error);
    if (limit) return NextResponse.json(limit, { status: 403 });
    const failure = recordImportFailure(error, "preflight commit");
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}
