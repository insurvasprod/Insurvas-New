import "server-only";

import { screenPartnerPhone } from "@/lib/compliance/screening";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeBatchInput, normalizeRecycleRule } from "./contract";

type RpcError = { message: string; code?: string };
type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: RpcError | null }> };
const rpc = () => getSupabaseServiceClient() as unknown as RpcClient;
type LooseQuery = PromiseLike<{ data: unknown; error: RpcError | null }> & { eq(column: string, value: unknown): LooseQuery; update(values: Record<string, unknown>): LooseQuery };

export type NurtureRule = { wait_days: number; allowed_dispositions: string[]; max_recycles: number };
export type NurtureCampaign = { campaign_id: string; campaign_name: string; status: string; scrub_status: string; rule: NurtureRule; eligible_count: number; reactivated_count: number };

/** A write that needs 20260925706500, asked of a database that does not have it yet. */
export class RecyclingNotApplied extends Error {
  constructor() { super("This setting needs a database update that has not been applied yet."); }
}

/** A refusal from the recycling SQL, with the status the route should answer. */
export class RecyclingRefused extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

const REFUSALS: Record<string, { status: number; message: string }> = {
  ROLE_NOT_ALLOWED: { status: 403, message: "Only owners and producers can recycle leads." },
  CAMPAIGN_NOT_FOUND: { status: 404, message: "That campaign is not in this agency." },
  RECYCLE_ANGLE_REQUIRED: { status: 400, message: "Say what is different this time — the angle is required." },
  RECYCLE_SCRIPT_TOO_LONG: { status: 400, message: "The script is too long." },
  RECYCLE_CEILING_INVALID: { status: 400, message: "Attempts this pass must be between 1 and 7." },
  RECYCLE_BATCH_OPEN: { status: 409, message: "This campaign already has a batch being screened. Finish or resume it first." },
  RECYCLE_NOTHING_ELIGIBLE: { status: 409, message: "Nothing in this campaign meets the rule right now." },
  RECYCLE_CAP_ZERO: { status: 409, message: "The recycle cap is 0, so no lead in this campaign can be recycled." },
  RECYCLE_BATCH_NOT_FOUND: { status: 404, message: "That batch is not in this agency." },
  RECYCLE_BATCH_NOT_YOURS: { status: 403, message: "Only the person who started this batch can continue it. An owner can resume it once it has made no progress for 15 minutes." },
  RECYCLE_BATCH_RUNNING: { status: 409, message: "This batch is still being screened by the person who started it. An owner can resume it once it has made no progress for 15 minutes." },
};

/** 42883 / PGRST202: the function (or this signature of it) is not in the database yet. */
export function isMissingSchema(error: RpcError | null | undefined) {
  if (!error) return false;
  return ["42883", "42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code ?? "") || /could not find the function|does not exist/i.test(error.message);
}

function refusal(error: RpcError, fallback: string): Error {
  if (isMissingSchema(error)) return new RecyclingNotApplied();
  const code = Object.keys(REFUSALS).find((key) => error.message.includes(key));
  if (code) return new RecyclingRefused(REFUSALS[code].message, REFUSALS[code].status, code);
  return new Error(`${fallback}: ${error.message}`);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The nurture response was invalid");
  return value as Record<string, unknown>;
}

export async function listNurtureCampaigns(tenantId: string): Promise<NurtureCampaign[]> {
  const result = await rpc().rpc("tenant_nurture_campaigns", { p_tenant_id: tenantId });
  if (result.error) throw new Error(`Could not load nurture campaigns: ${result.error.message}`);
  if (!Array.isArray(result.data)) throw new Error("The nurture campaigns response was invalid");
  return result.data as NurtureCampaign[];
}

export async function saveNurtureRule(tenantId: string, actorId: string, campaignId: string, input: { waitDays: number; allowedDispositions: string[]; maxRecycles: number }) {
  const rule = normalizeRecycleRule(input);
  const allowed = rule.allowedDispositions;
  const result = await rpc().rpc("upsert_campaign_recycle_rule", { p_tenant_id: tenantId, p_campaign_id: campaignId, p_wait_days: rule.waitDays, p_allowed_dispositions: allowed, p_max_recycles: rule.maxRecycles, p_updated_by: actorId });
  if (result.error) throw new Error(`Could not save recycle rule: ${result.error.message}`);
  return object(result.data);
}

/**
 * Starts a batch (reactivate_nurture, 20260925706500): the batch row and one pending reactivation
 * per eligible lead. No lead moves yet — each one moves only when its own screening clears, in
 * screenRecycleChunk. The eligibility rules (owner-only "Not interested" after 90 days, every
 * suppression hit excluded, resting leads left alone) are the SQL's, not this function's.
 */
export async function startRecycleBatch(tenantId: string, actorId: string, campaignId: string, input: { angle: string; script?: string | null; attemptCeiling?: number | null }) {
  const batch = normalizeBatchInput(input);
  const result = await rpc().rpc("reactivate_nurture", { p_tenant_id: tenantId, p_campaign_id: campaignId, p_actor: actorId, p_angle: batch.angle, p_script: batch.script, p_attempt_ceiling: batch.attemptCeiling });
  if (result.error) throw refusal(result.error, "Could not start the batch");
  const payload = object(result.data);
  return { batchId: String(payload.batch_id), queued: Number(payload.queued ?? 0), excludedTooRecent: Number(payload.excluded_too_recent ?? 0), saidNo: Number(payload.said_no ?? 0), attemptCeiling: Number(payload.attempt_ceiling ?? batch.attemptCeiling) };
}

type ChunkItem = { reactivation_id: string; lead_id: string; phone: string | null };

/**
 * Screens the next chunk of a batch — the page calls this until `done`. Each lead is leased for
 * five minutes by recycle_batch_claim_chunk, so a closed tab or a timed-out request leaves the rest
 * pending, not lost; the next call (or an owner, after 15 minutes without progress) carries on.
 *
 *   clear / internal_dq   cleared: the SQL moves the lead to nurture and queues it for the dialer
 *                         (it may still refuse — a suppression hit since, or someone working it)
 *   dnc / litigator       blocked: the number is suppressed; the lead stays where it was
 *   unavailable / invalid failed: the lead is held where it was, for a later batch
 *
 * `internal_dq` means the number matches an existing lead — for a recycled lead, itself.
 */
export async function screenRecycleChunk(tenantId: string, actorId: string, batchId: string, limit = 10) {
  const claimed = await rpc().rpc("recycle_batch_claim_chunk", { p_tenant_id: tenantId, p_batch_id: batchId, p_actor: actorId, p_limit: limit });
  if (claimed.error) throw refusal(claimed.error, "Could not continue the batch");
  const payload = object(claimed.data);
  if (payload.done === true) return { done: true, screened: 0, cleared: 0, blocked: 0, failed: 0, pending: 0, busyElsewhere: false };
  const items = (Array.isArray(payload.items) ? payload.items : []) as ChunkItem[];

  const db = getSupabaseServiceClient() as unknown as { from(table: string): LooseQuery };
  let cleared = 0;
  let blocked = 0;
  let failed = 0;
  for (const item of items) {
    // LA-2.3-9: a recycle re-screens a known lead, so its audit row names it.
    const screening = await screenPartnerPhone({ tenantId, partnerId: null, userId: actorId, phone: item.phone, leadId: item.lead_id });
    let status: "cleared" | "blocked" | "failed";
    if (screening.outcome === "unavailable" || screening.outcome === "invalid_phone") {
      status = "failed";
    } else {
      // The screening itself is a fact about the lead whatever happens next.
      const written = await db.from("agent_leads").update({ screening_result_id: screening.resultId, screening_version: screening.version, screening_outcome: screening.outcome, screening_warning: screening.warning?.message ?? null, screening_checked_at: screening.checkedAt }).eq("tenant_id", tenantId).eq("id", item.lead_id);
      if (written.error) throw new Error(`Could not record the screening: ${written.error.message}`);
      if (screening.outcome === "dnc" || screening.outcome === "tcpa_litigator") {
        const suppressed = await rpc().rpc("suppress_phone", { p_tenant_id: tenantId, p_phone: String(item.phone ?? ""), p_list_type: screening.outcome === "tcpa_litigator" ? "tcpa_litigator" : "federal_dnc", p_reason: "Recycle screening blocked this number", p_source: "vendor", p_added_by: actorId });
        if (suppressed.error) throw new Error(`Could not suppress the number: ${suppressed.error.message}`);
        status = "blocked";
      } else {
        status = "cleared";
      }
    }
    const completed = await rpc().rpc("complete_nurture_reactivation", { p_tenant_id: tenantId, p_reactivation_id: item.reactivation_id, p_status: status, p_result_id: screening.resultId, p_outcome: screening.outcome, p_reason: screening.message });
    if (completed.error) throw refusal(completed.error, "Could not settle a screened lead");
    // The SQL may settle it differently from what was asked (a suppression hit since, a lead being
    // worked), so the count is what it recorded.
    const final = String(object(completed.data).status ?? status);
    if (final === "cleared") cleared++;
    else if (final === "blocked") blocked++;
    else failed++;
  }
  const pending = Math.max(0, Number(payload.pending ?? 0) - items.length);
  return { done: pending === 0, screened: items.length, cleared, blocked, failed, pending, busyElsewhere: items.length === 0 && Number(payload.pending ?? 0) > 0 };
}
