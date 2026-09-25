import test from "node:test";
import assert from "node:assert/strict";

const { createUserSchema } = await import("./schemas.ts");

const tenantId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";

function valid(overrides = {}) {
  return {
    name: "A QA user",
    email: "qa-user@example.com",
    phone: "",
    tenantId,
    newTenantName: "",
    role: "producer",
    ...overrides,
  };
}

test("SA-1.2 allows an existing-tenant invitation without changing its plan", () => {
  assert.equal(createUserSchema.safeParse(valid()).success, true);
  assert.equal(createUserSchema.safeParse(valid({ planId })).success, false);
});

test("SA-1.2 requires a plan when creating a new tenant", () => {
  assert.equal(createUserSchema.safeParse(valid({ tenantId: undefined, newTenantName: "New QA tenant" })).success, false);
  assert.equal(
    createUserSchema.safeParse(valid({ tenantId: undefined, newTenantName: "New QA tenant", planId })).success,
    true,
  );
});
