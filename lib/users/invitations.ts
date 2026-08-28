import "server-only";
import { createHash, randomBytes } from "node:crypto";

export const INVITE_TTL_HOURS = 72;

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

export function inviteExpiryFromNow(): Date {
  return new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
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
