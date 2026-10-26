import "server-only";

import { sendEmail } from "@/lib/email/transport";
import { securityNoticeEmail } from "@/lib/email/templates";
import { getClientIp, getUserAgent } from "@/lib/request/clientInfo";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { failedLoginBursts, ownFailedLogins, type LoginEventRow } from "@/lib/tenantAuth/securityRules";

/**
 * LA-8.2 (Notion sprint) · the security event log a person reads on their own profile: password and
 * email changes, two-factor on and off, recovery codes used or replaced, sessions ended — and bursts
 * of failed sign-ins, read from login_events rather than copied. Someone who suspects their account
 * was used can look for themselves; nobody has to run a query for them.
 *
 * Append-only (20261015310000). LA-8.8's viewer reads the same table.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the table is not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;

export type SecurityEventType =
  | "password_changed" | "email_change_requested" | "email_changed" | "two_factor_enabled" | "two_factor_disabled"
  | "recovery_code_used" | "recovery_codes_regenerated" | "session_ended" | "other_sessions_ended"
  // 2026-10-24 (migration 20261024100000).
  | "device_trusted" | "signed_in_with_link";

export const SECURITY_EVENT_LABELS: Record<SecurityEventType | "failed_logins", string> = {
  password_changed: "Password changed",
  email_change_requested: "Email change requested",
  email_changed: "Sign-in email changed",
  two_factor_enabled: "Two-factor turned on",
  two_factor_disabled: "Two-factor turned off",
  recovery_code_used: "Recovery code used to sign in",
  recovery_codes_regenerated: "New recovery codes made",
  session_ended: "A session was ended",
  other_sessions_ended: "Every other session was ended",
  device_trusted: "This device trusted for 30 days",
  signed_in_with_link: "Signed in with an emailed link",
  failed_logins: "Failed sign-in attempts",
};

/** Record one event. A failure is logged and never undoes the change it describes. */
export async function recordSecurityEvent(input: { userId: string; tenantId: string | null; type: SecurityEventType; detail?: Record<string, unknown>; request?: Request }) {
  const { error } = await db().from("user_security_event").insert({
    user_id: input.userId,
    tenant_id: input.tenantId,
    event_type: input.type,
    detail: input.detail ?? {},
    ip: input.request ? getClientIp(input.request)?.slice(0, 64) ?? null : null,
    user_agent: input.request ? getUserAgent(input.request)?.slice(0, 512) ?? null : null,
  });
  if (error && !isPendingSchema(error)) console.error("[security-event]", input.type, error.message);
}

export type SecurityEventRow = { id: string; type: SecurityEventType | "failed_logins"; label: string; at: string; ip: string | null; device: string | null; detail: Record<string, unknown> };

/** This person's own events, newest first, with failed-login bursts from the last 90 days among them. */
export async function listSecurityEvents(userId: string, emailOrRead: string | PromiseLike<string>): Promise<SecurityEventRow[] | null> {
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const columns = "id, ts, ip, user_id, email";
  // The event log, the failed sign-ins by user id and the address do not depend on one another: one
  // round trip. Only the by-address read waits, for the address and the former ones in the log.
  const [events, byUser, email] = await Promise.all([
    db().from("user_security_event").select("id, event_type, detail, ip, user_agent, occurred_at").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(200),
    db().from("login_events").select(columns).eq("actor_type", "user").eq("user_id", userId).eq("success", false).gte("ts", since).order("ts", { ascending: false }).limit(500),
    emailOrRead,
  ]);
  if (events.error) {
    if (isPendingSchema(events.error)) return null;
    throw new Error(`Could not read the security log: ${events.error.message}`);
  }
  // Addresses this person signed in with before, and when they moved off each (email_changed rows).
  const formerEmails = new Map<string, string>();
  for (const e of (events.data ?? []) as { event_type: string; detail: Record<string, unknown> | null; occurred_at: string }[]) {
    const from = e.event_type === "email_changed" && typeof e.detail?.from === "string" ? e.detail.from.toLowerCase() : null;
    if (from && from !== email.toLowerCase() && (!formerEmails.has(from) || (formerEmails.get(from) as string) < e.occurred_at)) formerEmails.set(from, e.occurred_at);
  }
  const byEmail = await db().from("login_events").select(columns).eq("actor_type", "user").in("email", [email.toLowerCase(), ...formerEmails.keys()]).is("user_id", null).eq("success", false).gte("ts", since).order("ts", { ascending: false }).limit(500);
  const failures = { data: ownFailedLogins([...((byUser.data ?? []) as LoginEventRow[]), ...((byEmail.data ?? []) as LoginEventRow[])], userId, email, formerEmails) };
  const rows: SecurityEventRow[] = ((events.data ?? []) as Record<string, unknown>[]).map((e) => ({
    id: e.id as string,
    type: e.event_type as SecurityEventType,
    label: SECURITY_EVENT_LABELS[e.event_type as SecurityEventType] ?? String(e.event_type),
    at: e.occurred_at as string,
    ip: (e.ip as string | null) ?? null,
    device: (e.user_agent as string | null) ?? null,
    detail: (e.detail as Record<string, unknown>) ?? {},
  }));
  for (const burst of failedLoginBursts(((failures.data ?? []) as { ts: string; ip: string | null }[]))) {
    rows.push({ id: `failed-${burst.to}`, type: "failed_logins", label: `${burst.count} failed sign-in attempts`, at: burst.to, ip: burst.ips.join(", ") || null, device: null, detail: { from: burst.from, count: burst.count } });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Tell the person (LA-8.2): a password change, an email change (to both the old and the new address),
 * two-factor turned off. A failed send is logged and never undoes the change.
 */
export async function sendSecurityNotice(input: { to: string; name: string; what: string; detail?: string; userId: string; tenantId: string | null }) {
  const rendered = securityNoticeEmail({ name: input.name, what: input.what, when: new Date(), detail: input.detail, profileUrl: `${configuredAppOrigin("agent")}/app/profile#security` });
  await sendEmail({ to: input.to, ...rendered, templateKey: "user.security_notice", userId: input.userId, tenantId: input.tenantId })
    .catch((error: unknown) => console.error("[security-notice]", input.what, error instanceof Error ? error.message : error));
}
