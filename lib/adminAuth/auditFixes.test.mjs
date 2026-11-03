// Static checks on the admin-plane audit fixes of 2026-10-15. The behaviour behind each one is
// covered where it can run without a server: lib/users/ownerGuard.test.mjs (owner counting, tenant
// choice), lib/loginEvents/staffVisibility.test.mjs, lib/adminAuth/adminHost.test.mjs, the
// enrolment-token test in session.test.mjs and the rolled-back rehearsal of 20261015530000.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("creating an admin never hands the creator the new account's TOTP secret or QR code", async () => {
  const route = await read("app/api/admin/admins/route.ts");
  for (const leak of ["generateTotpSecret", "getTotpEnrollmentUri", "QRCode", "totpUri", "qrDataUrl"]) {
    assert.ok(!route.includes(leak), leak);
  }
  assert.match(route, /totp_secret: "",/);
  const dialog = await read("components/admin/create-admin-dialog.tsx");
  assert.ok(!dialog.includes("qrDataUrl"), "the create dialog shows no QR code");
});

test("POST /admins answers 409 only for a unique violation", async () => {
  const route = await read("app/api/admin/admins/route.ts");
  assert.match(route, /if \(error\.code === "23505"\) \{\s*return NextResponse\.json\(\{ error: "An admin with this email already exists" \}, \{ status: 409 \}\);/);
  assert.match(route, /\{ error: "Could not create admin" \}, \{ status: 500 \}/);
  assert.equal((route.match(/status: 409/g) ?? []).length, 1);
});

test("the new admin enrols at first sign-in; verify-2fa stores the secret only after a code from it verifies", async () => {
  const login = await read("app/api/admin/auth/login/route.ts");
  const enrol = await read("app/api/admin/auth/enroll-2fa/route.ts");
  const verify = await read("app/api/admin/auth/verify-2fa/route.ts");
  assert.match(login, /enrol2fa: !isTotpEnrolled\(admin\.totp_secret\)/);
  assert.match(enrol, /verifyPending2faToken/);
  assert.match(enrol, /if \(isTotpEnrolled\(admin\.totp_secret\)\)/);
  assert.ok(!/\.update\(/.test(enrol), "enroll-2fa must not write the secret");
  assert.match(verify, /verifyTotpEnrolToken/);
  assert.match(verify, /enrol\.sub !== admin\.id/);
  assert.match(verify, /\.eq\("totp_secret", ""\)/);
  // The secret is stored before the session is issued.
  assert.ok(verify.indexOf('.eq("totp_secret", "")') < verify.indexOf("signAdminSessionToken(admin.id"));
});

test("activate refuses anything but a deactivated user, like unsuspend refuses anything but a suspended one", async () => {
  const activate = await read("app/api/admin/users/[id]/activate/route.ts");
  const unsuspend = await read("app/api/admin/users/[id]/unsuspend/route.ts");
  assert.match(activate, /requireCurrentStatus: \["inactive"\]/);
  assert.match(unsuspend, /requireCurrentStatus: \["suspended"\]/);
});

test("PATCH and DELETE /users/:id each write exactly one audit row", async () => {
  const route = await read("app/api/admin/users/[id]/route.ts");
  const patch = route.slice(route.indexOf("export async function PATCH"), route.indexOf("export async function DELETE"));
  const del = route.slice(route.indexOf("export async function DELETE"));
  assert.equal((patch.match(/await audit\(/g) ?? []).length, 1);
  assert.equal((del.match(/await audit\(/g) ?? []).length, 1);
  // The delete is audited before the stamp-failure early return, not after it.
  assert.ok(del.indexOf("await audit(") < del.indexOf("if (stampError)"));
});

test("the delete's last-owner guard counts owners by status, and the edit names its tenant", async () => {
  const route = await read("app/api/admin/users/[id]/route.ts");
  assert.match(route, /users!inner\(status\)/);
  assert.match(route, /tenantsLeftWithoutOwner\(ownedTenantIds, rows\)/);
  assert.match(route, /p_tenant_id: target\.tenantId/);
  const dialog = await read("components/admin/edit-user-dialog.tsx");
  assert.match(dialog, /tenantId: user\.tenant_id \?\? null/);
});

test("ADMIN_HOST and the cookie domains are documented as required in production", async () => {
  const env = await read(".env.example");
  assert.match(env, /PRODUCTION: ADMIN_HOST, ADMIN_COOKIE_DOMAIN and AGENT_COOKIE_DOMAIN MUST all be set/);
  const proxy = await read("proxy.ts");
  assert.match(proxy, /refuseAdminOnThisHost\(hostname, pathname, process\.env\.ADMIN_HOST\)/);
  assert.match(proxy, /"\/api\/admin\/:path\*"/);
});
