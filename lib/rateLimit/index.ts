import "server-only";

// Rate limiting for endpoints anyone on the internet can call.
//
// Backed by the database rather than process memory, because the app runs on serverless instances
// that do not share memory: an in-process counter resets on every cold start, so an attacker could
// clear the limit just by spreading requests around.

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type RateLimitRule = {
  /** What is being limited — appears in the bucket key, so rules never collide. */
  name: string;
  max: number;
  windowSeconds: number;
};

/**
 * Signup limits.
 *
 * Two dimensions on purpose. The IP limit stops one machine creating tenants in bulk; the email
 * limit stops the same address being used to send someone repeated verification mail from our
 * domain, which costs sending reputation regardless of how many IPs it comes from.
 */
export const SIGNUP_PER_IP: RateLimitRule = { name: "signup_ip", max: 10, windowSeconds: 3600 };
export const SIGNUP_PER_EMAIL: RateLimitRule = { name: "signup_email", max: 3, windowSeconds: 3600 };
export const VERIFICATION_RESEND: RateLimitRule = { name: "verify_resend", max: 5, windowSeconds: 3600 };

/**
 * LA-2.5 · a vendor posting real-time leads.
 *
 * Per KEY rather than per IP, so one vendor's burst cannot throttle another's, which an IP-based
 * limit would do the moment two vendors shared a platform.
 *
 * LA-2.5-2 (2026-09-25): a one-minute window, 60 posts. The old 600 an hour was never reached by a
 * 100-post burst, so it limited nothing a runaway retry loop would do. Sixty a minute is 3,600 an
 * hour sustained — six times the old ceiling, far above a busy ping-post vendor (~300 an hour) — and
 * a burst above one a second gets 429 with retry-after (seconds to the next minute) instead of
 * being processed. A post over the limit is answered, not dropped: the vendor retries after
 * retry-after and is accepted.
 */
export const LEAD_POST_PER_KEY: RateLimitRule = { name: "lead_post_key", max: 60, windowSeconds: 60 };

/**
 * The caller's IP, from the proxy headers Vercel sets.
 *
 * Falls back to a single shared bucket rather than to "no limit": if we cannot tell callers apart,
 * limiting them together is wrong but safe, whereas letting them all through is neither.
 */
export function callerIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export type RateLimitResult = { allowed: true } | { allowed: false; rule: RateLimitRule };

/** Claims one request against a rule. Returns which rule refused, so the caller can say why. */
export async function claim(rule: RateLimitRule, subject: string): Promise<RateLimitResult> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("claim_rate_limit", {
    p_key: `${rule.name}:${subject.toLowerCase()}`,
    p_max: rule.max,
    p_window_seconds: rule.windowSeconds,
  });

  if (error) {
    // Fail OPEN, loudly. A rate limiter that is down should not take signup down with it — but a
    // silent failure would mean the protection quietly stops existing, so it is shouted.
    console.error(`[rate-limit] ${rule.name} check failed, allowing through: ${error.message}`);
    return { allowed: true };
  }

  return data === false ? { allowed: false, rule } : { allowed: true };
}

/** Claims several rules, stopping at the first refusal. */
export async function claimAll(
  claims: { rule: RateLimitRule; subject: string }[],
): Promise<RateLimitResult> {
  for (const { rule, subject } of claims) {
    const result = await claim(rule, subject);
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

export function retryAfterSeconds(rule: RateLimitRule): number {
  const elapsed = Math.floor(Date.now() / 1000) % rule.windowSeconds;
  return rule.windowSeconds - elapsed;
}
