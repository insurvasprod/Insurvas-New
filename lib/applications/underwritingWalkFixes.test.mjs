// Underwriting walk, 2026-11-03 (Quinn Testmore, inbound ?phase=underwriting): what the agent tripped on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { customPrefillFromInterview, INTERVIEW_VALUE_KEYS, prefillFromInterview } = await import("./prefill.ts");
const { plainKey } = await import("./qa.ts");
const { toZonedInput, zonedInputToIso, zoneShortName } = await import("./zonedInput.ts");

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("1 · interview answers fill the field set's own questions that mean the same", () => {
  const said = { annual_income: "$40,000", net_worth: 250000, occupation: " Welder ", height_in: 70 };
  assert.deepEqual(customPrefillFromInterview(said), [
    { key: "custom.annual_income", value: 40000 },
    { key: "custom.net_worth", value: 250000 },
    { key: "custom.occupation", value: "Welder" },
  ]);
  // Only what the attempt's field set asks; an amount that does not read is never guessed.
  assert.deepEqual(customPrefillFromInterview(said, ["custom.annual_income"]), [{ key: "custom.annual_income", value: 40000 }]);
  assert.deepEqual(customPrefillFromInterview({ annual_income: "about forty" }), []);
  // The built-in pairs are unchanged, and an income answer re-reads the case like height does.
  assert.deepEqual(prefillFromInterview(said), [{ key: "insured.height_in", value: 70 }]);
  assert.ok(INTERVIEW_VALUE_KEYS.has("annual_income") && INTERVIEW_VALUE_KEYS.has("height_in"));
});

test("1 · the server writes them only where the field set asks, left for the agent to confirm", () => {
  const src = read("lib/applications/mutations.ts");
  assert.match(src, /customPrefillFromInterview\(givenNow\)/);
  assert.match(src, /asked\.has\(v\.key\)/);
  assert.match(src, /reviewed_at: unconfirmed\.has\(v\.key\) \? null : now/);
  // saveValues still takes the custom.* keys the attempt's field set asks.
  assert.match(src, /customKeysFor\(actor\.tenantId, a\)/);
});

test("1/6 · the Application step shows the interview's answer, warm, and counts custom questions in their section", () => {
  const src = read("components/app/applications/workspace/steps/application-step.tsx");
  assert.match(src, /customPrefillFromInterview\(said, custom\.map/);
  assert.match(src, /source: "interview", reviewed: false/);
  assert.match(src, /onConfirm=\{fromInterviewOnly \? \(\) => setValue\(q\.key/);
  assert.match(src, /insured: \[\.\.\.groupKeys\.insured, \.\.\.customIn\(\["insured"\]\)/);
  assert.match(src, /progress\(countKeys\.insured\)/);
  assert.match(read("components/app/applications/workspace/steps/step-bits.tsx"), /if \(onConfirm\) \{ onConfirm\(\); return; \}/);
});

test("2 · a term product's term length and health class are asked once, as chips", () => {
  const src = read("components/app/applications/quotes/add-quote-form.tsx");
  assert.match(src, /!COVERAGE_KEYS\.has\(f\.key\) && !askedByChip\(f\.key\)/);
  assert.match(src, /case "term_length": return termByChip \? termLength/);
  assert.match(src, /case "health_class": return classByChip \? healthClass/);
  // The save still sends both on the quote and in its rating inputs.
  assert.match(src, /term_length: termLength, health_class: healthClass/);
});

test("3 · Copy-assist lists the field set's own questions in their group", () => {
  const src = read("components/app/applications/copy-assist/copy-groups.ts");
  assert.match(src, /attempt\.fieldSet\?\.custom/);
  assert.match(src, /items: \[\.\.\.f\("insured"\), \.\.\.extra\("insured"\)\]/);
  assert.match(src, /contact: "addr"/);
});

test("4/5 · a section never folds while focus is in it, and a deep link opens it", () => {
  const src = read("components/app/applications/workspace/fold-section.tsx");
  assert.match(src, /complete && !keepOpen && !reopened && !focused && !asked/);
  assert.match(src, /body\.current\?\.contains\(document\.activeElement\)/);
  assert.match(src, /addEventListener\("workspace:field"/);
  assert.match(src, /window\.location\.hash/);
  assert.doesNotMatch(src, /isTyped/);
});

test("7 · no raw field key reaches the agent", () => {
  assert.doesNotMatch(read("components/app/applications/workspace/steps/review-step.tsx"), /\{item\.fieldKey\}/);
  const qa = read("lib/applications/qa.ts");
  assert.doesNotMatch(qa, /LABEL\.get\(key\) \?\? key\b/);
  assert.equal(plainKey("custom.drivers_license_number"), "Drivers license number");
});

test("8 · the caller card says loading, not 'Not on the lead', until the lead is read", () => {
  const src = read("components/app/inbound/caller-card.tsx");
  assert.match(src, /const loading = !facts && !loadFailed/);
  assert.match(src, /loading \? <Pending \/>/);
  assert.match(src, /else setFailed\(true\)/);
});

test("9 · Submitted at is typed and printed on the agency's clock, and names the zone", () => {
  const zone = "America/Chicago";
  // 3 Nov 2026 is after the fall-back: Central is UTC−6.
  assert.equal(zonedInputToIso("2026-11-03T12:54", zone), "2026-11-03T18:54:00.000Z");
  assert.equal(toZonedInput(new Date("2026-11-03T18:54:00.000Z"), zone), "2026-11-03T12:54");
  // Summer: UTC−5.
  assert.equal(zonedInputToIso("2026-07-01T09:00", zone), "2026-07-01T14:00:00.000Z");
  assert.equal(zonedInputToIso("not a time", zone), null);
  assert.equal(zoneShortName(new Date("2026-11-03T18:54:00Z"), zone), "CST");
  assert.equal(zoneShortName(new Date(), undefined), "");
  const dialog = read("components/app/applications/submit/submission-dialog.tsx");
  assert.match(dialog, /zonedInputToIso\(at, timeZone\)/);
  assert.doesNotMatch(dialog, /new Date\(at\)/);
  const step = read("components/app/applications/workspace/steps/submit-step.tsx");
  assert.match(step, /toLocalInput\(new Date\(\), timeZone\)/);
  assert.match(step, /zoneShortName\(new Date\(s\.submittedAt\), timeZone\)/);
});
