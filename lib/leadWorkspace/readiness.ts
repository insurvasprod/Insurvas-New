import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * "What happens next" on the phone's lead page (board D3): the four things an application needs
 * before it can be signed, each read from where the product already keeps it.
 *
 *   consent      a consent certificate held for the lead (tenant_consent_artefacts, claimed), or a
 *                consent answer on the lead's own form
 *   coverage     the face amount on the lead's live application (cov.face_amount), else the deal's
 *   beneficiary  a primary beneficiary on that application
 *   bank         a bank account on that application's payment method (the draft)
 *
 * An item whose read fails is left out rather than shown as not done. Nothing is written.
 */
export type ReadinessKey = "consent" | "coverage" | "beneficiary" | "bank";
export type ReadinessItem = { key: ReadinessKey; done: boolean; faceAmountCents?: number | null };

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  neq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
};

const CONSENT_KEY = /consent/i;
const yes = (value: unknown) => value === true || (typeof value === "string" && /^(yes|true|y|agreed|recorded)$/i.test(value.trim()));
const cents = (value: unknown) => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

export async function leadReadiness(tenantId: string, leadId: string, values: unknown): Promise<ReadinessItem[]> {
  const db = getSupabaseServiceClient() as unknown as { from(table: string): Query };
  const form = values && typeof values === "object" && !Array.isArray(values) ? values as Row : {};
  const [consent, apps, deal] = await Promise.all([
    db.from("tenant_consent_artefacts").select("capture_status").eq("tenant_id", tenantId).eq("lead_id", leadId).limit(5),
    // The live attempt first (a closed one only when nothing is live), newest first.
    db.from("tenant_applications").select("id, status, created_at").eq("tenant_id", tenantId).eq("lead_id", leadId).eq("insured_role", "primary").order("created_at", { ascending: false }).limit(5),
    db.from("deal_flow").select("face_amount_cents").eq("tenant_id", tenantId).eq("lead_id", leadId).limit(1),
  ]);
  const items: ReadinessItem[] = [];

  const formConsent = Object.entries(form).some(([key, value]) => CONSENT_KEY.test(key) && yes(value));
  if (!consent.error || formConsent) {
    const held = !consent.error && (consent.data ?? []).some((row) => row.capture_status === "claimed");
    items.push({ key: "consent", done: held || formConsent });
  }

  const appRows = apps.error ? null : apps.data ?? [];
  const app = appRows ? appRows.find((row) => row.status !== "closed") ?? appRows[0] ?? null : null;
  const appId = app ? String(app.id) : null;
  const [face, beneficiaries, payment] = appId ? await Promise.all([
    db.from("tenant_application_values").select("value").eq("tenant_id", tenantId).eq("application_id", appId).eq("field_key", "cov.face_amount").limit(1),
    db.from("tenant_application_beneficiaries").select("id").eq("tenant_id", tenantId).eq("application_id", appId).eq("tier", "primary").limit(1),
    db.from("tenant_application_payment_methods").select("method, account_last4").eq("tenant_id", tenantId).eq("application_id", appId).limit(1),
  ]) : [null, null, null];

  const appFace = face && !face.error ? cents((face.data ?? [])[0]?.value) : null;
  const dealFace = !deal.error ? cents((deal.data ?? [])[0]?.face_amount_cents) : null;
  if (appRows !== null || !deal.error) {
    const faceAmountCents = appFace ?? dealFace;
    items.push({ key: "coverage", done: faceAmountCents !== null, faceAmountCents });
  }
  if (appRows !== null && (!beneficiaries || !beneficiaries.error)) items.push({ key: "beneficiary", done: Boolean(beneficiaries && (beneficiaries.data ?? []).length) });
  if (appRows !== null && (!payment || !payment.error)) {
    const row = payment ? (payment.data ?? [])[0] : undefined;
    items.push({ key: "bank", done: Boolean(row && typeof row.account_last4 === "string" && row.account_last4) });
  }
  return items;
}
