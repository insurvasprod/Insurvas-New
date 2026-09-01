import { SignJWT, jwtVerify } from "jose";

// A partner portal session is a third identity plane. It must never be accepted as an agent or
// admin session, even when the same browser visits both applications.
export const PARTNER_SESSION_COOKIE = "insurvas_partner_session";

const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getSecret(): Uint8Array {
  // Keep local development convenient without reusing the tenant signing key. The namespace
  // prefix makes a partner token cryptographically distinct even when only TENANT_SESSION_SECRET
  // exists; production should still set PARTNER_SESSION_SECRET explicitly.
  const secret = process.env.PARTNER_SESSION_SECRET || (process.env.TENANT_SESSION_SECRET ? `insurvas-partner:${process.env.TENANT_SESSION_SECRET}` : "");
  if (!secret) throw new Error("Missing PARTNER_SESSION_SECRET or TENANT_SESSION_SECRET env var.");
  return new TextEncoder().encode(secret);
}

export type PartnerSessionPayload = { sub: string; tenantId: string; partnerId: string };

export async function signPartnerSessionToken(userId: string, tenantId: string, partnerId: string): Promise<string> {
  return new SignJWT({ tenantId, partnerId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyPartnerSessionToken(token: string): Promise<PartnerSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.sub !== "string" || typeof payload.tenantId !== "string" || typeof payload.partnerId !== "string") return null;
    return payload as unknown as PartnerSessionPayload;
  } catch {
    return null;
  }
}

export const partnerSessionCookieOptions = {
  httpOnly: true as const,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  domain: process.env.PARTNER_COOKIE_DOMAIN || undefined,
  maxAge: SESSION_TTL_SECONDS,
};
