import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * LA-4.1 (Notion sprint) · how the two unattended doors prove who is calling.
 *
 *   · The email webhook: Postmark does not sign inbound posts, so the webhook URL carries HTTP Basic
 *     credentials (https://user:password@…/api/webhooks/postmark-inbound), checked here against
 *     POSTMARK_INBOUND_USER and POSTMARK_INBOUND_PASSWORD.
 *   · The bucket poll: "Authorization: Bearer <CARRIER_FILES_POLL_SECRET>", sent by the pg_cron job
 *     (through pg_net) or by any other scheduler.
 *
 * Both compare digests in constant time, so neither the value nor its length leaks.
 */
function same(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

export type DoorAuth = { ok: true } | { ok: false; status: 401 | 500; reason: string };

export function checkPostmarkBasicAuth(header: string | null): DoorAuth {
  const user = process.env.POSTMARK_INBOUND_USER ?? "";
  const password = process.env.POSTMARK_INBOUND_PASSWORD ?? "";
  if (user.length < 8 || password.length < 16) return { ok: false, status: 500, reason: "POSTMARK_INBOUND_USER / POSTMARK_INBOUND_PASSWORD are not set" };
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/.exec(header ?? "");
  if (!match) return { ok: false, status: 401, reason: "no basic credentials" };
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return { ok: false, status: 401, reason: "malformed basic credentials" };
  const okUser = same(decoded.slice(0, colon), user);
  const okPassword = same(decoded.slice(colon + 1), password);
  return okUser && okPassword ? { ok: true } : { ok: false, status: 401, reason: "wrong credentials" };
}

export function checkPollBearer(header: string | null): DoorAuth {
  const secret = process.env.CARRIER_FILES_POLL_SECRET ?? "";
  if (secret.length < 24) return { ok: false, status: 500, reason: "CARRIER_FILES_POLL_SECRET is not set" };
  const match = /^Bearer\s+(\S+)$/.exec(header ?? "");
  if (!match) return { ok: false, status: 401, reason: "no bearer token" };
  return same(match[1], secret) ? { ok: true } : { ok: false, status: 401, reason: "wrong token" };
}
