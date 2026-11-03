import { type NextRequest } from "next/server";

import { apiError, apiJson, authenticateApiKey } from "@/lib/apiKeys/authenticate";
import { COMMISSION_FIELDS } from "@/lib/apiKeys/fields";
import { decodeTimestampCursor, encodeCursor, pageLimit } from "@/lib/apiKeys/rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-8.7 · GET /api/v1/commissions (commissions:read) — commission entries from carrier statements,
 * newest first: type, policy, carrier, dates, rate and amount. `?since=YYYY-MM-DD` limits by the
 * date the entry was recorded.
 */

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, "GET /api/v1/commissions");
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const limit = pageLimit(params.get("limit"));
  const cursor = decodeTimestampCursor(params.get("cursor"));
  if (params.get("cursor") && !cursor) return apiError(400, "invalid_cursor", "That cursor is not one this API gave out.");
  const since = params.get("since");
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return apiError(400, "invalid_since", "since must be a date, YYYY-MM-DD.");

  const client = getSupabaseServiceClient() as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let query = client.from("commission_entry").select(COMMISSION_FIELDS).eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
  if (since) query = query.gte("created_at", `${since}T00:00:00Z`);
  if (cursor) query = query.or(`created_at.lt.${cursor.sortValue},and(created_at.eq.${cursor.sortValue},id.lt.${cursor.id})`);
  const [result, carriers] = await Promise.all([query, client.from("carriers").select("id, name")]);
  if (result.error) return apiError(500, "internal", "Commission entries could not be read.");

  const names = new Map(((carriers.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const rows = (result.data ?? []) as Array<Record<string, unknown> & { id: string; carrier_id: string; created_at: string }>;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return apiJson({
    data: page.map(({ carrier_id, ...rest }) => ({ ...rest, carrier: { id: carrier_id, name: names.get(carrier_id) ?? null } })),
    next_cursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  });
}
