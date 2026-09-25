// Everything in this file is shared with client components, so it must stay free of
// `server-only` imports. Query functions live in ./queries (server-only); their row shape and
// page size live here because the client needs both to render and paginate.

export type LoginEventRow = {
  id: string;
  actor_type: "user" | "admin";
  user_id: string | null;
  admin_id: string | null;
  email: string;
  ts: string;
  ip: string | null;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
};

export const ACTIVITY_PAGE_SIZE = 25;

/** Why an attempt failed. A small closed set so the UI can label them. */
export const LOGIN_FAILURE_REASONS = {
  invalid_credentials: "Wrong email or password",
  no_password_set: "Invitation not yet accepted",
  suspended: "Account suspended",
  inactive: "Account inactive",
  no_membership: "No tenant membership",
  invalid_2fa: "Wrong 2FA code",
  expired_2fa: "2FA step expired",
  // A correct code that had already been accepted once, or one older than the last accepted code
  // (admin verify-2fa replay protection). Counts toward the 2FA lockout like a wrong code.
  replayed_2fa: "2FA code already used",
  // Refused by login protection before the password was checked (lib/authProtection). Logged at
  // most once a minute per email + IP, so a burst of blocked requests is one row, not hundreds.
  locked_out: "Locked out after repeated failures",
  rate_limited: "Too many attempts, rate limited",
} as const;

export type LoginFailureReason = keyof typeof LOGIN_FAILURE_REASONS;

export function loginFailureLabel(reason: string | null): string {
  if (!reason) return "Failed";
  return LOGIN_FAILURE_REASONS[reason as LoginFailureReason] ?? reason;
}
