import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { assertOutboundLimit, outboundLimitResponse, outboundLimitSnapshot } from "@/lib/metering/outbound";
import { isSchemaGap, type SchemaGapNotice } from "@/lib/supabase/schemaGap";
import { campaignExtras } from "@/lib/campaigns/extras";

const roles = ["owner", "producer"] as const;
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result<unknown>> & { select(columns: string, options?: unknown): Query; eq(column: string, value: unknown): Query; order(column: string, options?: unknown): Query; insert(value: unknown): Query; single<T = unknown>(): Promise<Result<T>> };
type Db = { from(table: string): Query };
const campaignSchema = z.object({
  vendor_id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  lead_type: z.enum(["list", "realtime", "aged"]),
  product_code: z.string().trim().max(80).nullable().optional(),
  status: z.enum(["draft", "active", "paused", "exhausted"]).default("draft"),
}).strict();

const COST_COLUMNS = "campaign_id, vendor_id, name, lead_type, product_code, status, scrub_status, mixing_weight, total_spend_cents, records_purchased, credits_received_cents, records_rejected, records_usable, cost_per_record_cents, effective_cost_per_record_cents, cost_per_usable_record_cents, rejected_spend_cents";

// Everything the BASE table already stores. `cost_per_record_cents` and
// `effective_cost_per_record_cents` are generated columns on `tenant_campaigns`, so the purchased
// basis needs no arithmetic here — this fallback re-derives nothing and duplicates no money math.
// The usable basis genuinely cannot be answered without the rejection ledger, and is reported
// missing rather than guessed at.
const BASE_COLUMNS = "id, vendor_id, name, lead_type, product_code, status, scrub_status, mixing_weight, total_spend_cents, records_purchased, credits_received_cents, cost_per_record_cents, effective_cost_per_record_cents";

const USABLE_BASIS_MISSING: SchemaGapNotice = {
  missing: ["records_rejected", "records_usable", "cost_per_usable_record_cents", "rejected_spend_cents"],
  detail:
    "Cost per usable record needs the scrub-rejection ledger, which a pending migration creates. Spend, records purchased and cost per purchased record are exact.",
};

export async function GET() {
  const auth = await requireFeatureRole("outbound_dialing", roles);
  if (auth instanceof NextResponse) return auth;
  const db = getSupabaseServiceClient() as unknown as Db;
  // Read from `tenant_campaign_costs`, not `tenant_campaigns`. The view carries the same rows plus
  // the three numbers LA-2.1 and LA-2.2 are actually about: how many rows were rejected at scrub,
  // how many are usable, and what a usable lead really cost. Reading the base table is how the
  // cost-per-record column ended up captured and never displayed.
  // The concept audit's per-campaign facts (worked, workable, cadence, scrub run, cost per issued,
  // test batch) ride alongside, each tolerant of its own migration not being applied yet.
  const [full, extras] = await Promise.all([
    db.from("tenant_campaign_costs").select(COST_COLUMNS).eq("tenant_id", auth.context.tenantId).order("name"),
    campaignExtras(auth.context.tenantId, auth.entitlement),
  ]);
  const shared = { ...extras, canScrub: auth.context.role === "owner" };
  if (!full.error)
    return NextResponse.json(
      { campaigns: full.data ?? [], limits: await outboundLimitSnapshot(auth.context.tenantId), ...shared },
      { headers: { "Cache-Control": "no-store" } },
    );

  // A fault is still a fault. Only a not-yet-deployed view falls through to the base table.
  if (!isSchemaGap(full.error))
    return NextResponse.json({ error: `Could not load campaigns: ${full.error.message}` }, { status: 500 });

  const base = await db.from("tenant_campaigns").select(BASE_COLUMNS).eq("tenant_id", auth.context.tenantId).order("name");
  if (base.error)
    return NextResponse.json({ error: `Could not load campaigns: ${base.error.message}` }, { status: 500 });

  const rows = ((base.data as Array<Record<string, unknown>> | null) ?? []).map(({ id, ...rest }) => ({
    ...rest,
    campaign_id: id,
    records_rejected: null,
    records_usable: null,
    cost_per_usable_record_cents: null,
    rejected_spend_cents: null,
  }));
  return NextResponse.json(
    { campaigns: rows, limits: await outboundLimitSnapshot(auth.context.tenantId), pending: USABLE_BASIS_MISSING, ...shared },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = campaignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid campaign details" }, { status: 400 });
  try {
    if (parsed.data.status === "active") await assertOutboundLimit(auth.context.tenantId, "max_active_campaigns");
    const { data, error } = await (getSupabaseServiceClient() as unknown as Db).from("tenant_campaigns").insert({ ...parsed.data, tenant_id: auth.context.tenantId, product_code: parsed.data.product_code ?? null, created_by: auth.context.userId }).select("id, vendor_id, name, lead_type, product_code, status, paused_at, created_at, updated_at").single();
    if (error || !data) throw new Error(error?.message ?? "Could not create campaign");
    return NextResponse.json({ campaign: data }, { status: 201 });
  } catch (error) {
    const limit = outboundLimitResponse(error);
    if (limit) return NextResponse.json(limit, { status: 403 });
    const message = error instanceof Error ? error.message : "Could not create campaign";
    if (message.includes("max_active_campaigns")) return NextResponse.json({ error: "Your plan has reached active campaigns. Upgrade to activate another campaign.", code: "limit_reached", limitKey: "max_active_campaigns", upgrade: true }, { status: 403 });
    return NextResponse.json({ error: "Could not create campaign" }, { status: 400 });
  }
}
