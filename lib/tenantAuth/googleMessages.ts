/**
 * What the sign-in and sign-up pages say when Google sends someone back without signing them in
 * (2026-10-27). The callback puts only one of these keys in the URL, never text, so a crafted link
 * cannot make the page say anything else.
 */
export const GOOGLE_MESSAGES: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  failed: "Google sign-in did not finish. Try again.",
  expired: "Google sign-in took too long or was opened in another browser. Try again.",
  unverified: "Google could not confirm that email address. Use another Google account or your email.",
  locked: "Too many sign-in attempts. Wait a few minutes and try again.",
  maintenance: "Sign in is temporarily unavailable.",
  partner: "This is a partner account. Sign in on the partner portal instead.",
  "agency-suspended": "Your agency's workspace is suspended. Contact Insurvas support.",
  "account-suspended": "Your account has been suspended. Contact your administrator.",
  // An agency invited this address and the invitation is not accepted yet.
  invited: "You have an invitation to Insurvas. Open the link in your invitation email to join first.",
  // The account exists but is switched off (the person left, or the owner turned them off).
  inactive: "This account is not active. Ask your agency's owner, or contact Insurvas support.",
  refused: "We could not sign you in with Google. Use your email and password.",
  exists: "An account already uses that email. Sign in with your email and password.",
  disposable: "Disposable email addresses are not allowed.",
  unavailable: "Google sign-in is not available yet. Use your email instead.",
};

/** The sentence for a `?google=` value, or null for anything else. */
export function googleMessage(reason: string | null | undefined): string | null {
  return reason && Object.hasOwn(GOOGLE_MESSAGES, reason) ? GOOGLE_MESSAGES[reason] : null;
}
