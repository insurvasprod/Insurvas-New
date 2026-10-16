import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * LA-8.7 · webhook rules, pure so they are tested: signing, the target check, and the retry ladder.
 */

// ---------------------------------------------------------------- signing

export function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/**
 * `Insurvas-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. The timestamp is
 * inside the MAC, so a receiver that rejects old timestamps cannot be replayed at.
 */
export function signPayload(secret: string, body: string, timestamp: number): string {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

/** What a receiver does; here so the docs and the tests check the same thing the sender makes. */
export function verifySignature(secret: string, body: string, header: string, now: number, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;
  if (Math.abs(Math.floor(now / 1000) - timestamp) > toleranceSeconds) return false;
  const expected = Buffer.from(signPayload(secret, body, timestamp).split("v1=")[1], "hex");
  const given = Buffer.from(parts.v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---------------------------------------------------------------- the target

/**
 * Private, loopback, link-local and other non-public addresses. A webhook target is an outbound
 * request we make on someone's say-so; letting it reach these would make it a request-forgery tool.
 */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (kind === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(lower) || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8");
  }
  return false;
}

const BLOCKED_HOSTS = /(^localhost$|\.localhost$|\.local$|\.internal$|\.intranet$|\.lan$|\.home\.arpa$|^metadata\.google\.internal$)/i;

export type TargetCheck = { ok: true; url: URL } | { ok: false; message: string };

/**
 * The URL itself: HTTPS, no credentials in it, the standard port or none, and not an address or
 * hostname that is private on its face. A hostname is checked again after DNS on every delivery
 * (`deliver.ts`), because a public name can point at a private address.
 */
export function checkTargetUrl(raw: string): TargetCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "Enter a full URL, starting https://" };
  }
  if (url.protocol !== "https:") return { ok: false, message: "Webhook URLs must use HTTPS." };
  if (url.username || url.password) return { ok: false, message: "Put credentials in your receiver's checks, not in the URL." };
  if (url.port && url.port !== "443") return { ok: false, message: "Webhooks are sent to the standard HTTPS port only." };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) return { ok: false, message: "Private, loopback and link-local addresses cannot receive webhooks." };
  if (BLOCKED_HOSTS.test(host) || !host.includes(".")) return { ok: false, message: "That host is not a public address." };
  if (url.href.length > 500) return { ok: false, message: "That URL is too long." };
  return { ok: true, url };
}

// ---------------------------------------------------------------- retries

/** After attempt n fails, wait RETRY_DELAYS_MINUTES[n - 1] before the next: six tries over about nine hours. */
export const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

/** Failed attempts in a row, with no success between, at which a subscription is disabled. */
export const DISABLE_AFTER_FAILURES = 3 * MAX_ATTEMPTS;

export type AttemptOutcome = { ok: boolean };

export type DeliveryNext =
  | { status: "succeeded" }
  | { status: "pending"; nextAttemptAt: Date }
  | { status: "failed" };

export function nextForDelivery(attempt: number, outcome: AttemptOutcome, now: Date): DeliveryNext {
  if (outcome.ok) return { status: "succeeded" };
  if (attempt >= MAX_ATTEMPTS) return { status: "failed" };
  return { status: "pending", nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MINUTES[attempt - 1] * 60_000) };
}

export type SubscriptionState = { status: "active" | "paused" | "failing" | "disabled"; consecutiveFailures: number };

/**
 * What an attempt does to its subscription. A success clears everything. A delivery that used up
 * its retries marks the subscription `failing` — visible, still trying new events. Sustained failure
 * (DISABLE_AFTER_FAILURES in a row) disables it, and the caller tells the agency.
 */
export function nextForSubscription(current: SubscriptionState, outcome: AttemptOutcome, deliveryExhausted: boolean): SubscriptionState & { justDisabled: boolean } {
  if (current.status === "disabled" || current.status === "paused") return { ...current, justDisabled: false };
  if (outcome.ok) return { status: "active", consecutiveFailures: 0, justDisabled: false };
  const failures = current.consecutiveFailures + 1;
  if (failures >= DISABLE_AFTER_FAILURES) return { status: "disabled", consecutiveFailures: failures, justDisabled: true };
  return { status: deliveryExhausted || current.status === "failing" ? "failing" : "active", consecutiveFailures: failures, justDisabled: false };
}

/** Is a response a success? 2xx only; a redirect is not followed and is not a success. */
export const isSuccessStatus = (status: number) => status >= 200 && status < 300;

/** What the log keeps of a response body: printable, collapsed, 500 characters. */
export function responseSnippet(body: string): string {
  return body.replace(/[^\x20-\x7e\n\t]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}
