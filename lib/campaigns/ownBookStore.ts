import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { OWN_BOOK_CAMPAIGN_NAME, OWN_BOOK_VENDOR_NAME } from "@/lib/campaigns/ownBook";

type Failure = { message: string; code?: string };
type Result<T> = { data: T; error: Failure | null };
type Query = PromiseLike<Result<unknown>> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  insert(value: unknown): Query;
  update(value: unknown): Query;
  maybeSingle<T = unknown>(): Promise<Result<T | null>>;
  single<T = unknown>(): Promise<Result<T>>;
};
type Db = { from(table: string): Query };

export type OwnBookCampaign = { id: string; vendor_id: string; name: string; status: string };
export type OwnBookResult = { campaign: OwnBookCampaign; created: boolean };

/** Refused because the name is taken by something that is not the own book; said to the person. */
export class OwnBookConflictError extends Error {
  constructor(message: string) { super(message); this.name = "OwnBookConflictError"; }
}

const VENDOR_NOTE = "Stands in for the agency's own lists (its clients, old leads, referrals), which have no vendor. Created by Import › Your own book.";
const CAMPAIGN_COLUMNS = "id, vendor_id, name, status";
const isUnique = (error: Failure | null) => error?.code === "23505";

/**
 * Finds or creates, for this tenant, the one vendor named OWN_BOOK_VENDOR_NAME and the campaign of
 * the same name under it. Both names are unique per tenant, so a second click (or a second tab)
 * lands on the same rows: a unique violation on insert is read back, not reported.
 *
 * The campaign is an ordinary campaign, made the way New campaign makes one: `draft`, because the
 * dialer serves only active AND scrubbed campaigns and an empty, unscrubbed one must not sit in the
 * serving view (importReview.test.mjs pins that rule for New campaign). Its scrub_status starts at
 * the column default, `unscrubbed`; the first import into it marks it scrubbed exactly as it does
 * any new list (importScrubDecision: no earlier leads → mark), and activating it — like any draft,
 * on Lead sources › Source, under the plan's active-campaign cap — puts it on the dialer. An
 * existing own-book campaign is returned as it is: its status is the owner's call.
 */
export async function ensureOwnBookCampaign(tenantId: string, userId: string): Promise<OwnBookResult> {
  const db = getSupabaseServiceClient() as unknown as Db;

  // ── the vendor ──
  const readVendor = () => db.from("tenant_lead_vendors").select("id, status").eq("tenant_id", tenantId).eq("name", OWN_BOOK_VENDOR_NAME).maybeSingle<{ id: string; status: string }>();
  let vendor = await readVendor();
  if (vendor.error) throw new Error(`Could not read the vendors: ${vendor.error.message}`);
  if (!vendor.data) {
    const inserted = await db.from("tenant_lead_vendors")
      .insert({ tenant_id: tenantId, name: OWN_BOOK_VENDOR_NAME, lead_type: "list", notes: VENDOR_NOTE, status: "active", created_by: userId })
      .select("id, status").single<{ id: string; status: string }>();
    if (inserted.error && !isUnique(inserted.error)) throw new Error(`Could not create the own-book vendor: ${inserted.error.message}`);
    vendor = inserted.error ? await readVendor() : { data: inserted.data, error: null };
    if (vendor.error || !vendor.data) throw new Error(`Could not read the own-book vendor: ${vendor.error?.message ?? "not found"}`);
  } else if (vendor.data.status === "inactive") {
    // Switched off on Vendors & campaigns: the person asked for it again, so it is back on.
    const revived = await db.from("tenant_lead_vendors").update({ status: "active" }).eq("tenant_id", tenantId).eq("id", vendor.data.id);
    if (revived.error) throw new Error(`Could not switch the own-book vendor back on: ${revived.error.message}`);
  }
  const vendorId = vendor.data.id;

  // ── the campaign ──
  const readCampaign = () => db.from("tenant_campaigns").select(CAMPAIGN_COLUMNS).eq("tenant_id", tenantId).eq("name", OWN_BOOK_CAMPAIGN_NAME).maybeSingle<OwnBookCampaign>();
  const existing = await readCampaign();
  if (existing.error) throw new Error(`Could not read the campaigns: ${existing.error.message}`);
  if (existing.data) {
    if (existing.data.vendor_id !== vendorId)
      throw new OwnBookConflictError(`A campaign called "${OWN_BOOK_CAMPAIGN_NAME}" already belongs to another vendor. Rename it on Lead sources › Source, then try again.`);
    return { campaign: existing.data, created: false };
  }

  const created = await db.from("tenant_campaigns")
    .insert({ tenant_id: tenantId, vendor_id: vendorId, name: OWN_BOOK_CAMPAIGN_NAME, lead_type: "list", product_code: null, status: "draft", created_by: userId })
    .select(CAMPAIGN_COLUMNS).single<OwnBookCampaign>();
  if (created.error) {
    if (!isUnique(created.error)) throw new Error(`Could not create the own-book campaign: ${created.error.message}`);
    const raced = await readCampaign();
    if (raced.error || !raced.data) throw new Error(`Could not read the own-book campaign: ${raced.error?.message ?? "not found"}`);
    if (raced.data.vendor_id !== vendorId) throw new OwnBookConflictError(`A campaign called "${OWN_BOOK_CAMPAIGN_NAME}" already belongs to another vendor. Rename it on Lead sources › Source, then try again.`);
    return { campaign: raced.data, created: false };
  }
  return { campaign: created.data, created: true };
}
