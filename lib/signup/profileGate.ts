/**
 * The first-login gate for a skipped business profile (manager review, 2026-10-28, 13:49: "when he
 * logs in, first thing, complete your onboarding … fill this to continue"; owner, 2026-10-28: block the
 * app until it is filled).
 *
 * Who is gated: the owner of a self-serve agency (it has a sign-up record) whose plan has started and
 * which has no business profile. Agencies made any other way (staff-provisioned, older accounts) have
 * no sign-up record and are never gated, nor is anyone who is not the owner.
 *
 * "Skip for now" lets the current login through: the skip cookie holds this session's key, and a new
 * sign-in has a new key, so the next login is asked. Nothing has to clear the cookie.
 *
 * Pure, so it can be unit-tested; the shell reads the facts (lib/signup/profileGateQueries.ts).
 */
export type ProfileGateFacts = {
  role: string;
  userStatus: string;
  onboardingState: string;
  /** The agency has a signup_selections row: it came through self-serve sign-up. */
  signedUpHere: boolean;
  hasProfile: boolean;
  /** The skip cookie's value, or null. */
  skippedSession: string | null;
  /** This login's key (sessionKey). */
  currentSession: string;
};

export function needsProfileGate(facts: ProfileGateFacts): boolean {
  if (facts.role !== "owner" || facts.userStatus !== "active" || facts.onboardingState !== "completed") return false;
  if (!facts.signedUpHere || facts.hasProfile) return false;
  if (facts.skippedSession !== null && facts.skippedSession === facts.currentSession) return false;
  return true;
}

/**
 * One login's key: the session row id, or the token's expiry on cookies issued before session rows
 * existed. Either changes with every new sign-in.
 */
export function sessionKey(session: { sid?: string; exp?: number }): string {
  return session.sid ?? `exp:${session.exp ?? 0}`;
}

/** The About you form in its gate form: no Skip, "Finish setting up". */
export const PROFILE_GATE_PATH = "/app/onboarding/business-profile?finish=1";
