import "server-only";

import { demoScreeningEnabled } from "@/lib/compliance/demo";
import { COMPLIANCE_VENDOR_TYPE_LABELS, type ComplianceVendorType } from "@/lib/compliance/constants";
import { listComplianceVendors } from "@/lib/compliance/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { LIST_TYPES, normalizeDigits, type SuppressionListType } from "./constants";

/**
 * TCPA / DNC (p-app-tcpa): the parts of the screen around the list — which list a number is on,
 * how many dials screening refused, and whether the feeds the dialer depends on are answering.
 *
 * Nothing here is a second opinion on the dialer. The verdict for a number stays
 * `is_phone_suppressed` (checkPhone); `phoneLists` only says which of the stored lists it sits on,
 * so a "suppressed" answer can name its reason. The feeds are the platform's enabled scrub vendors
 * and their last 24 hours of calls — the same numbers `getDncDialingStatus` gates dialing on.
 */

export type PhoneListRow = { list: SuppressionListType; listed: boolean; since: string | null; reason: string | null; source: string | null };
export type FeedState = "fresh" | "failing" | "no_calls";
export type SuppressionFeed = { name: string; type: ComplianceVendorType; typeLabel: string; state: FeedState; lastSuccessAt: string | null; callsLast24h: number; failuresLast24h: number };
export type SuppressionOverview = {
  feeds: SuppressionFeed[];
  /** Demo screening answers every lookup locally; the feeds below are then not what gates dialing. */
  demo: boolean;
  /** True when the dialer is refusing every dial for want of a DNC scrub vendor. */
  dialingBlocked: boolean;
  /** Dials screening refused in the last 24 hours (audit `tenant.dial_refused`); null if unreadable. */
  refusedLast24h: number | null;
};

type Chain = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }> & {
  eq(column: string, value: unknown): Chain;
  gte(column: string, value: unknown): Chain;
};
type Loose = { from(table: string): { select(columns: string, options?: { count: "exact"; head: true }): Chain } };

const SCRUB_TYPES: ComplianceVendorType[] = ["dnc_scrub", "litigator_scrub", "phone_validation"];

export async function suppressionOverview(tenantId: string): Promise<SuppressionOverview> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [vendors, refused] = await Promise.all([
    listComplianceVendors().catch(() => null),
    db.from("audit_log").select("id", { count: "exact", head: true }).eq("action", "tenant.dial_refused").eq("metadata->>tenantId", tenantId).gte("ts", since),
  ]);
  const feeds: SuppressionFeed[] = (vendors ?? [])
    .filter((vendor) => vendor.is_enabled && SCRUB_TYPES.includes(vendor.vendor_type))
    .map((vendor) => ({
      name: vendor.name,
      type: vendor.vendor_type,
      typeLabel: COMPLIANCE_VENDOR_TYPE_LABELS[vendor.vendor_type],
      // `available` is false only when every call in the window failed; no calls is unknown, not down.
      state: vendor.calls_24h === 0 ? "no_calls" : vendor.available ? "fresh" : "failing",
      lastSuccessAt: vendor.last_success_at,
      callsLast24h: vendor.calls_24h,
      failuresLast24h: vendor.failures_24h,
    }));
  const demo = demoScreeningEnabled();
  const dnc = feeds.filter((feed) => feed.type === "dnc_scrub");
  return {
    feeds,
    demo,
    dialingBlocked: !demo && vendors !== null && (dnc.length === 0 || dnc.every((feed) => feed.state === "failing")),
    refusedLast24h: refused.error ? null : refused.count ?? 0,
  };
}

/** Which stored lists one number is on, for the check's breakdown. */
export async function phoneLists(tenantId: string, phone: string): Promise<PhoneListRow[]> {
  const digits = normalizeDigits(phone);
  if (!digits) return [];
  const db = getSupabaseServiceClient() as unknown as Loose;
  const [internal, external] = await Promise.all([
    db.from("tenant_do_not_call").select("created_at, reason").eq("tenant_id", tenantId).eq("phone_digits", digits).eq("is_active", true),
    db.from("tenant_suppression_list").select("list_type, added_at, reason, source").eq("tenant_id", tenantId).eq("phone_digits", digits),
  ]);
  const own = ((internal.error ? [] : internal.data ?? []) as Array<{ created_at: string; reason: string }>)[0];
  const byList = new Map(((external.error ? [] : external.data ?? []) as Array<{ list_type: SuppressionListType; added_at: string; reason: string; source: string }>).map((row) => [row.list_type, row]));
  return LIST_TYPES.map((list) => {
    if (list === "internal") {
      const screening = byList.get("internal");
      const row = own ?? (screening ? { created_at: screening.added_at, reason: screening.reason } : null);
      return { list, listed: Boolean(row), since: row?.created_at ?? null, reason: row?.reason ?? null, source: screening?.source ?? null };
    }
    const row = byList.get(list);
    return { list, listed: Boolean(row), since: row?.added_at ?? null, reason: row?.reason ?? null, source: row?.source ?? null };
  });
}
