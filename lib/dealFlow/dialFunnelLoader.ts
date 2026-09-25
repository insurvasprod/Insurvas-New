import "server-only";

import { localRangeToUtc } from "./localDate";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildDialFunnel, type Agent, type ApplicationRow, type AttemptRow, type DealPremiumRow, type DialFunnel, type QuotedRow, type ServedRow } from "./dialFunnel";

/** Hard ceiling per source; a range that exceeds it is reported as capped rather than silently cut. */
const MAX_ROWS = 50_000;
const PAGE = 1000;

type Result = { data: unknown[] | null; error: { message: string } | null };
type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  in: (column: string, values: unknown[]) => Query;
  gte: (column: string, value: unknown) => Query;
  lt: (column: string, value: unknown) => Query;
  lte: (column: string, value: unknown) => Query;
  ilike: (column: string, value: string) => Query;
  order: (column: string, options?: { ascending?: boolean }) => Query;
  range: (from: number, to: number) => PromiseLike<Result>;
} & PromiseLike<Result>;
type LooseDb = { from: (table: string) => Query };

/** Reads every page of a query (PostgREST returns 1,000 rows at most per request). */
async function all<T>(build: () => Query, label: string): Promise<{ rows: T[]; capped: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`Could not read ${label}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export async function loadDialFunnel(tenantId: string, input: { fromDate: string; toDate: string; agentId?: string; timeZone: string | null }): Promise<DialFunnel & { capped: boolean; timeZone: string }> {
  const zone = input.timeZone || "UTC";
  const { gte, lt } = localRangeToUtc(input.fromDate, input.toDate, zone);
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const agent = input.agentId;

  const served = () => { let q = db.from("tenant_lead_activity").select("lead_id, agent_user_id, campaign_id").eq("tenant_id", tenantId).gte("served_at", gte).lt("served_at", lt).order("served_at"); if (agent) q = q.eq("agent_user_id", agent); return q; };
  const attempts = () => { let q = db.from("tenant_call_attempts").select("lead_id, agent_id, dial_clicked_at, disposition").eq("tenant_id", tenantId).gte("attempted_at", gte).lt("attempted_at", lt).order("attempted_at"); if (agent) q = q.eq("agent_id", agent); return q; };
  const applications = () => { let q = db.from("tenant_application_cases").select("lead_id, opened_by").eq("tenant_id", tenantId).gte("opened_at", gte).lt("opened_at", lt).order("opened_at"); if (agent) q = q.eq("opened_by", agent); return q; };
  const deals = () => { let q = db.from("deal_flow").select("monthly_premium_cents").eq("tenant_id", tenantId).gte("local_date", input.fromDate).lte("local_date", input.toDate).order("created_at"); if (agent) q = q.eq("worked_by", agent); return q; };

  const [servedRows, attemptRows, applicationRows, dealRows, quotedStages, members] = await Promise.all([
    all<ServedRow>(served, "served leads"),
    all<AttemptRow>(attempts, "call attempts"),
    all<ApplicationRow>(applications, "applications"),
    all<DealPremiumRow>(deals, "deals"),
    // Pipelines belong to the tenant; their stages are reached through them.
    db.from("tenant_pipelines").select("id, stages:tenant_pipeline_stages(id, name)").eq("tenant_id", tenantId),
    db.from("tenant_users").select("user_id, role").eq("tenant_id", tenantId),
  ]);
  if (quotedStages.error) throw new Error(`Could not read pipeline stages: ${quotedStages.error.message}`);
  if (members.error) throw new Error(`Could not read the team: ${members.error.message}`);

  const quotedStageIds = ((quotedStages.data ?? []) as Array<{ stages: Array<{ id: string; name: string }> | null }>)
    .flatMap((pipeline) => pipeline.stages ?? [])
    .filter((stage) => /^quot/i.test(stage.name.trim()))
    .map((stage) => stage.id);
  let quoted: QuotedRow[] | null = null;
  let quotedCapped = false;
  if (quotedStageIds.length) {
    const result = await all<QuotedRow>(() => { let q = db.from("tenant_lead_stage_events").select("lead_id, actor_user_id").eq("tenant_id", tenantId).in("to_stage_id", quotedStageIds).gte("created_at", gte).lt("created_at", lt).order("created_at"); if (agent) q = q.eq("actor_user_id", agent); return q; }, "quoted stage moves");
    quoted = result.rows;
    quotedCapped = result.capped;
  }

  // Names and roles for everyone who appears, members or not.
  const memberRows = (members.data ?? []) as Array<{ user_id: string; role: string }>;
  const roleById = new Map(memberRows.map((row) => [row.user_id, row.role]));
  const ids = new Set<string>(memberRows.map((row) => row.user_id));
  for (const row of servedRows.rows) if (row.agent_user_id) ids.add(row.agent_user_id);
  for (const row of attemptRows.rows) if (row.agent_id) ids.add(row.agent_id);
  const users = ids.size ? await db.from("users").select("id, name").in("id", [...ids]) : { data: [], error: null };
  if (users.error) throw new Error(`Could not read agent names: ${users.error.message}`);
  const agents: Agent[] = ((users.data ?? []) as Array<{ id: string; name: string | null }>).map((user) => ({ id: user.id, name: user.name ?? "Unnamed user", role: roleById.get(user.id) ?? "" }));

  // Costs for exactly the served (lead, campaign) pairs.
  const leadIds = [...new Set(servedRows.rows.map((row) => row.lead_id))];
  const campaignIds = [...new Set(servedRows.rows.map((row) => row.campaign_id).filter((id): id is string => !!id))];
  const leadCost = new Map<string, number>();
  for (let index = 0; index < leadIds.length; index += 300) {
    const chunk = leadIds.slice(index, index + 300);
    const { data, error } = await db.from("tenant_lead_sources").select("lead_id, campaign_id, cost_cents").eq("tenant_id", tenantId).in("lead_id", chunk);
    if (error) throw new Error(`Could not read lead costs: ${error.message}`);
    for (const row of (data ?? []) as Array<{ lead_id: string; campaign_id: string; cost_cents: number }>) leadCost.set(`${row.lead_id}:${row.campaign_id}`, row.cost_cents);
  }
  const campaignPerRecord = new Map<string, number>();
  if (campaignIds.length) {
    const { data, error } = await db.from("tenant_campaigns").select("id, effective_cost_per_record_cents").eq("tenant_id", tenantId).in("id", campaignIds);
    if (error) throw new Error(`Could not read campaign costs: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; effective_cost_per_record_cents: number | string | null }>) {
      const value = row.effective_cost_per_record_cents == null ? null : Number(row.effective_cost_per_record_cents);
      if (value != null && Number.isFinite(value)) campaignPerRecord.set(row.id, Math.round(value));
    }
  }

  const funnel = buildDialFunnel({ served: servedRows.rows, attempts: attemptRows.rows, applications: applicationRows.rows, quoted, deals: dealRows.rows, agents, costs: { leadCost, campaignPerRecord } });
  return { ...funnel, capped: servedRows.capped || attemptRows.capped || applicationRows.capped || dealRows.capped || quotedCapped, timeZone: zone };
}
