import "server-only";

import { carrierFilter } from "@/lib/carriers/agency";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { moveLead } from "@/lib/applications/stageSyncService";
import { HUMAN_STAGE_SOURCES } from "@/lib/applications/stageSync";
import { agencyToday } from "@/lib/ingestion/agencyDay";
import { isRecordUuid } from "@/lib/ingestion/path";
import type { RuleRow } from "@/lib/ingestion/carrierRules";

import { computeEvents, OPEN_STATUSES, STATUS_EVENT_NAMES, policyKey, addDays, type ChangeFact, type LedgerFact, type PolicyFacts, type RuleEventFact } from "./events";
import { countOutcomes, doneKey, planRun, type Decision, type LeadState, type RuleSpec, type StageInfo } from "./plan";
import { DEFAULT_CAP_PER_RUN, DEFAULT_HAND_MOVE_DAYS, EVENT_LOOKBACK_DAYS, noteProblems, PIPELINE_RULES_PENDING_MESSAGE, RULE_EVENTS, type RuleEvent, type RuleMode } from "./rules";

/**
 * Setup › Pipeline rules, server side (owner 2026-11-02, docs/la4/SIMPLIFY-PROPOSAL.md §4): the rules and
 * their versions, a preview, the run, and what the run recorded. Every read and write filters on the
 * tenant. Before 20261102100000 every reader answers `available: false` and the run does nothing.
 *
 * The run: events (events.ts) → checks (plan.ts) → record. A forecast rule records "would move" and writes
 * nothing else. A live rule claims the change first (unique per change × rule × version × mode), then
 * moves the card through moveLead (the same move the application sync makes, source `pipeline_rule`),
 * then adds its note. A crash between the claim and the move leaves "claimed", never a second move.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class PipelineRulesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PipelineRulesError";
  }
}

function fail(error: { message: string; code?: string }, fallback: string): never {
  if (isSchemaGap(error)) throw new PipelineRulesError(PIPELINE_RULES_PENDING_MESSAGE, 503);
  if (error.code === "P0001") throw new PipelineRulesError(error.message, 409);
  if (error.code === "23514") throw new PipelineRulesError("That rule has a value it cannot hold.", 400);
  throw new Error(`${fallback}: ${error.message}`);
}

const CHUNK = 150;
const chunks = <T,>(list: T[], size = CHUNK): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
const DAY = 86_400_000;

/** Reads every page of a query (PostgREST hands back 1,000 rows at most), up to `max`. */
async function allPages(build: (from: number, to: number) => Loose, max = 20_000): Promise<{ data: Loose[]; error: Loose }> {
  const out: Loose[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}

// ─── shapes ─────────────────────────────────────────────────────────────────────────────────────────

export type RuleVersionRow = {
  id: string;
  version: number;
  event: RuleEvent;
  carrierIds: string[];
  fromStageIds: string[];
  targetPipelineId: string;
  targetStageId: string;
  noteOn: boolean;
  noteTemplate: string | null;
  createdAt: string;
  createdBy: string | null;
};

export type RuleRowView = {
  id: string;
  name: string;
  mode: RuleMode;
  enabled: boolean;
  currentVersion: number;
  liveSince: string | null;
  liveBy: string | null;
  createdAt: string;
  createdBy: string | null;
  current: RuleVersionRow | null;
};

export type BoardPipeline = { id: string; name: string; stages: Array<{ id: string; name: string; archived: boolean }> };
export type RuleSettings = { engineOn: boolean; capPerRun: number; handMoveDays: number };

const toVersion = (row: Loose): RuleVersionRow => ({
  id: row.id, version: row.version, event: row.event, carrierIds: row.carrier_ids ?? [], fromStageIds: row.from_stage_ids ?? [],
  targetPipelineId: row.target_pipeline_id, targetStageId: row.target_stage_id, noteOn: row.note_on, noteTemplate: row.note_template,
  createdAt: row.created_at, createdBy: row.created_by,
});

async function readSettings(tenantId: string): Promise<RuleSettings> {
  const { data, error } = await db().from("pipeline_rule_settings").select("engine_on, cap_per_run, hand_move_days").eq("tenant_id", tenantId).maybeSingle();
  if (error) fail(error, "Could not read the pipeline rule settings");
  return { engineOn: data?.engine_on ?? true, capPerRun: data?.cap_per_run ?? DEFAULT_CAP_PER_RUN, handMoveDays: data?.hand_move_days ?? DEFAULT_HAND_MOVE_DAYS };
}

/** The agency's rules, each with the version in force. */
async function readRules(tenantId: string, filter?: { ids?: string[]; active?: boolean }): Promise<RuleRowView[]> {
  let query = db().from("pipeline_rule").select("id, name, mode, enabled, current_version, live_since, live_by, created_at, created_by").eq("tenant_id", tenantId);
  if (filter?.ids) query = query.in("id", filter.ids);
  if (filter?.active) query = query.eq("enabled", true).in("mode", ["forecast", "live"]);
  const { data, error } = await query.order("created_at").limit(500);
  if (error) fail(error, "Could not read the pipeline rules");
  const rules = (data ?? []) as Loose[];
  if (!rules.length) return [];
  const versions = await db().from("pipeline_rule_version").select("*").eq("tenant_id", tenantId).in("rule_id", rules.map((r) => r.id)).limit(5000);
  if (versions.error) fail(versions.error, "Could not read the pipeline rule versions");
  const current = new Map<string, Loose>();
  const want = new Map(rules.map((r) => [r.id, r.current_version]));
  for (const v of (versions.data ?? []) as Loose[]) if (want.get(v.rule_id) === v.version) current.set(v.rule_id, v);
  return rules.map((r) => ({
    id: r.id, name: r.name, mode: r.mode, enabled: r.enabled, currentVersion: r.current_version, liveSince: r.live_since, liveBy: r.live_by,
    createdAt: r.created_at, createdBy: r.created_by, current: current.has(r.id) ? toVersion(current.get(r.id)) : null,
  }));
}

/** The agency's pipelines and their stages, for the form and for the checks. */
export async function loadBoard(tenantId: string): Promise<BoardPipeline[]> {
  const { data, error } = await db().from("tenant_pipelines").select("id, name, tenant_pipeline_stages(id, name, position, is_archived)").eq("tenant_id", tenantId).order("name");
  if (error) throw new Error(`Could not read the pipelines: ${error.message}`);
  return ((data ?? []) as Loose[]).map((p) => ({
    id: p.id, name: p.name,
    stages: ((p.tenant_pipeline_stages ?? []) as Loose[]).sort((a, b) => a.position - b.position).map((s) => ({ id: s.id, name: s.name, archived: Boolean(s.is_archived) })),
  }));
}

function stageMap(board: BoardPipeline[]): Map<string, StageInfo> {
  const map = new Map<string, StageInfo>();
  for (const p of board) for (const s of p.stages) map.set(s.id, { id: s.id, name: s.name, pipelineId: p.id, pipelineName: p.name, archived: s.archived });
  return map;
}

/**
 * LA-0.4: the carriers switched on in Settings › Carriers, plus any a rule already names (a carrier
 * switched off later keeps its rules readable and editable).
 */
export async function loadCarrierChoices(tenantId: string): Promise<Array<{ id: string; name: string }>> {
  const { data } = await db().from("pipeline_rule_version").select("carrier_ids").eq("tenant_id", tenantId).limit(5000);
  const named = ((data ?? []) as Loose[]).flatMap((row) => (row.carrier_ids ?? []) as string[]);
  return (await carrierFilter(tenantId, named)).map((c) => ({ id: c.id, name: c.name }));
}

// ─── the list page ──────────────────────────────────────────────────────────────────────────────────

export type RuleListItem = RuleRowView & { last7: { moved: number; wouldMove: number; held: number } };
export type RunSummaryRow = { id: string; trigger: string; startedAt: string; finishedAt: string | null; moved: number; wouldMove: number; skipped: number; held: number; cappedLive: number; cappedForecast: number; error: string | null };

export async function loadRulesList(tenantId: string): Promise<{ available: boolean; rules: RuleListItem[]; settings: RuleSettings; lastRun: RunSummaryRow | null; openHolds: number }> {
  const empty = { available: false, rules: [], settings: { engineOn: true, capPerRun: DEFAULT_CAP_PER_RUN, handMoveDays: DEFAULT_HAND_MOVE_DAYS }, lastRun: null, openHolds: 0 };
  try {
    const [rules, settings] = await Promise.all([readRules(tenantId), readSettings(tenantId)]);
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const [recent, run, holds] = await Promise.all([
      db().from("pipeline_rule_evaluation").select("rule_id, outcome").eq("tenant_id", tenantId).gte("evaluated_at", since).in("outcome", ["moved", "would_move", "held"]).limit(10_000),
      db().from("pipeline_rule_run").select("*").eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      db().from("pipeline_rule_hold").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("mode", "live").eq("status", "open"),
    ]);
    const counts = new Map<string, { moved: number; wouldMove: number; held: number }>();
    for (const row of (recent.data ?? []) as Loose[]) {
      const c = counts.get(row.rule_id) ?? { moved: 0, wouldMove: 0, held: 0 };
      if (row.outcome === "moved") c.moved += 1; else if (row.outcome === "would_move") c.wouldMove += 1; else c.held += 1;
      counts.set(row.rule_id, c);
    }
    return {
      available: true,
      rules: rules.map((r) => ({ ...r, last7: counts.get(r.id) ?? { moved: 0, wouldMove: 0, held: 0 } })),
      settings,
      lastRun: run.data ? toRun(run.data) : null,
      openHolds: holds.count ?? 0,
    };
  } catch (error) {
    if (error instanceof PipelineRulesError && error.status === 503) return empty;
    throw error;
  }
}

const toRun = (r: Loose): RunSummaryRow => ({ id: r.id, trigger: r.trigger, startedAt: r.started_at, finishedAt: r.finished_at, moved: r.moved, wouldMove: r.would_move, skipped: r.skipped, held: r.held, cappedLive: r.capped_live, cappedForecast: r.capped_forecast, error: r.error });

// ─── one rule's page ────────────────────────────────────────────────────────────────────────────────

export type EvaluationRow = {
  id: string;
  ruleId: string;
  ruleName: string | null;
  version: number;
  mode: "forecast" | "live";
  outcome: string;
  reason: string | null;
  event: RuleEvent;
  eventDate: string;
  carrierId: string;
  carrierName: string | null;
  policyNumber: string;
  leadId: string | null;
  leadName: string | null;
  fromStage: string | null;
  toStage: string | null;
  note: string | null;
  because: string | null;
  evaluatedAt: string;
  checked: "right" | "wrong" | null;
  checkedNote: string | null;
  undoneAt: string | null;
};

const leadPersonName = (values: Loose) => {
  if (!values || typeof values !== "object") return null;
  const part = (key: string) => (typeof values[key] === "string" ? values[key].trim() : "");
  return [part("first_name"), part("last_name")].filter(Boolean).join(" ") || part("full_name") || part("name") || null;
};

async function describeEvaluations(tenantId: string, rows: Loose[]): Promise<EvaluationRow[]> {
  if (!rows.length) return [];
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))] as string[];
  const ruleIds = [...new Set(rows.map((r) => r.rule_id))] as string[];
  const [board, carriers, rules, ...leadParts] = await Promise.all([
    loadBoard(tenantId),
    db().from("carriers").select("id, name").in("id", [...new Set(rows.map((r) => r.carrier_id))]),
    db().from("pipeline_rule").select("id, name").eq("tenant_id", tenantId).in("id", ruleIds),
    ...chunks(leadIds).map((part) => db().from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", part)),
  ]);
  const stages = stageMap(board);
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const ruleName = new Map<string, string>(((rules.data ?? []) as Loose[]).map((r) => [r.id, r.name]));
  const leadName = new Map<string, string | null>(leadParts.flatMap((part: Loose) => ((part.data ?? []) as Loose[]).map((l) => [l.id, leadPersonName(l.values)] as [string, string | null])));
  const label = (id: string | null) => (id && stages.has(id) ? `${stages.get(id)!.pipelineName} › ${stages.get(id)!.name}` : null);
  return rows.map((r) => ({
    id: r.id, ruleId: r.rule_id, ruleName: ruleName.get(r.rule_id) ?? null, version: r.version, mode: r.mode, outcome: r.outcome, reason: r.reason,
    event: r.event, eventDate: r.event_date, carrierId: r.carrier_id, carrierName: carrierName.get(r.carrier_id) ?? null, policyNumber: r.policy_number,
    leadId: r.lead_id, leadName: r.lead_id ? leadName.get(r.lead_id) ?? null : null, fromStage: label(r.from_stage_id), toStage: label(r.to_stage_id),
    note: r.note_body, because: (r.facts?.because as string | undefined) ?? null, evaluatedAt: r.evaluated_at, checked: r.checked, checkedNote: r.checked_note, undoneAt: r.undone_at,
  }));
}

export async function loadRule(tenantId: string, ruleId: string): Promise<{ available: boolean; rule: RuleRowView | null; versions: RuleVersionRow[]; forecast: EvaluationRow[]; recentLive: EvaluationRow[] }> {
  try {
    const [rule] = await readRules(tenantId, { ids: [ruleId] });
    if (!rule) return { available: true, rule: null, versions: [], forecast: [], recentLive: [] };
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const [versions, forecast, live] = await Promise.all([
      db().from("pipeline_rule_version").select("*").eq("tenant_id", tenantId).eq("rule_id", ruleId).order("version", { ascending: false }),
      db().from("pipeline_rule_evaluation").select("*").eq("tenant_id", tenantId).eq("rule_id", ruleId).eq("mode", "forecast").eq("outcome", "would_move").gte("evaluated_at", since).order("evaluated_at", { ascending: false }).limit(500),
      db().from("pipeline_rule_evaluation").select("*").eq("tenant_id", tenantId).eq("rule_id", ruleId).eq("mode", "live").gte("evaluated_at", since).order("evaluated_at", { ascending: false }).limit(200),
    ]);
    if (versions.error) fail(versions.error, "Could not read the versions");
    return {
      available: true,
      rule,
      versions: ((versions.data ?? []) as Loose[]).map(toVersion),
      forecast: await describeEvaluations(tenantId, (forecast.data ?? []) as Loose[]),
      recentLive: await describeEvaluations(tenantId, (live.data ?? []) as Loose[]),
    };
  } catch (error) {
    if (error instanceof PipelineRulesError && error.status === 503) return { available: false, rule: null, versions: [], forecast: [], recentLive: [] };
    throw error;
  }
}

/**
 * For a policy page's Pipeline tab (wired by its own builder): every move, forecast line, skip and hold
 * the rules recorded for this policy, newest first. `available: false` before 20261102100000.
 */
export async function loadPolicyRuleEvents(tenantId: string, carrierId: string, policyNumber: string): Promise<{ available: boolean; events: EvaluationRow[]; holds: HoldRow[] }> {
  const [evals, holds] = await Promise.all([
    db().from("pipeline_rule_evaluation").select("*").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("evaluated_at", { ascending: false }).limit(200),
    db().from("pipeline_rule_hold").select("*").eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("policy_number", policyNumber).order("created_at", { ascending: false }).limit(20),
  ]);
  if (evals.error) {
    if (isSchemaGap(evals.error)) return { available: false, events: [], holds: [] };
    throw new Error(`Could not read the policy's rule history: ${evals.error.message}`);
  }
  return { available: true, events: await describeEvaluations(tenantId, (evals.data ?? []) as Loose[]), holds: ((holds.data ?? []) as Loose[]).map(toHold) };
}

export type HoldRow = { id: string; mode: "forecast" | "live"; leadId: string | null; carrierId: string; policyNumber: string; options: Array<{ ruleId: string; ruleName: string; version: number; event: string; changeKey: string; toPipelineId: string; toStageId: string }>; status: string; createdAt: string };
const toHold = (h: Loose): HoldRow => ({
  id: h.id, mode: h.mode, leadId: h.lead_id, carrierId: h.carrier_id, policyNumber: h.policy_number, status: h.status, createdAt: h.created_at,
  options: ((h.options ?? []) as Loose[]).map((o) => ({ ruleId: o.rule_id, ruleName: o.rule_name, version: o.version, event: o.event, changeKey: o.change_key, toPipelineId: o.to_pipeline_id, toStageId: o.to_stage_id })),
});

/** For Needs you: live holds waiting for a person (two rules disagree). Null before 20261102100000. */
export async function countRuleHolds(tenantId: string): Promise<number | null> {
  const { count, error } = await db().from("pipeline_rule_hold").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("mode", "live").eq("status", "open");
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(`Could not count the rule holds: ${error.message}`);
  }
  return count ?? 0;
}

/** For Needs you: the open live holds, oldest first. */
export async function listRuleHolds(tenantId: string, limit = 100): Promise<{ available: boolean; holds: HoldRow[] }> {
  const { data, error } = await db().from("pipeline_rule_hold").select("*").eq("tenant_id", tenantId).eq("mode", "live").eq("status", "open").order("created_at").limit(limit);
  if (error) {
    if (isSchemaGap(error)) return { available: false, holds: [] };
    throw new Error(`Could not read the rule holds: ${error.message}`);
  }
  return { available: true, holds: ((data ?? []) as Loose[]).map(toHold) };
}

// ─── writing rules ──────────────────────────────────────────────────────────────────────────────────

export type Scope = { tenantId: string; userId: string };
export type RuleContent = { event: RuleEvent; carrierIds: string[]; fromStageIds: string[]; targetPipelineId: string; targetStageId: string; noteOn: boolean; noteTemplate: string | null };

async function checkContent(tenantId: string, content: RuleContent): Promise<void> {
  if (!(RULE_EVENTS as readonly string[]).includes(content.event)) throw new PipelineRulesError("Choose what happens.", 400);
  const problems = noteProblems(content.noteOn, content.noteTemplate);
  if (problems.length) throw new PipelineRulesError(problems[0], 400);
  const stages = stageMap(await loadBoard(tenantId));
  const target = stages.get(content.targetStageId);
  if (!target || target.pipelineId !== content.targetPipelineId) throw new PipelineRulesError("Choose a stage on that pipeline.", 400);
  if (target.archived) throw new PipelineRulesError("That stage is archived; choose one on the board.", 400);
  if (content.fromStageIds.some((id) => !stages.has(id))) throw new PipelineRulesError("A from-stage is no longer on the board.", 400);
  if (content.carrierIds.length) {
    const allowed = new Set((await loadCarrierChoices(tenantId)).map((c) => c.id));
    if (content.carrierIds.some((id) => !allowed.has(id))) throw new PipelineRulesError("Choose carriers from your carriers in Settings › Carriers.", 400);
  }
}

const versionRow = (scope: Scope, ruleId: string, version: number, c: RuleContent) => ({
  tenant_id: scope.tenantId, rule_id: ruleId, version, event: c.event, carrier_ids: [...new Set(c.carrierIds)], from_stage_ids: [...new Set(c.fromStageIds)],
  target_pipeline_id: c.targetPipelineId, target_stage_id: c.targetStageId, note_on: c.noteOn, note_template: c.noteTemplate?.trim() || null, created_by: scope.userId,
});

/** A new rule, version 1, in forecast (owner decision 3). */
export async function createRule(scope: Scope, input: { name: string; content: RuleContent; mode?: "draft" | "forecast" }): Promise<string> {
  await checkContent(scope.tenantId, input.content);
  const now = new Date().toISOString();
  const mode = input.mode ?? "forecast";
  const rule = await db().from("pipeline_rule").insert({ tenant_id: scope.tenantId, name: input.name.trim(), mode, enabled: true, current_version: 1, forecast_since: mode === "forecast" ? now : null, created_by: scope.userId, updated_by: scope.userId }).select("id").single();
  if (rule.error) fail(rule.error, "Could not save the rule");
  const version = await db().from("pipeline_rule_version").insert(versionRow(scope, rule.data.id, 1, input.content));
  if (version.error) fail(version.error, "Could not save the rule's first version");
  return rule.data.id as string;
}

/** A content change is a new version; the old one stays, with what it recorded. */
export async function saveVersion(scope: Scope, ruleId: string, input: { name: string; content: RuleContent }): Promise<number> {
  const [rule] = await readRules(scope.tenantId, { ids: [ruleId] });
  if (!rule) throw new PipelineRulesError("That rule is not in this workspace.", 404);
  await checkContent(scope.tenantId, input.content);
  const same = rule.current && JSON.stringify(contentOf(rule.current)) === JSON.stringify(normal(input.content));
  if (same) {
    if (input.name.trim() !== rule.name) await updateRule(scope, ruleId, { name: input.name.trim() });
    return rule.currentVersion;
  }
  const next = rule.currentVersion + 1;
  const version = await db().from("pipeline_rule_version").insert(versionRow(scope, ruleId, next, input.content));
  if (version.error) {
    if (version.error.code === "23505") throw new PipelineRulesError("Someone saved this rule a moment ago. Open it again.", 409);
    fail(version.error, "Could not save the new version");
  }
  await updateRule(scope, ruleId, { name: input.name.trim(), current_version: next });
  return next;
}

/**
 * A stage a person adds joins the starter rules' from-stages (owner 2026-11-05: "a new stage plus a rule… does
 * that lead go there automatically?" — and a card waiting on a new stage must still be moved on by Issued, In
 * force, Declined…). Starter rules move from every open stage, and from the sold stages of the other pipelines
 * (20261105120000); an owner's own rule is theirs and is left alone. Each change is a new version, never an edit.
 */
export async function addStageToStarterRules(scope: Scope, stageId: string): Promise<number> {
  const stage = (await db().from("tenant_pipeline_stages").select("id, pipeline_id, stage_type, is_archived, tenant_pipelines!inner(tenant_id, partner_type, is_default)").eq("id", stageId).eq("tenant_pipelines.tenant_id", scope.tenantId).maybeSingle()).data as Loose;
  if (!stage || stage.is_archived) return 0;
  const pipeline = Array.isArray(stage.tenant_pipelines) ? stage.tenant_pipelines[0] : stage.tenant_pipelines;
  const main = pipeline?.is_default && pipeline?.partner_type === null;
  if (!(stage.stage_type === "open" || (!main && stage.stage_type === "won"))) return 0;
  const { data: starters, error } = await db().from("pipeline_rule").select("id").eq("tenant_id", scope.tenantId).is("created_by", null);
  if (error) fail(error, "Could not read the starter rules");
  if (!starters?.length) return 0;
  let changed = 0;
  for (const rule of await readRules(scope.tenantId, { ids: ((starters ?? []) as Loose[]).map((r) => r.id) })) {
    const v = rule.current;
    if (!v || v.targetStageId === stageId || v.fromStageIds.includes(stageId)) continue;
    await saveVersion(scope, rule.id, { name: rule.name, content: { event: v.event, carrierIds: v.carrierIds, fromStageIds: [...v.fromStageIds, stageId], targetPipelineId: v.targetPipelineId, targetStageId: v.targetStageId, noteOn: v.noteOn, noteTemplate: v.noteTemplate } });
    changed++;
  }
  return changed;
}

const normal = (c: RuleContent) => ({ event: c.event, carrierIds: [...new Set(c.carrierIds)].sort(), fromStageIds: [...new Set(c.fromStageIds)].sort(), targetPipelineId: c.targetPipelineId, targetStageId: c.targetStageId, noteOn: c.noteOn, noteTemplate: c.noteTemplate?.trim() || null });
const contentOf = (v: RuleVersionRow) => normal({ event: v.event, carrierIds: v.carrierIds, fromStageIds: v.fromStageIds, targetPipelineId: v.targetPipelineId, targetStageId: v.targetStageId, noteOn: v.noteOn, noteTemplate: v.noteTemplate });

async function updateRule(scope: Scope, ruleId: string, patch: Record<string, unknown>) {
  const { data, error } = await db().from("pipeline_rule").update({ ...patch, updated_at: new Date().toISOString(), updated_by: scope.userId }).eq("tenant_id", scope.tenantId).eq("id", ruleId).select("id");
  if (error) fail(error, "Could not update the rule");
  if (!data?.length) throw new PipelineRulesError("That rule is not in this workspace.", 404);
}

/** Draft, forecast or live. Going live replays nothing unless `replay`: then the cards that qualify now move, once. */
export async function setMode(scope: Scope, ruleId: string, mode: RuleMode, replay = false): Promise<{ moved: number }> {
  const [rule] = await readRules(scope.tenantId, { ids: [ruleId] });
  if (!rule) throw new PipelineRulesError("That rule is not in this workspace.", 404);
  const now = new Date().toISOString();
  if (mode === "live" && rule.mode !== "live") {
    await updateRule(scope, ruleId, { mode: "live", live_since: now, live_by: scope.userId, enabled: true });
    if (!replay) return { moved: 0 };
    const run = await runPipelineRules(scope.tenantId, "switch_live", { onlyRuleId: ruleId, replay: true });
    return { moved: run.moved };
  }
  if (mode !== "live") await updateRule(scope, ruleId, { mode, live_since: null, ...(mode === "forecast" && rule.mode !== "forecast" ? { forecast_since: now } : {}) });
  return { moved: 0 };
}

/** Off and on are not a new version. */
export async function setEnabled(scope: Scope, ruleId: string, enabled: boolean): Promise<void> {
  await updateRule(scope, ruleId, { enabled });
}

/** A copy as a new rule in forecast, version 1, named "… (copy)". */
export async function duplicateRule(scope: Scope, ruleId: string): Promise<string> {
  const [rule] = await readRules(scope.tenantId, { ids: [ruleId] });
  if (!rule?.current) throw new PipelineRulesError("That rule is not in this workspace.", 404);
  const v = rule.current;
  return createRule(scope, { name: `${rule.name} (copy)`.slice(0, 120), content: { event: v.event, carrierIds: v.carrierIds, fromStageIds: v.fromStageIds, targetPipelineId: v.targetPipelineId, targetStageId: v.targetStageId, noteOn: v.noteOn, noteTemplate: v.noteTemplate } });
}

/** A person says whether a forecast line was right; "wrong" may say why. */
export async function checkEvaluation(scope: Scope, evaluationId: string, verdict: "right" | "wrong" | null, note: string | null): Promise<void> {
  const { data, error } = await db().from("pipeline_rule_evaluation").update({ checked: verdict, checked_note: verdict ? note?.trim() || null : null, checked_by: verdict ? scope.userId : null, checked_at: verdict ? new Date().toISOString() : null })
    .eq("tenant_id", scope.tenantId).eq("id", evaluationId).eq("mode", "forecast").select("id");
  if (error) fail(error, "Could not save the check");
  if (!data?.length) throw new PipelineRulesError("Only a forecast line can be checked.", 404);
}

/** Every move can be undone: the card goes back where it was (if nobody moved it since) and the note goes. */
export async function undoMove(scope: Scope, evaluationId: string): Promise<void> {
  const { data: row, error } = await db().from("pipeline_rule_evaluation").select("*").eq("tenant_id", scope.tenantId).eq("id", evaluationId).maybeSingle();
  if (error) fail(error, "Could not read the move");
  if (!row || row.outcome !== "moved") throw new PipelineRulesError("Only a move a rule made can be undone.", 404);
  if (row.undone_at) throw new PipelineRulesError("That move was already undone.", 409);
  if (!row.lead_id || !row.from_stage_id || !row.from_pipeline_id) throw new PipelineRulesError("The card had no stage before the move, so there is nowhere to put it back.", 409);
  const back = await moveLead(scope.tenantId, { leadId: row.lead_id, fromPipelineId: row.to_pipeline_id, fromStageId: row.to_stage_id, toPipelineId: row.from_pipeline_id, toStageId: row.from_stage_id, actorUserId: scope.userId, source: "pipeline_rule" });
  if (!back.moved) throw new PipelineRulesError("The card has moved since; move it by hand from the lead.", 409);
  if (row.note_id) await db().from("tenant_lead_notes").update({ deleted_at: new Date().toISOString() }).eq("tenant_id", scope.tenantId).eq("id", row.note_id);
  const mark = await db().from("pipeline_rule_evaluation").update({ undone_at: new Date().toISOString(), undone_by: scope.userId }).eq("tenant_id", scope.tenantId).eq("id", evaluationId);
  if (mark.error) fail(mark.error, "The card went back, but the undo could not be recorded");
}

/** A person settles two rules that disagree: the chosen rule's move is made (live), or nothing moves. */
export async function resolveHold(scope: Scope, holdId: string, chosenRuleId: string | null): Promise<void> {
  const { data: hold, error } = await db().from("pipeline_rule_hold").select("*").eq("tenant_id", scope.tenantId).eq("id", holdId).eq("status", "open").maybeSingle();
  if (error) fail(error, "Could not read the hold");
  if (!hold) throw new PipelineRulesError("That hold is already settled.", 404);
  const option = chosenRuleId ? ((hold.options ?? []) as Loose[]).find((o) => o.rule_id === chosenRuleId) : null;
  if (chosenRuleId && !option) throw new PipelineRulesError("Choose one of the rules that disagree.", 400);
  if (option && hold.mode === "live" && hold.lead_id) {
    const { data: lead } = await db().from("agent_leads").select("id, pipeline_id, stage_id").eq("tenant_id", scope.tenantId).eq("id", hold.lead_id).maybeSingle();
    if (lead && lead.stage_id !== option.to_stage_id) {
      const moved = await moveLead(scope.tenantId, { leadId: lead.id, fromPipelineId: lead.pipeline_id, fromStageId: lead.stage_id, toPipelineId: option.to_pipeline_id, toStageId: option.to_stage_id, actorUserId: scope.userId, source: "pipeline_rule" });
      if (!moved.moved) throw new PipelineRulesError("The card moved while you decided; open it again.", 409);
    }
  }
  const { error: done } = await db().from("pipeline_rule_hold").update({ status: option ? "resolved" : "dismissed", chosen_rule_id: option ? chosenRuleId : null, resolved_at: new Date().toISOString(), resolved_by: scope.userId }).eq("tenant_id", scope.tenantId).eq("id", holdId).eq("status", "open");
  if (done) fail(done, "Could not settle the hold");
}

// ─── the world a run reads ──────────────────────────────────────────────────────────────────────────

type World = { asOf: string; events: RuleEventFact[]; carriersWithoutGrace: string[]; leads: Map<string, LeadState | null>; stages: Map<string, StageInfo> };

const POLICY_COLUMNS = "carrier_id, policy_number, status_normalized, carrier_status_raw, paid_to_date, effective_date, issued_on, issue_date, first_seen_date, premium_cents, case_id, application_id";
const toPolicy = (r: Loose): PolicyFacts => ({
  carrierId: r.carrier_id, policyNumber: r.policy_number, status: r.status_normalized, carrierStatusRaw: r.carrier_status_raw, paidToDate: r.paid_to_date,
  effectiveDate: r.effective_date, issuedOn: r.issued_on, issueDate: r.issue_date, firstSeenDate: r.first_seen_date, premiumCents: r.premium_cents === null ? null : Number(r.premium_cents), caseId: r.case_id, applicationId: r.application_id,
});
const toCarrierRule = (row: Loose): RuleRow => ({ id: row.id, tenantId: row.tenant_id, carrierId: row.carrier_id, ruleType: row.rule_type, windowDays: row.window_days, graceDays: row.grace_days, redraftAttempts: row.redraft_attempts, redraftIntervalDays: row.redraft_interval_days, source: row.source, notes: row.notes, effectiveFrom: row.effective_from, createdAt: row.created_at, cleared: row.cleared, verifiedAt: row.verified_at });

/** Everything the checks need, read once per run with the tenant on every query. */
async function readWorld(tenantId: string, wanted: Set<RuleEvent>, handMoveDays: number): Promise<World> {
  const asOf = await agencyToday(tenantId);
  const since = addDays(asOf, -EVENT_LOOKBACK_DAYS);
  const needStatus = [...wanted].some((e) => STATUS_EVENT_NAMES.includes(e));
  const needChanges = needStatus || [...wanted].some((e) => ["paid_again", "cancelled"].includes(e));
  const needLedger = [...wanted].some((e) => ["advance_received", "commission_credited", "chargeback_received"].includes(e));

  const [open, issued, seen, changes, ledger, carrierRules, carriers, board] = await Promise.all([
    allPages((from, to) => db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", tenantId).in("status_normalized", [...OPEN_STATUSES]).order("carrier_id").order("policy_number").range(from, to)),
    // Issued in the look-back by a change (issued_on), or first seen already issued (the carrier's issue date): issuedDay().
    wanted.has("issued") ? allPages((from, to) => db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", tenantId).or(`issued_on.gte.${since},issue_date.gte.${since}`).order("carrier_id").order("policy_number").range(from, to)) : Promise.resolve({ data: [], error: null }),
    // First seen in the look-back, at any status (closed ones included): the file that brought the policy is its status event.
    needStatus ? allPages((from, to) => db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", tenantId).gte("first_seen_date", since).order("carrier_id").order("policy_number").range(from, to)) : Promise.resolve({ data: [], error: null }),
    needChanges ? allPages((from, to) => db().from("policy_change").select("carrier_id, policy_number, field_name, old_value, new_value, from_snapshot_date, to_snapshot_date").eq("tenant_id", tenantId).gte("to_snapshot_date", since).in("field_name", ["status_normalized", "paid_to_date", "termination_date", "carrier_status_raw"]).order("to_snapshot_date", { ascending: false }).order("id").range(from, to)) : Promise.resolve({ data: [], error: null }),
    needLedger ? allPages((from, to) => db().from("commission_entry").select("id, carrier_id, policy_number, entry_type, amount_cents, transaction_date, statement_date, created_at, reverses_entry_id").eq("tenant_id", tenantId).gte("created_at", `${since}T00:00:00Z`).in("entry_type", ["advance", "earned", "chargeback", "reversal"]).order("created_at").order("id").range(from, to)) : Promise.resolve({ data: [], error: null }),
    db().from("carrier_retention_rule").select("*").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).limit(5000),
    db().from("carriers").select("id, name"),
    loadBoard(tenantId),
  ]);
  for (const read of [open, issued, seen, changes, ledger]) if (read.error && !isSchemaGap(read.error)) throw new Error(`Could not read the book for the pipeline rules: ${read.error.message}`);

  const policies = new Map<string, PolicyFacts>();
  for (const r of [...open.data, ...issued.data, ...seen.data]) policies.set(policyKey(r.carrier_id, r.policy_number), toPolicy(r));
  const changeFacts: ChangeFact[] = (changes.data as Loose[]).map((c) => ({ carrierId: c.carrier_id, policyNumber: c.policy_number, field: c.field_name, oldValue: c.old_value, newValue: c.new_value, fromDate: c.from_snapshot_date, toDate: c.to_snapshot_date }));
  const ledgerFacts: LedgerFact[] = (ledger.data as Loose[]).map((l) => ({ id: l.id, carrierId: l.carrier_id, policyNumber: l.policy_number, entryType: l.entry_type, amountCents: Number(l.amount_cents), date: l.transaction_date ?? l.statement_date ?? String(l.created_at).slice(0, 10), reversesEntryId: l.reverses_entry_id }));

  // The policies a change or a statement line names that are no longer open: read them by number.
  const missing = new Map<string, string[]>();
  for (const f of [...changeFacts, ...ledgerFacts]) {
    if (policies.has(policyKey(f.carrierId, f.policyNumber))) continue;
    missing.set(f.carrierId, [...new Set([...(missing.get(f.carrierId) ?? []), f.policyNumber])]);
  }
  // Links made inside the look-back: a policy linked to its lead after its file was read raises its status then.
  const linked = needStatus
    ? await allPages((from, to) => db().from("policy_match").select("carrier_id, policy_number, created_at").eq("tenant_id", tenantId).is("superseded_by_id", null).in("matched_to_type", ["application", "deal_flow"]).gte("created_at", `${since}T00:00:00Z`).order("created_at").order("id").range(from, to))
    : { data: [], error: null };
  if (linked.error && !isSchemaGap(linked.error)) throw new Error(`Could not read the policy links for the pipeline rules: ${linked.error.message}`);
  const linkedOn = new Map<string, string>();
  for (const l of (linked.data ?? []) as Loose[]) {
    const k = policyKey(l.carrier_id, l.policy_number);
    linkedOn.set(k, String(l.created_at).slice(0, 10));
    if (!policies.has(k)) missing.set(l.carrier_id, [...new Set([...(missing.get(l.carrier_id) ?? []), l.policy_number])]);
  }
  for (const [carrierId, numbers] of missing) {
    for (const part of chunks(numbers)) {
      const { data } = await db().from("policy_current").select(POLICY_COLUMNS).eq("tenant_id", tenantId).eq("carrier_id", carrierId).in("policy_number", part);
      for (const r of (data ?? []) as Loose[]) policies.set(policyKey(r.carrier_id, r.policy_number), toPolicy(r));
    }
  }

  const computed = computeEvents({
    tenantId, asOf, policies: [...policies.values()].map((p) => ({ ...p, linkedOn: linkedOn.get(policyKey(p.carrierId, p.policyNumber)) ?? null })), changes: changeFacts, ledger: ledgerFacts,
    carrierRules: carrierRules.error ? [] : ((carrierRules.data ?? []) as Loose[]).map(toCarrierRule),
    carrierNames: new Map(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name])),
  });
  const events = computed.events.filter((e) => wanted.has(e.event));

  // Each policy's lead: through its case, else its application.
  const involved = new Map<string, PolicyFacts>();
  for (const e of events) { const p = policies.get(policyKey(e.carrierId, e.policyNumber)); if (p) involved.set(policyKey(p.carrierId, p.policyNumber), p); }
  const openPolicies = [...policies.values()].filter((p) => (OPEN_STATUSES as readonly string[]).includes(p.status ?? ""));
  const linkSource = [...involved.values(), ...openPolicies];
  const caseIds = [...new Set(linkSource.map((p) => p.caseId).filter(Boolean))] as string[];
  const appIds = [...new Set(linkSource.map((p) => p.applicationId).filter(Boolean))] as string[];
  const caseLead = new Map<string, string>();
  const appLead = new Map<string, string>();
  for (const part of chunks(caseIds)) {
    const { data } = await db().from("tenant_application_cases").select("id, lead_id").eq("tenant_id", tenantId).in("id", part);
    for (const c of (data ?? []) as Loose[]) if (c.lead_id) caseLead.set(c.id, c.lead_id);
  }
  for (const part of chunks(appIds)) {
    const { data } = await db().from("tenant_applications").select("id, lead_id").eq("tenant_id", tenantId).in("id", part);
    for (const a of (data ?? []) as Loose[]) if (a.lead_id) appLead.set(a.id, a.lead_id);
  }
  // A policy linked to the sale (deal_flow) rather than the application — by a person in the review queue, or by
  // our own issued-policy number (ladder step 2) — carries no case or application on its snapshot. Its lead is
  // the sale's (E2E 2026-11-05: Quinn Testmore, linked by hand, was never seen by any rule).
  const linkLead = new Map<string, string>();
  const unresolved = linkSource.filter((p) => !((p.caseId && caseLead.get(p.caseId)) || (p.applicationId && appLead.get(p.applicationId))));
  if (unresolved.length) {
    const wanted = new Set(unresolved.map((p) => policyKey(p.carrierId, p.policyNumber)));
    const links: Loose[] = [];
    for (const part of chunks([...new Set(unresolved.map((p) => p.policyNumber))])) {
      const { data, error } = await db().from("policy_match").select("carrier_id, policy_number, matched_to_type, matched_to_id").eq("tenant_id", tenantId).is("superseded_by_id", null).in("matched_to_type", ["deal_flow", "application"]).in("policy_number", part);
      if (error) fail(error, "Could not read the policy links");
      for (const l of (data ?? []) as Loose[]) if (wanted.has(policyKey(l.carrier_id, l.policy_number)) && l.matched_to_id) links.push(l);
    }
    const leadById = new Map<string, string>();
    for (const [table, type] of [["deal_flow", "deal_flow"], ["tenant_applications", "application"]] as const) {
      const ids = [...new Set(links.filter((l) => l.matched_to_type === type).map((l) => l.matched_to_id as string))];
      for (const part of chunks(ids)) {
        const { data } = await db().from(table).select("id, lead_id").eq("tenant_id", tenantId).in("id", part);
        for (const r of (data ?? []) as Loose[]) if (r.lead_id) leadById.set(`${type}:${r.id}`, r.lead_id);
      }
    }
    for (const l of links) {
      const lead = leadById.get(`${l.matched_to_type}:${l.matched_to_id}`);
      if (lead) linkLead.set(policyKey(l.carrier_id, l.policy_number), lead);
    }
  }
  const leadOf = (p: PolicyFacts) => (p.caseId && caseLead.get(p.caseId)) || (p.applicationId && appLead.get(p.applicationId)) || linkLead.get(policyKey(p.carrierId, p.policyNumber)) || null;
  const openByLead = new Map<string, string[]>();
  for (const p of openPolicies) {
    const lead = leadOf(p);
    if (lead) openByLead.set(lead, [...(openByLead.get(lead) ?? []), policyKey(p.carrierId, p.policyNumber)]);
  }

  const leadIds = [...new Set([...involved.values()].map(leadOf).filter(Boolean))] as string[];
  const cards = new Map<string, Loose>();
  const handMoves = new Map<string, string>();
  const handSince = new Date(Date.now() - Math.max(handMoveDays, 1) * DAY).toISOString();
  for (const part of chunks(leadIds)) {
    const [leads, moves] = await Promise.all([
      db().from("agent_leads").select("id, pipeline_id, stage_id").eq("tenant_id", tenantId).in("id", part),
      db().from("tenant_lead_stage_events").select("lead_id, created_at").eq("tenant_id", tenantId).in("lead_id", part).in("source", [...HUMAN_STAGE_SOURCES]).gte("created_at", handSince).order("created_at", { ascending: false }).limit(2000),
    ]);
    for (const l of (leads.data ?? []) as Loose[]) cards.set(l.id, l);
    for (const m of (moves.data ?? []) as Loose[]) if (!handMoves.has(m.lead_id)) handMoves.set(m.lead_id, new Date(m.created_at).toISOString());
  }
  const leads = new Map<string, LeadState | null>();
  for (const [key, p] of involved) {
    const id = leadOf(p);
    const card = id ? cards.get(id) : null;
    leads.set(key, card ? { leadId: card.id, pipelineId: card.pipeline_id, stageId: card.stage_id, lastHandMoveAt: handMoves.get(card.id) ?? null, openPolicies: openByLead.get(card.id) ?? [] } : null);
  }
  return { asOf, events, carriersWithoutGrace: computed.carriersWithoutGrace, leads, stages: stageMap(board) };
}

function specOf(rule: RuleRowView): RuleSpec | null {
  const v = rule.current;
  if (!v) return null;
  // A live rule acts on what happened since it went live, and since its version (a change replays nothing).
  const since = rule.liveSince ? [rule.liveSince.slice(0, 10), v.createdAt.slice(0, 10)].sort().at(-1) ?? null : null;
  return { ruleId: rule.id, name: rule.name, mode: rule.mode, enabled: rule.enabled, versionId: v.id, version: v.version, event: v.event, carrierIds: v.carrierIds, fromStageIds: v.fromStageIds, targetPipelineId: v.targetPipelineId, targetStageId: v.targetStageId, noteOn: v.noteOn, noteTemplate: v.noteTemplate, since };
}

async function readDone(tenantId: string, specs: RuleSpec[], events: RuleEventFact[]): Promise<Set<string>> {
  const done = new Set<string>();
  const keys = [...new Set(events.filter((e) => specs.some((s) => s.event === e.event)).map((e) => e.changeKey))];
  // A rule being previewed before it is saved ("preview") has done nothing yet, and rule_id is a uuid column:
  // asking for it made every preview with an event in it fail (E2E 2026-11-02).
  const ruleIds = [...new Set(specs.map((s) => s.ruleId))].filter(isRecordUuid);
  if (!keys.length || !ruleIds.length) return done;
  for (const part of chunks(keys, 100)) {
    const { data, error } = await db().from("pipeline_rule_evaluation").select("rule_id, version, mode, change_key").eq("tenant_id", tenantId).in("rule_id", ruleIds).in("change_key", part).limit(10_000);
    if (error) fail(error, "Could not read what the rules already did");
    for (const r of (data ?? []) as Loose[]) done.add(doneKey(r.rule_id, r.version, r.mode, r.change_key));
  }
  return done;
}

// ─── preview: the same checks, nothing written ──────────────────────────────────────────────────────

export type PreviewLine = Pick<Decision, "outcome" | "reason" | "event" | "eventDate" | "carrierId" | "policyNumber" | "leadId" | "note" | "because"> & { carrierName: string | null; leadName: string | null; fromStage: string | null; toStage: string | null };
export type Preview = { available: boolean; asOf: string; lines: PreviewLine[]; counts: Record<Decision["outcome"], number>; carriersWithoutGrace: string[] };

/**
 * What a rule (saved, or the form as it stands) would do on today's data: would move, or skipped and
 * why. The other rules that are on take part, so a disagreement shows as held. `asLive` previews it as
 * a live rule with every card that qualifies now (the Switch to live count).
 */
export async function previewRule(tenantId: string, input: { ruleId?: string | null; name?: string; content?: RuleContent; asLive?: boolean }): Promise<Preview> {
  const empty: Preview = { available: false, asOf: "", lines: [], counts: { move: 0, skip: 0, hold: 0, wait: 0, capped: 0 }, carriersWithoutGrace: [] };
  let rules: RuleRowView[];
  let settings: RuleSettings;
  try {
    [rules, settings] = await Promise.all([readRules(tenantId), readSettings(tenantId)]);
  } catch (error) {
    if (error instanceof PipelineRulesError && error.status === 503) return empty;
    throw error;
  }
  const saved = input.ruleId ? rules.find((r) => r.id === input.ruleId) ?? null : null;
  if (input.ruleId && !saved) throw new PipelineRulesError("That rule is not in this workspace.", 404);
  const previewId = saved?.id ?? "preview";
  let spec: RuleSpec | null;
  if (input.content) {
    if (!(RULE_EVENTS as readonly string[]).includes(input.content.event)) throw new PipelineRulesError("Choose what happens.", 400);
    const unchanged = saved?.current && JSON.stringify(contentOf(saved.current)) === JSON.stringify(normal(input.content));
    spec = {
      ruleId: previewId, name: input.name?.trim() || saved?.name || "This rule", mode: saved?.mode ?? "forecast", enabled: true,
      versionId: unchanged ? saved!.current!.id : "draft", version: unchanged ? saved!.currentVersion : (saved?.currentVersion ?? 0) + 1,
      event: input.content.event, carrierIds: input.content.carrierIds, fromStageIds: input.content.fromStageIds, targetPipelineId: input.content.targetPipelineId,
      targetStageId: input.content.targetStageId, noteOn: input.content.noteOn, noteTemplate: input.content.noteTemplate, since: saved ? specOf(saved)?.since ?? null : null,
    };
  } else {
    spec = saved ? specOf(saved) : null;
  }
  if (!spec) throw new PipelineRulesError("Choose what happens and where the card goes.", 400);
  if (input.asLive) spec = { ...spec, mode: "live", since: null };

  const others = rules.filter((r) => r.id !== previewId && r.enabled && r.mode !== "draft").map(specOf).filter((s): s is RuleSpec => Boolean(s));
  const all = [spec, ...others];
  const world = await readWorld(tenantId, new Set(all.map((s) => s.event)), settings.handMoveDays);
  const done = await readDone(tenantId, all, world.events);
  const plan = planRun({ now: new Date().toISOString(), rules: all, events: world.events, leads: world.leads, stages: world.stages, done, cap: settings.capPerRun, handMoveDays: settings.handMoveDays, previewRuleId: spec.ruleId, replay: input.asLive ? new Set([spec.ruleId]) : undefined });
  const mine = plan.decisions.filter((d) => d.ruleId === spec!.ruleId);
  const lines = await describeDecisions(tenantId, mine, world.stages);
  return { available: true, asOf: world.asOf, lines, counts: countOutcomes(mine), carriersWithoutGrace: world.carriersWithoutGrace.filter((id) => !spec!.carrierIds.length || spec!.carrierIds.includes(id)) };
}

async function describeDecisions(tenantId: string, decisions: Decision[], stages: Map<string, StageInfo>): Promise<PreviewLine[]> {
  const leadIds = [...new Set(decisions.map((d) => d.leadId).filter(Boolean))] as string[];
  const [carriers, ...leadParts] = await Promise.all([
    db().from("carriers").select("id, name"),
    ...chunks(leadIds).map((part) => db().from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", part)),
  ]);
  const carrierName = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  const leadName = new Map<string, string | null>(leadParts.flatMap((part: Loose) => ((part.data ?? []) as Loose[]).map((l) => [l.id, leadPersonName(l.values)] as [string, string | null])));
  const label = (id: string | null) => (id && stages.has(id) ? `${stages.get(id)!.pipelineName} › ${stages.get(id)!.name}` : null);
  const order: Record<Decision["outcome"], number> = { move: 0, hold: 1, capped: 2, skip: 3, wait: 4 };
  return decisions
    .sort((a, b) => order[a.outcome] - order[b.outcome] || b.eventDate.localeCompare(a.eventDate))
    .map((d) => ({ outcome: d.outcome, reason: d.reason, event: d.event, eventDate: d.eventDate, carrierId: d.carrierId, policyNumber: d.policyNumber, leadId: d.leadId, note: d.note, because: d.because, carrierName: carrierName.get(d.carrierId) ?? null, leadName: d.leadId ? leadName.get(d.leadId) ?? null : null, fromStage: label(d.fromStageId), toStage: label(d.toStageId) }));
}

// ─── the run ────────────────────────────────────────────────────────────────────────────────────────

export type RunTrigger = "file" | "daily" | "manual" | "switch_live" | "link";
export type RunOutcome = { available: boolean; ran: boolean; moved: number; wouldMove: number; skipped: number; held: number; capped: { forecast: number; live: number }; reason?: string };

const NOTHING: RunOutcome = { available: true, ran: false, moved: 0, wouldMove: 0, skipped: 0, held: 0, capped: { forecast: 0, live: 0 } };

/**
 * Evaluate the agency's rules that are on (forecast or live) and record what they did. Guarded: before
 * 20261102100000, with the engine off, with no rule on, or while another run is going, it does nothing.
 * Never throws for a missing table; a failure in one move is recorded on that line.
 */
export async function runPipelineRules(tenantId: string, trigger: RunTrigger, options: { onlyRuleId?: string; replay?: boolean } = {}): Promise<RunOutcome> {
  const active = await db().from("pipeline_rule").select("id").eq("tenant_id", tenantId).eq("enabled", true).in("mode", ["forecast", "live"]).limit(1);
  if (active.error) {
    if (isSchemaGap(active.error)) return { ...NOTHING, available: false, reason: PIPELINE_RULES_PENDING_MESSAGE };
    throw new Error(`Could not read the pipeline rules: ${active.error.message}`);
  }
  if (!active.data?.length) return { ...NOTHING, reason: "No rule is on" };
  const settings = await readSettings(tenantId);
  if (!settings.engineOn) return { ...NOTHING, reason: "Pipeline rules are switched off for this agency" };
  const busy = await db().from("pipeline_rule_run").select("id").eq("tenant_id", tenantId).is("finished_at", null).gte("started_at", new Date(Date.now() - 5 * 60_000).toISOString()).limit(1);
  if (busy.data?.length && trigger !== "switch_live") return { ...NOTHING, reason: "Another run is going" };

  const rules = await readRules(tenantId, { active: true });
  const specs = rules.map(specOf).filter((s): s is RuleSpec => Boolean(s));
  if (!specs.length) return { ...NOTHING, reason: "No rule is on" };
  // Author of a rule's note (the note table needs a person): who switched it live, else who wrote it.
  const author = new Map(rules.map((r) => [r.id, r.liveBy ?? r.current?.createdBy ?? r.createdBy]));

  const run = await db().from("pipeline_rule_run").insert({ tenant_id: tenantId, trigger }).select("id").single();
  if (run.error) fail(run.error, "Could not start the pipeline rules run");
  const runId = run.data.id as string;
  const totals = { moved: 0, wouldMove: 0, skipped: 0, held: 0 };
  let capped = { forecast: 0, live: 0 };
  let failure: string | null = null;
  try {
    const world = await readWorld(tenantId, new Set(specs.map((s) => s.event)), settings.handMoveDays);
    const done = await readDone(tenantId, specs, world.events);
    const plan = planRun({ now: new Date().toISOString(), rules: specs, events: world.events, leads: world.leads, stages: world.stages, done, cap: settings.capPerRun, handMoveDays: settings.handMoveDays, replay: options.replay && options.onlyRuleId ? new Set([options.onlyRuleId]) : undefined });
    capped = plan.capped;
    // A switch to live with "move the cards that qualify now" acts for that rule alone.
    const decisions = options.onlyRuleId ? plan.decisions.filter((d) => d.ruleId === options.onlyRuleId) : plan.decisions;
    const row = (d: Decision, outcome: string, extra: Record<string, unknown> = {}) => ({
      tenant_id: tenantId, rule_id: d.ruleId, version_id: d.versionId, version: d.version, mode: d.mode, run_id: runId, change_key: d.changeKey,
      event: d.event, event_date: d.eventDate, carrier_id: d.carrierId, policy_number: d.policyNumber, lead_id: d.leadId, outcome, reason: d.reason.slice(0, 500),
      from_pipeline_id: d.fromPipelineId, from_stage_id: d.fromStageId, to_pipeline_id: d.toPipelineId, to_stage_id: d.toStageId,
      note_body: d.note, facts: { because: d.because, ...d.fills }, ...extra,
    });

    // Forecast lines and every skip and hold: written in bulk, once only (the unique key ignores a repeat).
    const bulk = decisions.filter((d) => d.outcome === "skip" || d.outcome === "hold" || (d.outcome === "move" && d.mode === "forecast"))
      .map((d) => row(d, d.outcome === "move" ? "would_move" : d.outcome === "hold" ? "held" : "skipped", d.outcome === "move" ? {} : { note_body: null }));
    for (const part of chunks(bulk, 200)) {
      const { error } = await db().from("pipeline_rule_evaluation").upsert(part, { onConflict: "tenant_id,rule_id,version,mode,change_key", ignoreDuplicates: true });
      if (error) fail(error, "Could not record what the rules did");
    }
    for (const d of decisions) {
      if (d.outcome === "skip") totals.skipped += 1;
      if (d.outcome === "hold") totals.held += 1;
      if (d.outcome === "move" && d.mode === "forecast") totals.wouldMove += 1;
    }

    // Holds: one open hold per card and mode, for a person to settle.
    const holds = new Map<string, Decision[]>();
    for (const d of decisions.filter((x) => x.outcome === "hold" && x.leadId)) holds.set(`${d.mode}|${d.leadId}`, [...(holds.get(`${d.mode}|${d.leadId}`) ?? []), d]);
    for (const group of holds.values()) {
      const first = group[0];
      const { error } = await db().from("pipeline_rule_hold").insert({
        tenant_id: tenantId, mode: first.mode, run_id: runId, lead_id: first.leadId, carrier_id: first.carrierId, policy_number: first.policyNumber,
        options: group.map((d) => ({ rule_id: d.ruleId, rule_name: d.ruleName, version: d.version, event: d.event, change_key: d.changeKey, to_pipeline_id: d.toPipelineId, to_stage_id: d.toStageId })),
      });
      if (error && error.code !== "23505") console.error("[pipeline-rules] a hold could not be recorded", error.message);
    }

    // Live moves: claim, move, note.
    for (const d of decisions.filter((x) => x.outcome === "move" && x.mode === "live")) {
      const claim = await db().from("pipeline_rule_evaluation").insert(row(d, "claimed")).select("id").single();
      if (claim.error) {
        if (claim.error.code === "23505") continue;
        fail(claim.error, "Could not claim a move");
      }
      const id = claim.data.id as string;
      try {
        const moved = await moveLead(tenantId, { leadId: d.leadId!, fromPipelineId: d.fromPipelineId, fromStageId: d.fromStageId, toPipelineId: d.toPipelineId, toStageId: d.toStageId, actorUserId: null, source: "pipeline_rule" });
        if (!moved.moved) {
          await db().from("pipeline_rule_evaluation").update({ outcome: "skipped", reason: "The card moved while the rule ran" }).eq("tenant_id", tenantId).eq("id", id);
          totals.skipped += 1;
          continue;
        }
        let noteId: string | null = null;
        const by = author.get(d.ruleId);
        if (d.note && by) {
          const note = await db().from("tenant_lead_notes").insert({ tenant_id: tenantId, lead_id: d.leadId, author_user_id: by, body: d.note.slice(0, 10_000), visibility: "internal", idempotency_key: `pipeline_rule:${id}` }).select("id").single();
          if (note.error) console.error("[pipeline-rules] the note could not be added", note.error.message);
          else noteId = note.data.id as string;
        }
        await db().from("pipeline_rule_evaluation").update({ outcome: "moved", note_id: noteId, ...(d.note && !noteId ? { reason: `${d.reason} · the note could not be added` } : {}) }).eq("tenant_id", tenantId).eq("id", id);
        totals.moved += 1;
      } catch (error) {
        await db().from("pipeline_rule_evaluation").update({ outcome: "failed", reason: (error instanceof Error ? error.message : String(error)).slice(0, 500) }).eq("tenant_id", tenantId).eq("id", id);
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    console.error("[pipeline-rules] the run stopped", tenantId, error);
  } finally {
    await db().from("pipeline_rule_run").update({ finished_at: new Date().toISOString(), moved: totals.moved, would_move: totals.wouldMove, skipped: totals.skipped, held: totals.held, capped_live: capped.live, capped_forecast: capped.forecast, error: failure ? failure.slice(0, 2000) : null }).eq("tenant_id", tenantId).eq("id", runId);
  }
  return { available: true, ran: true, ...totals, capped, reason: failure ?? undefined };
}

/** The morning date check, every agency with a rule on (the cron route). */
export async function runAllAgencies(trigger: RunTrigger, budgetMs = 50_000): Promise<{ available: boolean; agencies: number; moved: number; wouldMove: number; left: number }> {
  const { data, error } = await db().from("pipeline_rule").select("tenant_id").eq("enabled", true).in("mode", ["forecast", "live"]).limit(5000);
  if (error) {
    if (isSchemaGap(error)) return { available: false, agencies: 0, moved: 0, wouldMove: 0, left: 0 };
    throw new Error(`Could not read the pipeline rules: ${error.message}`);
  }
  const tenants = [...new Set(((data ?? []) as Loose[]).map((r) => r.tenant_id as string))];
  const deadline = Date.now() + budgetMs;
  let agencies = 0;
  let moved = 0;
  let wouldMove = 0;
  for (const tenantId of tenants) {
    if (Date.now() > deadline) break;
    try {
      const run = await runPipelineRules(tenantId, trigger);
      agencies += 1;
      moved += run.moved;
      wouldMove += run.wouldMove;
    } catch (failure) {
      console.error("[pipeline-rules] an agency's run failed", tenantId, failure);
    }
  }
  return { available: true, agencies, moved, wouldMove, left: tenants.length - agencies };
}

