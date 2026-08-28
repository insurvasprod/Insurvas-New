/** Why an attempt failed. A small closed set so the UI can label them, kept free of
 *  `server-only` imports so client components can use it too. */
export const LOGIN_FAILURE_REASONS = {
  invalid_credentials: "Wrong email or password",
  no_password_set: "Invitation not yet accepted",
  suspended: "Account suspended",
  inactive: "Account inactive",
  no_membership: "No tenant membership",
  invalid_2fa: "Wrong 2FA code",
  expired_2fa: "2FA step expired",
} as const;

export type LoginFailureReason = keyof typeof LOGIN_FAILURE_REASONS;

export function loginFailureLabel(reason: string | null): string {
  if (!reason) return "Failed";
  return LOGIN_FAILURE_REASONS[reason as LoginFailureReason] ?? reason;
}
