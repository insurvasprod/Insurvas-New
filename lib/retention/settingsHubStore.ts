import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { DEFAULT_OWNER_ROLE, LA5_OWNER_ROLES, LA5_QUEUES, type La5OwnerRole, type La5Queue } from "./assignment";
import { loadMembers } from "./assignmentStore";
import { PLATFORM_DEFAULT_WEIGHTS, SIGNALS, type Band, type RetentionSettings, type Weights } from "./constants";
import { scoreDistribution } from "./queueStore";
import { computeRadar, loadRadarConfig } from "./radarStore";
import { bandMoves, diff, guardProblem, resetSection, sameWeights, toRow, validate, weightProblem, type Guards, type HubSection } from "./settingsHub";

/**
 * LA-5.11 (Notion sprint) · the retention settings hub, server side. Tenant-scoped and enforced here:
 * a value the browser sends is validated against the same limits the database checks, and nothing the
 * browser computed (a band count, a preview) is trusted. Every change writes retention_setting_change
 * (who, what, from, to, when), which LA-8.8 copies into the settings history. A weight change is a new
 * risk_weight_set version; scores already made keep the version that made them.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const HUB_PENDING_MESSAGE = "Retention settings need a database update (20261016200000–20261016220000).";

export class HubError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "HubError";
  }
}

export type Hub = {
  settings: RetentionSettings;
  weights: Weights;
  weightVersion: number;
  weightIsPlatform: boolean;
  platformWeights: Weights;
  distribution: { all: number[]; eligible: number[] } | null;
  rules: Record<La5Queue, La5OwnerRole>;
  reps: Array<{ userId: string; name: string }>;
  carriers: Array<{ id: string; name: string }>;
  changes: Array<{ setting: string; from: unknown; to: unknown; by: string; at: string }>;
};

async function rules(tenantId: string): Promise<Record<La5Queue, La5OwnerRole>> {
  const { data, error } = await db().from("queue_assignment_rule").select("queue_type, owner_role").eq("tenant_id", tenantId).in("queue_type", [...LA5_QUEUES]);
  if (error && !isSchemaGap(error)) throw new Error(error.message);
  const out = { ...DEFAULT_OWNER_ROLE };
  for (const r of (data ?? []) as Loose[]) if ((LA5_OWNER_ROLES as readonly string[]).includes(r.owner_role)) out[r.queue_type as La5Queue] = r.owner_role;
  return out;
}

export async function loadHub(tenantId: string): Promise<Hub> {
  const configRead = loadRadarConfig(tenantId);
  // Everything but the weight-set row is read beside the config (none of it needs the config), and the
  // carrier names as soon as the scored carriers are in. The config is still decided first: no config is
  // the pending notice, whatever the rest did. The no-op catch only stops an early failure counting as
  // unhandled while the config is awaited; `rest` is awaited (and throws) below as before.
  const rest = Promise.all([
    scoreDistribution(tenantId, { config: configRead }).catch((error) => {
      console.error("[retention-settings] distribution", error);
      return null;
    }),
    rules(tenantId),
    loadMembers(tenantId),
    db().from("policy_risk_score").select("carrier_id").eq("tenant_id", tenantId).limit(5000).then(async (carriers: Loose) => {
      const carrierIds = [...new Set(((carriers.data ?? []) as Loose[]).map((c) => c.carrier_id))];
      return carrierIds.length ? await db().from("carriers").select("id, name").in("id", carrierIds) : { data: [] };
    }),
    db().from("retention_setting_change").select("setting, old_value, new_value, changed_by, changed_at").eq("tenant_id", tenantId).order("changed_at", { ascending: false }).limit(40),
  ]);
  rest.catch(() => undefined);
  const config = await configRead;
  if (!config) throw new HubError(HUB_PENDING_MESSAGE, 503);
  const [[distribution, queueRules, members, names, changes], set] = await Promise.all([
    rest,
    db().from("risk_weight_set").select("tenant_id").eq("id", config.weightSetId).maybeSingle(),
  ]);
  const userName = new Map(members.map((m) => [m.userId, m.name]));
  return {
    settings: config.settings,
    weights: config.weights,
    weightVersion: config.weightSetVersion,
    weightIsPlatform: set.data?.tenant_id === null,
    platformWeights: { ...PLATFORM_DEFAULT_WEIGHTS },
    distribution,
    rules: queueRules,
    reps: members.filter((m) => m.active && m.role === "retention").map((m) => ({ userId: m.userId, name: m.name })),
    carriers: ((names.data ?? []) as Loose[]).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    changes: ((changes.data ?? []) as Loose[]).map((c) => ({ setting: c.setting, from: c.old_value, to: c.new_value, by: userName.get(c.changed_by) ?? "Someone", at: c.changed_at })),
  };
}

async function audit(tenantId: string, by: string, changes: Array<{ setting: string; from: unknown; to: unknown }>) {
  if (!changes.length) return;
  const { error } = await db().from("retention_setting_change").insert(changes.map((c) => ({ tenant_id: tenantId, setting: c.setting, old_value: c.from ?? null, new_value: c.to ?? null, changed_by: by })));
  if (error) throw new Error(`Could not record the change: ${error.message}`);
}

/** Apply a change to the settings (whole sections from the page). Returns what changed. */
export async function saveSettings(tenantId: string, by: string, next: RetentionSettings, guards: Guards) {
  const config = await loadRadarConfig(tenantId);
  if (!config) throw new HubError(HUB_PENDING_MESSAGE, 503);
  const before = config.settings;
  const problem = validate(next) ?? guardProblem(before, next, guards);
  if (problem) throw new HubError(problem);
  // The rep map and order name members of this agency only.
  if (Object.keys(next.assignmentCarrierReps).length || next.assignmentRepOrder.length) {
    const reps = new Set((await loadMembers(tenantId)).filter((m) => m.role === "retention").map((m) => m.userId));
    if ([...Object.values(next.assignmentCarrierReps), ...next.assignmentRepOrder].some((u) => !reps.has(u))) throw new HubError("Assign carriers and order only retention reps on this team.");
  }
  const changes = diff(before, next);
  if (!changes.length) return changes;
  const { error } = await db().from("retention_settings").upsert({ tenant_id: tenantId, ...toRow(next), updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) {
    if (isSchemaGap(error)) throw new HubError(HUB_PENDING_MESSAGE, 503);
    if (error.code === "23514") throw new HubError("One of those values is outside what the setting allows.");
    throw new Error(error.message);
  }
  await audit(tenantId, by, changes);
  return changes;
}

export async function resetHubSection(tenantId: string, by: string, section: HubSection, guards: Guards) {
  if (section === "weights") return saveWeights(tenantId, by, { ...PLATFORM_DEFAULT_WEIGHTS }, "Reset to the platform's weights.");
  const config = await loadRadarConfig(tenantId);
  if (!config) throw new HubError(HUB_PENDING_MESSAGE, 503);
  // A reset that shortens the affordability period (an agency above 365 days) still needs the typed word.
  return saveSettings(tenantId, by, resetSection(config.settings, section), guards);
}

/** A new weight version. Existing scores keep the version that produced them (LA-5.9 compares them). */
export async function saveWeights(tenantId: string, by: string, weights: Weights, note: string | null) {
  const problem = weightProblem(weights);
  if (problem) throw new HubError(problem);
  const config = await loadRadarConfig(tenantId);
  if (!config) throw new HubError(HUB_PENDING_MESSAGE, 503);
  if (sameWeights(config.weights, weights)) return [];
  const { data: top, error: topError } = await db().from("risk_weight_set").select("version").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).order("version", { ascending: false }).limit(1).maybeSingle();
  if (topError) throw new Error(topError.message);
  const version = Number(top?.version ?? 0) + 1;
  const clean = Object.fromEntries(SIGNALS.map((s) => [s, weights[s]]));
  const { error } = await db().from("risk_weight_set").insert({ tenant_id: tenantId, version, weights: clean, note: note?.trim() || null, created_by: by });
  if (error) {
    if (error.code === "23505") throw new HubError("Someone saved weights at the same moment. Reload and try again.", 409);
    throw new Error(`Could not save the weights: ${error.message}`);
  }
  const changes = [{ setting: "weights", from: { version: config.weightSetVersion, ...config.weights }, to: { version, ...clean } }];
  await audit(tenantId, by, changes);
  // Rescore now, so the queue reads the new weights today rather than tomorrow.
  await computeRadar(tenantId).catch((e) => console.error("[retention-settings] rescore after a weight change", e));
  return changes;
}

/** How many policies would change band under these weights. Nothing is written. */
export async function previewWeights(tenantId: string, weights: Weights) {
  const problem = weightProblem(weights);
  if (problem) throw new HubError(problem);
  const run = await computeRadar(tenantId, {}, { dryRun: true, weights });
  if (!run.available || !run.preview) throw new HubError(HUB_PENDING_MESSAGE, 503);
  const keyOf = (r: Loose) => `${r.carrier_id}|${r.policy_number}`;
  const current = new Map<string, Band>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from("policy_risk_score").select("carrier_id, policy_number, band").eq("tenant_id", tenantId).order("carrier_id").order("policy_number").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Loose[]) current.set(keyOf(r), r.band);
    if (!data || data.length < 1000) break;
  }
  const after = new Map<string, Band>(run.preview.scores.map((r: Loose) => [keyOf(r), r.band]));
  return bandMoves(current, after);
}

/** LA-4.9's rule rows for the three LA-5 queues. */
export async function saveQueueRules(tenantId: string, by: string, next: Record<La5Queue, La5OwnerRole>) {
  const before = await rules(tenantId);
  const changes = LA5_QUEUES.filter((q) => before[q] !== next[q]).map((q) => ({ setting: `queue_owner_${q}`, from: before[q], to: next[q] }));
  for (const q of LA5_QUEUES) {
    if (!(LA5_OWNER_ROLES as readonly string[]).includes(next[q])) throw new HubError("Choose who owns each queue.");
  }
  for (const c of changes) {
    const q = c.setting.replace("queue_owner_", "") as La5Queue;
    const { error } = await db().from("queue_assignment_rule").upsert({ tenant_id: tenantId, queue_type: q, owner_role: next[q], updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,queue_type" });
    if (error) {
      if (error.code === "23514") throw new HubError(HUB_PENDING_MESSAGE, 503);
      throw new Error(error.message);
    }
  }
  await audit(tenantId, by, changes);
  return changes;
}
