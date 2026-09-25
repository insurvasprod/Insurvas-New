import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getVendorReturns } from "@/lib/vendorScorecard/service";

/**
 * The lead list — inventory, not progress.
 *
 * A campaign is the list: one purchase, from one vendor, carrying what was paid and how many records
 * were bought. A pipeline is what happened to those leads afterwards. The product owner's model
 * keeps the two apart deliberately, and until this file the only way to look at imported leads was
 * `/app/leads`, which is organised **by pipeline** — so the only view of the inventory was through
 * the thing the inventory is not.
 *
 * What this answers, which a pipeline board cannot:
 *
 *   · I paid for 15,000 records. How many arrived, and how many can actually be dialled?
 *   · Of what arrived, how much has nobody touched?
 *   · Who is holding the rest?
 *
 * The counts are computed from the rows rather than stored, because a stored count of "untouched"
 * is wrong the moment somebody dials one, and this screen exists to be trusted at a glance.
 */

export type LeadListRow = {
  campaignId: string;
  campaignName: string;
  vendorId: string | null;
  vendorName: string;
  status: string;
  createdAt: string;
  /** What the campaign says was bought, from the purchase — not a count of rows. */
  recordsPurchased: number;
  totalSpendCents: number;
  creditsReceivedCents: number;
  /** What actually arrived. The gap between this and recordsPurchased is the first thing to look at. */
  leadsReceived: number;
  /** Never dialled and nobody owns it. This is the number that means "there is work here". */
  untouched: number;
  assigned: number;
  byState: Record<string, number>;
  /** `scrubbed` is the only state the queue serves from (campaigns_servable, serve_next_lead). */
  scrubStatus: string;
  /** Leads whose state is outside every licence the agency holds. Null when no licences are recorded. */
  offTerritory: number | null;
  /** How many distinct states those off-territory leads sit in. */
  offTerritoryStates: number;
  /** The most recent change to any lead in the list — "stalling" is untouched work nobody is moving. */
  lastTouchedAt: string | null;
  /** Leads the vendor can still be asked to refund (return window open), from vendor_returns_report. */
  claimable: number;
};

export type LeadListsReport = {
  lists: LeadListRow[];
  /** States the agency's members are licensed in; empty when none are recorded. */
  licensedStates: string[];
};

export type LeadListLead = {
  leadId: string;
  workItemId: string | null;
  name: string;
  phone: string;
  state: string;
  leadState: string;
  queueStatus: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  attemptsMade: number;
  createdAt: string;
};

type Row = Record<string, unknown>;
type Result<T> = { data: T; error: { message: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  not(column: string, operator: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  range(from: number, to: number): Query<T>;
};
type Db = { from(table: string): Query<Row[]> };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);

/** PostgREST caps a page at 1000, and a bought list is routinely larger. */
const PAGE = 1000;

async function allRows(build: (start: number) => Query<Row[]>, label: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await build(start);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** PostgREST returns a one-to-one embed as an object (or null); older detection gives an array. */
function embeddedQueue(row: Row): Row | null {
  const value = row.lead_queue as Row | Row[] | null | undefined;
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function listLeadLists(tenantId: string): Promise<LeadListRow[]> {
  return (await leadListsReport(tenantId)).lists;
}

export async function leadListsReport(tenantId: string): Promise<LeadListsReport> {
  const db = getSupabaseServiceClient() as unknown as Db;

  // Independent reads, so they go together. Run sequentially this screen took three to six seconds
  // on a tenant holding 28 leads — four round trips at ~200ms each, one after another, for data
  // that has no ordering between the parts.
  const [campaigns, vendors, attributedLeads, licences, returns] = await Promise.all([
    db
      .from("tenant_campaigns")
      .select("id, name, vendor_id, status, created_at, records_purchased, total_spend_cents, credits_received_cents, scrub_status")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    db.from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId),
    // Only leads that belong to a list. The first draft read every lead on the tenant and filtered
    // in memory, which is the whole book to count the inventory — and on a tenant with a real book
    // that is the difference between a page and a timeout.
    allRows(
      (start) =>
        db
          .from("agent_leads")
          // The work item rides along through lead_queue_lead_id_fkey (unique on lead_id, so at
          // most one), replacing a second sequential pass of .in() chunks over lead_queue.
          .select("id, campaign_id, lead_state, updated_at, us_state:values->>state, lead_queue!lead_queue_lead_id_fkey(lead_id, status, owner_user_id)")
          .eq("tenant_id", tenantId)
          .eq("lead_queue.tenant_id", tenantId)
          .not("campaign_id", "is", null)
          .order("id", { ascending: true })
          .range(start, start + PAGE - 1),
      "the leads in your lists",
    ),
    // Territory: the union of what the agency's members are licensed in, expired rows left out.
    // Read failures degrade to "unknown territory" rather than taking the screen down.
    heldLicensedStates(db, tenantId),
    getVendorReturns(tenantId).catch(() => null),
  ]);
  if (campaigns.error) throw new Error(`Could not load lead lists: ${campaigns.error.message}`);
  if (vendors.error) throw new Error(`Could not load vendors: ${vendors.error.message}`);
  const rows = campaigns.data ?? [];
  const licensed = new Set(licences ?? []);
  if (rows.length === 0) return { lists: [], licensedStates: [...licensed].sort() };

  const claimableByCampaign = new Map<string, number>();
  for (const candidate of returns?.claimable ?? []) {
    if (candidate.claimable) claimableByCampaign.set(candidate.campaign_id, (claimableByCampaign.get(candidate.campaign_id) ?? 0) + 1);
  }

  const vendorName = new Map((vendors.data ?? []).map((row) => [text(row.id), text(row.name)]));
  const attributed = attributedLeads;

  // The work items belonging to those leads came back embedded on each lead.
  const queueByLead = new Map(
    attributed.flatMap((row) => {
      const item = embeddedQueue(row);
      return item ? [[text(row.id), item] as const] : [];
    }),
  );

  type Counts = { received: number; untouched: number; assigned: number; states: Record<string, number>; off: number; offStates: Set<string>; lastTouched: string | null };
  const empty = (): Counts => ({ received: 0, untouched: 0, assigned: 0, states: {}, off: 0, offStates: new Set(), lastTouched: null });
  const byCampaign = new Map<string, Counts>();
  for (const lead of attributed) {
    const key = text(lead.campaign_id);
    const entry = byCampaign.get(key) ?? empty();
    entry.received += 1;
    const usState = text(lead.us_state).trim().toUpperCase();
    // A lead with no state recorded cannot be called off-territory; it is only counted when known.
    if (licensed.size > 0 && usState && !licensed.has(usState)) { entry.off += 1; entry.offStates.add(usState); }
    const touched = text(lead.updated_at);
    if (touched && (!entry.lastTouched || touched > entry.lastTouched)) entry.lastTouched = touched;
    const state = text(lead.lead_state) || "unknown";
    entry.states[state] = (entry.states[state] ?? 0) + 1;
    const item = queueByLead.get(text(lead.id));
    const owner = item ? text(item.owner_user_id) : "";
    if (owner) entry.assigned += 1;
    // Untouched means exactly that: still fresh, and nobody owns it. A lead somebody claimed and
    // put down is not untouched, and counting it as such is how a list looks full of work it does
    // not have.
    else if (state === "fresh") entry.untouched += 1;
    byCampaign.set(key, entry);
  }

  const lists = rows.map((row) => {
    const id = text(row.id);
    const counts = byCampaign.get(id) ?? empty();
    return {
      campaignId: id,
      campaignName: text(row.name) || "Untitled list",
      vendorId: text(row.vendor_id) || null,
      vendorName: vendorName.get(text(row.vendor_id)) ?? "Unknown vendor",
      status: text(row.status) || "draft",
      createdAt: text(row.created_at),
      recordsPurchased: num(row.records_purchased),
      totalSpendCents: num(row.total_spend_cents),
      creditsReceivedCents: num(row.credits_received_cents),
      leadsReceived: counts.received,
      untouched: counts.untouched,
      assigned: counts.assigned,
      byState: counts.states,
      scrubStatus: text(row.scrub_status) || "unscrubbed",
      offTerritory: licensed.size > 0 ? counts.off : null,
      offTerritoryStates: counts.offStates.size,
      lastTouchedAt: counts.lastTouched,
      claimable: claimableByCampaign.get(id) ?? 0,
    };
  });
  return { lists, licensedStates: [...licensed].sort() };
}

export async function listLeadsInList(
  tenantId: string,
  campaignId: string,
  filters: { state?: string | null; unassignedOnly?: boolean } = {},
): Promise<LeadListLead[]> {
  const db = getSupabaseServiceClient() as unknown as Db;

  // "unknown" is the display fallback for an empty lead_state, so only a real state can be pushed
  // into the query; the in-memory filter below still applies either way.
  const pushState = filters.state && filters.state !== "unknown" ? filters.state : null;
  const leads = await allRows(
    (start) => {
      let query = db
        .from("agent_leads")
        // Work item and its owner's name are embedded (lead_queue_lead_id_fkey is unique, so at
        // most one; lead_queue_owner_user_id_fkey for the name), replacing two sequential passes.
        .select("id, values, lead_state, attempts_made, created_at, lead_queue!lead_queue_lead_id_fkey(id, lead_id, status, owner_user_id, users!lead_queue_owner_user_id_fkey(name))")
        .eq("tenant_id", tenantId)
        .eq("campaign_id", campaignId)
        .eq("lead_queue.tenant_id", tenantId);
      if (pushState) query = query.eq("lead_state", pushState);
      // id breaks created_at ties (a CSV import stamps many rows alike) so range pages never overlap or skip.
      return query.order("created_at", { ascending: false }).order("id", { ascending: true }).range(start, start + PAGE - 1);
    },
    "the leads in this list",
  );
  if (leads.length === 0) return [];

  const queueByLead = new Map(
    leads.flatMap((row) => {
      const item = embeddedQueue(row);
      return item ? [[text(row.id), item] as const] : [];
    }),
  );
  const ownerNameOf = (item: Row) => {
    const user = item.users as Row | Row[] | null | undefined;
    const name = Array.isArray(user) ? user[0]?.name : user?.name;
    return name == null ? null : text(name);
  };

  const mapped = leads.map((row) => {
    const values = (row.values ?? {}) as Record<string, unknown>;
    const item = queueByLead.get(text(row.id));
    const owner = item ? text(item.owner_user_id) : "";
    return {
      leadId: text(row.id),
      workItemId: item ? text(item.id) : null,
      name:
        text(values.full_name) ||
        [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") ||
        "Unnamed lead",
      phone: text(values.phone) || text(values.phone_number) || "",
      state: text(values.state),
      leadState: text(row.lead_state) || "unknown",
      queueStatus: item ? text(item.status) : null,
      ownerUserId: owner || null,
      ownerName: owner && item ? ownerNameOf(item) ?? "Unknown member" : null,
      attemptsMade: num(row.attempts_made),
      createdAt: text(row.created_at),
    };
  });

  return mapped.filter(
    (lead) =>
      (!filters.state || lead.leadState === filters.state) &&
      (!filters.unassignedOnly || !lead.ownerUserId),
  );
}

/**
 * The agency's territory as the lead lists count it: the union of the states its members are
 * licensed in (tenant_user_licensed_states). Null when none are recorded or the read fails — then
 * nothing is called off-territory, because an unknown territory is not an empty one. The import
 * review uses the same answer as the index, so the two screens cannot disagree about a lead.
 */
export async function licensedStates(tenantId: string): Promise<string[] | null> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const states = await heldLicensedStates(db, tenantId);
  return states && states.length > 0 ? states : null;
}

/**
 * The states some member holds a current licence in. A row whose `expires_on` has passed is not
 * held (20260925702000, the same test agent_may_work_state applies). Before that migration the
 * column does not exist (42703) and every recorded row counts, as it did. Null when the read fails.
 */
async function heldLicensedStates(db: Db, tenantId: string): Promise<string[] | null> {
  let result = await db.from("tenant_user_licensed_states").select("state, expires_on").eq("tenant_id", tenantId);
  if (result.error && ((result.error as { code?: string }).code === "42703" || /expires_on/.test(result.error.message))) {
    result = await db.from("tenant_user_licensed_states").select("state").eq("tenant_id", tenantId);
  }
  if (result.error) return null;
  const today = new Date().toISOString().slice(0, 10);
  const states = new Set(
    (result.data ?? [])
      .filter((row) => !text(row.expires_on) || text(row.expires_on).slice(0, 10) >= today)
      .map((row) => text(row.state).trim().toUpperCase())
      .filter(Boolean),
  );
  return [...states].sort();
}
