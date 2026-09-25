import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { assertOutboundLimit, outboundLimitResponse } from "@/lib/metering/outbound";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

const roles = ["owner", "producer"] as const;
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result<unknown>> & { select(columns: string, options?: unknown): Query; eq(column: string, value: unknown): Query; update(value: unknown): Query; maybeSingle<T = unknown>(): Promise<Result<T | null>>; single<T = unknown>(): Promise<Result<T>> };
type Db = { from(table: string): Query };
/**
 * LA-2.1 criterion 2: "Effective cost per record changes when a credit is recorded, and the change
 * is visible."
 *
 * The spend fields were writable only by whoever had database access, so the derived cost columns
 * could never change from inside the product and the criterion was unreachable. They are editable
 * here, with the same owner/producer gate as the rest of the campaign.
 *
 * `credits_received_cents` is deliberately NOT here. A credit is the outcome of a vendor return
 * claim (LA-2.19) and must arrive through that ledger, not by someone typing a number into a form
 * — otherwise "we got $63 back" has no evidence behind it and the effective cost becomes a matter
 * of opinion.
 *
 * Nor is `scrub_status`. A campaign becomes scrubbed only by an import that screened it or by a
 * completed re-scrub run (POST ./scrub) — never by a request that says so.
 */
const statusSchema = z.object({
  // `exhausted` is an owner's or producer's call ("Mark exhausted"). Nothing sets it on its own; the
  // screen only hints when a campaign has no workable leads left.
  status: z.enum(["draft", "active", "paused", "exhausted"]).optional(),
  total_spend_cents: z.number().int().min(0).max(1_000_000_00).optional(),
  records_purchased: z.number().int().min(0).max(10_000_000).optional(),
  // Relative, not a percentage: weights 4 and 2 serve 2:1, which is criterion 5. Zero would mean
  // "never serve", and that is what `paused` is for, so the floor is 1.
  mixing_weight: z.number().int().min(1).max(100).optional(),
  target_states: z.array(z.string().trim().length(2)).max(60).optional(),
  product_code: z.string().trim().max(80).nullable().optional(),
  // A small trial buy (Scorecard's column, 20260925708000). The scorecard labels it rather than
  // reading two policies as a verdict.
  is_test_batch: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

const COST_COLUMNS = "campaign_id, vendor_id, name, lead_type, product_code, status, scrub_status, mixing_weight, total_spend_cents, records_purchased, credits_received_cents, records_rejected, records_usable, cost_per_record_cents, effective_cost_per_record_cents, cost_per_usable_record_cents, rejected_spend_cents";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Choose a valid campaign" }, { status: 400 });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid campaign status" }, { status: 400 });
  const db = getSupabaseServiceClient() as unknown as Db;
  try {
    const current = await db.from("tenant_campaigns").select("status, scrub_status").eq("id", id).eq("tenant_id", auth.context.tenantId).maybeSingle<{ status: string; scrub_status: string | null }>();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    if (parsed.data.status === "active" && current.data.status !== "active") await assertOutboundLimit(auth.context.tenantId, "max_active_campaigns");

    const { data, error } = await db.from("tenant_campaigns").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", auth.context.tenantId).select("id, status, scrub_status, paused_at, updated_at").single<{ id: string; status: string; scrub_status: string | null }>();
    // The test-batch column is Scorecard's migration. Until it is applied, the flag cannot be
    // stored, and saying so beats a 404 for a campaign that plainly exists.
    if (error && parsed.data.is_test_batch !== undefined && isSchemaGap(error))
      return NextResponse.json({ error: "This setting needs a database update that has not been applied yet.", code: "schema_pending" }, { status: 503 });
    if (error || !data) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.campaign_updated",
      targetType: "tenant_campaigns",
      targetId: id,
      metadata: { changed: Object.keys(parsed.data), from: { status: current.data.status }, to: parsed.data },
      request,
    });

    // Re-read through the cost view so the response carries the recomputed cost per record. The
    // caller changed spend in order to see the cost move; returning only the status would make the
    // screen show a stale number until a refresh, which is the criterion failing quietly.
    const costs = await db.from("tenant_campaign_costs").select(COST_COLUMNS).eq("campaign_id", id).eq("tenant_id", auth.context.tenantId).maybeSingle();
    // Activating an unscrubbed campaign is allowed (user decision); the response says whether it
    // actually serves, so the screen never claims "serving again" for leads the queue withholds.
    return NextResponse.json({ campaign: costs.data ?? data, serving: data.status === "active" && data.scrub_status === "scrubbed" });
  } catch (error) {
    const limit = outboundLimitResponse(error);
    if (limit) return NextResponse.json(limit, { status: 403 });
    const message = error instanceof Error ? error.message : "Could not change campaign status";
    if (message.includes("max_active_campaigns")) return NextResponse.json({ error: "Your plan has reached active campaigns. Pause a campaign or upgrade before activating another.", code: "limit_reached", limitKey: "max_active_campaigns", upgrade: true }, { status: 403 });
    return NextResponse.json({ error: "Could not change campaign status" }, { status: 400 });
  }
}
