import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { RouteStats } from "./constants";

/**
 * The Route step's figures (Leads in round 3, board LirT1): what waits, since when, what was handed
 * out today, and the states of the next leads in line. Read with the service client, so every read
 * names the tenant itself (memory: service-role embeds need a tenant filter).
 *
 *   waiting         lead_queue unclaimed with no owner — the same count as the rail's Route step
 *   oldestAt        the oldest of them (lead_queue (tenant_id, status, queued_at) index)
 *   handedOutToday  lead_assignment_events 'assigned' or 'pulled' to someone since 00:00 UTC, the
 *                   day the page's "this week" figures also count in
 *   sampleStates    the state of the next STATE_SAMPLE pool leads, oldest first (the order the router
 *                   hands them out in), read the way assignment_insights reads it:
 *                   upper(trim(values.state ?? values.state_code ?? '')), '' for none
 *
 * Each read fails on its own to null: a figure the page cannot read is left off, never guessed.
 */
const STATE_SAMPLE = 1000;

type Row = Record<string, unknown>;
type Res = { data: unknown; error: { message: string } | null; count?: number | null };
type Q = PromiseLike<Res> & {
  select(columns: string, options?: unknown): Q;
  eq(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: unknown): Q;
  gte(column: string, value: unknown): Q;
  order(column: string, options?: unknown): Q;
  limit(count: number): Q;
};
const db = () => getSupabaseServiceClient() as unknown as { from(table: string): Q };

function utcMidnight(now: number) {
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day.toISOString();
}

function leadState(v: Row): string {
  const raw = typeof v.state === "string" && v.state.trim() ? v.state : typeof v.state_code === "string" ? v.state_code : "";
  return raw.trim().toUpperCase();
}

export async function readRouteStats(tenantId: string, now = Date.now()): Promise<RouteStats> {
  const pool = () => db().from("lead_queue").eq("tenant_id", tenantId).eq("status", "unclaimed").is("owner_user_id", null);
  const settle = <T>(read: PromiseLike<T>) => Promise.resolve(read).then((value) => value, () => null);

  const [waiting, oldest, today, sample] = await Promise.all([
    settle(db().from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "unclaimed").is("owner_user_id", null)),
    settle(pool().select("queued_at, created_at").order("queued_at", { ascending: true, nullsFirst: false }).limit(1)),
    settle(db().from("lead_assignment_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("event_type", ["assigned", "pulled"]).not("to_user_id", "is", null).gte("created_at", utcMidnight(now))),
    settle(pool().select("agent_leads!inner(state:values->>state, state_code:values->>state_code)").eq("agent_leads.tenant_id", tenantId).order("queued_at", { ascending: true, nullsFirst: false }).limit(STATE_SAMPLE)),
  ]);

  const first = oldest && !oldest.error && Array.isArray(oldest.data) ? (oldest.data[0] as Row | undefined) : undefined;
  let sampleStates: Record<string, number> | null = null;
  let sampleSize = 0;
  if (sample && !sample.error && Array.isArray(sample.data)) {
    sampleStates = {};
    for (const row of sample.data as Row[]) {
      const lead = row.agent_leads as Row | Row[] | null;
      const state = leadState((Array.isArray(lead) ? lead[0] : lead) ?? {});
      sampleStates[state] = (sampleStates[state] ?? 0) + 1;
      sampleSize += 1;
    }
  }

  return {
    waiting: waiting && !waiting.error ? waiting.count ?? 0 : null,
    oldestAt: first ? String(first.queued_at ?? first.created_at ?? "") || null : null,
    handedOutToday: today && !today.error ? today.count ?? 0 : null,
    sampleStates,
    sampleSize,
  };
}
