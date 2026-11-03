import "server-only";

import { claimConsentCertificate } from "@/lib/compliance/consentClaims";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import { claimWindowFor, providerFetchAvailability, trustedFormRetainRequest } from "./claimWindow";

/**
 * LA-2.6-2 · "Cert claimed within provider expiry; stored copy survives link expiry."
 *
 * The claim used to store whatever copy the caller sent, with no look at the certificate's age and
 * no call to the provider. Now:
 *
 *   1. the provider's claim window is checked FIRST. A TrustedForm certificate that was never
 *      retained stops being claimable 72 hours after it was created; one past that is marked
 *      `expired` (with the date it closed) and the claim is refused, rather than "claimed" with a
 *      copy that proves nothing.
 *   2. The copy is FETCHED from the provider when the provider's credentials are configured
 *      (TRUSTEDFORM_API_KEY). Without them nothing is fetched, and the response says so in words:
 *      the copy stored is the one the caller supplied, labelled as supplied — never presented as
 *      the provider's. Jornaya has no fetch here at all, and says that too.
 *   3. The copy is stored through claimConsentCertificate (metered as consent_cert_claims), and it
 *      is ours from then on: it survives the provider's link expiring.
 */

type Row = Record<string, unknown>;
type Db = {
  from(table: string): {
    select(columns: string): { eq(column: string, value: unknown): { eq(column: string, value: unknown): { maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> } } };
    update(values: Record<string, unknown>): { eq(column: string, value: unknown): { eq(column: string, value: unknown): PromiseLike<{ error: { message: string } | null }> } };
  };
};

export class ConsentClaimRefusal extends Error {
  constructor(readonly status: 404 | 409 | 422 | 502, message: string, readonly code: string) {
    super(message);
  }
}

export type ConsentClaimResult = {
  artefact: unknown;
  alreadyClaimed: boolean;
  /** True only when the stored copy came from the provider's own API. */
  providerFetched: boolean;
  /** What the claim did about the provider, in words (never blank when nothing was fetched). */
  note: string | null;
  /** When the provider's claim window closes (or closed); null when the provider publishes none. */
  claimableUntil: string | null;
};

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

export async function claimConsentWithProvider(input: {
  tenantId: string;
  artefactId: string;
  storedCopy: Record<string, unknown>;
  now?: Date;
  fetcher?: typeof fetch;
  env?: Record<string, string | undefined>;
}): Promise<ConsentClaimResult & { expiredNow?: boolean }> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  const current = await db
    .from("tenant_consent_artefacts")
    .select("id, lead_id, provider, certificate_id, certificate_url, capture_status, captured_at, consent_timestamp, claimed_at")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.artefactId)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new ConsentClaimRefusal(404, "That certificate is not in your locker.", "not_found");
  const row = current.data;
  const provider = text(row.provider) ?? "other";
  const claimWin = claimWindowFor({ provider, createdAt: text(row.consent_timestamp) ?? text(row.captured_at) }, now);

  if (row.capture_status === "claimed")
    return { artefact: row, alreadyClaimed: true, providerFetched: false, note: "This certificate was already claimed; its stored copy is unchanged.", claimableUntil: claimWin.closesAt };

  const markExpired = async (why: string) => {
    await db.from("tenant_consent_artefacts").update({ capture_status: "expired", capture_error: why }).eq("tenant_id", input.tenantId).eq("id", input.artefactId);
  };

  if (row.capture_status === "expired" || claimWin.expired) {
    const why = claimWin.closesAt
      ? `The ${claimWin.providerLabel} claim window closed on ${claimWin.closesAt.slice(0, 16).replace("T", " ")} UTC, ${claimWin.hours} hours after the certificate was created. It can no longer be claimed.`
      : "This certificate is marked expired and can no longer be claimed.";
    if (row.capture_status !== "expired") await markExpired(why);
    throw Object.assign(new ConsentClaimRefusal(409, why, "claim_window_closed"), { expiredNow: row.capture_status !== "expired" });
  }

  const availability = providerFetchAvailability(provider, env);
  let storedCopy: Record<string, unknown> = input.storedCopy;
  let providerFetched = false;
  let note: string | null = null;

  if (availability.canFetch) {
    const request = trustedFormRetainRequest({
      certificateUrl: text(row.certificate_url),
      certificateId: text(row.certificate_id),
      apiKey: availability.apiKey,
      reference: text(row.lead_id) ?? input.artefactId,
    });
    if (!request) throw new ConsentClaimRefusal(422, "This certificate has no TrustedForm URL or id to claim it with.", "no_certificate_url");
    let response: Response;
    try {
      response = await (input.fetcher ?? fetch)(request.url, request.init);
    } catch {
      // Nothing is changed: the window is still open and the claim can be tried again.
      throw new ConsentClaimRefusal(502, "TrustedForm did not answer, so nothing was claimed. Try again — the claim window is still open.", "provider_unreachable");
    }
    const body = await response.text();
    let json: unknown = null;
    try { json = JSON.parse(body); } catch { /* kept as text below */ }
    if (!response.ok) {
      const said = typeof json === "object" && json !== null ? JSON.stringify(json).slice(0, 300) : body.slice(0, 300);
      if (response.status === 404 || response.status === 410 || /expir/i.test(said)) {
        const why = `TrustedForm reports this certificate expired or unknown (HTTP ${response.status}). It can no longer be claimed.`;
        await markExpired(why);
        throw new ConsentClaimRefusal(409, why, "provider_says_expired");
      }
      if (response.status === 401 || response.status === 403)
        throw new ConsentClaimRefusal(502, "TrustedForm refused the configured API key (TRUSTEDFORM_API_KEY), so nothing was claimed.", "provider_auth_failed");
      throw new ConsentClaimRefusal(502, `TrustedForm refused the claim (HTTP ${response.status}), so nothing was claimed.`, "provider_refused");
    }
    storedCopy = { source: "trustedform_api", fetched_at: now.toISOString(), status: response.status, certificate: json ?? body };
    providerFetched = true;
  } else {
    if (Object.keys(input.storedCopy).length === 0)
      throw new ConsentClaimRefusal(422, `${availability.reason} Nothing was claimed: send the certificate's copy to store it.`, "no_copy_and_no_provider_fetch");
    note = `${availability.reason} The copy stored is the one you supplied, not one fetched from the provider.`;
    storedCopy = { ...input.storedCopy, _capture: { source: "supplied", provider_fetched: false, stored_at: now.toISOString(), reason: availability.reason } };
  }

  const artefact = await claimConsentCertificate({ tenantId: input.tenantId, artefactId: input.artefactId, storedCopy });
  return { artefact, alreadyClaimed: false, providerFetched, note, claimableUntil: claimWin.closesAt };
}
