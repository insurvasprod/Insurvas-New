import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { assertOutboundLimit, outboundLimitResponse } from "@/lib/metering/outbound";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { CAMPAIGN_REFERENCES, deleteBlocker, isForeignKeyRefusal, type GuardDb } from "@/lib/campaigns/deleteGuards";

const roles = ["owner", "producer"] as const;
type Result<T> = { data: T; error: { message: string; code?: string } | null };
type DeleteQuery = { delete(): { eq(column: string, value: unknown): { eq(column: string, value: unknown): { select(columns: string): PromiseLike<Result<unknown>> } } } };
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
  // A campaign's Settings tab (owner pick C, 2026-10-30): its name, the vendor it came from (the
  // vendor-tenant trigger refuses another tenant's vendor) and its lead type.
  name: z.string().trim().min(1).max(160).optional(),
  vendor_id: z.string().uuid().optional(),
  lead_type: z.enum(["list", "realtime", "aged"]).optional(),
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
    // The database's own cap (constraint trigger, reads plan_limits live) comes back as an error
    // value, not a throw. It is the same limit the check above names, so it answers the same 403
    // rather than a "Campaign not found" for a campaign that plainly exists.
    if (error && /max_active_campaigns/.test(error.message)) return NextResponse.json(activeCampaignCapResponse(error.message), { status: 403 });
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
    if (message.includes("max_active_campaigns")) return NextResponse.json(activeCampaignCapResponse(message), { status: 403 });
    return NextResponse.json({ error: "Could not change campaign status" }, { status: 400 });
  }
}

/**
 * Lead sources clean-up (owner 2026-10-29): delete a campaign for good, only while it is empty —
 * no leads, no imported or waiting file, no claim, invoice line, deal, policy, posting key or
 * win-back pointing at it (lib/campaigns/deleteGuards.ts lists every referencing table). Anything
 * with history is refused with a 409 and the way out, which stays "Mark exhausted". Same gate as
 * PATCH (owner/producer, the money boundary, not a read-only plan), refused for a narrow agency
 * session like the list route, tenant-scoped, audited.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("outbound_dialing", roles, { write: true, prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Campaigns");
  if (refused) return refused;
  const id = (await params).id;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Choose a valid campaign" }, { status: 400 });
  const tenantId = auth.context.tenantId;
  const service: unknown = getSupabaseServiceClient();
  const db = service as Db;
  try {
    const current = await db.from("tenant_campaigns").select("id, name, status, vendor_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle<{ id: string; name: string; status: string; vendor_id: string }>();
    if (current.error) throw new Error(current.error.message);
    if (!current.data) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const blocker = await deleteBlocker(service as GuardDb, tenantId, id, CAMPAIGN_REFERENCES);
    if (blocker) return NextResponse.json({ error: blocker, code: "campaign_in_use" }, { status: 409 });

    const removed = await (service as { from(table: string): DeleteQuery }).from("tenant_campaigns").delete().eq("id", id).eq("tenant_id", tenantId).select("id");
    if (isForeignKeyRefusal(removed.error)) return NextResponse.json({ error: "Something now points at this campaign — mark it exhausted instead.", code: "campaign_in_use" }, { status: 409 });
    if (removed.error) throw new Error(removed.error.message);
    if (!Array.isArray(removed.data) || removed.data.length === 0) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.campaign_deleted",
      targetType: "tenant_campaigns",
      targetId: id,
      metadata: { name: current.data.name, status: current.data.status, vendorId: current.data.vendor_id },
      request,
    });
    return NextResponse.json({ deleted: id });
  } catch {
    return NextResponse.json({ error: "Could not delete this campaign" }, { status: 500 });
  }
}

/** "max_active_campaigns:19:19" from the trigger, in words, with the way out. */
function activeCampaignCapResponse(message: string) {
  const match = /max_active_campaigns:(\d+):(\d+)/.exec(message);
  const usage = match ? Number(match[1]) : null;
  const limit = match ? Number(match[2]) : null;
  return {
    error: limit === null
      ? "Your plan has reached its limit of active campaigns. Pause a campaign or upgrade before activating another."
      : `Your plan has reached its limit of ${limit} active campaigns (${usage} of ${limit} active). Pause a campaign or upgrade before activating another.`,
    code: "limit_reached",
    limitKey: "max_active_campaigns",
    usage,
    limit,
    upgrade: true,
  };
}
