import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeDigits, type SuppressionEntry, type SuppressionListType, type SuppressionSource } from "./constants";

/**
 * LA-2.3 · reading and adding to the numbers this tenant must never call.
 *
 * The suppression machinery was complete except for the part a person uses. `suppress_phone` and
 * `is_phone_suppressed` exist and are correct; three code paths already write through them — the
 * disposition wizard, the import preflight, and reactivation screening. What had no home anywhere
 * was the ordinary case: a complaint arrives by email or phone, and somebody has to put that
 * number on the list by hand and later prove it is there.
 *
 * `/app/tcpa` was a menu entry pointing at a route that did not exist.
 *
 * Two stores, deliberately. `tenant_do_not_call` is the tenant's own internal list, written by the
 * disposition path since LA-1.12. `tenant_suppression_list` holds everything that came from
 * outside — federal and state DNC, litigator flags, invalid numbers. `is_phone_suppressed` answers
 * over both, so this file presents both as one list rather than inventing a third.
 */

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };
type Query = {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  like(column: string, pattern: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  limit(count: number): Query;
  then(resolve: (value: Result<Record<string, unknown>[]>) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
type Db = {
  from(table: string): Query;
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
};

function db(): Db {
  return getSupabaseServiceClient() as unknown as Db;
}

export { LIST_TYPES, LIST_TYPE_LABELS, MANUAL_SOURCES, formatPhone, normalizeDigits } from "./constants";
export type { SuppressionEntry, SuppressionListType, SuppressionSource } from "./constants";

const text = (value: unknown) => (typeof value === "string" ? value : "");

async function nameMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const result = await db().from("users").select("id, full_name, email").in("id", unique);
  if (result.error) return new Map();
  return new Map(
    (result.data ?? []).map((row) => [text(row.id), text(row.full_name) || text(row.email) || "Someone on your team"]),
  );
}

export type SuppressionPage = {
  entries: SuppressionEntry[];
  /** Totals per store, so the screen can say how big the list is without paging through it. */
  counts: { internal: number; external: number };
  hasMore: boolean;
};

/** "Grace A. Oyelaran" for each lead id, from the lead's own fields. Best effort: a miss is "—". */
async function leadNameMap(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const result = await db().from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", unique);
  if (result.error) return new Map();
  const map = new Map<string, string>();
  for (const row of (result.data ?? []) as Record<string, unknown>[]) {
    const values = (row.values && typeof row.values === "object" ? row.values : {}) as Record<string, unknown>;
    const name = text(values.full_name) || text(values.name) || [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ");
    if (name.trim()) map.set(text(row.id), name.trim());
  }
  return map;
}

export async function listSuppressions(input: {
  tenantId: string;
  search?: string | null;
  listType?: SuppressionListType | null;
  limit?: number;
}): Promise<SuppressionPage> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const digits = input.search ? (input.search ?? "").replace(/[^0-9]/g, "") : "";
  const wantsInternal = !input.listType || input.listType === "internal";
  const wantsExternal = !input.listType || input.listType !== "internal";

  const client = db();

  // Both stores are queried for one more row than asked for, so "there are more" is something
  // observed rather than inferred from a full page — a page that happens to land exactly on the
  // limit would otherwise claim more entries exist when it is the last one.
  const internalQuery = () => {
    let query = client
      .from("tenant_do_not_call")
      .select("id, phone_digits, lead_id, reason, added_by, created_at")
      .eq("tenant_id", input.tenantId)
      .eq("is_active", true);
    if (digits) query = query.like("phone_digits", `%${digits}%`);
    return query.order("created_at", { ascending: false }).limit(limit + 1);
  };

  const externalQuery = () => {
    let query = client
      .from("tenant_suppression_list")
      .select("id, phone_digits, list_type, reason, source, added_by, added_at")
      .eq("tenant_id", input.tenantId);
    if (digits) query = query.like("phone_digits", `%${digits}%`);
    if (input.listType && input.listType !== "internal") query = query.eq("list_type", input.listType);
    return query.order("added_at", { ascending: false }).limit(limit + 1);
  };

  const [internal, external, internalCount, externalCount] = await Promise.all([
    wantsInternal ? internalQuery() : Promise.resolve({ data: [], error: null } as Result<Record<string, unknown>[]>),
    wantsExternal ? externalQuery() : Promise.resolve({ data: [], error: null } as Result<Record<string, unknown>[]>),
    client.from("tenant_do_not_call").select("id", { count: "exact", head: true }).eq("tenant_id", input.tenantId).eq("is_active", true),
    client.from("tenant_suppression_list").select("id", { count: "exact", head: true }).eq("tenant_id", input.tenantId),
  ]);

  if (internal.error) throw new Error(`Could not load your do-not-call list: ${internal.error.message}`);
  if (external.error) throw new Error(`Could not load the suppression list: ${external.error.message}`);

  const internalRows = internal.data ?? [];
  const externalRows = external.data ?? [];
  const [names, leadNames] = await Promise.all([
    nameMap([
      ...internalRows.map((row) => text(row.added_by)),
      ...externalRows.map((row) => text(row.added_by)),
    ]),
    // Only your own list remembers which lead a number came from; screening rows have no lead.
    leadNameMap(input.tenantId, internalRows.map((row) => text(row.lead_id))),
  ]);

  const entries: SuppressionEntry[] = [
    ...internalRows.map((row) => ({
      id: text(row.id),
      phoneDigits: text(row.phone_digits),
      listType: "internal" as const,
      reason: text(row.reason),
      // `tenant_do_not_call` predates the `source` column and has none. Saying "we do not record
      // it for this store" by returning null is more honest than labelling every row "manual".
      source: null,
      addedAt: text(row.created_at),
      addedByName: names.get(text(row.added_by)) ?? null,
      leadId: text(row.lead_id) || null,
      leadName: leadNames.get(text(row.lead_id)) ?? null,
    })),
    ...externalRows.map((row) => ({
      id: text(row.id),
      phoneDigits: text(row.phone_digits),
      listType: text(row.list_type) as SuppressionListType,
      reason: text(row.reason),
      source: (text(row.source) || null) as SuppressionSource | null,
      addedAt: text(row.added_at),
      addedByName: names.get(text(row.added_by)) ?? null,
    })),
  ].sort((a, b) => b.addedAt.localeCompare(a.addedAt));

  const hasMore = internalRows.length > limit || externalRows.length > limit;

  return {
    entries: entries.slice(0, limit),
    counts: {
      internal: (internalCount as unknown as { count?: number }).count ?? 0,
      external: (externalCount as unknown as { count?: number }).count ?? 0,
    },
    hasMore,
  };
}

export type SuppressionCheck = {
  phoneDigits: string;
  suppressed: boolean;
  listType: string | null;
  reason: string | null;
};

/**
 * The same answer the dialer gets, for a number somebody is asking about.
 *
 * This calls `is_phone_suppressed` rather than querying the two tables, on purpose: if the screen
 * ran its own query it could answer "not suppressed" for a number the dialer would refuse, and the
 * whole point of the screen is to be able to tell somebody what will happen.
 */
export async function checkPhone(tenantId: string, phone: string): Promise<SuppressionCheck> {
  const digits = normalizeDigits(phone);
  if (!digits) throw new Error("That is not a ten-digit US phone number.");

  const result = await db().rpc("is_phone_suppressed", { p_tenant_id: tenantId, p_phone: digits });
  if (result.error) throw new Error(`Could not check that number: ${result.error.message}`);

  // The function returns a table, so PostgREST hands back an array of one row — or an empty array
  // when nothing matched.
  const row = Array.isArray(result.data) ? (result.data[0] as Record<string, unknown> | undefined) : null;
  return {
    phoneDigits: digits,
    suppressed: row?.suppressed === true,
    listType: row ? text(row.list_type) || null : null,
    reason: row ? text(row.reason) || null : null,
  };
}

export async function suppressPhone(input: {
  tenantId: string;
  userId: string;
  phone: string;
  listType: SuppressionListType;
  reason: string;
  source: SuppressionSource;
}): Promise<SuppressionCheck> {
  const digits = normalizeDigits(input.phone);
  if (!digits) throw new Error("That is not a ten-digit US phone number.");

  const result = await db().rpc("suppress_phone", {
    p_tenant_id: input.tenantId,
    p_phone: digits,
    p_list_type: input.listType,
    p_reason: input.reason,
    p_source: input.source,
    p_added_by: input.userId,
  });
  if (result.error) {
    // The function raises `not_a_us_phone` with a check_violation code. Passing its own words
    // through would show the caller a Postgres exception; this says the same thing in the screen's
    // vocabulary.
    if (result.error.message.includes("not_a_us_phone"))
      throw new Error("That is not a ten-digit US phone number.");
    throw new Error(`Could not suppress that number: ${result.error.message}`);
  }

  // Read the answer back through the same function the dialer uses, rather than reporting success
  // from the write. A suppression that did not take is the one failure mode that matters here.
  return checkPhone(input.tenantId, digits);
}
