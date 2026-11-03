import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.APPLICATION_DATA_ENCRYPTION_KEY ||= "test-only application data key, 2026-10-16";

const { isSealedTotpSecret, openAdminTotpSecret, sealAdminTotpSecret } = await import("./totpSecret.ts");
const { generateTotpSecret } = await import("./totp.ts");

const ADMIN = "7d1c3a52-5b0e-4f7e-9d3b-0a4f1c2e9b10";
const OTHER = "0f5e2b9c-1a3d-4c8e-b7f6-9d2a1e4c3b50";

test("a sealed secret never contains the plain secret and opens only for its own admin", () => {
  const secret = generateTotpSecret();
  const sealed = sealAdminTotpSecret(ADMIN, secret);
  assert.equal(isSealedTotpSecret(sealed), true);
  assert.ok(!sealed.includes(secret));
  assert.deepEqual(openAdminTotpSecret(ADMIN, sealed), { secret, legacy: false });
  // Copied onto another admin's row, it does not open.
  assert.equal(openAdminTotpSecret(OTHER, sealed), null);
  // Tampered, it does not open.
  assert.equal(openAdminTotpSecret(ADMIN, `${sealed.slice(0, -2)}AA`), null);
});

test("a legacy plain-text row still opens, marked for re-sealing; an empty one is not enrolled", () => {
  const secret = generateTotpSecret();
  assert.equal(isSealedTotpSecret(secret), false);
  assert.deepEqual(openAdminTotpSecret(ADMIN, secret), { secret, legacy: true });
  assert.equal(openAdminTotpSecret(ADMIN, ""), null);
  assert.equal(openAdminTotpSecret(ADMIN, null), null);
});

test("verify-2fa stores only sealed secrets, re-seals legacy rows and fails closed on one that will not open", () => {
  const route = readFileSync(new URL("../../app/api/admin/auth/verify-2fa/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /totp_secret: secret as string/);
  assert.match(route, /\.update\(\{ totp_secret: sealed \}\)/);
  assert.match(route, /opened\?\.legacy/);
  assert.match(route, /totp_secret: sealAdminTotpSecret\(admin\.id, opened\.secret\)/);
  assert.match(route, /if \(!opened\) \{[\s\S]{0,200}GENERIC_ERROR, \{ status: 401 \}/);
});

test("the admin scripts that write a secret seal it", () => {
  for (const script of ["reset-admin-totp.mjs", "seed-super-admin.mjs", "provision-demo-accounts.mjs", "encrypt-admin-totp-secrets.mjs"]) {
    const source = readFileSync(new URL(`../../scripts/${script}`, import.meta.url), "utf8");
    assert.match(source, /sealAdminTotpSecret\(/, script);
    assert.doesNotMatch(source, /totp_secret: (totpSecret|new OTPAuth)/, script);
  }
});
