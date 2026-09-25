import "server-only";

import { after } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { callerIp, type RateLimitRule, retryAfterSeconds } from "@/lib/rateLimit";
import { getSetting } from "@/lib/settings/queries";
import { recordLoginEvent } from "@/lib/loginEvents/record";
import { lockoutRetrySeconds, lockoutThresholdFor, rateLimitClaims, scopeKeyFor, type LoginFactor } from "./factor";

export type LoginActorType = "admin" | "user";
export type { LoginFactor } from "./factor";

type LoginConfig = {
  attempts: number;
  windowSeconds: number;
  lockoutThreshold: number;
  lockoutSeconds: number;
};

export type LoginProtectionResult =
  | { allowed: true; scopeKey: string }
  | {
      allowed: false;
      retryAfterSeconds: number;
      reason: "rate_limited" | "locked_out";
      /** The protection check itself failed (fail-closed). Nobody was actually locked out or limited. */
      checkFailed?: true;
    };

export type BlockedLoginResult = Extract<LoginProtectionResult, { allowed: false }>;

// Key construction lives in ./factor (a plain module, so the tests can pin it).
function scopeKey(actorType: LoginActorType, email: string, ip: string, factor: LoginFactor = "password"): string {
  return scopeKeyFor(actorType, email, ip, factor);
}

function lockoutKey(scope: string): string {
  return `login_lockout:${scope}`;
}

async function config(): Promise<LoginConfig> {
  const [attempts, windowMinutes, lockoutThreshold, lockoutMinutes] = await Promise.all([
    getSetting<number>("security.login_attempts"),
    getSetting<number>("security.login_window_minutes"),
    getSetting<number>("security.lockout_threshold"),
    getSetting<number>("security.lockout_minutes"),
  ]);
  return {
    attempts,
    windowSeconds: windowMinutes * 60,
    lockoutThreshold,
    lockoutSeconds: lockoutMinutes * 60,
  };
}

function claimsFor(
  actorType: LoginActorType,
  email: string,
  ip: string,
  settings: LoginConfig,
  factor: LoginFactor = "password",
): { rule: RateLimitRule; subject: string }[] {
  // Password: per-email and per-IP buckets (SA-6.2). Second factor: one email + IP bucket only, never
  // per IP alone — see rateLimitClaims in ./factor.
  return rateLimitClaims(actorType, factor, email, ip, settings.attempts, settings.windowSeconds);
}

/**
 * Runs before password verification. A refused request must return before users/admin_users or
 * Supabase Auth are queried, so repeated attempts cannot keep touching the credential store.
 *
 * `factor: "totp"` guards the admin second factor with its own buckets and a lockout of at most
 * five wrong codes (./factor). The pending-2FA token only carries the admin id, so verify-2fa reads
 * the admin row by id before this runs; the code itself is still checked only when this allows it.
 */
export async function checkLoginAllowed(
  actorType: LoginActorType,
  email: string,
  request: Request,
  factor: LoginFactor = "password",
): Promise<LoginProtectionResult> {
  const settings = await config();
  const ip = callerIp(request.headers);
  const key = scopeKey(actorType, email, ip, factor);
  const lockoutThreshold = lockoutThresholdFor(factor, settings.lockoutThreshold);
  const supabase = getSupabaseServiceClient();

  const { data: lockout, error: lockoutError } = await supabase
    .from("rate_limits")
    .select("hits, window_start")
    .eq("bucket_key", lockoutKey(key))
    .order("window_start", { ascending: false })
    .limit(1)
    .maybeSingle<{ hits: number; window_start: string }>();
  if (lockoutError) {
    console.error("[login-protection] lockout check failed", lockoutError.message);
    // Login protection is fail-closed: bypassing a security control is worse than briefly making
    // login unavailable. This is a temporary 429 with Retry-After, not a misleading 500 or hang.
    return { allowed: false, retryAfterSeconds: 30, reason: "locked_out", checkFailed: true };
  }
  const lockoutRetry = lockoutRetrySeconds(lockout, lockoutThreshold, settings.lockoutSeconds, Date.now());
  if (lockoutRetry > 0) {
    return {
      allowed: false,
      retryAfterSeconds: lockoutRetry,
      reason: "locked_out",
    };
  }

  const claims = claimsFor(actorType, email, ip, settings, factor);

  for (const { rule, subject } of claims) {
    const { data, error } = await supabase.rpc("claim_rate_limit", {
      p_key: `${rule.name}:${subject}`,
      p_max: rule.max,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      console.error("[login-protection] rate-limit check failed", error.message);
      return { allowed: false, retryAfterSeconds: 30, reason: "rate_limited", checkFailed: true };
    }
    if (data === false) {
      return { allowed: false, retryAfterSeconds: retryAfterSeconds(rule), reason: "rate_limited" };
    }
  }

  return { allowed: true, scopeKey: key };
}

export async function recordLoginFailure(
  actorType: LoginActorType,
  email: string,
  request: Request,
  factor: LoginFactor = "password",
): Promise<void> {
  const settings = await config();
  const key = scopeKey(actorType, email, callerIp(request.headers), factor);
  const { error } = await getSupabaseServiceClient().rpc("claim_rate_limit", {
    p_key: lockoutKey(key),
    p_max: lockoutThresholdFor(factor, settings.lockoutThreshold),
    p_window_seconds: settings.lockoutSeconds,
  });
  if (error) console.error("[login-protection] failed to record login failure", error.message);
}

export async function clearLoginFailures(
  actorType: LoginActorType,
  email: string,
  request: Request,
  factor: LoginFactor = "password",
): Promise<void> {
  const key = scopeKey(actorType, email, callerIp(request.headers), factor);
  const { error } = await getSupabaseServiceClient().from("rate_limits").delete().eq("bucket_key", lockoutKey(key));
  if (error) console.error("[login-protection] failed to clear login failures", error.message);
}

/** At most one logged blocked attempt per email + IP key per this many seconds. */
const BLOCKED_LOG_WINDOW_SECONDS = 60;

/**
 * Records a refused sign-in (locked out / rate limited) in login_events, so the Login activity page
 * shows the attempts that were stopped and not only the ones that got as far as a password check.
 *
 * Best-effort and off the response path, by construction:
 *  - it is scheduled with `after`, so it runs once the 429 has been sent and cannot delay it;
 *  - nothing here throws to the caller — every failure is caught and logged to the console;
 *  - it is capped at one row per email + IP key per minute through the same claim_rate_limit
 *    counter login protection uses (`login_blocked_log:<key>`), so an attacker hammering a locked
 *    account writes one row a minute, not one per request;
 *  - when the protection check itself failed (checkFailed) nothing is written: nobody was locked
 *    out, and the database that just failed is the one this would write to.
 *
 * `factor: "totp"` (admin verify-2fa) caps on its own key, so a refused code and a refused
 * password in the same minute are both recorded.
 */
export function logBlockedLoginAttempt(
  actorType: LoginActorType,
  email: string,
  request: Request,
  blocked: BlockedLoginResult,
  factor: LoginFactor = "password",
): void {
  if (blocked.checkFailed) return;
  const key = `login_blocked_log:${scopeKey(actorType, email, callerIp(request.headers), factor)}`;

  const work = async () => {
    try {
      const { data: first, error } = await getSupabaseServiceClient().rpc("claim_rate_limit", {
        p_key: key,
        p_max: 1,
        p_window_seconds: BLOCKED_LOG_WINDOW_SECONDS,
      });
      if (error) {
        console.error("[login-protection] could not cap blocked-attempt logging", error.message);
        return;
      }
      if (first !== true) return; // already logged one for this key this minute
      await recordLoginEvent({ request, email, success: false, actorType, failureReason: blocked.reason });
    } catch (error) {
      console.error("[login-protection] could not log blocked attempt", error);
    }
  };

  try {
    after(work);
  } catch (error) {
    // Outside a request scope `after` throws. Logging is optional; the refusal already stands.
    console.error("[login-protection] could not schedule blocked-attempt logging", error);
  }
}

export function loginRateLimitResponse(retryAfter: number): ResponseInit {
  return {
    status: 429,
    headers: {
      "retry-after": String(Math.max(1, Math.ceil(retryAfter))),
      "cache-control": "no-store",
    },
  };
}
