import "server-only";
import { createHash, randomBytes } from "node:crypto";

import { inviteExpiryHours } from "@/lib/settings/queries";

/**
 * The coded default, kept so the store can be unreachable without breaking invitations.
 *
 * SA-4.1 moved the live value into `users.invite_expiry_hours`. Read it through
 * `inviteExpiryFromNow()` rather than using this — a link built from the constant while the
 * setting says something else expires at a time nobody expects.
 */
export const DEFAULT_INVITE_TTL_HOURS = 72;

/** 32 random bytes, base64url-encoded. This is what goes in the link and is never stored. */
export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * SHA-256 rather than bcrypt: the token is high-entropy random (not a guessable password), so
 * a fast hash is safe here, and being deterministic lets us look the invitation up directly.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Async since SA-4.1, because the lifetime is now a setting rather than a constant.
 *
 * Resolved at issue time and baked into the row, so shortening the window never retroactively
 * expires a link somebody has already been sent.
 */
export async function inviteExpiryFromNow(): Promise<Date> {
  const hours = await inviteExpiryHours();
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function buildInviteUrl(token: string, origin: string): string {
  return `${origin}/app/set-password?token=${encodeURIComponent(token)}`;
}

/** Password resets land on the same screen as invites — both end in "choose a password". */
export function buildPasswordResetUrl(token: string, origin: string): string {
  return buildInviteUrl(token, origin);
}

export function buildEmailChangeUrl(token: string, origin: string): string {
  return `${origin}/app/confirm-email?token=${encodeURIComponent(token)}`;
}
