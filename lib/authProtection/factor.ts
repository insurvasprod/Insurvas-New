// Plain module (no `server-only`) so the tests can import it. index.ts is the only runtime caller.

/**
 * Which sign-in step a protection check guards.
 *
 *  - `password` — the credentials step of every plane (admin, tenant, partner).
 *  - `totp`     — the admin second factor (POST /api/admin/auth/verify-2fa).
 *
 * The two steps count in separate buckets on purpose. A correct password clears the password
 * lockout (clearLoginFailures in the login route); if wrong codes counted in that same bucket, an
 * attacker who knows the password could guess four codes, sign in with the password again to wipe
 * the count, and guess four more — for ever. Separate keys mean only a correct code clears the
 * code count.
 */
export type LoginFactor = "password" | "totp";

/** Wrong second-factor codes per staff email + IP before the lockout applies (user decision). */
export const TOTP_LOCKOUT_MAX = 5;

/**
 * The name the rate-limit and lockout keys carry. For the password step it is the actor type
 * itself, so every key that existed before the second factor was protected is unchanged.
 */
export function protectionPlane(actorType: string, factor: LoginFactor): string {
  return factor === "totp" ? `${actorType}_2fa` : actorType;
}

export function safePart(value: string, maxLength: number): string {
  return value.trim().toLowerCase().slice(0, maxLength) || "unknown";
}

/** The email + IP scope the lockout (`login_lockout:<scope>`) and blocked-attempt log are keyed on. */
export function scopeKeyFor(actorType: string, email: string, ip: string, factor: LoginFactor = "password"): string {
  const plane = protectionPlane(actorType, factor);
  return `login:${plane}:${encodeURIComponent(safePart(email, 320))}:${encodeURIComponent(safePart(ip, 128))}`;
}

export type RateLimitClaim = {
  rule: { name: string; max: number; windowSeconds: number };
  /** The claim_rate_limit key is `${rule.name}:${subject}`. */
  subject: string;
};

/**
 * The per-window rate-limit buckets one attempt claims.
 *
 * Password step: two independent buckets, per email and per IP (SA-6.2). The key includes the actor
 * plane so a public tenant address cannot consume an admin's budget.
 *
 * Second factor: ONE bucket per staff email + IP, and no per-IP bucket (user decision). Staff in an
 * office share an IP, so a per-IP budget would block the sixth colleague holding a correct code.
 * A code attempt already needed the right password for that email, and the password step keeps its
 * per-IP limit, so an address-spraying caller is still stopped there.
 */
export function rateLimitClaims(
  actorType: string,
  factor: LoginFactor,
  email: string,
  ip: string,
  attempts: number,
  windowSeconds: number,
): RateLimitClaim[] {
  const plane = protectionPlane(actorType, factor);
  const rule = (name: string) => ({ name, max: attempts, windowSeconds });
  if (factor === "totp") {
    return [{ rule: rule(`login_${plane}_email_ip`), subject: `${safePart(email, 320)}:${safePart(ip, 128)}` }];
  }
  return [
    { rule: rule(`login_${plane}_email`), subject: safePart(email, 320) },
    { rule: rule(`login_${plane}_ip`), subject: safePart(ip, 128) },
  ];
}

/**
 * The lockout threshold for a step. The second factor locks after at most five wrong codes; a
 * stricter configured threshold (security.lockout_threshold below 5) applies to it too, so the
 * setting can tighten the code step but never loosen it. The lockout duration is the same
 * security.lockout_minutes for both.
 */
export function lockoutThresholdFor(factor: LoginFactor, configuredThreshold: number): number {
  return factor === "totp" ? Math.min(TOTP_LOCKOUT_MAX, configuredThreshold) : configuredThreshold;
}

/**
 * Seconds until a lockout lifts, or 0 when none applies. `row` is the newest `login_lockout:` row
 * for the email + IP key: recordLoginFailure adds one hit per failure (claim_rate_limit increments
 * unconditionally) in a fixed window of `lockoutSeconds`. So with a threshold of 5, five failures
 * lock the key and the sixth attempt is refused before anything is checked.
 */
export function lockoutRetrySeconds(
  row: { hits: number; window_start: string } | null,
  threshold: number,
  lockoutSeconds: number,
  nowMs: number,
): number {
  if (!row || row.hits < threshold) return 0;
  const retry = Math.ceil((new Date(row.window_start).getTime() + lockoutSeconds * 1000 - nowMs) / 1000);
  return retry > 0 ? retry : 0;
}
