import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { languageFromLeadValues, phoneFromLeadValues } from "./leadFacts.ts";

test("the queue's language comes from the lead, in the first key that has one", () => {
  assert.equal(languageFromLeadValues({ language: "es" }), "Spanish");
  assert.equal(languageFromLeadValues({ preferred_language: "spanish" }), "Spanish");
  assert.equal(languageFromLeadValues({ language_code: "pt-BR" }), "Brazilian Portuguese");
  assert.equal(languageFromLeadValues({ language: "", preferred_language: "Tagalog" }), "Tagalog");
  assert.equal(languageFromLeadValues({}), null);
});

test("the phone is the lead's own, or nothing", () => {
  assert.equal(phoneFromLeadValues({ phone_number: " (602) 555-0142 " }), "(602) 555-0142");
  assert.equal(phoneFromLeadValues({ email: "a@b.c" }), null);
});

test("the floor starts from the saved status and never assumes ready", async () => {
  const [component, service] = await Promise.all([
    readFile(new URL("../../components/app/agent-floor.tsx", import.meta.url), "utf8"),
    readFile(new URL("./service.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(component, /useState<[^>]*>\("ready"\)/, "the floor must not default to ready");
  assert.match(component, /next\.ownStatus/);
  assert.match(component, /availability === null\) return/, "no heartbeat before the saved status is known");
  assert.match(service, /ownStatus:/);
});

test("Ask to pick up is owner-only and reaches the bell", async () => {
  const service = await readFile(new URL("./service.ts", import.meta.url), "utf8");
  assert.match(service, /params\.targetUserId && params\.role !== "owner"/);
  // The bell drops kinds it does not know; handoff_offered is its live-offer event.
  assert.match(service, /notifyAgentUser\(\{[^}]*kind: "handoff_offered"/);
  assert.match(service, /notifyTenantAgents\(\{[^}]*kind: "handoff_offered"/);
});
