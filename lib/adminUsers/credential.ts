/**
 * Which sign-in link a person can be sent: a password reset, a fresh invitation, or neither.
 * Plain module — the users list, the user record and both reset routes share it.
 *
 * Supabase Auth is the credential authority for agency sign-in (app/api/app/auth/login), and the
 * set-password page writes BOTH the Auth password and the legacy `users.password_hash`. Most
 * accounts were created through Auth directly and have no hash at all (193 of 198 active on
 * 2026-09-25), so "has a hash" was the wrong test: it offered those people only "Resend
 * invitation", which the invite route then accepted for someone already in their agency.
 *
 * The rule is onboarding, not the hash:
 *  - Someone who has joined an agency (an accepted membership) or has a hash is past the invite:
 *    they get a reset.
 *  - Someone who has never accepted a membership and has no hash is still being invited.
 *  - Only an ACTIVE account gets a reset. Consuming a reset link sets the account active
 *    (consume_user_password_token), so a reset sent to a suspended or deactivated person would
 *    have lifted the suspension through the back door.
 */
export type CredentialAction = "reset" | "invite";

export type CredentialFacts = {
  status: string;
  hasPassword: boolean;
  /** True when any tenant_users row for the person has accepted_at set. */
  acceptedMembership: boolean;
};

export function isOnboarded(facts: Pick<CredentialFacts, "hasPassword" | "acceptedMembership">): boolean {
  return facts.hasPassword || facts.acceptedMembership;
}

export function credentialAction(facts: CredentialFacts): CredentialAction | null {
  if (facts.status === "deleted") return null;
  if (isOnboarded(facts)) return facts.status === "active" ? "reset" : null;
  // Not onboarded yet: an invitation, for an account still waiting for one.
  return facts.status === "active" || facts.status === "pending_verification" ? "invite" : null;
}

/** Why no reset can be sent, in the words the menu and the route both use. */
export function resetRefusal(facts: CredentialFacts): string | null {
  if (credentialAction(facts) === "reset") return null;
  if (!isOnboarded(facts)) return "This user hasn't joined their agency yet — resend their invitation instead";
  return "Only an active account can be sent a password reset. Reactivate or lift the suspension first.";
}
