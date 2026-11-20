import test from "node:test";
import assert from "node:assert/strict";

const { outstandingSubmitItems } = await import("./submitReadiness.ts");

test("LA-1.6-7: every missing requirement is named, in form order", () => {
  assert.deepEqual(
    outstandingSubmitItems({ screened: false, dncPending: false, missingRequired: ["First name", "Date of birth"], duplicateReasonMissing: true, consentGiven: false }),
    ["Phone screening", "First name", "Date of birth", "Reason this is a separate lead", "Consent"],
  );
  assert.deepEqual(
    outstandingSubmitItems({ screened: true, dncPending: true, missingRequired: [], duplicateReasonMissing: false, consentGiven: true }),
    ["DNC acknowledgement"],
  );
});

test("LA-1.6-7: nothing outstanding means an empty list", () => {
  assert.deepEqual(outstandingSubmitItems({ screened: true, dncPending: false, missingRequired: [], duplicateReasonMissing: false, consentGiven: true }), []);
});

test("the submit form renders the list and points the button at it", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/partner/partner-portal-workspace.tsx", "utf8");
  assert.match(source, /outstandingSubmitItems\(/);
  assert.match(source, /Still needed to submit: \{outstanding\.join\(", "\)\}/);
  assert.match(source, /aria-describedby=\{!canSubmit && outstanding\.length/);
});

test("a 201 shows the done state and never brings the submitted draft back (walk 2026-11-20)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("components/partner/partner-portal-workspace.tsx", "utf8").replace(/\r\n/g, "\n");
  const submit = source.slice(source.indexOf("async function submit(event: FormEvent)"), source.indexOf("function handleFormSubmit"));
  // No save may race the submit: one already running finishes first, later ones do nothing.
  assert.match(submit, /submittingRef\.current = true;\n\s+setSaving\(true\);\n\s+await saveQueue\.current/);
  assert.match(source, /if \(submittingRef\.current \|\| submittedRef\.current\) return false;/);
  // After the 201 a reload or save that started before it is stale, and the draft id is never asked for again.
  assert.match(submit, /submitGeneration\.current \+= 1;/);
  assert.match(submit, /submittedDraftIds\.current\.add\(draftIdRef\.current\)/);
  assert.match(source, /if \(submitGeneration\.current !== startedAtSubmit \|\| submittingRef\.current \|\| submittedRef\.current\) return;/);
  assert.match(source, /if \(submitGeneration\.current !== sentAtSubmit\) return false;/);
  // A page opened from Drafts drops ?draft_id= so a reload does not try the submitted draft.
  assert.match(submit, /url\.searchParams\.delete\("draft_id"\)/);
  // The done state: a clear success, Submit Another, and the lead in the partner's pipeline.
  assert.match(submit, /setSubmitted\(\{\n\s+leadId: typeof body\?\.lead\?\.id === "string"/);
  assert.match(source, /if \(submitted\)\n\s+return \(/);
  assert.match(source, /Submit Another/);
  assert.match(source, /`\/partner\/pipeline\/\$\{submitted\.leadId\}`/);
  assert.match(submit, /notify\.win\(/);
});
