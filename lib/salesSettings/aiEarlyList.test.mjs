import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Settings › AI assistant, round 8 (owner pick A, 2026-11-12): joining the early list is stored in the Sales
// settings document, nothing more. No AI provider is called anywhere, and the sent / never-sent lists keep
// today's facts (no call transcripts in "sent").
const { DEFAULT_SALES_SETTINGS, resolveSalesSettings, salesSettingsSchema } = await import("./schema.ts");

const ROOT = process.cwd();
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const entry = {
  joined: true, joinedAt: "2026-11-12T10:00:00.000Z", joinedBy: { name: "Dana Avery", email: "dana@example.test" },
  features: ["underwriting", "compliance"], whenReady: "email",
  controls: { sendDoses: true, keepFor: "1_year", who: "everyone" },
};

test("the early list is null until an owner joins, and a stored entry round-trips", () => {
  assert.equal(DEFAULT_SALES_SETTINGS.aiEarlyList, null);
  assert.equal(salesSettingsSchema.safeParse({ ...DEFAULT_SALES_SETTINGS, aiEarlyList: entry }).success, true);
  assert.deepEqual(resolveSalesSettings({ aiEarlyList: entry }).aiEarlyList, entry);
  assert.equal(resolveSalesSettings({ aiEarlyList: { ...entry, features: ["mind_reading"] } }).aiEarlyList, null, "an unknown feature falls back to the default");
  assert.equal(salesSettingsSchema.safeParse({ ...DEFAULT_SALES_SETTINGS, aiEarlyList: { ...entry, transcripts: true } }).success, false);
});

test("the page and its parts call no AI provider and write only through the Sales settings document", () => {
  const files = [
    "components/app/settings/sales/ai-assistant.tsx",
    ...readdirSync(join(ROOT, "components/app/settings/ai")).map((f) => `components/app/settings/ai/${f}`),
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /openai|anthropic|api\.openai|generativelanguage|@ai-sdk|bedrock/i, `${file} reaches for a provider`);
    for (const [, url] of source.matchAll(/["'`](\/api\/[^"'`]+)["'`]/g)) {
      assert.ok(["/api/app/ai-assistant/status", "/api/app/settings/sales/settings"].includes(url), `${file} calls ${url}`);
    }
  }
  assert.match(read("app/api/app/ai-assistant/status/route.ts"), /available: false/);
});

test("the data lists keep today's facts: never SSN, bank details or contact data; no transcripts sent", () => {
  const content = read("components/app/settings/ai/content.ts");
  const sent = content.slice(content.indexOf("export const SENT"), content.indexOf("export const NEVER"));
  assert.doesNotMatch(sent, /transcript/i);
  for (const never of ["Social Security number", "Bank routing and account numbers", "Card numbers", "Home address", "Phone number", "Email address", "Date of birth"]) {
    assert.match(content, new RegExp(`"${never}"`));
  }
});
