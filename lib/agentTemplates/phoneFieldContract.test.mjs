import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("partner intake recognizes legacy phone keys as screening fields", async () => {
  const [constants, route, service, portal, verifier] = await Promise.all([
    readFile(new URL("../templates/constants.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/api/partner/leads/route.ts", import.meta.url), "utf8"),
    readFile(new URL("./service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../components/partner/partner-portal-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/verify-intake-pipeline.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(constants, /function isPhoneTemplateField/);
  assert.match(constants, /\["phone", "phone_number"\]/);
  assert.match(route, /fields\.find\(isPhoneTemplateField\)/);
  assert.match(service, /fields\.find\(isPhoneTemplateField\)/);
  assert.match(portal, /fields\.find\(isPhoneTemplateField\)/);
  assert.match(verifier, /field\.type === "phone" \|\| \["phone", "phone_number"\]/);
});
