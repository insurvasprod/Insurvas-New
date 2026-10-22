import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normaliseRevealReason, REVEAL_REASON_MAX, revealReasonField } from "./revealReason.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a reveal reason is a few words, trimmed, and never missing", () => {
  assert.equal(normaliseRevealReason("  Reading it back to the customer  "), "Reading it back to the customer");
  assert.equal(normaliseRevealReason(undefined), null);
  assert.equal(normaliseRevealReason(""), null);
  assert.equal(normaliseRevealReason("   ok  "), null);
  assert.equal(normaliseRevealReason("x".repeat(REVEAL_REASON_MAX + 1)), null);
  assert.equal(revealReasonField.safeParse(42).success, false);
});

test("revealField refuses a person's reveal without a reason and records the reason it was given", () => {
  const mutations = read("./mutations.ts");
  const start = mutations.indexOf("export async function revealField");
  const fn = mutations.slice(start, mutations.indexOf("\n}", start));
  assert.match(fn, /surface !== "extension" && !why\) throw new ApplicationError\("REVEAL_REASON_REQUIRED"/);
  // The refusal comes before anything is decrypted or logged.
  assert.ok(fn.indexOf("REVEAL_REASON_REQUIRED") < fn.indexOf("decryptSensitive("));
  assert.match(fn, /insert\(\{ \.\.\.entry, reason: why \}\)/);
  assert.match(fn, /metadata: \{ fieldKey, surface, caseId: a\.case_id, \.\.\.\(why \? \{ reason: why \} : \{\}\) \}/);
});

test("every SSN reveal route requires the reason and passes it on", () => {
  assert.match(read("./schemas.ts"), /revealSchema = z\.object\(\{ field_key: fieldKey, surface: [^}]+\), reason: revealReasonField \}\)\.strict\(\)/);
  assert.match(read("../../app/api/app/applications/attempts/[id]/reveal/route.ts"), /revealField\(actor, id, input\.field_key, input\.surface, input\.reason\)/);
  for (const path of ["../../app/api/app/inbound/verification/reveal/route.ts", "../../app/api/app/outbound/application/reveal/route.ts"]) {
    const route = read(path);
    assert.match(route, /reason: revealReasonField,/, path);
    assert.match(route, /fieldKey: parsed\.data\.field_key,[^}]*reason: parsed\.data\.reason \}/, path);
  }
  assert.match(read("../../app/api/app/outbound/application/reveal/route.ts"), /"insured\.ssn", "web", reason\)/);
});

test("each reveal surface asks for the reason before calling the server", () => {
  assert.match(read("../../components/app/applications/workspace/use-reveal.tsx"), /const reason = await ask\(label\);\r?\n\s+if \(reason === null\) return;/);
  assert.match(read("../../components/app/applications/workspace/context.tsx"), /body: \{ field_key: fieldKey, reason \}/);
  assert.match(read("../../components/app/applications/copy-assist/copy-assist-panel.tsx"), /surface: "copy_assist", reason \}/);
  assert.match(read("../../components/app/verification-panel.tsx"), /field_key: key, reason \}/);
});

test("the access log gets a reason column, length-checked, in its own migration", () => {
  const sql = read("../../supabase/migrations/20261016300000_sensitive_reveal_reason.sql");
  assert.match(sql, /add column if not exists reason text;/);
  assert.match(sql, /check \(reason is null or char_length\(reason\) between 4 and 200\)/);
});
