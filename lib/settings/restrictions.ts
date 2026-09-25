// Client-safe, like ./constants: the Advanced screen renders from these lists and the settings API
// enforces them, so the two read one definition and cannot disagree.
//
// Kept beside the registry rather than as fields on each definition so that adding a restriction
// does not rewrite registry entries another change may be editing.

import type { AdminRole } from "@/lib/adminAuth/roles";

import type { SettingKey, SettingValue } from "./constants";

/**
 * The four knobs lib/authProtection reads for password-login protection, in the order the Login
 * protection card draws them: the per-window rate limit first, then the lockout it escalates to.
 *
 * Super admin only. They decide how hard an attacker may push on staff and customer sign-in, which
 * is a security call rather than platform configuration — the same line the lockouts table and its
 * unlock already draw (app/api/admin/security/rate-limits).
 */
export const LOGIN_PROTECTION_KEYS = [
  "security.login_attempts",
  "security.login_window_minutes",
  "security.lockout_threshold",
  "security.lockout_minutes",
] as const satisfies readonly SettingKey[];

/** Who may read and change a login-protection key. Everything else keeps CAN_MANAGE_SETTINGS. */
export const LOGIN_PROTECTION_ROLES: readonly AdminRole[] = ["super_admin"];

/** The Login protection card's field labels. The store rows use the registry's help text instead. */
export const LOGIN_PROTECTION_LABELS: Record<(typeof LOGIN_PROTECTION_KEYS)[number], string> = {
  "security.login_attempts": "Attempts per window",
  "security.login_window_minutes": "Window minutes",
  "security.lockout_threshold": "Attempts before lockout",
  "security.lockout_minutes": "Lockout minutes",
};

/**
 * Counts that decide how much one caller may do before a limiter or a lockout engages. Raising
 * any of them loosens abuse protection, so the Advanced screen warns while one sits above its
 * coded default.
 *
 * Only the "how many" keys: a longer window or a longer lockout is stricter, not looser, so the
 * minute keys are deliberately not here.
 */
export const ABUSE_CONTROL_KEYS = [
  "security.login_attempts",
  "security.lockout_threshold",
  "security.password_reset_per_hour",
  "security.verification_resend_per_hour",
  "security.signup_per_ip_per_hour",
  "security.public_plans_per_minute",
] as const satisfies readonly SettingKey[];

export function isLoginProtectionKey(key: string): boolean {
  return (LOGIN_PROTECTION_KEYS as readonly string[]).includes(key);
}

export function isAbuseControlKey(key: string): boolean {
  return (ABUSE_CONTROL_KEYS as readonly string[]).includes(key);
}

/** Whether this role may see and change this key at all. */
export function canManageSettingKey(role: AdminRole, key: string): boolean {
  return !isLoginProtectionKey(key) || LOGIN_PROTECTION_ROLES.includes(role);
}

/** An abuse-control key set above its default — the case the warning callout exists for. */
export function isLoosenedAbuseControl(key: string, value: SettingValue, defaultValue: SettingValue): boolean {
  return isAbuseControlKey(key) && typeof value === "number" && typeof defaultValue === "number" && value > defaultValue;
}
