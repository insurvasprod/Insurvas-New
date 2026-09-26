/**
 * LA-2.6-2 · a provider's claim window, and whether this server can fetch from the provider.
 * Pure, so the rules are tested without a database or a network.
 *
 * TrustedForm: a certificate that is not retained (claimed) expires 72 hours after it was created,
 * and a claim after that fails. The window is measured from the consent timestamp when the vendor
 * sent one, else from when we captured the certificate — the later of the two readings is never
 * used, so a late capture cannot stretch the provider's deadline.
 *
 * Jornaya publishes no fixed window we can enforce here, so none is; the claim is not refused on
 * age, and the result says the provider has no window rather than inventing one.
 */

export const PROVIDER_CLAIM_WINDOW_HOURS: Record<string, number | null> = {
  trustedform: 72,
  jornaya: null,
  other: null,
};

const PROVIDER_LABEL: Record<string, string> = { trustedform: "TrustedForm", jornaya: "Jornaya", other: "provider" };

export type ClaimWindow = {
  providerLabel: string;
  hours: number | null;
  /** ISO time the window closes (or closed); null when the provider has none, or no creation time is known. */
  closesAt: string | null;
  expired: boolean;
};

export function claimWindowFor(input: { provider: string; createdAt: string | null }, now: Date): ClaimWindow {
  const provider = input.provider in PROVIDER_CLAIM_WINDOW_HOURS ? input.provider : "other";
  const hours = PROVIDER_CLAIM_WINDOW_HOURS[provider];
  const providerLabel = PROVIDER_LABEL[provider];
  const created = input.createdAt ? Date.parse(input.createdAt) : NaN;
  if (hours === null || !Number.isFinite(created)) return { providerLabel, hours, closesAt: null, expired: false };
  const closes = created + hours * 3_600_000;
  return { providerLabel, hours, closesAt: new Date(closes).toISOString(), expired: now.getTime() > closes };
}

export type FetchAvailability =
  | { canFetch: true; apiKey: string; reason: null }
  | { canFetch: false; apiKey: null; reason: string };

/** Only a provider whose credentials are configured in this server's environment is ever called. */
export function providerFetchAvailability(provider: string, env: Record<string, string | undefined>): FetchAvailability {
  if (provider === "trustedform") {
    const apiKey = (env.TRUSTEDFORM_API_KEY ?? "").trim();
    return apiKey
      ? { canFetch: true, apiKey, reason: null }
      : { canFetch: false, apiKey: null, reason: "No TrustedForm API key is configured on this server (TRUSTEDFORM_API_KEY), so the certificate was not fetched from TrustedForm." };
  }
  if (provider === "jornaya")
    return { canFetch: false, apiKey: null, reason: "Fetching a certificate from Jornaya is not built, so nothing was fetched from Jornaya." };
  return { canFetch: false, apiKey: null, reason: "This certificate's provider has no fetch here, so nothing was fetched from it." };
}

/**
 * TrustedForm's retain call: POST to the certificate's own URL with the API key as the Basic-auth
 * password. Only a cert.trustedform.com URL (or an id to build one from) is ever called, so a
 * vendor-supplied URL cannot point this server at an arbitrary host.
 */
export function trustedFormRetainRequest(input: { certificateUrl: string | null; certificateId: string | null; apiKey: string; reference: string }): { url: string; init: RequestInit } | null {
  const fromUrl = input.certificateUrl && /^https:\/\/cert\.trustedform\.com\/[A-Za-z0-9_-]{8,128}\/?$/.test(input.certificateUrl.split(/[?#]/)[0])
    ? input.certificateUrl.split(/[?#]/)[0].replace(/\/$/, "")
    : null;
  const fromId = input.certificateId && /^[A-Za-z0-9_-]{8,128}$/.test(input.certificateId) ? `https://cert.trustedform.com/${input.certificateId}` : null;
  const url = fromUrl ?? fromId;
  if (!url) return null;
  const basic = typeof Buffer !== "undefined" ? Buffer.from(`API:${input.apiKey}`).toString("base64") : btoa(`API:${input.apiKey}`);
  return {
    url,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "Api-Version": "4.0", Authorization: `Basic ${basic}` },
      body: JSON.stringify({ retain: { reference: input.reference } }),
      signal: AbortSignal.timeout(15_000),
    },
  };
}
