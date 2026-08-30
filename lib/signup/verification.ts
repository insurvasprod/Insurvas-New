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

export function buildVerificationUrl(token: string, requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const origin = configured || requestOrigin;
  return `${origin}/api/public/signup/verify?token=${encodeURIComponent(token)}`;
}
