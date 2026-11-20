import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { NO_PRODUCER, type ProducerScope } from "@/lib/agency/visibilityCore";
import type { CallbackFact } from "@/lib/reports/callbackResultsCore";

/**
 * Reports › Callbacks kept: the period's booked callbacks, lean (no lead embed: a report needs the outcome, not the
 * customer). Read from tenant_callbacks a page of 1,000 at a time (the API's cap), up to 20,000, inside the period
 * widened a day each side so a callback's day can be cut in the workspace's own zone; the rules are in
 * callbackResultsCore.ts. `scope`: the session's producer scope (AG-0.5), as the calendar applies it.
 */

const PAGE = 1_000;
const LIMIT = 20_000;

type Row = { assigned_to: string | null; status: string; scheduled_at_utc: string; completed_via?: string | null; missed_at?: string | null };
type Result = { data: Row[] | null; error: { code?: string; message?: string } | null };
type Query = PromiseLike<Result> & {
  eq(column: string, value: string): Query;
  gte(column: string, value: string): Query;
  lt(column: string, value: string): Query;
  in(column: string, values: readonly string[]): Query;
  order(column: string, options: { ascending: boolean }): Query;
  range(from: number, to: number): Query;
};
type Loose = { from(table: string): { select(columns: string): Query } };

function isMissingColumn(error: { code?: string; message?: string }) {
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist/i.test(error.message ?? "");
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const isoOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

function dayIn(utc: string, zone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utc));
  } catch {
    return utc.slice(0, 10);
  }
}

export type CallbackResultsRead = { available: boolean; zone: string; facts: CallbackFact[]; names: Record<string, string>; capped: boolean };

export async function loadCallbackResults(tenantId: string, period: { from: string; to: string }, scope: ProducerScope = null): Promise<CallbackResultsRead> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const zone = (await getWorkspaceTimezone(tenantId).catch(() => null)) ?? "America/New_York";
  const since = `${isoOf(dayNumber(period.from) - 1)}T00:00:00Z`;
  const until = `${isoOf(dayNumber(period.to) + 2)}T00:00:00Z`;

  const read = async (columns: string) => {
    const rows: Row[] = [];
    for (let from = 0; from < LIMIT; from += PAGE) {
      let query = db.from("tenant_callbacks").select(columns).eq("tenant_id", tenantId).gte("scheduled_at_utc", since).lt("scheduled_at_utc", until);
      if (scope) query = query.in("assigned_to", scope.length ? [...scope] : [NO_PRODUCER]);
      const { data, error } = await query.order("scheduled_at_utc", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE - 1);
      if (error) return { rows, error };
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
    return { rows, error: null };
  };

  const BASE = "id, assigned_to, status, scheduled_at_utc";
  let result = await read(`${BASE}, completed_via, missed_at`);
  // Before 20260925708500 there is no missed stamp and no kept-on-a-call: the same read without them.
  if (result.error && isMissingColumn(result.error)) result = await read(BASE);
  if (result.error) {
    // No calendar table in this environment: nothing to report, said as "not set up", never as zero.
    if (result.error.code === "42P01" || /relation .* does not exist/i.test(result.error.message ?? "")) return { available: false, zone, facts: [], names: {}, capped: false };
    throw new Error(`Could not load callbacks: ${result.error.message}`);
  }

  const facts: CallbackFact[] = result.rows.map((row) => ({
    assignedTo: row.assigned_to,
    status: row.status,
    day: dayIn(row.scheduled_at_utc, zone),
    completedVia: row.completed_via === "call" || row.completed_via === "manual" ? row.completed_via : null,
    missedAt: row.missed_at ?? null,
  }));

  const ids = [...new Set(facts.map((fact) => fact.assignedTo).filter((id): id is string => Boolean(id)))];
  const names: Record<string, string> = {};
  if (ids.length) {
    const users = await (db.from("users").select("id, name").in("id", ids) as unknown as PromiseLike<{ data: Array<{ id: string; name: string | null }> | null }>);
    for (const user of users.data ?? []) if (user.name) names[user.id] = user.name;
  }
  return { available: true, zone, facts, names, capped: result.rows.length >= LIMIT };
}
