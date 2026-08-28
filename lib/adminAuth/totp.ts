import * as OTPAuth from "otpauth";

const ISSUER = "Insurvas Admin";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function buildTotp(email: string, secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function getTotpEnrollmentUri(email: string, secret: string): string {
  return buildTotp(email, secret).toString();
}

/** Validates a 6-digit code, allowing one 30s step of clock drift either side. */
export function verifyTotpCode(email: string, secret: string, code: string): boolean {
  const totp = buildTotp(email, secret);
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
