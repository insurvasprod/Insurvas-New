import "server-only";

import { assertOutboundLimit, outboundLimitResponse, recordOutboundUsage } from "@/lib/metering/outbound";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function claimConsentCertificate(input: { tenantId: string; artefactId: string; storedCopy: Record<string, unknown> }) {
  type Query = { select(columns: string): Query; eq(column: string, value: string): Query; maybeSingle<T>(): Promise<{ data: T | null; error: { message: string } | null }>; update(values: Record<string, unknown>): Query; single<T>(): Promise<{ data: T | null; error: { message: string } | null }> };
  const db = getSupabaseServiceClient() as unknown as { from(table: string): Query };
  const current = await db.from("tenant_consent_artefacts").select("id, capture_status, stored_copy").eq("tenant_id", input.tenantId).eq("id", input.artefactId).maybeSingle<{ id: string; capture_status: string; stored_copy: unknown }>();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new Error("Consent certificate not found");
  if (current.data.capture_status === "claimed") return current.data;
  await assertOutboundLimit(input.tenantId, "consent_cert_claims");
  const updated = await db.from("tenant_consent_artefacts").update({ capture_status: "claimed", claimed_at: new Date().toISOString(), stored_copy: input.storedCopy, capture_error: null }).eq("tenant_id", input.tenantId).eq("id", input.artefactId).select("id, capture_status, claimed_at, stored_copy").single<{ id: string; capture_status: string; claimed_at: string; stored_copy: unknown }>();
  if (updated.error || !updated.data) throw new Error(updated.error?.message ?? "Could not store consent certificate");
  await recordOutboundUsage(input.tenantId, "consent_cert_claims", 1, `consent-claim:${input.artefactId}`, input.artefactId);
  return updated.data;
}

export { outboundLimitResponse };
