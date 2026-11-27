import {
  bornLine, boardLanes, comparePeople, dayMonthYear, eventTitle, eventWhen, formLines, leadMenu, leadSource, matchesFilters, NO_FILTERS, OWNER_ME, OWNER_NONE, planMove, pruneHidden,
  maskUsDate, readableDetail, usDateToIso, verificationRows, type FormTemplate, type MenuFacts,
} from "../logic";

/** The web's rules, ported: these must answer exactly as the web does. */

const quoted = { id: "s-quoted", name: "Quoted" };

test("a move picks the outcome named like the stage, else the first mapped one", () => {
  const ctx = { dispositionsByStage: { "s-quoted": [
    { key: "sent_quote", label: "Sent quote", nextAction: null, nextActionMinutes: null },
    { key: "quoted", label: "Quoted", nextAction: null, nextActionMinutes: null },
  ] } };
  expect(planMove(quoted, ctx)).toEqual({ pick: expect.objectContaining({ key: "quoted" }) });
  expect(planMove(quoted, { dispositionsByStage: { "s-quoted": [ctx.dispositionsByStage["s-quoted"][0]] } })).toEqual({ pick: expect.objectContaining({ key: "sent_quote" }) });
});

test("a stage only a call can reach is refused with the web's words", () => {
  const ctx = { dispositionsByStage: { "s-cb": [
    { key: "callback_scheduled", label: "Callback", nextAction: "callback", nextActionMinutes: null },
    { key: "dnc", label: "Do not call", nextAction: "suppress", nextActionMinutes: null },
  ] } };
  expect(planMove({ id: "s-cb", name: "Callback" }, ctx)).toEqual({ error: "Only a call can move a lead to Callback. Record it from the dialer or the call outcome." });
  expect(planMove({ id: "s-none", name: "Sold" }, ctx)).toEqual({ error: expect.stringContaining("Only a call can move a lead to Sold") });
});

test("the ⋯ menu offers only what the server's actions allow", () => {
  const base: MenuFacts = { readOnly: false, queue: null, stage: { id: "s1" }, actions: {} };
  expect(leadMenu(base)).toEqual(["recheck", "copy"]);
  expect(leadMenu({ ...base, actions: { canChangeStage: true } })).toEqual(["recheck", "stage_fix", "copy"]);
  // Handoff, requeue and unassign need a work item even when the flags say yes.
  expect(leadMenu({ ...base, actions: { canHandoff: true, canUnassign: true, canRequeue: true } })).toEqual(["recheck", "copy"]);
  expect(leadMenu({ ...base, queue: { id: "q", status: "claimed" }, actions: { canHandoff: true, canUnassign: true } })).toEqual(["handoff", "nudge", "recheck", "copy", "unassign"]);
  expect(leadMenu({ ...base, queue: { id: "q", status: "expired" } })).toEqual(["nudge", "reopen", "recheck", "copy"]);
  // A read-only plan offers nothing that writes; copying the ID writes nothing.
  expect(leadMenu({ ...base, readOnly: true, queue: { id: "q", status: "claimed" }, actions: { canHandoff: true, canChangeStage: true } })).toEqual(["copy"]);
});

test("filters narrow by owner, source, time in stage, state and age", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const lead = { owner_user_id: "u1", owner_name: "Ava Kim", partner_name: "Apex Leads", stage_entered_at: "2026-11-20T12:00:00Z", values: { state: "GA", date_of_birth: "1958-06-11" } };
  expect(matchesFilters(lead, NO_FILTERS, "u1", now)).toBe(true);
  expect(matchesFilters(lead, { ...NO_FILTERS, owner: OWNER_ME }, "u1", now)).toBe(true);
  expect(matchesFilters(lead, { ...NO_FILTERS, owner: OWNER_ME }, "u2", now)).toBe(false);
  expect(matchesFilters(lead, { ...NO_FILTERS, owner: OWNER_NONE }, "u1", now)).toBe(false);
  expect(matchesFilters(lead, { ...NO_FILTERS, owner: "Ava Kim" }, "u2", now)).toBe(true);
  expect(matchesFilters(lead, { ...NO_FILTERS, source: "Web form" }, "u1", now)).toBe(false);
  expect(matchesFilters(lead, { ...NO_FILTERS, inStage: "3+" }, "u1", now)).toBe(true);
  expect(matchesFilters(lead, { ...NO_FILTERS, inStage: "14+" }, "u1", now)).toBe(false);
  expect(matchesFilters(lead, { ...NO_FILTERS, inStage: "1-3" }, "u1", now)).toBe(false);
  expect(matchesFilters(lead, { ...NO_FILTERS, state: "GA", age: "60-80" }, "u1", now)).toBe(true);
  expect(matchesFilters(lead, { ...NO_FILTERS, age: "over80" }, "u1", now)).toBe(false);
  // No stage date: a time-in-stage filter cannot claim it.
  expect(matchesFilters({ ...lead, stage_entered_at: null }, { ...NO_FILTERS, inStage: "today" }, "u1", now)).toBe(false);
});

test("lanes follow the pipeline's stage order and leave out leads on a stage it no longer has", () => {
  const lanes = boardLanes([{ id: "a", name: "New" }, { id: "b", name: "Quoted" }], [{ id: "1", stage_id: "b" }, { id: "2", stage_id: "a" }, { id: "3", stage_id: "gone" }]);
  expect(lanes.map((l) => [l.name, l.leads.map((x) => x.id)])).toEqual([["New", ["2"]], ["Quoted", ["1"]]]);
});

const template: FormTemplate = {
  product_name: "Final expense", product_code: "final_expense",
  fields: [
    { field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 0 },
    { field_key: "last_name", label: "Last name", type: "text", is_required: true, options: [], sort_order: 1 },
    { field_key: "tobacco", label: "Tobacco", type: "boolean", is_required: false, options: [], sort_order: 2 },
    { field_key: "packs", label: "Packs a day", type: "number", is_required: false, options: [], sort_order: 3 },
    { field_key: "date_of_birth", label: "Date of birth", type: "date", is_required: false, options: [], sort_order: 4 },
    { field_key: "senior_note", label: "Senior note", type: "text", is_required: false, options: [], sort_order: 5 },
  ],
  form_definition: { sections: [{ section_key: "p", label: "Person", sort_order: 0, fields: [
    { field_key: "first_name", is_required: true, width: "half" },
    { field_key: "last_name", is_required: true, width: "half" },
    { field_key: "tobacco", is_required: false },
    { field_key: "packs", is_required: false, show_when: { field_key: "tobacco", equals: "true" } },
    { field_key: "date_of_birth", is_required: false },
    { field_key: "senior_note", is_required: false, logic: { match: "all", rules: [{ field_key: "date_of_birth", op: "age_at_least", value: "65" }] } },
  ] }] },
};

test("the form shows a question only when its logic holds, pairing half-width ones", () => {
  const keys = (v: Record<string, unknown>) => formLines(template, v).map((line) => line.map((x) => x.field.field_key));
  expect(keys({})).toEqual([["first_name", "last_name"], ["tobacco"], ["date_of_birth"]]);
  expect(keys({ tobacco: true, date_of_birth: "1950-01-01" })).toEqual([["first_name", "last_name"], ["tobacco"], ["packs"], ["date_of_birth"], ["senior_note"]]);
});

test("answers to questions that stop showing are dropped before posting", () => {
  expect(pruneHidden(template.form_definition, { tobacco: false, packs: 2, first_name: "Earl" })).toEqual({ tobacco: false, first_name: "Earl" });
});

test("a typed US date becomes the ISO date the server stores, only when it is a real date", () => {
  expect(usDateToIso("02/14/1957")).toBe("1957-02-14");
  expect(usDateToIso("2/30/1957")).toBeNull();
  expect(usDateToIso("02/14/57")).toBeNull();
});

test("a date typed as digits gets its slashes, and deleting back through them works", () => {
  expect(maskUsDate("01151960")).toBe("01/15/1960");
  expect(maskUsDate("0115")).toBe("01/15");
  expect(maskUsDate("01/151")).toBe("01/15/1");
  expect(maskUsDate("01/1")).toBe("01/1");
  expect(maskUsDate("01/")).toBe("01");
  expect(maskUsDate("2/14/1957")).toBe("2/14/1957");
  expect(maskUsDate("011519601")).toBe("01/15/1960");
  expect(usDateToIso(maskUsDate("01151960"))).toBe("1960-01-15");
});

test("verification rows say confirmed, corrected was → now, or outstanding", () => {
  const rows = verificationRows([
    { field_key: "full_name", state: "confirmed", old_value: null, new_value: "Linda Adaeze Okafor", confirmed_at: "x" },
    { field_key: "date_of_birth", state: "corrected", old_value: "1957-06-11", new_value: "1958-06-11", confirmed_at: "x" },
    { field_key: "beneficiary", state: "outstanding", old_value: null, new_value: null, confirmed_at: null },
  ], new Map([["full_name", "Full legal name"], ["date_of_birth", "Date of birth"]]), {});
  expect(rows).toEqual([
    { key: "full_name", label: "Full legal name", state: "confirmed", meta: "Linda Adaeze Okafor" },
    { key: "date_of_birth", label: "Date of birth", state: "corrected", meta: "Was 6/11/1957 · corrected to 6/11/1958" },
    { key: "beneficiary", label: "Beneficiary", state: "outstanding", meta: "Not asked" },
  ]);
});

test("verification rows follow the form's order, name the partner and print phones and dates as people read them", () => {
  const rows = verificationRows([
    { field_key: "phone", state: "confirmed", old_value: null, new_value: "8135550177", confirmed_at: "x" },
    { field_key: "date_of_birth", state: "corrected", old_value: "1957-06-11", new_value: "1958-06-11", confirmed_at: "x" },
  ], new Map(), {}, { partner: true, order: ["date_of_birth", "phone"], types: new Map([["phone", "phone"]]) });
  expect(rows.map((r) => r.key)).toEqual(["date_of_birth", "phone"]);
  expect(rows[0].meta).toBe("Partner sent 6/11/1957 · corrected to 6/11/1958");
  expect(rows[1].meta).toBe("(813) 555-0177");
});

test("lead page words: born, event titles, event times and stage ids", () => {
  expect(dayMonthYear("1958-06-11")).toBe("11 Jun 1958");
  expect(bornLine("1958-06-11", new Date(2026, 10, 25))).toBe("11 Jun 1958 · 68");
  expect(eventTitle("Verification Field Updated")).toBe("Verification field updated");
  expect(eventTitle("tenant.lead_stage_changed")).toBe("Lead stage changed");
  expect(eventTitle("DNC check")).toBe("DNC check");
  const now = new Date(2026, 10, 25, 15, 0).getTime();
  expect(eventWhen(new Date(2026, 10, 25, 9, 12).toISOString(), now)).toBe("today 9:12");
  expect(eventWhen(new Date(2026, 10, 24, 18, 40).toISOString(), now)).toBe("yesterday 18:40");
  expect(eventWhen(new Date(2026, 10, 22, 10, 0).toISOString(), now)).toBe("Sun 22 Nov");
  const stages = [{ id: "2f5a1785-773c-48b2-bac0-a1631033a435", name: "Interested" }];
  expect(readableDetail("Stage: 2f5a1785-773c-48b2-bac0-a1631033a435", stages)).toBe("Stage: Interested");
  expect(readableDetail("Stage: 11111111-773c-48b2-bac0-a1631033a435 · by phone", stages)).toBe("by phone");
  expect(readableDetail("Stage: 11111111-773c-48b2-bac0-a1631033a435", stages)).toBeNull();
});

test("a list row's source is the vendor, else the partner, else the kind of source", () => {
  expect(leadSource({ source_name: "Apex Leads", partner_name: "Maya", source_type: "import" })).toBe("Apex Leads");
  expect(leadSource({ source_name: null, partner_name: "Maya", source_type: "import" })).toBe("Maya");
  expect(leadSource({ source_name: null, partner_name: null, source_type: "import" })).toBe("List import");
  expect(leadSource({ partner_name: null })).toBeNull();
});

test("same person? names what matched and what differs", () => {
  const a = { when: "New today", name: "Earl Johnson", phone: "(614) 555-0127", dob: "14 Feb 1957", place: "Columbus, OH", source: null };
  const b = { ...a, when: "Since 2 Oct", place: "Grove City, OH" };
  expect(comparePeople(a, b, ["phone", "dob"])).toEqual({ same: ["phone", "date of birth"], differs: ["place"], line: "Same phone and date of birth. Place differs." });
});
