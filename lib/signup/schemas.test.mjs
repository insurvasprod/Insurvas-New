import assert from "node:assert/strict";
import test from "node:test";

import { businessProfileSchema, publicSignupSchema, verificationActionSchema } from "./schemas.ts";

const validSignup = {
  fullName: "Ada Agent",
  email: "ada@example.com",
  password: "correct horse battery staple",
  phone: "+1 555 555 0100",
  planCode: "plan_a",
  billingCycle: "monthly",
};

test("signup accepts exactly the four account fields plus its plan selection", () => {
  const result = publicSignupSchema.safeParse(validSignup);
  assert.equal(result.success, true);
  assert.equal(result.data.email, "ada@example.com");
});

test("disposable email domains are rejected", () => {
  const result = publicSignupSchema.safeParse({ ...validSignup, email: "ada@mailinator.com" });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /Disposable/);
});

test("signup rejects a short password and an invalid plan code", () => {
  assert.equal(publicSignupSchema.safeParse({ ...validSignup, password: "short" }).success, false);
  assert.equal(publicSignupSchema.safeParse({ ...validSignup, planCode: "Plan A" }).success, false);
});

test("changing a typo also rejects a disposable replacement email", () => {
  assert.equal(
    verificationActionSchema.safeParse({ action: "change_email", email: "fix@mailinator.com" }).success,
    false,
  );
});

test("business profile preserves a leading-zero NPN and validates choices", () => {
  const result = businessProfileSchema.safeParse({
    businessName: "Ada Insurance",
    npn: "0012345678",
    primaryState: "tx",
    productsSold: ["life", "medicare"],
    monthlyVolumeRange: "26_100",
    leadSources: ["referrals"],
    leadSourceOther: "",
  });
  assert.equal(result.success, true);
  assert.equal(result.data.npn, "0012345678");
  assert.equal(result.data.primaryState, "TX");
});

test("the Other lead source requires an explanation", () => {
  const result = businessProfileSchema.safeParse({
    businessName: "Ada Insurance",
    npn: "1234567890",
    primaryState: "TX",
    productsSold: ["life"],
    monthlyVolumeRange: "0_25",
    leadSources: ["other"],
    leadSourceOther: "",
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /Describe/);
});
