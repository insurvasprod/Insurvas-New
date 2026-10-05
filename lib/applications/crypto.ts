import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Sensitive application values — SSN, routing, account and card numbers (LA-3.7, 3.19) — encrypted
 * before they reach the database. AES-256-GCM, the construction lib/agencyProfile/crypto.ts and
 * lib/compliance/crypto.ts already use, with two additions:
 *
 *   - PER-TENANT KEYS. HKDF-SHA256 over APPLICATION_DATA_ENCRYPTION_KEY with the tenant id as salt,
 *     so one agency's ciphertext cannot be opened with another's derived key.
 *   - BOUND TO ITS ROW. The tenant, application and field key are the GCM associated data: a
 *     ciphertext copied into another application, or into another field, fails to verify rather than
 *     decrypting as somebody else's routing number.
 *
 * `key_version` is stored beside every ciphertext so a rotation can re-encrypt in place.
 * There is deliberately no fallback secret: the application data key is its own.
 */
export const APPLICATION_KEY_VERSION = 1;
const PREFIX = "a1";

export class ApplicationKeyMissingError extends Error {
  constructor() {
    super("Sensitive application details cannot be stored until APPLICATION_DATA_ENCRYPTION_KEY is set on the server.");
    this.name = "ApplicationKeyMissingError";
  }
}

export function applicationKeyConfigured() {
  return Boolean(process.env.APPLICATION_DATA_ENCRYPTION_KEY);
}

function tenantKey(tenantId: string, version: number): Buffer {
  const master = process.env.APPLICATION_DATA_ENCRYPTION_KEY;
  if (!master) throw new ApplicationKeyMissingError();
  if (version !== APPLICATION_KEY_VERSION) throw new Error(`Unknown application key version ${version}`);
  return Buffer.from(hkdfSync("sha256", Buffer.from(master, "utf8"), Buffer.from(tenantId, "utf8"), Buffer.from(`insurvas:application-data:v${version}`, "utf8"), 32));
}

function aad(scope: SensitiveScope) {
  return Buffer.from(`${scope.tenantId}|${scope.applicationId}|${scope.fieldKey}`, "utf8");
}

export type SensitiveScope = { tenantId: string; applicationId: string; fieldKey: string };

export function encryptSensitive(value: string, scope: SensitiveScope): { ciphertext: string; keyVersion: number } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tenantKey(scope.tenantId, APPLICATION_KEY_VERSION), iv);
  cipher.setAAD(aad(scope));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    ciphertext: [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join("."),
    keyVersion: APPLICATION_KEY_VERSION,
  };
}

/** null when nothing is stored or the ciphertext does not verify for this scope. Throws only when the key is missing. */
export function decryptSensitive(ciphertext: string | null, keyVersion: number | null, scope: SensitiveScope): string | null {
  if (!ciphertext) return null;
  const key = tenantKey(scope.tenantId, keyVersion ?? APPLICATION_KEY_VERSION);
  try {
    const [prefix, ivText, tagText, bodyText] = ciphertext.split(".");
    if (prefix !== PREFIX || !ivText || !tagText || !bodyText) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAAD(aad(scope));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
