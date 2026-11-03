import test from "node:test";
import assert from "node:assert/strict";

const { createAddonSchema, updateAddonSchema } = await import("./schemas.ts");

const planId = "11111111-1111-4111-8111-111111111111";

function valid(overrides = {}) {
  return {
    code: "extra_seats",
    name: "Extra seats",
    description: "A small QA add-on",
    price_cents: 1500,
    billing_cycle: "monthly",
    feature_keys: ["agent_floor"],
    meters: [{ meter_key: "dial_minutes", included_qty: 100 }],
    plan_ids: [planId],
    sort_order: 1,
    ...overrides,
  };
}

test("SA-2.6 accepts a bounded integer-cent add-on definition", () => {
  const result = createAddonSchema.safeParse(valid());
  assert.equal(result.success, true);
});

test("SA-2.6 rejects unsafe prices and duplicate grants", () => {
  assert.equal(createAddonSchema.safeParse(valid({ price_cents: -1 })).success, false);
  assert.equal(createAddonSchema.safeParse(valid({ price_cents: 2_147_483_648 })).success, false);
  assert.equal(createAddonSchema.safeParse(valid({ feature_keys: ["agent_floor", "agent_floor"] })).success, false);
  assert.equal(createAddonSchema.safeParse(valid({ meters: [{ meter_key: "dial_minutes", included_qty: 1 }, { meter_key: "dial_minutes", included_qty: 2 }] })).success, false);
  assert.equal(createAddonSchema.safeParse(valid({ plan_ids: [planId, planId] })).success, false);
});

test("SA-2.6 update schema keeps code immutable and requires active state", () => {
  const update = valid();
  delete update.code;
  assert.equal(updateAddonSchema.safeParse({ ...update, is_active: false }).success, true);
  assert.equal(updateAddonSchema.safeParse({ ...update, is_active: "false" }).success, false);
});
