// SA-3.1 · Whop webhook signature verification, written by hand.
//
// Whop's docs show `unwrapWebhook` from @whop/sdk/helpers, but carry a warning that the helper
// "lands in the next release" and to verify without an SDK until then. This is that verification,
// following the Standard Webhooks spec exactly as Whop documents it:
//
//   signed content = `{webhook-id}.{webhook-timestamp}.{raw body}`
//   HMAC-SHA256, key = the ws_... secret verbatim (not base64-decoded, prefix not stripped)
//   webhook-signature = "v1,<base64>", possibly several space-separated for key rotation
//
// Pure and dependency-free apart from node:crypto, so it is unit-tested directly.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Whop's documented replay window. A request older than this is rejected even if signed. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type VerifyInput = {
  /** The RAW request body. Parsing and re-stringifying changes the bytes and the check fails. */
  payload: string;
  headers: Record<string, string | undefined>;
  secret: string;
  /** Injectable so tests do not depend on the wall clock. Seconds since epoch. */
  nowSeconds?: number;
};

export type VerifyResult =
  | { ok: true; webhookId: string; timestamp: number }
  | { ok: false; reason: string };

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  // Header names are case-insensitive; Node lowercases them but a test or proxy may not.
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself leak length by throwing at a
  // different time. Compare lengths first and return the same way for every mismatch.
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function verifyWhopSignature(input: VerifyInput): VerifyResult {
  const { payload, headers, secret } = input;

  if (!secret) return { ok: false, reason: "WHOP_WEBHOOK_SECRET is not set" };

  const webhookId = header(headers, "webhook-id");
  const timestampRaw = header(headers, "webhook-timestamp");
  const signatureHeader = header(headers, "webhook-signature");

  if (!webhookId) return { ok: false, reason: "missing webhook-id" };
  if (!timestampRaw) return { ok: false, reason: "missing webhook-timestamp" };
  if (!signatureHeader) return { ok: false, reason: "missing webhook-signature" };

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "webhook-timestamp is not a number" };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  // Both directions: a timestamp far in the future is as suspicious as one far in the past.
  if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: `webhook-timestamp is outside the ${WEBHOOK_TOLERANCE_SECONDS}s replay window` };
  }

  const expected = createHmac("sha256", secret)
    .update(`${webhookId}.${timestampRaw}.${payload}`)
    .digest("base64");

  // The header may carry several signatures separated by spaces, so that a secret can be rotated
  // without dropping deliveries signed by the old one. Any v1 match is a pass.
  const candidates = signatureHeader
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice("v1,".length));

  if (candidates.length === 0) return { ok: false, reason: "no v1 signature in webhook-signature" };

  const matched = candidates.some((candidate) => constantTimeEquals(candidate, expected));
  if (!matched) return { ok: false, reason: "signature mismatch" };

  return { ok: true, webhookId, timestamp };
}
