import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * The agency's federal tax ID, encrypted before it reaches the database (AES-256-GCM, the same
 * construction lib/compliance/crypto.ts uses for vendor credentials).
 *
 * Key: AGENCY_TAX_ID_ENCRYPTION_KEY, or — so a deployment that already holds a secret for vendor
 * credentials does not need a second one to start — COMPLIANCE_VENDOR_ENCRYPTION_KEY. Either way the
 * key is derived under its own label, so a tax-ID ciphertext cannot be decrypted as a credential or
 * the other way round.
 */
const VERSION = "t1";

export class TaxIdKeyMissingError extends Error {
  constructor() {
    super("Tax IDs cannot be stored until AGENCY_TAX_ID_ENCRYPTION_KEY is set on the server.");
    this.name = "TaxIdKeyMissingError";
  }
}

function key(): Buffer {
  const configured = process.env.AGENCY_TAX_ID_ENCRYPTION_KEY || process.env.COMPLIANCE_VENDOR_ENCRYPTION_KEY;
  if (!configured) throw new TaxIdKeyMissingError();
  return createHash("sha256").update(`insurvas:agency-tax-id:${configured}`, "utf8").digest();
}

export function taxIdKeyConfigured() {
  return Boolean(process.env.AGENCY_TAX_ID_ENCRYPTION_KEY || process.env.COMPLIANCE_VENDOR_ENCRYPTION_KEY);
}

export function encryptTaxId(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** null when there is nothing stored, no key, or the ciphertext does not verify. Never throws. */
export function decryptTaxId(value: string | null): string | null {
  if (!value) return null;
  try {
    const [version, ivText, tagText, ciphertextText] = value.split(".");
    if (version !== VERSION || !ivText || !tagText || !ciphertextText) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
