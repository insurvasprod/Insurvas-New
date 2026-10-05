// LA-3.12 grant tokens and the checks every extension request passes. Pure (jose only, no I/O, no
// `server-only`, no `@/` imports) so lib/extension/grants.test.mjs can run every refusal without a
// database. lib/extension/grants.ts supplies the grant row and the signing key.
//
// A token is a JWT (HS256, EXTENSION_GRANT_SIGNING_KEY) naming ONE application and ONE carrier
// origin. The token alone is never enough: its `jti` is a row in tenant_extension_grants, and that
// row — not the token — decides revocation and expiry on every request.

import { SignJWT, errors as joseErrors, jwtVerify } from "jose";

import { GRANT_LIFETIME_MS, GRANT_SCOPE } from "./constants.ts";

export const GRANT_ISSUER = "insurvas";
export const GRANT_AUDIENCE = "insurvas-extension";

export type GrantClaims = {
  /** The grant row id. */
  jti: string;
  /** The user the grant was minted for. */
  sub: string;
  tenantId: string;
  applicationId: string;
  /** `https://host[:port]` — the only page origin the token is honoured from. */
  origin: string;
  scope: typeof GRANT_SCOPE;
};

export type GrantRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  application_id: string;
  carrier_origin: string;
  scope: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
};

export type GrantRefusal =
  | "missing_token" | "invalid_token" | "expired" | "not_found" | "revoked" | "tenant_mismatch"
  | "user_mismatch" | "application_mismatch" | "origin_mismatch" | "scope_mismatch";

/** What the extension is told. Deliberately short: a refusal never explains how to get past it. */
export const REFUSAL_STATUS: Record<GrantRefusal, number> = {
  missing_token: 401,
  invalid_token: 401,
  expired: 401,
  not_found: 401,
  revoked: 401,
  tenant_mismatch: 403,
  user_mismatch: 403,
  application_mismatch: 403,
  origin_mismatch: 403,
  scope_mismatch: 403,
};

export const REFUSAL_MESSAGE: Record<GrantRefusal, string> = {
  missing_token: "Open a new grant from the application in Insurvas.",
  invalid_token: "This grant is not valid. Open a new one from the application in Insurvas.",
  expired: "This grant has expired. Press Fill on carrier site again in Insurvas.",
  not_found: "This grant is not valid. Open a new one from the application in Insurvas.",
  revoked: "This grant was revoked. Open a new one from the application in Insurvas.",
  tenant_mismatch: "This grant is not valid for this application.",
  user_mismatch: "This grant is not valid for this application.",
  application_mismatch: "This grant is for a different application.",
  origin_mismatch: "This grant is for a different carrier site.",
  scope_mismatch: "This grant cannot do that.",
};

/** The expiry a grant issued at `issuedAt` has. Exactly 60 minutes — the table CHECK agrees. */
export function grantExpiry(issuedAt: Date) {
  return new Date(issuedAt.getTime() + GRANT_LIFETIME_MS);
}

/**
 * `https://host[:port]` for an https URL or origin, else null. Paths, queries and credentials are
 * dropped; an http origin is refused (carrier portals are https, and the table CHECK says so).
 */
export function httpsOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The bearer token from an Authorization header, or null. */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec((header ?? "").trim());
  return m ? m[1] : null;
}

/** The signing key, as bytes. At least 32 characters: HS256 with a short secret is guessable. */
export function signingKey(secret: string | null | undefined): Uint8Array | null {
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export async function signGrantToken(claims: GrantClaims, key: Uint8Array, issuedAt: Date): Promise<string> {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  return new SignJWT({ tid: claims.tenantId, app: claims.applicationId, org: claims.origin, scope: claims.scope })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(GRANT_ISSUER)
    .setAudience(GRANT_AUDIENCE)
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt(iat)
    // Never past the row's expiry: the token's clock is whole seconds, the row's is exact.
    .setExpirationTime(Math.floor(grantExpiry(issuedAt).getTime() / 1000))
    .sign(key);
}

function claimsFrom(payload: Record<string, unknown>): GrantClaims | null {
  const { jti, sub, tid, app, org, scope } = payload;
  if (typeof jti !== "string" || typeof sub !== "string" || typeof tid !== "string" || typeof app !== "string" || typeof org !== "string") return null;
  if (scope !== GRANT_SCOPE) return null;
  return { jti, sub, tenantId: tid, applicationId: app, origin: org, scope };
}

export type TokenResult =
  | { ok: true; claims: GrantClaims }
  | { ok: false; reason: GrantRefusal; claims: GrantClaims | null };

/**
 * Verifies the signature, issuer, audience and expiry. An expired token whose signature is good
 * still reports its claims, so the refusal can be logged against the right tenant and grant.
 */
export async function verifyGrantToken(token: string | null, key: Uint8Array, now: Date = new Date()): Promise<TokenResult> {
  if (!token) return { ok: false, reason: "missing_token", claims: null };
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer: GRANT_ISSUER, audience: GRANT_AUDIENCE, currentDate: now });
    const claims = claimsFrom(payload as Record<string, unknown>);
    return claims ? { ok: true, claims } : { ok: false, reason: "invalid_token", claims: null };
  } catch (error) {
    // jose checks the signature before the claims, so a JWTExpired payload is authentic.
    if (error instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired", claims: claimsFrom(error.payload as Record<string, unknown>) };
    return { ok: false, reason: "invalid_token", claims: null };
  }
}

export type GrantCheck = { ok: true } | { ok: false; reason: GrantRefusal };

/**
 * The store-checked half: the token's claims against the grant row, the request's Origin header and
 * (when the caller names one) the application it asks about. Run on EVERY request.
 */
export function checkGrant(input: {
  claims: GrantClaims;
  row: GrantRow | null;
  /** The request's Origin header. */
  origin: string | null;
  /** The application the request is about, when it names one. */
  applicationId?: string | null;
  now?: Date;
}): GrantCheck {
  const { claims, row } = input;
  const now = input.now ?? new Date();
  if (!row || row.id !== claims.jti) return { ok: false, reason: "not_found" };
  if (row.tenant_id !== claims.tenantId) return { ok: false, reason: "tenant_mismatch" };
  if (row.user_id !== claims.sub) return { ok: false, reason: "user_mismatch" };
  if (row.scope !== claims.scope) return { ok: false, reason: "scope_mismatch" };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.application_id !== claims.applicationId) return { ok: false, reason: "application_mismatch" };
  if (input.applicationId && input.applicationId !== row.application_id) return { ok: false, reason: "application_mismatch" };
  // Exact match on the normalised origin. No suffix matching, no wildcard: one grant, one site.
  const origin = httpsOrigin(input.origin);
  if (!origin || origin !== input.origin || origin !== row.carrier_origin || origin !== claims.origin) return { ok: false, reason: "origin_mismatch" };
  return { ok: true };
}

export function grantStatus(row: Pick<GrantRow, "expires_at" | "revoked_at">, now: Date = new Date()): "active" | "expired" | "revoked" {
  if (row.revoked_at) return "revoked";
  return new Date(row.expires_at).getTime() > now.getTime() ? "active" : "expired";
}
