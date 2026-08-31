import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function key(): Buffer {
  const configured = process.env.COMPLIANCE_VENDOR_ENCRYPTION_KEY;
  if (!configured) throw new Error("COMPLIANCE_VENDOR_ENCRYPTION_KEY is not set");
  return createHash("sha256").update(configured, "utf8").digest();
}

export function encryptVendorCredentials(value: string): string {
  if (!value) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptVendorCredentials(value: string | null): string | null {
  if (!value) return null;
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText) throw new Error("Unsupported credential ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}
