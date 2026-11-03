// Health answers are sealed field by field (2026-10-16): the database never holds them in plain
// text once the migration is live, and one answer's ciphertext never opens as another's.
// Run with: node --experimental-strip-types --test lib/applications/healthSeal.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.APPLICATION_DATA_ENCRYPTION_KEY = "test-only-key-for-the-health-seal-test-0123456789";
const core = await import("./healthSealCore.ts");
const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const T = "00000000-0000-4000-8000-0000000000a1";
const IV = "00000000-0000-4000-8000-0000000000b1";

test("an answer and its note are sealed together; the plain columns stay empty", () => {
  const cols = core.sealAnswer(T, IV, "heart_condition", { yes: true, detail: "stent 2019" }, "asked twice");
  assert.equal(cols.value, null);
  assert.equal(cols.notes, null);
  assert.match(cols.sealed, /^a1\./);
  assert.doesNotMatch(cols.sealed, /stent|asked/);
  const back = core.openAnswer(T, { interview_id: IV, question_key: "heart_condition", ...cols });
  assert.deepEqual(back, { value: { yes: true, detail: "stent 2019" }, notes: "asked twice" });
});

test("a sealed answer moved to another question, person or agency does not open", () => {
  const cols = core.sealAnswer(T, IV, "cancer", true, null);
  assert.equal(core.openAnswer(T, { interview_id: IV, question_key: "diabetes", ...cols }).unreadable, true);
  assert.equal(core.openAnswer(T, { interview_id: "00000000-0000-4000-8000-0000000000b2", question_key: "cancer", ...cols }).unreadable, true);
  assert.equal(core.openAnswer("00000000-0000-4000-8000-0000000000a2", { interview_id: IV, question_key: "cancer", ...cols }).unreadable, true);
});

test("rows written before sealing still read as they are", () => {
  assert.deepEqual(core.openAnswer(T, { interview_id: IV, question_key: "tobacco", value: false, notes: null, sealed: null, key_version: null }), { value: false, notes: null });
});

test("medications, the amendment history and the submission snapshot are sealed the same way", () => {
  const med = { name: "Metformin", dose: "500mg", since: "2020", prescribed_for: "diabetes", prescribed_for_unknown: false, notes: null };
  const m = core.sealMedication(T, IV, med);
  assert.equal(m.name, null);
  assert.deepEqual(core.openMedication(T, { interview_id: IV, ...m }), med);

  const c = core.sealChange(T, IV, "medications", [med], []);
  assert.equal(c.old_value, null);
  assert.deepEqual(core.openChange(T, { interview_id: IV, question_key: "medications", ...c }), { old: [med], new: [] });

  const snap = { answers: { cancer: { value: false } }, medications: [med], template: "FE", revision: 2 };
  const s = core.sealSnapshot(T, "app-1", snap);
  assert.equal(Object.keys(s).sort().join(), "key_version,sealed");
  assert.deepEqual(core.openSnapshot(T, "app-1", s), snap);
  assert.deepEqual(core.sealSnapshot(T, "app-1", {}), {}, "an empty snapshot stays empty");
});

test("every read and write of health answers in the app goes through the seal", () => {
  const mutations = read("lib/applications/mutations.ts");
  const service = read("lib/applications/service.ts");
  for (const src of [mutations, service]) {
    assert.doesNotMatch(src, /from\("tenant_uw_answers"\)\.select\(/, "a plain read of the answers is left");
    assert.doesNotMatch(src, /from\("tenant_medications"\)\.select\("(?!id", \{ count)/, "a plain read of the medications is left");
  }
  assert.match(mutations, /\.\.\.\(await answerColumns\(actor\.tenantId, interviewId, x\.key, x\.value, x\.notes\?\.trim\(\) \|\| null\)\)/);
  assert.match(mutations, /\.\.\.\(await medicationColumns\(actor\.tenantId, interviewId, \{/);
  assert.equal((mutations.match(/\.\.\.\(await changeColumns\(/g) ?? []).length, 2, "both amendment records are sealed");
  assert.match(mutations, /p_health_snapshot: interview \? await snapshotFor\(actor\.tenantId, applicationId, \{/);
});

test("the migration makes room and keeps the history append-only; the backlog is sealed on the production server", () => {
  const sql = read("supabase/migrations/20261016420000_health_answers_sealed.sql");
  assert.match(sql, /check \(sealed is null or \(value is null and notes is null and key_version is not null\)\)/);
  assert.match(sql, /set sealed = p_sealed, key_version = p_key_version, old_value = null, new_value = null\n\s+where id = p_id and sealed is null;/);
  assert.match(sql, /grant execute on function public\.seal_uw_answer_change\(uuid, text, smallint\) to service_role;/);
  const seal = read("lib/applications/healthSeal.ts");
  assert.match(seal, /if \(!cols\.sealed \|\| back\.unreadable \|\| !same\(back\.value, r\.value\) \|\| !same\(back\.notes, r\.notes\)\) \{ out\.failed\+\+; continue; \}/, "a row is only cleared after it opens again");
  assert.match(read("app/api/admin/system/seal-health-data/route.ts"), /requireAdminRole\(CAN_CHANGE_MAINTENANCE\)/);
});
