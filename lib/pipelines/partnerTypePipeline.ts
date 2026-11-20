import "server-only";

import { after } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { NEW_STAGE_COLOR, STAGE_SWATCHES } from "./outcomesBoard";
import { createPipeline, ensureDefaultPublisherDispositionMappings } from "./service";
import type { PartnerPipelineType } from "./types";

/**
 * A partner's own pipeline (owner 2026-11-19): "when someone successfully established a publisher, I want
 * automatically to be added a new pipeline … if a partner is a publisher, the publisher pipeline; if marketing,
 * marketing pipeline; if affiliate, affiliate pipeline". Adding the agency's first partner of a type creates that
 * type's default pipeline with the stages LA-1.9 seeded for it (20260902190000), so the partner's leads land on
 * their own board (resolvePartnerEntryStage) instead of the all-in-one Sales pipeline.
 *
 * After the sale a card still goes on: every open and won stage joins the starter after-sale rules
 * (addStageToStarterRules, 20261104120000 / 20261105120000), so when the carrier file says Issued, In force, Lapsed
 * or Charged back the card moves to the Sales pipeline's after-sale stage, as for any other pipeline.
 *
 * Idempotent: a type that already has a default pipeline is left exactly as it is.
 */
export const PARTNER_PIPELINES: Record<PartnerPipelineType, { name: string; stages: ReadonlyArray<{ name: string; type: "open" | "won" | "lost" }> }> = {
  publisher: {
    name: "Publisher transfers",
    stages: [
      { name: "New Transfer", type: "open" },
      { name: "Incomplete Transfer", type: "open" },
      { name: "Needs Callback", type: "open" },
      { name: "Pending Approval", type: "open" },
      { name: "Submitted", type: "won" },
      { name: "Returned to Partner - DQ", type: "lost" },
      { name: "Previously Sold", type: "lost" },
      { name: "Did Not Qualify", type: "lost" },
      { name: "Application Withdrawn", type: "lost" },
      { name: "Declined Underwriting", type: "lost" },
    ],
  },
  marketing: {
    name: "Marketing leads",
    stages: [
      { name: "Form Lead", type: "open" },
      { name: "Call Lead", type: "open" },
      { name: "No Pickup - Needs Connection", type: "open" },
      { name: "Pickup - Needs Callback", type: "open" },
      { name: "Qualified - Needs Conversion", type: "open" },
      { name: "Converted", type: "won" },
      { name: "Disqualified - Do Not Call", type: "lost" },
    ],
  },
  affiliate: {
    name: "Affiliate referrals",
    stages: [
      { name: "Referred", type: "open" },
      { name: "Contacted", type: "open" },
      { name: "Qualified", type: "open" },
      { name: "Submitted", type: "won" },
      { name: "Not Interested", type: "lost" },
    ],
  },
};

/** The stage colours: the palette's own (lib/pipelines/outcomesBoard.ts), never a hex of our own. */
const colorOf = (type: "open" | "won" | "lost", index: number) => (type === "open" ? STAGE_SWATCHES[(index % 4) + 1] ?? NEW_STAGE_COLOR.open : NEW_STAGE_COLOR[type]);

/** The type's default pipeline, if the tenant has one. Always under the tenant (service-role read). */
async function readTypePipeline(tenantId: string, partnerType: PartnerPipelineType): Promise<string | null> {
  const existing = await getSupabaseServiceClient().from("tenant_pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", partnerType).eq("is_default", true).maybeSingle();
  if (existing.error) throw new Error(`Could not read the pipelines: ${existing.error.message}`);
  return existing.data ? (existing.data.id as string) : null;
}

/**
 * The board itself: the pipeline and all its stages, in two writes (the stages in one insert, positions
 * 0…n in the plan's order). It used to be one createStage per stage, three round trips each; with the
 * rules below that took ~80 s inline. A stage insert that fails takes its empty pipeline with it, so a
 * half-made board never catches leads. Two intakes racing: the second meets the one-default-per-type
 * index and reads the winner's pipeline.
 */
export async function ensurePartnerTypeBoard(tenantId: string, partnerType: PartnerPipelineType): Promise<{ created: boolean; pipelineId: string; stageIds: string[] }> {
  const existing = await readTypePipeline(tenantId, partnerType);
  if (existing) return { created: false, pipelineId: existing, stageIds: [] };

  const plan = PARTNER_PIPELINES[partnerType];
  let pipeline: { id: string };
  try {
    pipeline = await createPipeline(tenantId, { name: plan.name, partner_type: partnerType, is_default: true });
  } catch (error) {
    const raced = await readTypePipeline(tenantId, partnerType);
    if (raced) return { created: false, pipelineId: raced, stageIds: [] };
    throw error;
  }
  const supabase = getSupabaseServiceClient();
  const rows = plan.stages.map((stage, index) => ({ pipeline_id: pipeline.id, name: stage.name, position: index, stage_type: stage.type, color: colorOf(stage.type, index) }));
  const { data, error } = await supabase.from("tenant_pipeline_stages").insert(rows as never).select("id, stage_type");
  if (error || !data) {
    await supabase.from("tenant_pipelines").delete().eq("id", pipeline.id).eq("tenant_id", tenantId);
    throw new Error(`Could not create the ${plan.name} stages: ${error?.message ?? "no rows"}`);
  }
  const made = data as unknown as Array<{ id: string; stage_type: string }>;
  return { created: true, pipelineId: pipeline.id, stageIds: made.filter((stage) => stage.stage_type !== "lost").map((stage) => stage.id) };
}

/** What a new board still needs once it exists: the after-sale rules, and a publisher's outcome mappings. */
export async function finishPartnerTypePipeline(scope: { tenantId: string; userId: string }, partnerType: PartnerPipelineType, pipelineId: string, stageIds: readonly string[]) {
  // The after-sale rules pick this pipeline's sold cards up too; a failure here leaves the board, never the partner.
  try {
    const { addStageToStarterRules } = await import("@/lib/pipelineRules/store");
    for (const stageId of stageIds) await addStageToStarterRules(scope, stageId);
  } catch (error) {
    console.error("[partner pipeline] starter rules", error);
  }
  if (partnerType === "publisher") await ensureDefaultPublisherDispositionMappings(scope.tenantId, pipelineId).catch((error) => console.error("[partner pipeline] dispositions", error));
}

export async function ensurePartnerTypePipeline(scope: { tenantId: string; userId: string }, partnerType: PartnerPipelineType): Promise<{ created: boolean; pipelineId: string | null }> {
  const board = await ensurePartnerTypeBoard(scope.tenantId, partnerType);
  if (board.created) await finishPartnerTypePipeline(scope, partnerType, board.pipelineId, board.stageIds);
  return { created: board.created, pipelineId: board.pipelineId };
}

// Tenants (and types) whose board this server has already seen: their later leads skip the read.
const boardsSeen = new Set<string>();

/**
 * Walk 2026-11-20: a partner added before the per-type pipelines existed (owner 2026-11-19) never had
 * ensurePartnerTypePipeline run for it, so its leads fell through resolvePartnerEntryStage's "no
 * pipeline of this type yet" branch into the Sales pipeline. Every partner lead now passes here first
 * (createPartnerLead): when the type's board is missing it is made (two writes), so this lead is filed
 * by the same rule as a new partner's — resolvePartnerEntryStage, the type's first open stage. The
 * slow part (the after-sale rules, one write at a time) runs after the response.
 *
 * Never fails the lead: if the board cannot be made, the lead lands in the Sales pipeline as before.
 */
export async function ensurePartnerTypePipelineForIntake(scope: { tenantId: string; partnerId: string; userId: string | null }, partnerType: PartnerPipelineType | null): Promise<void> {
  if (!partnerType) return;
  const seenKey = `${scope.tenantId}:${partnerType}`;
  if (boardsSeen.has(seenKey)) return;
  try {
    const board = await ensurePartnerTypeBoard(scope.tenantId, partnerType);
    boardsSeen.add(seenKey);
    if (!board.created) return;
    const finish = async () => {
      // A public affiliate link has no signed-in user: the rules are saved as whoever added the partner.
      const userId = scope.userId ?? await partnerCreator(scope.tenantId, scope.partnerId);
      if (userId) await finishPartnerTypePipeline({ tenantId: scope.tenantId, userId }, partnerType, board.pipelineId, board.stageIds);
      else if (partnerType === "publisher") await ensureDefaultPublisherDispositionMappings(scope.tenantId, board.pipelineId);
    };
    const run = () => finish().catch((error) => console.error("[partner pipeline] intake finish", error));
    try {
      after(run);
    } catch {
      // Outside a request (a script): finish without holding the caller.
      void run();
    }
  } catch (error) {
    console.error("[partner pipeline] intake board", error);
  }
}

async function partnerCreator(tenantId: string, partnerId: string): Promise<string | null> {
  const { data } = await getSupabaseServiceClient().from("partners").select("created_by").eq("tenant_id", tenantId).eq("id", partnerId).maybeSingle();
  const createdBy = (data as { created_by?: string | null } | null)?.created_by;
  return typeof createdBy === "string" ? createdBy : null;
}
