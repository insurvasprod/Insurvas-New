import type { User } from "@supabase/supabase-js";

/**
 * The plain parts of Google sign-in (lib/tenantAuth/google.ts): what the callback reads from the
 * Auth user Supabase returns, and the flow cookie. No server imports, so they are unit-tested.
 */

export type GoogleIntent = "sign-in" | "sign-up";
export type GoogleFlow = { verifier: string; intent: GoogleIntent; plan: string | null; cycle: string | null };

export type GoogleProfile = {
  authUserId: string;
  email: string;
  name: string;
  /** Google says it owns this address. Nothing proceeds without it. */
  verified: boolean;
  /** The Google identity was added just now to an Auth user that already had a password. */
  newlyLinked: boolean;
};

/** What the callback needs from the Auth user Supabase returned. */
export function googleProfile(user: User, now = Date.now()): GoogleProfile | null {
  const google = user.identities?.find((identity) => identity.provider === "google");
  const data = (google?.identity_data ?? {}) as Record<string, unknown>;
  const email = (user.email ?? (typeof data.email === "string" ? data.email : "")).trim().toLowerCase();
  if (!google || !email) return null;
  const name = [data.full_name, data.name, user.user_metadata?.full_name, user.user_metadata?.name].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
  const verified = data.email_verified === true || user.user_metadata?.email_verified === true;
  const created = google.created_at ? Date.parse(google.created_at) : Number.NaN;
  const hasPassword = (user.identities ?? []).some((identity) => identity.provider === "email");
  return { authUserId: user.id, email, name, verified, newlyLinked: hasPassword && Number.isFinite(created) && now - created < 5 * 60 * 1000 };
}

/** Reads the flow cookie the start route set. */
export function parseGoogleFlow(raw: string | undefined): GoogleFlow | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GoogleFlow>;
    if (typeof value.verifier !== "string" || (value.intent !== "sign-in" && value.intent !== "sign-up")) return null;
    return { verifier: value.verifier, intent: value.intent, plan: typeof value.plan === "string" ? value.plan : null, cycle: typeof value.cycle === "string" ? value.cycle : null };
  } catch {
    return null;
  }
}

/**
 * What a Google sign-in finds at Insurvas (owner test, 2026-10-27). Every new Supabase Auth user gets
 * a `users` row from the `private.handle_new_auth_user` trigger, with status "invited" and nothing
 * else, so a row alone does not mean an account:
 *  - "new": no row, or that bare invited row with no agency and no partner membership. Goes to
 *    "Finish your account" from either door.
 *  - "invited": invited by an agency (a membership exists) but not accepted yet. The invitation
 *    link comes first.
 *  - "account": everything else. completeTenantSignIn decides, as for a password.
 */
export type GoogleAccountState = "new" | "invited" | "account";

export function googleAccountState(row: { status: string } | null, memberships: { agency: number; partner: number }): GoogleAccountState {
  if (!row) return "new";
  if (row.status !== "invited") return "account";
  return memberships.agency + memberships.partner === 0 ? "new" : "invited";
}
