import assert from "node:assert/strict";
import test from "node:test";

import { deriveRecommendedSetupSteps } from "./constants.ts";

test("every profile gets the basic product workspace step", () => {
  assert.deepEqual(
    deriveRecommendedSetupSteps({ productsSold: ["life"], monthlyVolumeRange: "0_25", leadSources: ["referrals"] }),
    ["Configure your product workspace"],
  );
});

test("lead sources and an existing book produce different setup work", () => {
  const steps = deriveRecommendedSetupSteps({
    productsSold: ["life"],
    monthlyVolumeRange: "26_100",
    leadSources: ["website", "existing_book"],
  });
  assert.ok(steps.includes("Connect and route your lead sources"));
  assert.ok(steps.includes("Import your existing book of business"));
});

test("volume and Medicare answers drive additional setup steps", () => {
  const steps = deriveRecommendedSetupSteps({
    productsSold: ["medicare"],
    monthlyVolumeRange: "500_plus",
    leadSources: ["referrals"],
  });
  assert.ok(steps.includes("Configure high-volume workflow automation"));
  assert.ok(steps.includes("Set up Medicare compliance preferences"));
});
