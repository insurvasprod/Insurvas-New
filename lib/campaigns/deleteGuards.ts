import "server-only";

import { isSchemaGap } from "@/lib/supabase/schemaGap";

/**
 * Lead sources clean-up (owner 2026-10-29): a campaign or a vendor can be deleted for good only while
 * nothing points at it. Every table with a RESTRICT or SET NULL foreign key to `tenant_campaigns` /
 * `tenant_lead_vendors` is listed here (read off supabase/migrations), because a SET NULL row would
 * quietly lose its attribution and a RESTRICT row would refuse the delete with a raw 23503. Tables
 * that CASCADE (cadence, scripts, recycle rules, scrub runs, saved column maps, invoice templates) are
 * the campaign's or vendor's own settings and go with it.
 *
 * The way out for anything with history stays what it was: Mark exhausted (campaign) or Inactive
 * (vendor). The reasons say so.
 */
type Result = { data: unknown; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: string[]): Query;
  limit(count: number): Query;
};
export type GuardDb = { from(table: string): Query };

export type Reference = {
  table: string;
  column: string;
  /** Only rows in these states count (a discarded file, status 'failed', does not hold a campaign). */
  only?: { column: string; values: string[] };
  reason: string;
};

const EXHAUST = "mark it exhausted instead";
const INACTIVE = "set it to Inactive instead";

/** In priority order: the first one found is the reason given. */
export const CAMPAIGN_REFERENCES: Reference[] = [
  { table: "agent_leads", column: "campaign_id", reason: `It has leads — ${EXHAUST}.` },
  { table: "tenant_lead_sources", column: "campaign_id", reason: `It has leads — ${EXHAUST}.` },
  { table: "agent_lead_import_batches", column: "campaign_id", only: { column: "status", values: ["completed"] }, reason: `A list was imported into it — ${EXHAUST}.` },
  { table: "agent_lead_import_batches", column: "campaign_id", only: { column: "status", values: ["processing"] }, reason: "A file for it is waiting in Review — discard that file first." },
  { table: "lead_claims", column: "campaign_id", reason: `It has vendor credit claims — ${EXHAUST}.` },
  { table: "vendor_invoice_line", column: "campaign_id", reason: `It is on a vendor invoice — ${EXHAUST}.` },
  { table: "deal_flow", column: "campaign_id", reason: `It has deals — ${EXHAUST}.` },
  { table: "tenant_application_cases", column: "campaign_id", reason: `It has applications — ${EXHAUST}.` },
  { table: "tenant_issued_policies", column: "campaign_id", reason: `It has issued policies — ${EXHAUST}.` },
  { table: "policy_annotation", column: "lead_campaign_id", reason: `Policies in the book name it — ${EXHAUST}.` },
  { table: "tenant_lead_activity", column: "campaign_id", reason: `It has lead activity — ${EXHAUST}.` },
  { table: "tenant_lead_post_log", column: "campaign_id", reason: `Leads were posted to it — ${EXHAUST}.` },
  { table: "tenant_vendor_post_keys", column: "campaign_id", reason: `A lead-posting key sends leads to it — ${EXHAUST}.` },
  { table: "retention_settings", column: "winback_campaign_id", reason: "Win-back sends leads to it — pick another win-back campaign first." },
  { table: "winback_candidate", column: "campaign_id", reason: `Win-back leads name it — ${EXHAUST}.` },
  { table: "lead_duplicate_reviews", column: "campaign_id", only: { column: "status", values: ["pending"] }, reason: "Leads from it are waiting on Clean (same phone) — answer them first." },
];

export const VENDOR_REFERENCES: Reference[] = [
  { table: "tenant_campaigns", column: "vendor_id", reason: `It has campaigns — ${INACTIVE}.` },
  { table: "agent_lead_import_batches", column: "vendor_id", only: { column: "status", values: ["completed", "processing"] }, reason: `Lists were imported from it — ${INACTIVE}.` },
  { table: "lead_claims", column: "vendor_id", reason: `It has vendor credit claims — ${INACTIVE}.` },
  { table: "vendor_invoice", column: "vendor_id", reason: `It has invoices — ${INACTIVE}.` },
  { table: "tenant_lead_post_log", column: "vendor_id", reason: `Leads were posted from it — ${INACTIVE}.` },
  // CASCADE, but a live posting key is a vendor in use: deleting it would silently cut the feed.
  { table: "tenant_vendor_post_keys", column: "vendor_id", reason: `It has a lead-posting key — ${INACTIVE}.` },
  { table: "deal_flow", column: "vendor_id", reason: `It has deals — ${INACTIVE}.` },
  { table: "tenant_application_cases", column: "vendor_id", reason: `It has applications — ${INACTIVE}.` },
  { table: "tenant_issued_policies", column: "vendor_id", reason: `It has issued policies — ${INACTIVE}.` },
  { table: "policy_annotation", column: "lead_vendor_id", reason: `Policies in the book name it — ${INACTIVE}.` },
];

/**
 * The first reason the row cannot be deleted, or null when nothing points at it. Each check is one
 * tenant-scoped `limit 1` read. A table a pending migration has not created cannot reference
 * anything, so a schema gap is skipped; any other failure throws (never read as "nothing there").
 */
export async function deleteBlocker(db: GuardDb, tenantId: string, id: string, references: Reference[]): Promise<string | null> {
  const found = await Promise.all(references.map(async (reference) => {
    let query = db.from(reference.table).select(reference.column).eq("tenant_id", tenantId).eq(reference.column, id);
    if (reference.only) query = query.in(reference.only.column, reference.only.values);
    const { data, error } = await query.limit(1);
    if (error) {
      if (isSchemaGap(error)) return null;
      throw new Error(`Could not check ${reference.table}: ${error.message}`);
    }
    return Array.isArray(data) && data.length > 0 ? reference.reason : null;
  }));
  return found.find((reason): reason is string => reason !== null) ?? null;
}

/** A foreign key refused the delete anyway (a row arrived between the check and the delete). */
export const isForeignKeyRefusal = (error: { code?: string } | null) => error?.code === "23503";
