import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The facts the phone's lead list and board draw on each row beyond the lead itself (board D1, D2,
 * D8): the soonest open callback (a card's "callback Thu" or "Overdue 2 h"), the screening result
 * (a row's "Needs review" chip) and, only when asked, whether the lead may be dialled right now.
 *
 * Read for the page's leads only, in chunks, tenant-filtered. "Callable now" is the same database
 * function every dial path asks (tenant_can_dial_now: the calling window for the lead's state and
 * campaign at this moment), asked once per distinct state and campaign on the page; the dialer still
 * checks again when it dials. A read that fails leaves its fact unknown (null), never guessed.
 */
export type LeadRowExtras = {
  callbackAt: string | null;
  callbackTimezone: string | null;
  screeningOutcome: string | null;
  screeningWarning: boolean;
  /** Null when not asked, when the lead has no state, or when the check could not be made. */
  callableNow: boolean | null;
};

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const CHUNK = 150;
/** A page of 500 leads spans a few dozen states and campaigns; past this many the rest stay unknown. */
const MAX_DIAL_CHECKS = 80;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export async function leadRowExtras(tenantId: string, leads: ReadonlyArray<{ id: string; values: unknown }>, options: { callable: boolean }): Promise<Map<string, LeadRowExtras>> {
  const out = new Map<string, LeadRowExtras>(leads.map((lead) => [lead.id, { callbackAt: null, callbackTimezone: null, screeningOutcome: null, screeningWarning: false, callableNow: null }]));
  if (!leads.length) return out;
  const db = getSupabaseServiceClient() as unknown as Db;
  const ids = leads.map((lead) => lead.id);
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += CHUNK) chunks.push(ids.slice(start, start + CHUNK));
  const [rows, callbacks] = await Promise.all([
    Promise.all(chunks.map((part) => db.from("agent_leads").select("id, campaign_id, screening_outcome, screening_warning").eq("tenant_id", tenantId).in("id", part))),
    Promise.all(chunks.map((part) => db.from("tenant_callbacks").select("lead_id, scheduled_at_utc, customer_timezone").eq("tenant_id", tenantId).in("lead_id", part).in("status", ["scheduled", "due"]).order("scheduled_at_utc", { ascending: true }))),
  ]);
  const campaignOf = new Map<string, string | null>();
  for (const page of rows) {
    if (page.error) continue;
    for (const row of page.data ?? []) {
      const entry = out.get(String(row.id));
      if (!entry) continue;
      entry.screeningOutcome = text(row.screening_outcome);
      entry.screeningWarning = Boolean(text(row.screening_warning));
      campaignOf.set(String(row.id), text(row.campaign_id));
    }
  }
  for (const page of callbacks) {
    if (page.error) continue;
    for (const row of page.data ?? []) {
      const entry = out.get(String(row.lead_id));
      // Ordered soonest first, so the first open callback per lead is the one that counts.
      if (!entry || entry.callbackAt) continue;
      entry.callbackAt = text(row.scheduled_at_utc);
      entry.callbackTimezone = text(row.customer_timezone);
    }
  }
  if (options.callable) {
    const at = new Date().toISOString();
    const stateOf = (values: unknown) => {
      const v = values && typeof values === "object" && !Array.isArray(values) ? values as Row : {};
      return (text(v.state) ?? text(v.state_code))?.toUpperCase() ?? null;
    };
    const keyOf = new Map<string, string>();
    const asks = new Map<string, { state: string; campaignId: string | null }>();
    for (const lead of leads) {
      const state = stateOf(lead.values);
      if (!state) continue;
      const campaignId = campaignOf.get(lead.id) ?? null;
      const key = `${state}|${campaignId ?? ""}`;
      keyOf.set(lead.id, key);
      if (!asks.has(key) && asks.size < MAX_DIAL_CHECKS) asks.set(key, { state, campaignId });
    }
    const answers = new Map<string, boolean | null>();
    await Promise.all([...asks].map(async ([key, ask]) => {
      try {
        const decided = await db.rpc("tenant_can_dial_now", { p_tenant_id: tenantId, p_state: ask.state, p_campaign_id: ask.campaignId, p_at: at });
        answers.set(key, decided.error ? null : decided.data === true);
      } catch {
        answers.set(key, null);
      }
    }));
    for (const [leadId, key] of keyOf) {
      const entry = out.get(leadId);
      if (entry) entry.callableNow = answers.get(key) ?? null;
    }
  }
  return out;
}
