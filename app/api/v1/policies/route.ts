import { type NextRequest } from "next/server";

import { apiError, apiJson, authenticateApiKey } from "@/lib/apiKeys/authenticate";
import { POLICY_FIELDS } from "@/lib/apiKeys/fields";
import { decodePolicyCursor, encodeCursor, pageLimit } from "@/lib/apiKeys/rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-8.7 · GET /api/v1/policies (policies:read) — the book of business as the carrier files report
 * it: policy number, carrier, status, dates and premium. No client name, no payment details.
 * `?status=active|lapsed|…` filters; paged by carrier and policy number.
 */

const STATUSES = new Set(["submitted", "declined", "withdrawn", "approved_unpaid", "not_taken", "active", "at_risk", "lapsed", "paid_up"]);

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, "GET /api/v1/policies");
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const limit = pageLimit(params.get("limit"));
  const status = params.get("status");
  if (status && !STATUSES.has(status)) return apiError(400, "invalid_status", `status must be one of ${[...STATUSES].join(", ")}.`);
  // The cursor's "sort value" is the carrier id; its id half is the policy number's position, so
  // a policy cursor carries both in the sort value instead.
  const raw = params.get("cursor");
  let after: { carrierId: string; policyNumber: string } | null = null;
  if (raw) {
    const decoded = decodePolicyCursor(raw);
    if (!decoded) return apiError(400, "invalid_cursor", "That cursor is not one this API gave out.");
    after = { carrierId: decoded.id, policyNumber: decoded.sortValue };
  }

  const client = getSupabaseServiceClient() as unknown as { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let query = client.from("policy_current").select(POLICY_FIELDS).eq("tenant_id", auth.tenantId)
    .order("carrier_id", { ascending: true }).order("policy_number", { ascending: true }).limit(limit + 1);
  if (status) query = query.eq("status_normalized", status);
  if (after) query = query.or(`carrier_id.gt.${after.carrierId},and(carrier_id.eq.${after.carrierId},policy_number.gt."${after.policyNumber}")`);
  const [result, carriers] = await Promise.all([query, client.from("carriers").select("id, name")]);
  if (result.error) return apiError(500, "internal", "Policies could not be read.");

  const names = new Map(((carriers.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const rows = (result.data ?? []) as Array<Record<string, unknown> & { carrier_id: string; policy_number: string }>;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return apiJson({
    data: page.map(({ carrier_id, status_normalized, ...rest }) => ({ ...rest, status: status_normalized, carrier: { id: carrier_id, name: names.get(carrier_id) ?? null } })),
    next_cursor: rows.length > limit && last ? encodeCursor(last.policy_number, last.carrier_id) : null,
  });
}
