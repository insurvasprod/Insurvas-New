import { barClock, checkTicks, compoundFields, consentTick, consequences, correctionValue, duplicateLine, handoffAgents, handoffLine, handoffQualifier, nextRing, objectPronoun, onCallClock, partnerDetails, partnerQuote, phaseOf, providerLabel, quickTimes, teamGroups, teamRow, verifyView, waitingLine, windowTick } from "../model";
import type { FloorMember, OutcomeOption, PanelField } from "../types";

const field = (key: string, over: Partial<PanelField> = {}): PanelField => ({
  field_key: key, label: key, type: "text", options: [], is_required: true, is_visible: true, state: "outstanding", old_value: null, new_value: null, confirmed_at: null, ...over,
});

describe("C2 · which transfer rings", () => {
  const items = [{ id: "a", waitSeconds: 40 }, { id: "b", waitSeconds: 10 }];
  test("nothing rings on the first read: those callers are already on the list", () => {
    expect(nextRing(null, items, [], "ready", false)).toBeNull();
  });
  test("a caller new since the last read rings, longest wait first", () => {
    expect(nextRing(["b"], items, [], "ready", false)).toBe("a");
    expect(nextRing([], items, [], "ready", false)).toBe("a");
  });
  test("only while you are taking calls, never when read-only, never one you passed", () => {
    expect(nextRing([], items, [], "on_break", false)).toBeNull();
    expect(nextRing([], items, [], "on_call", false)).toBeNull();
    expect(nextRing([], items, [], "ready", true)).toBeNull();
    expect(nextRing([], items, ["a"], "ready", false)).toBe("b");
  });
});

describe("the call's steps", () => {
  test("a link lands on its step; anything else starts at Caller profile", () => {
    expect(phaseOf("verify")).toBe("verify");
    expect(phaseOf("finish")).toBe("finish");
    expect(phaseOf("underwriting")).toBe("check");
    expect(phaseOf(undefined)).toBe("check");
  });
  test("the on-call clock runs from the server's call record only", () => {
    const start = "2026-11-24T14:00:00Z";
    expect(onCallClock(start, Date.parse(start) + 198_000)).toBe("03:18");
    expect(onCallClock(null, Date.now())).toBeNull();
  });
});

describe("C4 · verification", () => {
  const panel = {
    requiredCount: 3,
    sections: [{ section_key: "s", label: "S", sort_order: 1, fields: [
      field("name", { state: "confirmed" }),
      field("address", { state: "corrected" }),
      field("height", { is_required: false }),
      field("beneficiary"),
    ] }],
  };
  test("confirmed and corrected are done; the next required field is Now; the count is the server's rule", () => {
    const v = verifyView(panel);
    expect(v.done.map((f) => f.field_key)).toEqual(["name", "address"]);
    expect(v.now?.field_key).toBe("beneficiary");
    expect(v.later.map((f) => f.field_key)).toEqual(["height"]);
    expect([v.confirmed, v.required, v.corrected]).toEqual([2, 3, 1]);
    expect(v.percent).toBe(66);
  });
  test("tapping a field to check makes it Now; a done field cannot be picked", () => {
    expect(verifyView(panel, "height").now?.field_key).toBe("height");
    expect(verifyView(panel, "name").now?.field_key).toBe("beneficiary");
  });
  test("a correction sends what the template stores: cents, numbers, booleans, lists", () => {
    expect(correctionValue("currency", "$10,000")).toBe(1_000_000);
    expect(correctionValue("number", "72")).toBe(72);
    expect(correctionValue("boolean", "false")).toBe(false);
    expect(correctionValue("multi_select", ["a", "b"])).toEqual(["a", "b"]);
    expect(correctionValue("text", "  Karen King ")).toBe("Karen King");
  });
  test("the partner's details skip what the caller card already shows", () => {
    const out = partnerDetails({
      lead: { id: "l", values: { full_name: "Dolores King", phone: "9045550117", coverage_amount: 1000000, notes: "Prefers afternoons" } },
      sections: [{ section_key: "s", label: "S", sort_order: 1, fields: [field("full_name"), field("phone"), field("coverage_amount", { type: "currency", label: "Coverage" }), field("notes", { label: "Notes" })] }],
    });
    expect(out).toEqual([{ key: "coverage_amount", label: "Coverage", value: "$10,000" }, { key: "notes", label: "Notes", value: "Prefers afternoons" }]);
  });
});

describe("C3 / C1b · checks are the server's ticks", () => {
  const now = Date.parse("2026-11-24T14:00:19Z");
  const steps = (dnc: string, dup: string) => [
    { key: "phone" as const, label: "", state: "passed" as const },
    { key: "tenant_dnc" as const, label: "", state: "passed" as const },
    { key: "litigator" as const, label: "", state: "passed" as const },
    { key: "dnc_registry" as const, label: "", state: dnc as "passed" | "match" },
    { key: "duplicate" as const, label: "", state: dup as "passed" | "match" },
  ];
  test("clear screening and a new household are two green ticks (no tick for a passed duplicate check)", () => {
    const t = checkTicks({ steps: steps("passed", "passed"), checkedAt: "2026-11-24T14:00:00Z" }, { status: "new_household" }, now);
    expect(t.map((x) => [x.title, x.ok])).toEqual([["Not on any Do Not Call list", 1], ["Not already your client", 1]]);
    expect(t[0].meta).toBe("Checked 0:19 ago");
  });
  test("a duplicate is a red ×, and nothing is claimed when screening did not run", () => {
    expect(checkTicks({ steps: steps("passed", "match"), checkedAt: null }, null, now).find((x) => x.key === "dup")?.ok).toBe(0);
    expect(checkTicks(null, undefined, now)).toEqual([]);
  });
  test("consent and the calling window sit in the board's order, from the caller read", () => {
    const zones = { customer: "America/New_York", window: { start: 8, end: 20, noSunday: false, state: "FL" } };
    const consent = { provider: "trustedform", status: "claimed", consentAt: "2026-11-22T15:00:00Z", capturedAt: null };
    const t = checkTicks({ steps: steps("passed", "passed"), checkedAt: null }, { status: "new_household" }, now, { consent, zones });
    expect(t.map((x) => x.key)).toEqual(["dnc", "consent", "client", "window"]);
    expect(t[1]).toMatchObject({ ok: 1, title: "Consent on file" });
    expect(t[1].meta).toContain("TrustedForm");
    // 14:00:19Z is 9:00 am in New York (EST): inside 8 am–8 pm.
    expect(t[3]).toMatchObject({ ok: 1, title: "Inside the calling window", meta: "9:00 am their time · open until 8 pm" });
  });
  test("consent: pending is still arriving, failed is red, none is said, unreadable is left out", () => {
    expect(consentTick({ provider: "jornaya", status: "pending", consentAt: null, capturedAt: null })).toMatchObject({ ok: null, title: "Consent proof still arriving" });
    expect(consentTick({ provider: null, status: "failed", consentAt: null, capturedAt: null })?.ok).toBe(0);
    expect(consentTick(null)).toMatchObject({ ok: null, title: "No consent proof on file yet" });
    expect(consentTick(undefined)).toBeNull();
    expect(providerLabel("trusted_form")).toBe("TrustedForm");
    expect(providerLabel("acme_consent")).toBe("acme consent");
  });
  test("window: outside says when it opens; a closed Sunday says so; no zone, no tick", () => {
    const at = Date.parse("2026-11-24T03:30:00Z"); // 10:30 pm in New York
    expect(windowTick({ customer: "America/New_York", window: { start: 8, end: 21, noSunday: false, state: "FL" } }, at)).toMatchObject({ ok: null, title: "Outside the calling window", meta: "10:30 pm their time · opens 8 am" });
    const sunday = Date.parse("2026-11-22T17:00:00Z"); // Sunday noon in New York
    expect(windowTick({ customer: "America/New_York", window: { start: 8, end: 21, noSunday: true, state: "FL" } }, sunday)?.meta).toContain("closed on Sundays in FL");
    expect(windowTick({ customer: "America/New_York", window: null }, at)).toBeNull();
    expect(windowTick(null, at)).toBeNull();
  });
  test("the partner's own words are a quote, not repeated in the list", () => {
    const panel = { lead: { id: "l1", values: { notes: "Wants $10k to cover burial.", coverage_amount: 10000 } }, sections: [{ section_key: "s", label: "S", sort_order: 1, fields: [
      { field_key: "notes", label: "Notes", type: "long_text" as const, options: [], is_required: false, is_visible: true, state: "outstanding" as const, old_value: null, new_value: null, confirmed_at: null },
      { field_key: "coverage_amount", label: "Coverage", type: "number" as const, options: [], is_required: false, is_visible: true, state: "outstanding" as const, old_value: null, new_value: null, confirmed_at: null },
    ] }] };
    expect(partnerQuote(panel)).toEqual({ key: "notes", value: "Wants $10k to cover burial." });
    expect(partnerQuote({ ...panel, lead: { id: "l1", values: {} } })).toBeNull();
  });
});

describe("C1 / C2 / L2 · lines from the server's figures", () => {
  const now = Date.parse("2026-11-24T14:00:00Z");
  test("a waiting caller: age, state, product, only what was sent", () => {
    expect(waitingLine({ age: "71", state: "FL", productLine: "final_expense" })).toBe("71 yrs · FL · Final expense");
    expect(waitingLine({ state: "—", productLine: null })).toBe("");
  });
  test("a handoff: verification done and when it was offered", () => {
    expect(handoffLine({ progressPercentage: 75, offeredAt: "2026-11-24T13:57:00Z" }, now)).toBe("Verification 75% done · 3 min ago");
    expect(handoffLine({ progressPercentage: null, productLine: "term_life", offeredAt: null }, now)).toBe("Term life");
  });
  test("the on-call card never shows a 1,600-hour timer", () => {
    expect(barClock("2026-11-24T13:55:42Z", now)).toBe("on a call · 4:18");
    expect(barClock("2026-09-17T14:38:00Z", now)).toMatch(/^on a call since 17 Sept?, /);
  });
});

describe("C1c · the team", () => {
  const now = Date.parse("2026-11-24T14:10:00Z");
  const member = (over: Partial<FloorMember>): FloorMember => ({ id: "u", name: "Sam Lee", role: "producer", availability: "ready", away: false, lastSeenAt: null, statusChangedAt: "2026-11-24T14:07:00Z", call: null, lastCall: null, supporting: false, ...over });
  test("ready says how long they have waited; on a call shows the call's length", () => {
    expect(teamRow(member({}), "me", [], now)).toMatchObject({ meta: "Ready · waiting 3 min", taking: true, chip: null });
    expect(teamRow(member({ availability: "on_call", call: { workItemId: "w", leadId: "l", customer: "X", partnerName: null, startedAt: "2026-11-24T14:03:48Z" } }), "me", [], now))
      .toMatchObject({ meta: "On a call · 6:12", chip: { tone: "info", text: "On a call" } });
  });
  test("you and assistants are named so", () => {
    expect(teamRow(member({ id: "me" }), "me", [], now).name).toBe("Sam Lee (you)");
    // An on-call member the server has stopped hearing from is away: listed with those not taking calls.
    expect(teamRow(member({ availability: "on_call", away: true, call: { workItemId: "w", leadId: "l", customer: "X", partnerName: null, startedAt: "2026-11-24T14:03:48Z" } }), "me", [], now))
      .toMatchObject({ taking: false, chip: { tone: "warn", text: "Away" } });
    // A call older than 4 hours was never closed: its start, not a 1646-hour timer.
    const stale = teamRow(member({ availability: "on_call", call: { workItemId: "w", leadId: "l", customer: "X", partnerName: null, startedAt: "2026-09-06T08:00:00Z" } }), "me", [], now);
    expect(stale.meta).toMatch(/^On a call since 6 Sept?, /);
    expect(stale.meta).not.toMatch(/\d{3,}:\d\d:\d\d/);
    expect(teamRow(member({ role: "assistant", availability: "off" }), "me", [], now)).toMatchObject({ name: "Sam Lee (assistant)", taking: false });
  });
});

describe("C6 · what happens when you save", () => {
  const option: OutcomeOption = { disposition_key: "callback_scheduled", label: "Callback", closes_as: "completed", description: "", stage: { id: "s", name: "Callback", pipeline_name: "Sales", is_current: false }, application: false, needs_verification: false, adds_to_do_not_call: false };
  test("the stage it moves to, and the callback in their time", () => {
    const at = new Date("2026-11-25T19:00:00Z");
    const out = consequences(option, { at, zone: "America/New_York", mine: "America/New_York" });
    expect(out[0].text).toBe("Callback Wed 25 Nov, 2:00 pm their time (2:00 pm yours)");
    expect(out[1]).toEqual({ icon: "kanban", text: "Lead moves to", bold: "Callback" });
  });
  test("nothing is promised for a stage it is already in", () => {
    expect(consequences({ ...option, stage: { ...option.stage!, is_current: true } }, null)).toEqual([]);
  });
  test("quick times are tomorrow 2 pm and the next two days, in the customer's zone", () => {
    const q = quickTimes("America/New_York", Date.parse("2026-11-24T15:00:00Z"));
    expect(q.map((x) => x.local)).toEqual(["2026-11-25T14:00", "2026-11-26T10:00", "2026-11-27T16:00"]);
    expect(q[0].label).toBe("Tomorrow 2 pm");
  });
});

describe("board round 2 (2026-11-26) · C1b, C1c, C4, C4b, C5, C6", () => {
  const now = Date.parse("2026-11-24T14:10:00Z");
  const member = (over: Partial<FloorMember>): FloorMember => ({ id: "u", name: "Sam Lee", role: "producer", availability: "ready", away: false, lastSeenAt: null, statusChangedAt: "2026-11-24T14:07:00Z", call: null, lastCall: null, supporting: false, ...over });

  test("C1b: the duplicate tick names the earlier lead, who and when", () => {
    const dup = { leadId: "l0", name: "Walter Brooks", phone: "4785550133", lastContact: { at: "2026-10-04T15:00:00Z", by: "Sam Lee" } };
    expect(duplicateLine(dup)).toBe("Walter Brooks, (478) 555-0133, Contacted 4 Oct by Sam Lee");
    expect(duplicateLine({ ...dup, lastContact: null })).toBe("Walter Brooks, (478) 555-0133");
    // A lead this session may not see: only that one exists.
    expect(duplicateLine({ leadId: null, name: null, phone: null, lastContact: null })).toBeNull();
    const steps = [{ key: "duplicate" as const, label: "", state: "match" as const }];
    expect(checkTicks({ steps, checkedAt: null }, undefined, now, { duplicate: dup }).find((x) => x.key === "dup")?.meta).toBe("Walter Brooks, (478) 555-0133, Contacted 4 Oct by Sam Lee");
  });

  test("C1c: ready longest-waiting first, then on a call; assistants verifying and people off are not taking calls", () => {
    const calls = [{ id: "c", customer: "X", agentId: "ava", agentName: "Ava Kim", startedAt: "2026-11-24T14:04:00Z", productLine: "fe", state: "GA", buffer: { userId: "lena", name: "Lena Park" } }];
    const { taking, notTaking } = teamGroups([
      member({ id: "jr", name: "Jordan Reyes", statusChangedAt: "2026-11-24T14:09:00Z" }),
      member({ id: "ava", name: "Ava Kim", availability: "on_call", call: { workItemId: "w", leadId: "l", customer: "X", partnerName: null, startedAt: "2026-11-24T14:04:00Z" } }),
      member({ id: "sl", name: "Sam Lee", statusChangedAt: "2026-11-24T14:07:00Z" }),
      member({ id: "lena", name: "Lena Park", role: "assistant", availability: "on_call", supporting: true }),
      member({ id: "nw", name: "Nia Watts", availability: "off" }),
    ], "jr", calls, now);
    expect(taking.map((r) => r.id)).toEqual(["sl", "jr", "ava"]);
    expect(notTaking.map((r) => [r.name, r.meta])).toEqual([["Lena Park (assistant)", "Verifying for Ava"], ["Nia Watts", "Off today"]]);
    // No rotation exists on the server, so no row claims to be "Next".
    expect([...taking, ...notTaking].some((r) => r.chip?.text === "Next")).toBe(false);
  });

  test("C4: read it back to her / him / them, from the lead's gender", () => {
    expect(objectPronoun({ gender: "Female" })).toBe("her");
    expect(objectPronoun({ sex: "M" })).toBe("him");
    expect(objectPronoun({})).toBe("them");
  });

  test("C4b: agents licensed in the caller's state, ready first, under the qualifier", () => {
    const agents = [{ id: "ak", name: "Ava Kim" }, { id: "jr", name: "Jordan Reyes" }, { id: "tb", name: "Tom Baker" }];
    const floor = [member({ id: "ak", availability: "on_call" }), member({ id: "jr" })];
    const out = handoffAgents(agents, { ak: ["GA"], jr: ["FL", "GA"], tb: ["FL"] }, "ga", floor);
    expect(out).toEqual({ agents: [{ id: "jr", name: "Jordan Reyes" }, { id: "ak", name: "Ava Kim" }], filtered: true });
    expect(handoffQualifier("GA", "final_expense")).toBe("Licensed in Georgia for final expense, ready now");
    // Nobody licensed there, or no licences sent: every agent the server offers, and no qualifier.
    expect(handoffAgents(agents, { tb: ["FL"] }, "GA", null).filtered).toBe(false);
    expect(handoffAgents(agents, null, "GA", null).agents).toHaveLength(3);
  });

  test("C5: a beneficiary kept as sibling fields is corrected together", () => {
    const f = (field_key: string, type: "text" | "single_select" = "text") => ({ field_key, label: field_key, type, options: [], is_required: true, is_visible: true, state: "outstanding" as const, old_value: null, new_value: null, confirmed_at: null });
    const panel = { sections: [{ section_key: "s", label: "S", sort_order: 1, fields: [f("full_name"), f("beneficiary"), f("beneficiary_relationship", "single_select"), f("beneficiary_share"), f("contingent_beneficiary")] }] };
    expect(compoundFields(panel, { field_key: "beneficiary_relationship" })).toMatchObject({ label: "Beneficiary", fields: [{ field_key: "beneficiary" }, { field_key: "beneficiary_relationship" }, { field_key: "beneficiary_share" }] });
    expect(compoundFields(panel, { field_key: "full_name" })).toBeNull();
    expect(compoundFields(panel, { field_key: "contingent_beneficiary" })).toBeNull();
  });

  test("C6: a callback says when its reminder goes out, from the server's minutes", () => {
    const option: OutcomeOption = { disposition_key: "callback_scheduled", label: "Callback", closes_as: "completed", description: "", stage: { id: "s", name: "Callback", pipeline_name: "Sales", is_current: false }, application: false, needs_verification: false, adds_to_do_not_call: false };
    const cb = { at: new Date("2026-11-25T19:00:00Z"), zone: "America/New_York", mine: "America/New_York" };
    expect(consequences(option, cb, 5).at(-1)).toEqual({ icon: "bell", text: "You get a reminder 5 minutes before" });
    expect(consequences(option, cb, null).some((e) => e.icon === "bell")).toBe(false);
    expect(consequences(option, null, 5).some((e) => e.icon === "bell")).toBe(false);
  });
});
