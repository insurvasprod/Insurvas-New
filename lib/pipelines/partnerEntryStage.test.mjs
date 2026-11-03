/**
 * LA-1.9-4: a partner's submission enters its partner-type pipeline at that pipeline's entry stage —
 * "New Transfer" for a publisher — not a lazily created "Partner Submitted" stage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const service = read("lib", "pipelines", "service.ts");
const intake = read("lib", "agentTemplates", "service.ts");

const entry = service.slice(service.indexOf("export async function resolvePartnerEntryStage"), service.indexOf("const DEFAULT_PUBLISHER_DISPOSITION_STAGES"));

test("the entry stage is the first open, unarchived stage of the partner type's default pipeline", () => {
  assert.match(entry, /\.eq\("partner_type", partnerType\)\s*\.eq\("is_default", true\)/);
  assert.match(entry, /\.eq\("is_archived", false\)\s*\.eq\("stage_type", "open"\)\s*\.order\("position"\)\s*\.limit\(1\)/);
  assert.match(entry, /return resolveRuntimeStage\(tenantId, "new", partnerType\);/, "the legacy name lookup is only the fallback");
});

test("intake no longer creates or looks up a 'Partner Submitted' stage", () => {
  assert.doesNotMatch(entry, /Partner Submitted"\s*,\s*position/, "the stage is never inserted");
  assert.doesNotMatch(service, /\.insert\(\{ pipeline_id: pipeline\.id, name: "Partner Submitted"/);
  assert.doesNotMatch(intake, /resolvePartnerSubmissionStage/);
  assert.match(intake, /const stage = await resolvePartnerEntryStage\(tenantId, partnerType\);/);
});
