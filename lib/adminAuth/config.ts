/**
 * Admin 2FA is mandatory for every platform account. It is intentionally not
 * configurable through an environment flag: making the second factor
 * optional would violate the SA-0.1 security boundary.
 */
export function isAdmin2faEnabled(): true {
  return true;
}
