import assert from "node:assert/strict";
import test from "node:test";

import { businessProfileSchema, nameFromEmail, publicSignupSchema, verificationActionSchema } from "./schemas.ts";

const validSignup = {
  fullName: "Ada Agent",
  email: "ada@example.com",
  password: "correct horse battery staple",
  phone: "+1 201 555 0123",
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

test("business profile is accepted without an NPN; a sent one is still checked", () => {
  const base = { businessName: "Ada Insurance", primaryState: "TX", productsSold: ["life"], monthlyVolumeRange: "0_25", leadSources: ["referrals"] };
  const result = businessProfileSchema.safeParse(base);
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.equal(result.data.npn, undefined);
  assert.equal(businessProfileSchema.safeParse({ ...base, npn: "12ab" }).success, false);
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

test("a profile without an 'other' lead source is accepted when the form posts null", () => {
  // The form renders the free-text box only when "other" is ticked, so FormData.get returns null
  // and the payload carries a literal null. An `.optional()` string rejected that, which failed
  // EVERY onboarding that did not pick "other". Found by driving signup in a real browser.
  const result = businessProfileSchema.safeParse({
    businessName: "Whitfield Insurance Group",
    npn: "1234567",
    primaryState: "CA",
    productsSold: ["life"],
    monthlyVolumeRange: "0_25",
    leadSources: ["purchased"],
    leadSourceOther: null,
  });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("picking 'other' still requires describing it", () => {
  const result = businessProfileSchema.safeParse({
    businessName: "Whitfield Insurance Group",
    npn: "1234567",
    primaryState: "CA",
    productsSold: ["life"],
    monthlyVolumeRange: "0_25",
    leadSources: ["other"],
    leadSourceOther: null,
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0].message, /Describe the other source/);
});

test("step 1 needs only email and password; name and phone are asked on step 3", () => {
  const result = publicSignupSchema.safeParse({ email: "ada@example.com", password: "correct horse battery staple" });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.equal(result.data.fullName, undefined);
  assert.equal(result.data.phone, undefined);
  // One that is sent is still checked.
  assert.equal(publicSignupSchema.safeParse({ ...validSignup, phone: "12" }).success, false);
});

test("the stand-in name comes from the address until step 3", () => {
  assert.equal(nameFromEmail("jane.doe@agency.com"), "Jane Doe");
  assert.equal(nameFromEmail("ADA_lovelace+crm@x.io"), "Ada Lovelace Crm");
  assert.equal(nameFromEmail("j7@x.io"), "New agent");
});

test("step 3 takes the person's name and phone with the business", () => {
  const base = { businessName: "Ada Insurance", primaryState: "TX", productsSold: ["life"], monthlyVolumeRange: "0_25", leadSources: ["referrals"] };
  const result = businessProfileSchema.safeParse({ ...base, firstName: "Ada", lastName: "Agent", phone: "+1 201 555 0123" });
  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
  assert.equal(result.data.phone, "+12015550123");
  assert.equal(businessProfileSchema.safeParse({ ...base, phone: "+1 555" }).success, false);
});
