import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getClientIp, getUserAgent } from "@/lib/request/clientInfo";
import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { signTenantSessionToken } from "./session";
import { approxLocation, deviceLabel } from "./securityRules";
import { revokeExtensionGrantsForSessionEnd } from "@/lib/extension/sessionGrants";

/**
 * LA-8.2 (Notion sprint) · tenant sessions as rows. Every sign-in makes one, and the cookie names it;
 * lib/tenantAuth/requireTenant.ts checks the row on every request, so "end this session" takes effect
 * on that session's next request — store-checked, never inferred from the token.
 *
 * Before migration 20261015310000 there is no table: a cookie is issued without a session id, exactly
 * as before, and sign-in keeps working.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the table is not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;

export type SessionRevokeReason = "signed_out" | "ended_by_user" | "password_changed" | "email_changed" | "two_factor_changed" | "switched_workspace";

/** Make the session row, then the cookie that names it. */
export async function issueTenantSession(input: {
  userId: string;
  tenantId: string;
  sessionVersion: number;
  request: Request;
  /** The sign-in passed the second factor (or carries it over, on a workspace switch). */
  twoFactorAt?: string | null;
  /** "Keep me signed in on this device", and the expiry to keep when a session is carried over. */
  remember?: boolean;
  expiresAt?: number;
}): Promise<{ token: string; sessionId: string | null }> {
  const userAgent = getUserAgent(input.request);
  const { data, error } = await db().from("tenant_user_session").insert({
    user_id: input.userId,
    tenant_id: input.tenantId,
    ip: getClientIp(input.request)?.slice(0, 64) ?? null,
    approx_location: approxLocation(input.request.headers),
    user_agent: userAgent?.slice(0, 512) ?? null,
    device_label: deviceLabel(userAgent),
    two_factor_at: input.twoFactorAt ?? null,
  }).select("id").single();
  if (error && !isPendingSchema(error)) throw new Error(`Could not start the session: ${error.message}`);
  const sessionId = (data?.id as string | undefined) ?? null;
  return { token: await signTenantSessionToken(input.userId, input.tenantId, input.sessionVersion, sessionId ?? undefined, { remember: input.remember, expiresAt: input.expiresAt }), sessionId };
}

export type SessionCheck = { live: boolean; twoFactorAt: string | null };

/**
 * Is this session still live? A row that is gone, revoked or belongs to someone else is not. When
 * the table is not there yet, a cookie with a session id cannot have been issued, so any answer but
 * "missing table" is authoritative. last_seen_at is moved at most every five minutes, after the fact.
 */
export async function checkTenantSession(sessionId: string, userId: string): Promise<SessionCheck> {
  const { data, error } = await db().from("tenant_user_session").select("user_id, revoked_at, last_seen_at, two_factor_at").eq("id", sessionId).maybeSingle();
  if (error) {
    if (isPendingSchema(error)) return { live: true, twoFactorAt: null };
    throw new Error(`Could not check the session: ${error.message}`);
  }
  if (!data || data.user_id !== userId || data.revoked_at) return { live: false, twoFactorAt: null };
  if (Date.now() - Date.parse(data.last_seen_at) > 5 * 60_000) {
    void db().from("tenant_user_session").update({ last_seen_at: new Date().toISOString() }).eq("id", sessionId).is("revoked_at", null).then(() => undefined, () => undefined);
  }
  return { live: true, twoFactorAt: data.two_factor_at ?? null };
}

/** End one session, or every one but `except`. Returns how many ended. */
export async function endTenantSessions(input: { userId: string; sessionId?: string | null; except?: string | null; reason: SessionRevokeReason; by: string | null }): Promise<number> {
  const { data, error } = await db().rpc("end_user_sessions", {
    p_user_id: input.userId, p_session_id: input.sessionId ?? null, p_except: input.except ?? null, p_reason: input.reason, p_by: input.by,
  });
  if (error) {
    if (isPendingSchema(error)) return 0;
    throw new Error(`Could not end the session: ${error.message}`);
  }
  // LA-3.12 · the browser-extension grants those sessions opened end with them. A failure here is
  // logged, not thrown: the session has ended, and the extension checks its session on every request.
  await revokeExtensionGrantsForSessionEnd({ userId: input.userId, sessionId: input.sessionId ?? null, except: input.except ?? null, reason: input.reason })
    .catch((e) => console.error("[sessions] extension grants", e instanceof Error ? e.message : e));
  return Number(data ?? 0);
}

export type SessionRow = { id: string; tenantName: string; createdAt: string; lastSeenAt: string; ip: string | null; location: string | null; device: string; current: boolean; twoFactor: boolean };

/** This person's live sessions, newest activity first, across every workspace they belong to. */
export async function listTenantSessions(userId: string, currentId: string | null): Promise<SessionRow[] | null> {
  const { data, error } = await db().from("tenant_user_session")
    .select("id, created_at, last_seen_at, ip, approx_location, device_label, two_factor_at, tenants(name)")
    .eq("user_id", userId).is("revoked_at", null).order("last_seen_at", { ascending: false }).limit(100);
  if (error) {
    if (isPendingSchema(error)) return null;
    throw new Error(`Could not list sessions: ${error.message}`);
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    tenantName: ((r.tenants as { name?: string } | null)?.name ?? "Workspace"),
    createdAt: r.created_at as string,
    lastSeenAt: r.last_seen_at as string,
    ip: (r.ip as string | null) ?? null,
    location: (r.approx_location as string | null) ?? null,
    device: (r.device_label as string | null) ?? "Unknown device",
    current: r.id === currentId,
    twoFactor: Boolean(r.two_factor_at),
  }));
}
