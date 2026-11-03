import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit/log";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listDispositionCatalog, listDispositionMappings, removeDispositionMapping, setDispositionMapping, unmappedOutcomes } from "@/lib/pipelines/service";
import { listPipelineOutcomeStages, removePipelineOutcomeStage, setPipelineOutcomeStage } from "@/lib/pipelines/outcomeStages";
import { SchemaPendingError } from "@/lib/pipelines/schemaGap";

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const [mappings, dispositions, pipelineOutcomes] = await Promise.all([listDispositionMappings(auth.context.tenantId), listDispositionCatalog(auth.context.tenantId), listPipelineOutcomeStages(auth.context.tenantId)]);
    // `dispositions` and `unmapped` are additive: the catalogue for labels, and how many recent
    // outcomes had no stage to move the lead to. `pipelineOutcomes` (20261022200000): each pipeline's
    // own stage for an outcome, which wins over the agency-wide mapping for that pipeline's leads.
    const unmapped = await unmappedOutcomes(auth.context.tenantId, mappings.map((mapping) => mapping.disposition_key));
    return NextResponse.json({ mappings, dispositions, unmapped, pipelineOutcomes });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load mappings" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { stage_id?: unknown; disposition_key?: unknown; pipeline_id?: unknown } | null;
  // With a pipeline: that pipeline's own stage for the outcome (stage_id null: it keeps the lead where
  // it is in that pipeline, 20261027100000). Without: the agency-wide mapping.
  if (body?.pipeline_id) {
    try {
      const row = await setPipelineOutcomeStage(auth.context.tenantId, { pipeline_id: body.pipeline_id, stage_id: body.stage_id, disposition_key: body.disposition_key });
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_outcome_stage_set", targetType: "pipeline_disposition_stage", targetId: row.id, metadata: { pipelineId: row.pipeline_id, stageId: row.stage_id, dispositionKey: row.disposition_key }, request });
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "dispositions", changes: [{ key: `pipeline-mapping:${row.pipeline_id}:${row.disposition_key}`, label: `Outcome “${row.disposition_key}” moves the lead within its pipeline`, from: null, to: row.stage_id ? `to stage ${row.stage_id}` : "keeps the lead where it is" }] });
      return NextResponse.json({ pipelineOutcome: row }, { status: 201 });
    } catch (error) {
      if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save mapping" }, { status: 400 });
    }
  }
  try { const mapping = await setDispositionMapping(auth.context.tenantId, { stage_id: body?.stage_id, disposition_key: body?.disposition_key }); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.stage_disposition_mapped", targetType: "stage_disposition", targetId: mapping.id, metadata: { stageId: mapping.stage_id, dispositionKey: mapping.disposition_key }, request }); await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "dispositions", changes: [{ key: `mapping:${mapping.disposition_key}`, label: `Outcome “${mapping.disposition_key}” moves the lead`, from: null, to: `to stage ${mapping.stage_id}` }] }); return NextResponse.json({ mapping }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save mapping" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { id?: string; scope?: string } | null;
  // A pipeline's own row may always go: its leads fall back to the agency-wide stage.
  if (body?.scope === "pipeline") {
    try {
      if (!body.id) throw new Error("Mapping id is required");
      await removePipelineOutcomeStage(auth.context.tenantId, body.id);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.pipeline_outcome_stage_removed", targetType: "pipeline_disposition_stage", targetId: body.id, request });
      await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "dispositions", changes: [{ key: `pipeline-mapping:${body.id}`, label: "Outcome-to-stage rule for one pipeline", from: "rule", to: null, changeType: "delete" }] });
      return new NextResponse(null, { status: 204 });
    } catch (error) {
      if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove mapping" }, { status: 400 });
    }
  }
  try { if (!body?.id) throw new Error("Mapping id is required"); await removeDispositionMapping(auth.context.tenantId, body.id); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.stage_disposition_removed", targetType: "stage_disposition", targetId: body.id, request }); await recordSettingsChanges({ tenantId: auth.context.tenantId, actorId: auth.context.userId, section: "dispositions", changes: [{ key: `mapping:${body.id}`, label: "Outcome-to-stage rule", from: "rule", to: null, changeType: "delete" }] }); return new NextResponse(null, { status: 204 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove mapping" }, { status: 400 }); }
}
