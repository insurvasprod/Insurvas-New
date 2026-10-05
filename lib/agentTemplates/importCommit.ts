import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { friendlyImportCommitError } from "@/lib/agentTemplates/errors";
import type { CapturedConsent } from "@/lib/consent/capture";

/**
 * LA-2.2-9 · the one write of a list import: its scrub-rejection ledger, its leads, their sources,
 * the campaign's spend, each new lead's calling zone and each row's consent certificate — all in one
 * transaction (`commit_reviewed_lead_import`, 20260925709610), so a failure anywhere leaves nothing.
 *
 * Both import paths commit through here: the reviewed import (importPreflight.commitImport) and the
 * direct POST (service.importAgentLeads).
 *
 * Before that migration the transaction does not exist, and the order is the one the spec allows as
 * the alternative: the leads commit first (import_agent_lead_batch, itself one transaction), and the
 * ledger is written ONLY AFTER that succeeds. A failed commit then leaves no ledger rows. The
 * certificates are filed after it too, best effort, and the calling zone cannot be stored at all
 * (the column is the migration's).
 */

type DbError = { message: string; code?: string };
type RpcResult = { data: unknown; error: DbError | null };
type Db = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  from(table: string): {
    upsert(rows: unknown[], options: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<{ error: DbError | null; count?: number | null }>;
  };
};

export type ScrubRejection = { phone_digits: string; outcome: string; detail: string; source_key: string; occurrence?: number };

export type ImportItem = Record<string, unknown> & { dial_timezone?: string | null; consent?: CapturedConsent | null };

export type ImportCommitResult = {
  /** One lead id per item, in order. */
  ids: string[];
  rejectionsRecorded: number;
  artefactsFiled: number;
  /** True when the ledger, leads and certificates committed in the single transaction. */
  atomic: boolean;
  /** Set when, before the migration, something after the leads could not be written. */
  warning: string | null;
};

/** Thrown for the three refusals each caller words itself. */
export class ImportCommitRefusal extends Error {
  constructor(readonly reason: "already_committed" | "spend_overflow" | "spend_invalid" | "spend_needs_migration", message: string) {
    super(message);
  }
}

export function isMissingFunction(error: DbError | null | undefined) {
  if (!error) return false;
  return ["42883", "PGRST202", "42P01", "PGRST205"].includes(error.code ?? "") || /could not find the function/i.test(error.message);
}

function refusalOf(error: DbError): Error {
  const message = error.message ?? "";
  if (/IMPORT_BATCH_ALREADY_COMMITTED/.test(message)) return new ImportCommitRefusal("already_committed", "This list has already been imported. Nothing was imported again.");
  if (/IMPORT_SPEND_OVERFLOW/.test(message))
    return new ImportCommitRefusal("spend_overflow", "Adding this cost would take the campaign's total spend past what it can record. Check the amount, or untick “Add to the campaign's spend”.");
  if (/IMPORT_SPEND_INVALID/.test(message)) return new ImportCommitRefusal("spend_invalid", "The batch cost is not a valid amount. Upload the file again and re-enter it.");
  return friendlyImportCommitError(error) ?? new Error(message || "Could not commit the lead import batch");
}

const isRepeatConstraint = (error: DbError | null) => Boolean(error && /check constraint|duplicate_in_file/i.test(error.message ?? ""));

/** What the fallback path writes after the leads: every certificate, ignoring ones already filed. */
async function fileCertificates(db: Db, tenantId: string, items: ImportItem[], ids: string[]) {
  const rows = items.flatMap((item, index) => {
    const consent = item.consent;
    const leadId = ids[index];
    if (!consent || !leadId || (!consent.certificate_url && !consent.certificate_id)) return [];
    return [{ tenant_id: tenantId, lead_id: leadId, ...consent, capture_status: "pending" }];
  });
  let filed = 0;
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500);
    const result = await db.from("tenant_consent_artefacts").upsert(chunk, { onConflict: "tenant_id,lead_id,provider", ignoreDuplicates: true });
    if (result.error) return { filed, error: result.error.message };
    filed += chunk.length;
  }
  return { filed, error: null as string | null };
}

async function recordLedger(db: Db, tenantId: string, campaignId: string, userId: string, rejections: ScrubRejection[], withoutRepeats: ScrubRejection[]) {
  let payload = rejections;
  let recorded = await db.rpc("record_campaign_scrub_rejections", { p_tenant_id: tenantId, p_campaign_id: campaignId, p_created_by: userId, p_rejections: payload });
  // Before 20260925703100 the ledger has no duplicate outcome and refuses the whole payload on its
  // check constraint: every other rejection is recorded, the repeats not.
  if (recorded.error && isRepeatConstraint(recorded.error) && withoutRepeats.length < rejections.length) {
    payload = withoutRepeats;
    recorded = payload.length > 0
      ? await db.rpc("record_campaign_scrub_rejections", { p_tenant_id: tenantId, p_campaign_id: campaignId, p_created_by: userId, p_rejections: payload })
      : { data: 0, error: null };
  }
  return { recorded: payload.length, error: recorded.error };
}

export async function commitLeadImport(input: {
  tenantId: string;
  userId: string;
  items: ImportItem[];
  /** The staged batch the reviewed import commits; null for the direct import. */
  batchId: string | null;
  spend: { campaign_id: string; cost_cents: number; records_purchased: number } | null;
  campaignId: string | null;
  rejections: ScrubRejection[];
  /**
   * The same ledger without in-file repeats, for a database before 20260925703100, whose ledger has
   * no duplicate outcome and refuses the whole payload on its check constraint.
   */
  rejectionsWithoutRepeats?: ScrubRejection[];
}): Promise<ImportCommitResult> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const rejections = input.campaignId ? input.rejections : [];
  const withoutRepeats = input.rejectionsWithoutRepeats ?? rejections.filter((rejection) => rejection.outcome !== "duplicate_in_file");
  const ledger = input.campaignId && rejections.length > 0 ? { campaign_id: input.campaignId, items: rejections } : null;

  // ── the transaction ─────────────────────────────────────────────────────────────────────────
  const call = (payload: typeof ledger) => db.rpc("commit_reviewed_lead_import", {
    p_tenant_id: input.tenantId,
    p_created_by: input.userId,
    p_items: input.items,
    p_batch_id: input.batchId,
    p_campaign_spend: input.spend,
    p_rejections: payload,
  });
  let result = await call(ledger);
  if (result.error && ledger && isRepeatConstraint(result.error) && withoutRepeats.length < rejections.length) {
    result = await call(withoutRepeats.length ? { campaign_id: ledger.campaign_id, items: withoutRepeats } : null);
  }
  if (!result.error) {
    const data = (result.data ?? {}) as { ids?: unknown[]; rejections_recorded?: number; artefacts?: number };
    return {
      ids: (data.ids ?? []).filter((id): id is string => typeof id === "string"),
      rejectionsRecorded: Number(data.rejections_recorded ?? 0),
      artefactsFiled: Number(data.artefacts ?? 0),
      atomic: true,
      warning: null,
    };
  }
  if (!isMissingFunction(result.error)) throw refusalOf(result.error);

  // ── before 20260925709610: leads first, the ledger only after they committed ─────────────────
  let ids: string[] = [];
  if (input.items.length > 0) {
    let batch: RpcResult = input.batchId || input.spend
      ? await db.rpc("import_agent_lead_batch", { p_tenant_id: input.tenantId, p_created_by: input.userId, p_items: input.items, p_batch_id: input.batchId, p_campaign_spend: input.spend })
      : await db.rpc("import_agent_lead_batch", { p_tenant_id: input.tenantId, p_created_by: input.userId, p_items: input.items });
    if (batch.error && isMissingFunction(batch.error) && (input.batchId || input.spend)) {
      // Before 20260924330100. Adding the spend cannot be done in the same transaction without it.
      if (input.spend) throw new ImportCommitRefusal("spend_needs_migration", "spend needs 20260924330100");
      batch = await db.rpc("import_agent_lead_batch", { p_tenant_id: input.tenantId, p_created_by: input.userId, p_items: input.items });
    }
    if (batch.error) throw refusalOf(batch.error);
    ids = (Array.isArray(batch.data) ? batch.data : []).filter((id): id is string => typeof id === "string");
  }

  const warnings: string[] = [];
  let rejectionsRecorded = 0;
  if (input.campaignId && rejections.length > 0) {
    const written = await recordLedger(db, input.tenantId, input.campaignId, input.userId, rejections, withoutRepeats);
    if (written.error) {
      console.error(`[import] leads committed but the scrub-rejection ledger was not written for campaign ${input.campaignId}: ${written.error.message}`);
      warnings.push("The leads were imported, but the rows left out at the scrub could not be recorded for a vendor credit. Import the same file into the same campaign again to record them — nothing is imported twice.");
    } else rejectionsRecorded = written.recorded;
  }
  const certificates = await fileCertificates(db, input.tenantId, input.items, ids);
  if (certificates.error) {
    console.error(`[import] leads committed but ${input.items.filter((item) => item.consent).length} consent certificates were not filed: ${certificates.error}`);
    warnings.push("The leads were imported, but their consent certificates could not be filed.");
  }
  return { ids, rejectionsRecorded, artefactsFiled: certificates.filed, atomic: false, warning: warnings.join(" ") || null };
}

export { projectedUsableCostCents } from "@/lib/agentTemplates/importReviewModel";
