import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { commitLeadImport } from "@/lib/agentTemplates/importCommit";
import { leadDuplicateDecisionError, type LeadDuplicateDecision, type LeadDuplicateQueue, type LeadDuplicateSide } from "./types";

/**
 * Same-phone leads, asked about on Clean (owner 2026-10-29): "if you import the same file twice and
 * accept the leads anyway, the duplicates do not show up on Review or Clean".
 *
 * The import still attaches a number it already has to that lead (LA-2.20: one lead, many sources),
 * so nothing is lost and nothing is dialled twice; what changed is that every attached row is now a
 * question on Clean, with the row's own values kept so "different people" can still add it as a
 * lead of its own. Two lead rows that already shared a number were backfilled by the migration.
 *
 * Everything here needs 20261029600000. Before it, queueing is a no-op and the queue reads as not
 * set up, so imports and Clean behave exactly as before.
 */

type DbError = { message: string; code?: string } | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lead_duplicate_reviews is not in the generated types until 20261029600000
const loose = () => getSupabaseServiceClient() as any;

const MISSING_SCHEMA = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);
function isMissingSchema(error: DbError) {
  return Boolean(error && (MISSING_SCHEMA.has(error.code ?? "") || /schema cache|lead_duplicate_reviews/i.test(error.message ?? "")));
}

export const LEAD_DUPLICATES_PENDING = "Same-phone review needs database update 20261029600000, which has not been applied yet.";

export class LeadDuplicateConflictError extends Error {}
export class LeadDuplicatesNotReadyError extends Error {}

export type QueuedLeadDuplicate = {
  /** The lead the row was attached to. */
  leadId: string;
  phone: string;
  /** The row as it would have been inserted as a new lead (import_agent_lead_batch item, no lead_id). */
  incoming: Record<string, unknown>;
  campaignId: string | null;
  batchId: string | null;
  sourceKey: string | null;
};

const ROW_CHUNK = 500;

/**
 * Puts each attached row on Clean. Best effort, like the contact link after an import: it never
 * throws, because the leads it is about are already committed and calling the import failed would
 * be untrue. Returns how many questions were queued.
 */
export async function queueLeadDuplicates(tenantId: string, rows: readonly QueuedLeadDuplicate[]): Promise<number> {
  if (!rows.length) return 0;
  const payload = rows.map((row) => ({
    tenant_id: tenantId,
    lead_id: row.leadId,
    phone: row.phone,
    incoming: stripForStorage(row.incoming),
    campaign_id: row.campaignId,
    import_batch_id: row.batchId,
    source_key: row.sourceKey,
  }));
  let queued = 0;
  try {
    for (let at = 0; at < payload.length; at += ROW_CHUNK) {
      const chunk = payload.slice(at, at + ROW_CHUNK);
      const inserted = await loose().from("lead_duplicate_reviews").insert(chunk);
      if (!inserted.error) { queued += chunk.length; continue; }
      if (isMissingSchema(inserted.error)) return queued;
      // A row already asked about (the same batch's row sent twice) fails the whole chunk on the
      // unique index; then each row on its own, so the rest are still asked.
      if (inserted.error.code !== "23505") { console.error("[lead-duplicates] could not queue same-phone rows", inserted.error); return queued; }
      for (const item of chunk) {
        const one = await loose().from("lead_duplicate_reviews").insert(item);
        if (!one.error) queued += 1;
        else if (one.error.code !== "23505") { console.error("[lead-duplicates] could not queue a same-phone row", one.error); return queued; }
      }
    }
  } catch (error) {
    console.error("[lead-duplicates] could not queue same-phone rows", error);
  }
  return queued;
}

/** Tenant and creator are set again when the row is added; kept out of the stored copy. */
function stripForStorage(item: Record<string, unknown>) {
  const { tenant_id: _tenant, created_by: _creator, lead_id: _lead, ...rest } = item;
  void _tenant; void _creator; void _lead;
  return rest;
}

type ReviewRow = {
  id: string; lead_id: string; other_lead_id: string | null; incoming: Record<string, unknown> | null; phone: string;
  campaign_id: string | null; created_at: string;
};
type LeadRow = { id: string; values: Record<string, unknown> | null; created_at: string; campaign_id: string | null };

/** How many same-phone questions are waiting; null before the migration. */
export async function pendingLeadDuplicateCount(tenantId: string): Promise<number | null> {
  const result = await loose().from("lead_duplicate_reviews").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "pending");
  if (result.error) {
    if (isMissingSchema(result.error)) return null;
    throw new Error(`Could not count same-phone leads: ${result.error.message}`);
  }
  return result.count ?? 0;
}

/** The `index`th waiting question (0-based, oldest first), with both sides read. */
export async function getLeadDuplicateQueue(tenantId: string, index = 0): Promise<LeadDuplicateQueue> {
  const at = Math.max(0, Math.floor(index));
  const result = await loose().from("lead_duplicate_reviews")
    .select("id, lead_id, other_lead_id, incoming, phone, campaign_id, created_at", { count: "exact" })
    .eq("tenant_id", tenantId).eq("status", "pending").order("created_at").order("id").range(at, at);
  if (result.error) {
    if (isMissingSchema(result.error)) return { ready: false, total: 0, index: 0, item: null };
    throw new Error(`Could not load same-phone leads: ${result.error.message}`);
  }
  const total = result.count ?? 0;
  const row = (result.data ?? [])[0] as ReviewRow | undefined;
  if (!row) return total > 0 && at > 0 ? getLeadDuplicateQueue(tenantId, total - 1) : { ready: true, total, index: 0, item: null };

  const ids = [row.lead_id, row.other_lead_id].filter((id): id is string => Boolean(id));
  const leads = await loose().from("agent_leads").select("id, values, created_at, campaign_id").eq("tenant_id", tenantId).in("id", ids);
  if (leads.error) throw new Error(`Could not load the leads for this number: ${leads.error.message}`);
  const byId = new Map(((leads.data ?? []) as LeadRow[]).map((lead) => [lead.id, lead]));
  const existing = byId.get(row.lead_id);
  const other = row.other_lead_id ? byId.get(row.other_lead_id) : null;
  if (!existing || (row.other_lead_id && !other)) return { ready: true, total, index: at, item: null };

  const campaignIds = [...new Set([existing.campaign_id, other?.campaign_id, row.campaign_id].filter((id): id is string => Boolean(id)))];
  const campaigns = campaignIds.length
    ? await loose().from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).in("id", campaignIds)
    : { data: [], error: null };
  const nameOf = new Map(((campaigns.error ? [] : campaigns.data ?? []) as Array<{ id: string; name: string }>).map((item) => [item.id, item.name]));
  const side = (values: Record<string, unknown>, leadId: string | null, createdAt: string | null, campaignId: string | null): LeadDuplicateSide => ({
    leadId, values: pickValues(values), createdAt, campaign: campaignId ? nameOf.get(campaignId) ?? null : null,
  });
  const incomingValues = (row.incoming?.values ?? {}) as Record<string, unknown>;
  return {
    ready: true, total, index: at,
    item: {
      id: row.id,
      phone: row.phone,
      kind: other ? "pair" : "reimport",
      createdAt: row.created_at,
      existing: side(existing.values ?? {}, existing.id, existing.created_at, existing.campaign_id),
      incoming: other
        ? side(other.values ?? {}, other.id, other.created_at, other.campaign_id)
        : side(incomingValues, null, null, row.campaign_id),
    },
  };
}

/** The values a person compares: strings and numbers only, never consent blobs or nested objects. */
function pickValues(values: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

/**
 * Answers one question.
 *   same_person  the row stays attached to the lead it matched (re-import), or the two leads are
 *                recorded as one person (pair: nothing is merged; both stay and the answer is kept)
 *   separate     a re-imported row becomes a lead of its own; a pair is left as two leads
 * The status flip is conditional on `pending`, so a second click or a second person cannot act twice.
 */
export async function resolveLeadDuplicate(tenantId: string, userId: string, reviewId: string, decision: LeadDuplicateDecision): Promise<{ id: string; createdLeadId: string | null }> {
  const invalid = leadDuplicateDecisionError(decision);
  if (invalid) throw new LeadDuplicateConflictError(invalid);
  const read = await loose().from("lead_duplicate_reviews").select("id, lead_id, other_lead_id, incoming, status").eq("tenant_id", tenantId).eq("id", reviewId).maybeSingle();
  if (read.error) {
    if (isMissingSchema(read.error)) throw new LeadDuplicatesNotReadyError(LEAD_DUPLICATES_PENDING);
    throw new Error(`Could not read this question: ${read.error.message}`);
  }
  const row = read.data as (ReviewRow & { status: string }) | null;
  if (!row) throw new LeadDuplicateConflictError("This question is no longer waiting.");
  if (row.status !== "pending") throw new LeadDuplicateConflictError("Someone already answered this one.");

  let createdLeadId: string | null = null;
  if (decision === "separate" && row.incoming && !row.other_lead_id) {
    // Claimed first, so two clicks cannot add the lead twice; released if the add fails.
    const claimed = await claim(tenantId, userId, reviewId, "separate");
    if (!claimed) throw new LeadDuplicateConflictError("Someone already answered this one.");
    // The import's own write, so the new lead gets its source, calling zone and certificate as an
    // imported row does. No batch and no spend: the file's cost was already counted at import.
    const campaignId = typeof row.incoming.campaign_id === "string" ? row.incoming.campaign_id : null;
    let failure: string | null = null;
    try {
      const added = await commitLeadImport({ tenantId, userId, items: [{ ...row.incoming, tenant_id: tenantId, created_by: userId }], batchId: null, spend: null, campaignId, rejections: [] });
      createdLeadId = added.ids[0] ?? null;
      if (!createdLeadId) failure = "no lead came back";
    } catch (error) {
      failure = error instanceof Error ? error.message : "unknown error";
    }
    if (failure || !createdLeadId) {
      await loose().from("lead_duplicate_reviews").update({ status: "pending", resolved_at: null, resolved_by: null }).eq("tenant_id", tenantId).eq("id", reviewId).eq("status", "separate");
      throw new Error(`Could not add this row as a new lead: ${failure}`);
    }
    await loose().from("lead_duplicate_reviews").update({ created_lead_id: createdLeadId }).eq("tenant_id", tenantId).eq("id", reviewId);
    return { id: reviewId, createdLeadId };
  }
  if (!(await claim(tenantId, userId, reviewId, decision))) throw new LeadDuplicateConflictError("Someone already answered this one.");
  return { id: reviewId, createdLeadId };
}

async function claim(tenantId: string, userId: string, reviewId: string, status: "same_person" | "separate") {
  const updated = await loose().from("lead_duplicate_reviews")
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq("tenant_id", tenantId).eq("id", reviewId).eq("status", "pending").select("id");
  if (updated.error) throw new Error(`Could not save the answer: ${updated.error.message}`);
  return Array.isArray(updated.data) && updated.data.length > 0;
}
