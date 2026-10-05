import "server-only";

import { z } from "zod";

import type { Actor } from "@/lib/applications/http";
import { ApplicationError, db, isMissingSchema, rows, SchemaPendingError, type DbError } from "@/lib/applications/db";
import { auditSales } from "./settings";

/**
 * LA-3.23 · which of the tenant's own pipeline stages a lead's card moves to as its application
 * reaches each state (STATUS-MODEL §6). One stage per sync key (tenant_application_stage_map's key);
 * an unmapped key moves nothing — "Doesn't move the card". The stage must be one of this tenant's
 * (the table's trigger refuses another tenant's; this checks first so the message is plain).
 */

export const STAGE_SYNC_KEYS = ["quoted", "application_started", "submitted", "pending_requirements", "issued", "requoting", "lost"] as const;
export type StageSyncKey = (typeof STAGE_SYNC_KEYS)[number];

export const stageMapSchema = z.object({
  map: z.partialRecord(z.enum(STAGE_SYNC_KEYS), z.string().uuid().nullable()),
}).strict();

export type PipelineOption = { id: string; name: string; isDefault: boolean; stages: { id: string; name: string; stageType: "open" | "won" | "lost" }[] };
export type StageMapView = { pipelines: PipelineOption[]; map: Record<StageSyncKey, string | null>; stored: number; canEdit: boolean };

function fail(error: DbError, what: string): never {
  if (isMissingSchema(error)) throw new SchemaPendingError("Pipeline sync");
  if (error?.message?.includes("STAGE_MAP_FOREIGN_STAGE")) throw new ApplicationError("STAGE_NOT_FOUND", "That stage isn't in one of your pipelines.", 400);
  throw new ApplicationError("STAGE_MAP_UNAVAILABLE", `${what}: ${error?.message ?? "unknown error"}`, 500);
}

async function tenantPipelines(tenantId: string): Promise<PipelineOption[]> {
  const { data, error } = await db()
    .from("tenant_pipelines")
    .select("id, name, is_default, stages:tenant_pipeline_stages(id, name, position, stage_type, is_archived)")
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("name");
  if (error) fail(error, "Could not load your pipelines");
  return rows<{ id: string; name: string; is_default: boolean; stages: { id: string; name: string; position: number; stage_type: "open" | "won" | "lost"; is_archived: boolean }[] | null }>(data).map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.is_default,
    stages: (p.stages ?? []).filter((s) => !s.is_archived).sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, name: s.name, stageType: s.stage_type })),
  }));
}

async function storedMap(tenantId: string) {
  const { data, error } = await db().from("tenant_application_stage_map").select("sync_key, stage_id").eq("tenant_id", tenantId);
  if (error) fail(error, "Could not load the pipeline sync");
  return rows<{ sync_key: StageSyncKey; stage_id: string }>(data);
}

export async function getStageMap(actor: Actor): Promise<StageMapView> {
  const [pipelines, stored] = await Promise.all([tenantPipelines(actor.tenantId), storedMap(actor.tenantId)]);
  const map = Object.fromEntries(STAGE_SYNC_KEYS.map((key) => [key, stored.find((r) => r.sync_key === key)?.stage_id ?? null])) as Record<StageSyncKey, string | null>;
  return { pipelines, map, stored: stored.length, canEdit: actor.role === "owner" };
}

export async function saveStageMap(actor: Actor, next: Partial<Record<StageSyncKey, string | null>>): Promise<StageMapView> {
  const [pipelines, stored] = await Promise.all([tenantPipelines(actor.tenantId), storedMap(actor.tenantId)]);
  const known = new Set(pipelines.flatMap((p) => p.stages.map((s) => s.id)));
  const before = Object.fromEntries(STAGE_SYNC_KEYS.map((key) => [key, stored.find((r) => r.sync_key === key)?.stage_id ?? null])) as Record<StageSyncKey, string | null>;
  const after = { ...before, ...next };
  for (const key of STAGE_SYNC_KEYS) {
    const stage = after[key];
    if (stage && !known.has(stage) && stage !== before[key]) throw new ApplicationError("STAGE_NOT_FOUND", "That stage isn't in one of your pipelines — it may have been archived. Refresh and choose again.", 400);
  }
  const changed = STAGE_SYNC_KEYS.filter((key) => after[key] !== before[key]);
  if (!changed.length) return getStageMap(actor);

  const client = db();
  const upserts = changed.filter((key) => after[key]).map((key) => ({ tenant_id: actor.tenantId, sync_key: key, stage_id: after[key], updated_by: actor.userId }));
  if (upserts.length) {
    const up = await client.from("tenant_application_stage_map").upsert(upserts, { onConflict: "tenant_id,sync_key" });
    if (up.error) fail(up.error, "Could not save the pipeline sync");
  }
  const cleared = changed.filter((key) => !after[key]);
  if (cleared.length) {
    const del = await client.from("tenant_application_stage_map").delete().eq("tenant_id", actor.tenantId).in("sync_key", cleared);
    if (del.error) fail(del.error, "Could not save the pipeline sync");
  }
  const name = (id: string | null) => (id ? pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name }))).find((s) => s.id === id) : null);
  await auditSales(actor, "tenant.application_stage_map_updated", "tenant_application_stage_map", actor.tenantId, {
    changed,
    before: Object.fromEntries(changed.map((key) => [key, before[key] ? { stageId: before[key], stage: name(before[key])?.name ?? null } : null])),
    after: Object.fromEntries(changed.map((key) => [key, after[key] ? { stageId: after[key], stage: name(after[key])?.name ?? null, pipeline: name(after[key])?.pipeline ?? null } : null])),
  });
  return getStageMap(actor);
}
