import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { getUsPhone10Digits } from "./scrub";

/**
 * LA-6.1 (Notion sprint, Module 6 — Compliance) · the compliance record index, read side.
 *
 * One lookup by phone number returns every compliance-relevant record held about it, across the
 * tables five modules write (screening, scrubs, the do-not-call list, consent, call attempts,
 * disclosures — later the transfer verdict, complaints and deletions). The index holds pointers, not
 * copies: each event names its source table and row, and the source row is the truth. The database
 * keeps it current (triggers) and reconciles it nightly (20261015100000).
 *
 * The number is keyed by LA-1.5's getUsPhone10Digits — the only normaliser this module uses.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export const INDEX_PENDING_MESSAGE = "The compliance record index needs a database update (20261015100000).";

export const COMPLIANCE_EVENT_TYPES = ["screening", "scrub", "dnc_add", "consent", "call_attempt", "disclosure", "transfer_verdict", "complaint", "deletion"] as const;
export type ComplianceEventType = (typeof COMPLIANCE_EVENT_TYPES)[number];

export type ComplianceEvent = {
  phoneDigits: string;
  contactId: string | null;
  leadId: string | null;
  eventType: ComplianceEventType;
  eventAt: string;
  sourceTable: string;
  sourceId: string;
  sourceSubId: string | null;
  summary: string;
  module: string;
};

export class RecordIndexError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RecordIndexError";
  }
}

const ZERO = "00000000-0000-0000-0000-000000000000";
const COLUMNS = "phone_digits, contact_id, lead_id, event_type, event_at, source_table, source_id, source_sub_id, outcome_summary, module";
/** PostgREST caps a request at 1,000 rows, so a long history is read in pages. */
const PAGE = 1000;

function toEvent(r: Loose): ComplianceEvent {
  return {
    phoneDigits: r.phone_digits,
    contactId: r.contact_id ?? null,
    leadId: r.lead_id ?? null,
    eventType: r.event_type,
    eventAt: r.event_at,
    sourceTable: r.source_table,
    sourceId: r.source_id,
    sourceSubId: r.source_sub_id && r.source_sub_id !== ZERO ? r.source_sub_id : null,
    summary: r.outcome_summary,
    module: r.module,
  };
}

/** The ten-digit key for a number as typed, or a 400. */
export function phoneKey(phone: unknown): string {
  try {
    return getUsPhone10Digits(phone);
  } catch (e) {
    throw new RecordIndexError(e instanceof Error ? e.message : "Enter a valid US phone number", 400);
  }
}

type Scope = { phoneDigits: string } | { contactId: string } | { leadId: string };

/** Every indexed event for one number (or client, or lead), oldest first. Optional date range on event_at. */
export async function lookupComplianceEvents(tenantId: string, scope: Scope, range: { from?: string; to?: string } = {}): Promise<ComplianceEvent[]> {
  const out: ComplianceEvent[] = [];
  for (let page = 0; ; page += 1) {
    let q = db().from("compliance_index").select(COLUMNS).eq("tenant_id", tenantId);
    if ("phoneDigits" in scope) q = q.eq("phone_digits", scope.phoneDigits);
    else if ("contactId" in scope) q = q.eq("contact_id", scope.contactId);
    else q = q.eq("lead_id", scope.leadId);
    if (range.from) q = q.gte("event_at", range.from);
    if (range.to) q = q.lte("event_at", range.to);
    const { data, error } = await q
      .order("event_at", { ascending: true })
      .order("source_table", { ascending: true })
      .order("source_id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      if (isSchemaGap(error)) throw new RecordIndexError(INDEX_PENDING_MESSAGE, 503);
      throw new Error(error.message);
    }
    const rows = (data ?? []) as Loose[];
    out.push(...rows.map(toEvent));
    if (rows.length < PAGE) return out;
  }
}

/** The numbers a client or lead is known by — a report on a person covers all of them. */
export async function phonesFor(tenantId: string, scope: { contactId: string } | { leadId: string }): Promise<string[]> {
  const events = await lookupComplianceEvents(tenantId, scope);
  return [...new Set(events.map((e) => e.phoneDigits))];
}

/** The latest nightly reconciliation for a tenant: a non-zero missing count is a bug. */
export async function latestReconciliation(tenantId: string) {
  const { data, error } = await db()
    .from("compliance_index_reconciliation")
    .select("ran_at, missing_count, stale_count, unkeyed_count")
    .eq("tenant_id", tenantId)
    .order("ran_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isSchemaGap(error)) return null;
    throw new Error(error.message);
  }
  return data ? { ranAt: data.ran_at as string, missing: Number(data.missing_count), stale: Number(data.stale_count), unkeyed: Number(data.unkeyed_count) } : null;
}
