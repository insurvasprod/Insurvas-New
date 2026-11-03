import { type NextRequest } from "next/server";

import { apiError, apiJson, authenticateApiKey } from "@/lib/apiKeys/authenticate";
import { LEAD_FIELDS } from "@/lib/apiKeys/fields";
import { decodeTimestampCursor, encodeCursor, pageLimit, pickLeadFields } from "@/lib/apiKeys/rules";
import { acceptPostedLead } from "@/lib/leadPost/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-8.7 · the public API's leads.
 *
 * POST (leads:write) posts a lead through LA-2.5's lead posting, as the vendor named in the
 * `Insurvas-Vendor` header: that vendor's field map, campaign, duplicate and consent checks, rate
 * limit and billing log apply, exactly as if it had posted with its own key.
 *
 * GET (leads:read) lists leads newest first: id, dates, stage, campaign and the working fields
 * (name, phone, email, state, zip, city). Nothing else from the form comes out.
 */

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, "POST /api/v1/leads");
  if (auth instanceof Response) return auth;
  const vendorId = request.headers.get("insurvas-vendor")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(vendorId)) return apiError(400, "vendor_required", "Name the vendor this lead comes from in the Insurvas-Vendor header (its id from Settings › Lead posting).");
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return apiError(400, "invalid_body", "The body must be a JSON object.");

  const outcome = await acceptPostedLead({
    key: "",
    payload: payload as Record<string, unknown>,
    idempotencyKey: request.headers.get("idempotency-key")?.slice(0, 200) ?? null,
    vendorKey: { tenantId: auth.tenantId, vendorId },
  });
  return apiJson({ accepted: outcome.outcome === "accepted", reason_code: outcome.reasonCode, message: outcome.message, lead_id: outcome.leadId }, { status: outcome.status });
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, "GET /api/v1/leads");
  if (auth instanceof Response) return auth;
  const params = new URL(request.url).searchParams;
  const limit = pageLimit(params.get("limit"));
  const cursor = decodeTimestampCursor(params.get("cursor"));
  if (params.get("cursor") && !cursor) return apiError(400, "invalid_cursor", "That cursor is not one this API gave out.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (getSupabaseServiceClient() as any).from("agent_leads")
    .select(LEAD_FIELDS)
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) query = query.or(`created_at.lt.${cursor.sortValue},and(created_at.eq.${cursor.sortValue},id.lt.${cursor.id})`);
  const result = await query;
  if (result.error) return apiError(500, "internal", "Leads could not be read.");

  const rows = (result.data ?? []) as Array<{ id: string; created_at: string; updated_at: string; product_line: string; pipeline_id: string; stage_id: string; campaign_id: string | null; values: unknown }>;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return apiJson({
    data: page.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      product_line: row.product_line,
      pipeline_id: row.pipeline_id,
      stage_id: row.stage_id,
      campaign_id: row.campaign_id,
      fields: pickLeadFields(row.values),
    })),
    next_cursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  });
}
