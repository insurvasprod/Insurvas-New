// Client-safe: no `server-only` import, so the status panel can render from these and they can be
// unit-tested without a database. The reads that touch env and provider_calls live in ./status.

export const WHOP_SANDBOX_HOST = "sandbox-api.whop.com";

export type ProviderMode = "sandbox" | "production" | "unknown";

/**
 * Which Whop account the platform is pointed at, read from the base URL alone.
 *
 * There is no separate mode flag anywhere — sandbox and production are two different hosts with
 * two different keys. Deriving it from the URL means the screen cannot disagree with what the
 * client is actually calling, which a stored `mode` column eventually would.
 */
export function deriveMode(baseUrl: string | undefined): ProviderMode {
  if (!baseUrl) return "unknown";

  let host: string;
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch {
    // A malformed URL is not production — but it is certainly not a working sandbox either, and
    // saying "unknown" is more honest than guessing in either direction.
    return "unknown";
  }

  if (host === WHOP_SANDBOX_HOST) return "sandbox";
  return host.endsWith("whop.com") ? "production" : "unknown";
}

/**
 * A fingerprint of a secret, never the secret.
 *
 * Enough to tell two keys apart and to confirm the one you just pasted is the one running — and
 * useless to anyone who reads it. Short values are hidden entirely rather than half-shown, because
 * revealing four characters of an eight-character secret gives away half of it.
 */
export function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length < 12) return "•••• (too short to fingerprint safely)";
  return `••••${trimmed.slice(-4)}`;
}

/** What a mode means for the person looking at the screen. */
export const MODE_COPY: Record<ProviderMode, { label: string; detail: string }> = {
  sandbox: {
    label: "Sandbox",
    detail: "Test money only. Cards are fake and nobody is charged.",
  },
  production: {
    label: "Production",
    detail: "Real customer money. Every checkout and refund on this platform is a live transaction.",
  },
  unknown: {
    label: "Unknown",
    detail:
      "WHOP_API_BASE_URL is missing or is not a Whop host, so no Whop call can succeed. Payments are down until it is set.",
  },
};
