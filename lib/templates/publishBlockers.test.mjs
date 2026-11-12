import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { publishBlockers } = await import("./publishBlockers.ts");

const field = (over = {}) => ({ field_key: "first_name", label: "First name", type: "text", is_required: false, options: [], sort_order: 0, help_text: null, validation: {}, ...over });
const form = (sections, extra = {}) => ({ sections, ...extra });
const part = (label, keys) => ({ section_key: label.toLowerCase(), label, sort_order: 0, fields: keys.map((field_key) => ({ field_key, is_required: false, show_when: null })) });

test("a clean draft has nothing blocking it", () => {
  assert.deepEqual(publishBlockers(form([part("Applicant", ["first_name"])]), [field()]), []);
});

test("empty words, an unnamed part and a choice list with no choices each block publishing", () => {
  const blockers = publishBlockers(
    form([part("Applicant", ["first_name", "state"]), { ...part("", []), section_key: "section_2" }]),
    [field({ label: "  " }), field({ field_key: "state", label: "State", type: "single_select", options: [" "] })],
  );
  assert.equal(blockers.length, 3);
  assert.match(blockers[0], /A question has no words/);
  assert.match(blockers[1], /A page of the form has no name/);
  assert.match(blockers[2], /“State” has no choices/);
});

test("format-2 logic: a broken rule, a page skipped by its own question, and a required question hidden by AND / OR all block", () => {
  const and = { match: "all", rules: [{ field_key: "first_name", op: "filled" }, { field_key: "state", op: "is", value: "TX" }] };
  const required = publishBlockers(
    form([{ ...part("Applicant", ["first_name", "state"]) }, { ...part("Health", ["tobacco"]), fields: [{ field_key: "tobacco", is_required: true, show_when: null, logic: and }] }]),
    [field(), field({ field_key: "state", label: "State", type: "single_select", options: ["TX"] }), field({ field_key: "tobacco", label: "Tobacco", type: "boolean" })],
  );
  assert.equal(required.length, 1);
  assert.match(required[0], /“Tobacco” must be answered but has more than one rule/);

  const selfSkip = publishBlockers(
    form([{ ...part("Applicant", ["first_name"]), skip_when: { match: "all", rules: [{ field_key: "first_name", op: "empty" }] } }]),
    [field()],
  );
  assert.match(selfSkip[0], /skipped by a question on the same page/);

  const unknown = publishBlockers(
    form([{ ...part("Applicant", ["first_name"]), fields: [{ field_key: "first_name", is_required: false, show_when: null, logic: { match: "any", rules: [{ field_key: "ghost", op: "filled" }, { field_key: "ghost", op: "empty" }] } }] }]),
    [field()],
  );
  assert.match(unknown[0], /not on the form/);
});

test("switching off a topic that holds a question required everywhere is refused before Publish", () => {
  const blockers = publishBlockers(
    form([part("Applicant", ["first_name"])], { section_availability: { personal: false } }),
    [field({ is_required: true })],
  );
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /cannot be switched off/);
});

test("r8 A: Publish asks once, waits on the blockers, and the builder draws one inspector", () => {
  const controls = readFileSync(new URL("../../components/app/form-templates/status-line.tsx", import.meta.url), "utf8");
  assert.match(controls, /disabled=\{saving \|\| blockers\.length > 0\}/);
  assert.match(controls, /export function PublishDialog/);
  const page = readFileSync(new URL("../../components/app/template-settings.tsx", import.meta.url), "utf8");
  assert.match(page, /publishBlockers\(draft\.form, draft\.fields\)/);
  assert.match(page, /picked && pickedField \? \(\s*<QuestionPanel/);
  assert.doesNotMatch(page, /Guide|StatusTabs|<PublishBar\b/);
  // One way to publish: the title line's button opens the dialog; nothing else publishes.
  assert.equal((page.match(/<PublishDialog\b/g) ?? []).length, 1);
  // The page's one gold button is Share.
  assert.equal((page.match(/variant="highlight"/g) ?? []).length, 1);
});

test("switching Settings section asks first, and the draft is kept as it changes", () => {
  const page = readFileSync(new URL("../../components/app/template-settings.tsx", import.meta.url), "utf8");
  assert.match(page, /writeLocalDraft\(/);
  assert.match(page, /\/draft`, \{ method: "PUT"/);
  // The Settings menu's items are buttons: LeaveGuard holds them when they carry data-navigates.
  const guard = readFileSync(new URL("../../components/ui/leave-guard.tsx", import.meta.url), "utf8");
  assert.match(guard, /\[data-navigates\]/);
  const rail = readFileSync(new URL("../../components/app/agent-settings-tabs.tsx", import.meta.url), "utf8");
  assert.match(rail, /id=\{`settings-nav-\$\{tab\.id\}`\}[\s\S]{0,260}data-navigates=""/);
});
