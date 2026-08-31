/**
 * Admin 2FA is opt-in so deployments can control the extra login step without
 * a code change. Only the explicit value "true" enables it.
 */
export function isAdmin2faEnabled(value = process.env.ADMIN_2FA_ENABLED): boolean {
  return value?.trim().toLowerCase() === "true";
}
