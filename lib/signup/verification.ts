import "server-only";

import { generateInviteToken, hashInviteToken } from "@/lib/users/invitations";

export const EMAIL_VERIFICATION_TTL_HOURS = 24;

export function createEmailVerification() {
  const token = generateInviteToken();
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
  };
}

/**
 * The absolute URL that goes into a verification email.
 *
 * Deliberately has NO request-derived fallback. `request.nextUrl.origin` comes from the Host
 * header, which the caller controls: an attacker could POST a signup for someone else's address
 * with `Host: attacker.com`, and the victim would receive a genuine-looking email from our domain
 * whose verification link hands the token to the attacker.
 *
 * A URL that is emailed to someone must come from configuration, never from the request that
 * triggered it. Missing configuration throws, because a signup that silently emails an
 * unverifiable link is worse than one that fails loudly.
 */
export function buildVerificationUrl(token: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!configured) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be set — verification links cannot be built from the request Host header.",
    );
  }
  return `${configured}/api/public/signup/verify?token=${encodeURIComponent(token)}`;
}
