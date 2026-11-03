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
  assert.match(blockers[1], /A part of the form has no name/);
  assert.match(blockers[2], /“State” has no choices/);
});

test("switching off a topic that holds a question required everywhere is refused before Publish", () => {
  const blockers = publishBlockers(
    form([part("Applicant", ["first_name"])], { section_availability: { personal: false } }),
    [field({ is_required: true })],
  );
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /cannot be switched off/);
});

test("layout A: Publish waits on the blockers, and the page draws one side panel", () => {
  const controls = readFileSync(new URL("../../components/app/form-templates/status-line.tsx", import.meta.url), "utf8");
  assert.match(controls, /disabled=\{saving \|\| blockers\.length > 0\}/);
  const page = readFileSync(new URL("../../components/app/template-settings.tsx", import.meta.url), "utf8");
  assert.match(page, /publishBlockers\(draft\.form, draft\.fields\)/);
  assert.match(page, /picked && pickedField \? \(\s*<QuestionPanel/);
  assert.doesNotMatch(page, /Guide|StatusTabs/);
});

test("self-audit fixes: Publish reachable on a phone, and switching Settings section asks first", () => {
  const controls = readFileSync(new URL("../../components/app/form-templates/status-line.tsx", import.meta.url), "utf8");
  // Below 1024px the title line keeps only the state; the buttons ride a bar at the foot.
  assert.match(controls, /hidden items-center gap-2 lg:flex/);
  assert.match(controls, /fixed inset-x-0 bottom-0[^"]*lg:hidden/);
  assert.match(controls, /createPortal\(/);
  const page = readFileSync(new URL("../../components/app/template-settings.tsx", import.meta.url), "utf8");
  assert.match(page, /<PublishBar\b/);
  // The Settings menu's items are buttons: LeaveGuard holds them when they carry data-navigates.
  const guard = readFileSync(new URL("../../components/ui/leave-guard.tsx", import.meta.url), "utf8");
  assert.match(guard, /\[data-navigates\]/);
  const rail = readFileSync(new URL("../../components/app/agent-settings-tabs.tsx", import.meta.url), "utf8");
  assert.match(rail, /id=\{`settings-nav-\$\{tab\.id\}`\}[\s\S]{0,260}data-navigates=""/);
});
