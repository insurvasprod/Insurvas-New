import { APPLICATION_KEY_VERSION, decryptSensitive, encryptSensitive, type SensitiveScope } from "../applications/cryptoCore.ts";

/**
 * Staff authenticator secrets at rest (audit 2026-10-16).
 *
 * admin_users.totp_secret used to hold the base32 secret in plain text, so anyone who could read
 * the table (a leaked backup, a service-key script, a logged row) could mint valid second-factor
 * codes for every admin. It now holds the same AES-256-GCM ciphertext SSNs and agency 2FA secrets
 * use (lib/applications/cryptoCore.ts), keyed per admin and bound to this field, so a ciphertext
 * copied onto another admin's row does not open.
 *
 * The column keeps its shape (text, NOT NULL, '' = not enrolled) so no DDL is needed. The "a1."
 * prefix tells ciphertext from a legacy plain secret; the key version is the prefix's (1). A legacy
 * row still verifies, and verify-2fa re-stores it encrypted on that sign-in; the rest are converted
 * by scripts/encrypt-admin-totp-secrets.mjs (run once by the owner).
 */
const CIPHERTEXT_PREFIX = "a1.";

const scope = (adminId: string): SensitiveScope => ({ tenantId: adminId, applicationId: adminId, fieldKey: "admin.totp_secret" });

export function isSealedTotpSecret(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(CIPHERTEXT_PREFIX);
}

/** The value to store in admin_users.totp_secret. Throws ApplicationKeyMissingError without the key. */
export function sealAdminTotpSecret(adminId: string, secret: string): string {
  return encryptSensitive(secret, scope(adminId)).ciphertext;
}

/**
 * The secret a stored value holds. `legacy` marks a plain-text row that should be re-stored sealed.
 * null when nothing is stored or a ciphertext does not open for this admin (never a guess).
 */
export function openAdminTotpSecret(adminId: string, stored: string | null | undefined): { secret: string; legacy: boolean } | null {
  if (typeof stored !== "string" || !stored.trim()) return null;
  if (!isSealedTotpSecret(stored)) return { secret: stored, legacy: true };
  const secret = decryptSensitive(stored, APPLICATION_KEY_VERSION, scope(adminId));
  return secret ? { secret, legacy: false } : null;
}
