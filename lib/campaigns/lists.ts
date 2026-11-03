import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { latestLeadOwners } from "@/lib/agentTemplates/service";

/**
 * A campaign's lists and a list's leads (manager 2026-10-29: "no standalone Lists page — open a
 * campaign and see its lists there"; canvas m2-leads-in-r3 boards LirF1 and LirF2).
 *
 * Module 2 §5: "List — one import. A campaign may take several." A list is one committed import batch
 * (agent_lead_import_batches), and its leads are the ones that batch created (agent_leads.import_batch_id,
 * 20260924330000, read along agent_leads_import_batch_idx). Leads that came in another way — before
 * batches were stamped, through the direct import, or re-sold and attached to a lead the agency already
 * had — carry no batch: they are the campaign's "Earlier leads", one more row, so nothing is hidden.
 */

export const EARLIER = "earlier";

type DbError = { message: string; code?: string } | null;
type Res<T> = { data: T; error: DbError; count?: number | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- import_batch_id and the batch columns are not in the generated types
const loose = () => getSupabaseServiceClient() as any;

export type CampaignList = {
  id: string;
  fileName: string;
  importedAt: string | null;
  rows: number | null;
  leads: number;
  /** Fresh, working or retry: what the dialer can still serve (tenant_campaign_progress' definition). */
  left: number;
  dialed: number;
  /** Leads with no state: no calling window, never served. */
  noState: number;
  costCents: number | null;
};

const WORKABLE = ["fresh", "working", "retry"];

/** The campaign's committed imports, newest first, each with its lead counts. Null: the campaign is not this tenant's. */
export async function listsOfCampaign(tenantId: string, campaignId: string): Promise<CampaignList[] | null> {
  const db = loose();
  const campaign: Res<{ id: string } | null> = await db.from("tenant_campaigns").select("id").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle();
  if (campaign.error) throw new Error(`Could not read the campaign: ${campaign.error.message}`);
  if (!campaign.data) return null;
  const batches: Res<Array<{ id: string; file_name: string | null; row_count: number | null; cost_cents: number | null; completed_at: string | null; created_at: string }> | null> = await db
    .from("agent_lead_import_batches")
    .select("id, file_name, row_count, cost_cents, completed_at, created_at")
    .eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(200);
  if (batches.error) throw new Error(`Could not read the campaign's lists: ${batches.error.message}`);

  const counted = async (batchId: string | null) => {
    const base = () => {
      const query = db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
      return batchId ? query.eq("import_batch_id", batchId) : query.eq("campaign_id", campaignId).is("import_batch_id", null);
    };
    const [all, left, dialed, noState] = await Promise.all([
      base(),
      base().in("lead_state", WORKABLE),
      base().gt("attempts_made", 0),
      base().is("values->>state", null),
    ]) as Array<Res<null>>;
    const failed = [all, left, dialed, noState].find((result) => result.error);
    if (failed?.error) throw new Error(`Could not count a list's leads: ${failed.error.message}`);
    return { leads: all.count ?? 0, left: left.count ?? 0, dialed: dialed.count ?? 0, noState: noState.count ?? 0 };
  };

  const lists: CampaignList[] = await Promise.all((batches.data ?? []).map(async (batch) => ({
    id: batch.id,
    fileName: batch.file_name ?? "Imported list",
    importedAt: batch.completed_at ?? batch.created_at,
    rows: batch.row_count,
    costCents: batch.cost_cents,
    ...(await counted(batch.id)),
  })));
  const earlier = await counted(null);
  if (earlier.leads > 0) lists.push({ id: EARLIER, fileName: "Earlier leads", importedAt: null, rows: null, costCents: null, ...earlier });
  return lists;
}

export type ListLead = {
  id: string;
  name: string;
  phone: string | null;
  state: string | null;
  leadState: string | null;
  attempts: number;
  agentId: string | null;
  agentName: string | null;
};

export type ListView = "all" | "not_called" | "problems";
export const LIST_VIEWS: readonly ListView[] = ["all", "not_called", "problems"];

export type ListLeads = {
  list: { id: string; fileName: string; importedAt: string | null; rows: number | null; costCents: number | null };
  counts: Record<ListView, number>;
  leads: ListLead[];
  page: number;
  pageSize: number;
  total: number;
};

function text(values: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = values?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** One page of a list's leads. Null: the list (or the campaign) is not this tenant's. */
export async function leadsOfList(tenantId: string, campaignId: string, listId: string, options: { view: ListView; q: string; page: number; pageSize: number }): Promise<ListLeads | null> {
  const db = loose();
  let list: ListLeads["list"];
  if (listId === EARLIER) {
    const campaign: Res<{ id: string } | null> = await db.from("tenant_campaigns").select("id").eq("tenant_id", tenantId).eq("id", campaignId).maybeSingle();
    if (campaign.error) throw new Error(`Could not read the campaign: ${campaign.error.message}`);
    if (!campaign.data) return null;
    list = { id: EARLIER, fileName: "Earlier leads", importedAt: null, rows: null, costCents: null };
  } else {
    const batch: Res<{ id: string; file_name: string | null; row_count: number | null; cost_cents: number | null; completed_at: string | null; created_at: string } | null> = await db
      .from("agent_lead_import_batches").select("id, file_name, row_count, cost_cents, completed_at, created_at")
      .eq("tenant_id", tenantId).eq("campaign_id", campaignId).eq("id", listId).eq("status", "completed").maybeSingle();
    if (batch.error) throw new Error(`Could not read the list: ${batch.error.message}`);
    if (!batch.data) return null;
    list = { id: batch.data.id, fileName: batch.data.file_name ?? "Imported list", importedAt: batch.data.completed_at ?? batch.data.created_at, rows: batch.data.row_count, costCents: batch.data.cost_cents };
  }

  const scoped = (columns: string, options?: unknown) => {
    const query = db.from("agent_leads").select(columns, options).eq("tenant_id", tenantId);
    return listId === EARLIER ? query.eq("campaign_id", campaignId).is("import_batch_id", null) : query.eq("import_batch_id", listId);
  };
  const viewed = (query: ReturnType<typeof scoped>, view: ListView) =>
    view === "not_called" ? query.eq("attempts_made", 0).in("lead_state", WORKABLE) : view === "problems" ? query.is("values->>state", null) : query;
  // A name or a number, matched on the fields an import writes.
  const needle = options.q.replace(/[%,()*]/g, " ").trim();
  const searched = (query: ReturnType<typeof scoped>) => needle
    ? query.or(["first_name", "last_name", "full_name", "phone"].map((key) => `values->>${key}.ilike.*${needle}*`).join(","))
    : query;

  const [all, notCalled, problems] = await Promise.all(LIST_VIEWS.map((view) => searched(viewed(scoped("id", { count: "exact", head: true }), view)))) as Array<Res<null>>;
  const failed = [all, notCalled, problems].find((result) => result.error);
  if (failed?.error) throw new Error(`Could not count the list's leads: ${failed.error.message}`);
  const counts = { all: all.count ?? 0, not_called: notCalled.count ?? 0, problems: problems.count ?? 0 };

  const from = options.page * options.pageSize;
  const rows: Res<Array<{ id: string; values: Record<string, unknown> | null; lead_state: string | null; attempts_made: number | null }> | null> = await searched(viewed(scoped("id, values, lead_state, attempts_made"), options.view))
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .range(from, from + options.pageSize - 1);
  if (rows.error) throw new Error(`Could not read the list's leads: ${rows.error.message}`);
  const page = rows.data ?? [];

  const owners = page.length ? await latestLeadOwners(tenantId, page.map((row) => row.id)) : new Map<string, string | null>();
  const agentIds = [...new Set([...owners.values()].filter((id): id is string => Boolean(id)))];
  const users: Res<Array<{ id: string; name: string | null; email: string | null }> | null> = agentIds.length
    ? await db.from("users").select("id, name, email").in("id", agentIds)
    : { data: [], error: null };
  const nameOf = new Map((users.error ? [] : users.data ?? []).map((user) => [user.id, user.name || user.email || null]));

  return {
    list,
    counts,
    page: options.page,
    pageSize: options.pageSize,
    total: counts[options.view],
    leads: page.map((row) => {
      const values = row.values ?? {};
      const full = text(values, ["full_name", "name"]);
      const name = full ?? ([text(values, ["first_name"]), text(values, ["last_name"])].filter(Boolean).join(" ") || "Unnamed lead");
      const agentId = owners.get(row.id) ?? null;
      return {
        id: row.id,
        name,
        phone: text(values, ["phone", "phone_number"]),
        state: text(values, ["state", "state_code"])?.toUpperCase() ?? null,
        leadState: row.lead_state,
        attempts: row.attempts_made ?? 0,
        agentId,
        agentName: agentId ? nameOf.get(agentId) ?? null : null,
      };
    }),
  };
}
