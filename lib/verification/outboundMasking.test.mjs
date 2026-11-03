import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The outbound application route hands out the same verification panel as the inbound one, so it
// must mask it the same way. Until 2026-09-24 it returned SSN and banking values in full on POST,
// GET and PATCH while the inbound route masked them — one door locked, the other open.
const route = readFileSync(new URL("../../app/api/app/outbound/application/route.ts", import.meta.url), "utf8");
const reveal = readFileSync(new URL("../../app/api/app/outbound/application/reveal/route.ts", import.meta.url), "utf8");

test("every outbound panel leaves masked", () => {
  assert.match(route, /import \{ maskSensitivePanel \} from "@\/lib\/verification\/sensitive"/);
  assert.match(route, /panel: maskSensitivePanel\(panel\)/, "POST returns the started application's panel unmasked");
  assert.match(route, /NextResponse\.json\(maskSensitivePanel\(await getVerificationPanel\(/, "GET returns the panel unmasked");
  assert.match(route, /panel: maskSensitivePanel\(updated\.panel\)/, "PATCH returns the updated panel unmasked");
  // No panel is serialised any other way.
  assert.doesNotMatch(route, /NextResponse\.json\(await getVerificationPanel\(/);
  assert.doesNotMatch(route, /NextResponse\.json\(await updateVerificationField\(/);
});

test("the outbound reveal audits before it returns the value, and only for masked fields", () => {
  assert.match(reveal, /if \(!isSensitiveFieldKey\(parsed\.data\.field_key\)\)/);
  assert.match(reveal, /requireFeatureRole\("outbound_dialing", APPLICATION_ROLES\)/);
  assert.match(reveal, /const APPLICATION_ROLES = \["owner", "producer"\] as const;/);
  const auditAt = reveal.indexOf("await audit(");
  const returnAt = reveal.indexOf("return NextResponse.json({ field_key: parsed.data.field_key, value })");
  assert.ok(auditAt > 0 && returnAt > auditAt, "the value is returned before the audit row is written");
  assert.match(reveal, /action: "tenant\.verification_field_revealed"/);
});
