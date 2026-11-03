import * as OTPAuth from "otpauth";

const ISSUER = "Insurvas Admin";
const PERIOD_SECONDS = 30;

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function buildTotp(email: string, secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: PERIOD_SECONDS,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function getTotpEnrollmentUri(email: string, secret: string): string {
  return buildTotp(email, secret).toString();
}

/**
 * Validates a 6-digit code, allowing one 30s step of clock drift either side, and returns the time
 * step (30s periods since the epoch) the code belongs to, or null when it matches none.
 *
 * The step is what replay protection compares (lib/adminAuth/totpReplay.ts): a code is accepted
 * once, and never again, nor any code from an earlier step. `timestamp` exists for the tests.
 */
export function verifyTotpStep(
  email: string,
  secret: string,
  code: string,
  timestamp: number = Date.now(),
): number | null {
  const totp = buildTotp(email, secret);
  const delta = totp.validate({ token: code, timestamp, window: 1 });
  if (delta === null) return null;
  return totp.counter({ timestamp }) + delta;
}

/** Validates a 6-digit code, allowing one 30s step of clock drift either side. */
export function verifyTotpCode(email: string, secret: string, code: string): boolean {
  return verifyTotpStep(email, secret, code) !== null;
}
