import {
  continuePath, draftChoices, draftInputs, isKnockedOut, numberRangeError, stepsLeft, listCounts, nextDraftDate, partDone, partFlow, phoneStep, pickableDates, pickAttempt, premium, pruneHidden, questionFlow, rankQuotes, resumeQuestion, resumeStep, rowFilter, sectionPosition, stepLine, stepStates, toCents,
} from "../logic";
import type { ApplicationRow, QuoteView } from "../types";
import { attempt, interview, kase, QUESTIONS } from "../test-fixtures";

describe("the interview, one question per screen", () => {
  test("asks the persistency questions first, a follow-up straight after the answer that opened it, medicines last", () => {
    const closed = questionFlow(QUESTIONS, {}).map((q) => q.key);
    expect(closed).toEqual(["ss_deposit_day", "existing_coverage", "health_heart", "health_height", "medications"]);
    const open = questionFlow(QUESTIONS, { existing_coverage: { value: true } }).map((q) => q.key);
    expect(open).toEqual(["ss_deposit_day", "existing_coverage", "existing_cash_value", "health_heart", "health_height", "medications"]);
  });

  test("a follow-up closed again takes its answer with it, and is named as hidden", () => {
    const { answers, hidden } = pruneHidden(QUESTIONS, { existing_coverage: { value: false }, existing_cash_value: { value: true } });
    expect(answers).toEqual({ existing_coverage: { value: false } });
    expect(hidden).toEqual(["existing_cash_value"]);
  });

  test("a dropped call resumes on the first question still unanswered", () => {
    const answers = { ss_deposit_day: { value: "3rd Wednesday" }, existing_coverage: { value: false } };
    const flow = questionFlow(QUESTIONS, answers);
    expect(flow[resumeQuestion(flow, answers, 0)].key).toBe("health_heart");
    // Medicines count as answered when some are listed.
    const all = { ...answers, health_heart: { value: false }, health_height: { value: 64 } };
    expect(resumeQuestion(questionFlow(QUESTIONS, all), all, 2)).toBe(4);
  });

  test("names the place in the section, and the knockout answer", () => {
    const flow = questionFlow(QUESTIONS, {});
    expect(sectionPosition(flow, 0)).toEqual({ section: "Before we start", at: 1, of: 2 });
    expect(sectionPosition(flow, 3)).toEqual({ section: "Health", at: 2, of: 2 });
    expect(isKnockedOut(QUESTIONS[0], true)).toBe(true);
    expect(isKnockedOut(QUESTIONS[0], false)).toBe(false);
  });
});

describe("the ten steps (board E2b)", () => {
  test("in the board's order, done, now and locked: a step opens once every step before it is done", () => {
    const c = kase({}, {}, {});
    const a = pickAttempt(c)!;
    const states = stepStates(c, a, c.interviews.primary!, "eligibility");
    expect(states.map((s) => s.label)).toEqual(["Verify", "Quote", "Eligibility", "Personal details", "Health", "Medications", "Beneficiary", "Payment", "Review", "Sign"]);
    expect(states.map((s) => s.state)).toEqual(["done", "open", "now", "locked", "locked", "locked", "locked", "locked", "locked", "locked"]);
  });

  test("resumes on the first step not finished; a submitted or closed attempt opens on Sign", () => {
    const c = kase({}, { selectedQuoteId: "q1", quotes: [] }, { completedAt: "2026-11-24T10:00:00Z" });
    expect(resumeStep(c, pickAttempt(c)!, c.interviews.primary!)).toBe("beneficiaries");
    const closed = kase({}, { status: "closed" });
    expect(resumeStep(closed, pickAttempt(closed)!, null)).toBe("submit");
  });

  test("the list says where a draft stopped", () => {
    const c = kase({}, { selectedQuoteId: "q1" }, { answers: { ss_deposit_day: { value: "x" }, existing_coverage: { value: false } } });
    expect(stepLine(c, pickAttempt(c)!, c.interviews.primary!)).toBe("step 5 of 10 · Health");
  });

  test("the web's step names open the phone step that holds them", () => {
    const c = kase({}, {}, { answers: { ss_deposit_day: { value: "x" }, existing_coverage: { value: false } } });
    const a = pickAttempt(c)!;
    expect(phoneStep("interview", c, a, c.interviews.primary!)).toBe("health");
    expect(phoneStep("application", c, a, null)).toBe("personal");
    expect(phoneStep("disclosures", c, a, null)).toBe("review");
    expect(phoneStep("after", c, a, null)).toBe("submit");
  });

  test("the interview splits into Eligibility (persistency and its follow-ups), Health and Medications", () => {
    const open = { existing_coverage: { value: true } };
    expect(partFlow(QUESTIONS, open, "eligibility").map((q) => q.key)).toEqual(["ss_deposit_day", "existing_coverage", "existing_cash_value"]);
    expect(partFlow(QUESTIONS, open, "health").map((q) => q.key)).toEqual(["health_heart", "health_height"]);
    expect(partFlow(QUESTIONS, open, "medications").map((q) => q.key)).toEqual(["medications"]);
    expect(partDone(interview({ answers: { ss_deposit_day: { value: "x" }, existing_coverage: { value: false } } }), "eligibility")).toBe(true);
    expect(partDone(interview(), "eligibility")).toBe(false);
    expect(partDone(interview({ completedAt: "2026-11-24" }), "medications")).toBe(true);
  });

  test("the attempt on screen is the primary's newest open one", () => {
    const c = kase({ attempts: [attempt({ id: "old", attemptNo: 1, status: "closed" }), attempt({ id: "new", attemptNo: 2 }), attempt({ id: "sp", attemptNo: 1, insuredRole: "spouse" })] });
    expect(pickAttempt(c)?.id).toBe("new");
  });
});

describe("the Applications list", () => {
  const row = (status: ApplicationRow["status"]): ApplicationRow => ({ caseId: "c", applicationId: status, leadId: "l", clientName: "A", insuredRole: "primary", state: null, carrierName: null, productLabel: null, attemptNo: 1, status, monthlyPremiumCents: null, updatedAt: "2026-11-24" });
  test("drafts are in progress, ready needs a signature, closed stays on the web", () => {
    expect(rowFilter("closed")).toBeNull();
    expect(listCounts(["draft", "draft", "ready", "pending_carrier", "submitted", "closed"].map((s) => row(s as ApplicationRow["status"])))).toEqual({ progress: 2, ready: 1, submitted: 2 });
  });
});

describe("money and the quotes", () => {
  test("a premium keeps its cents; a typed amount becomes cents", () => {
    expect(premium(5218)).toBe("$52.18");
    expect(premium(null)).toBe("—");
    expect(toCents("$15,000")).toBe(1_500_000);
    expect(toCents("52.18")).toBe(5218);
    expect(toCents("abc")).toBeNull();
    expect(toCents("0")).toBeNull();
  });

  test("quotes still on offer, cheapest first", () => {
    const q = (id: string, cents: number, status: QuoteView["status"] = "draft"): QuoteView => ({ id, carrierId: "x", carrierName: id, productLabel: "", tier: "level", faceAmountCents: 1, monthlyPremiumCents: cents, status, appointed: { ok: true, reason: null }, warnings: [] });
    expect(rankQuotes([q("b", 5490), q("a", 5218), q("gone", 100, "discarded")]).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("the draft day inputs", () => {
  test("Social Security takes the birth day from the date of birth unless one is stored", () => {
    expect(draftInputs("ssa", {}, 14)).toEqual({ birthDay: 14, before1997: false });
    expect(draftInputs("ssa", { birthDay: 3, before1997: true }, 14)).toEqual({ birthDay: 3, before1997: true });
    expect(draftInputs("ssi", { birthDay: 3 }, 14)).toEqual({});
  });
});

describe("the draft date as dates (board E3)", () => {
  test("the first date a draft day comes round", () => {
    expect(nextDraftDate(18, "2026-11-26")).toBe("2026-12-18");
    expect(nextDraftDate(28, "2026-11-26")).toBe("2026-11-28");
    expect(nextDraftDate(3, "2026-12-20")).toBe("2027-01-03");
    expect(pickableDates("2026-11-26")).toHaveLength(28);
  });

  test("each day measured against the deposit before it; the deposit day itself is offered as Risky", () => {
    const rec = { kind: "recommended" as const, recommended: { day: 18, minGapDays: 2, reason: "" }, alternates: [{ day: 21, minGapDays: 4, reason: "" }], schedule: "Social Security on the 3rd Wednesday",
      arrivals: [{ month: "2026-12", date: "2026-12-16" }, { month: "2027-01", date: "2027-01-20" }] };
    expect(draftChoices(rec, "2026-11-26").map((c) => [c.date, c.meta, c.best, c.risky])).toEqual([
      ["2026-12-18", "2 days after the deposit · usually clears", true, false],
      ["2026-12-21", "5 days after the deposit", false, false],
      ["2026-12-16", "Deposit day · can bounce if it lands late", false, true],
    ]);
    expect(draftChoices({ kind: "not_applicable", why: "x" }, "2026-11-26")).toEqual([]);
  });
});

test("an interview fixture is complete enough for the screens", () => {
  expect(interview().questions).toHaveLength(QUESTIONS.length);
});

describe("Mark ready waits on the steps before Review; Save draft says where to go on", () => {
  test("stepsLeft lists every unfinished step before Review, in order, and nothing once it is ready", () => {
    const c = kase({ verification: { workItemId: "w1", complete: false } });
    expect(stepsLeft(c, c.attempts[0], c.interviews.primary ?? null)).toEqual(["verify", "quote", "eligibility", "personal", "health", "medications", "beneficiaries", "payment"]);
    const ready = kase({}, { status: "ready" });
    expect(stepsLeft(ready, ready.attempts[0], null)).toEqual([]);
  });
  test("continuePath opens the first computer step left, else Review", () => {
    expect(continuePath("c1", ["quote", "personal", "beneficiaries"])).toBe("/app/applications/c1?step=application");
    expect(continuePath("c1", ["payment"])).toBe("/app/applications/c1?step=payment");
    expect(continuePath("c1", [])).toBe("/app/applications/c1?step=review");
  });
});

test("a typed height, weight or count no person can be is refused before it is saved", () => {
  expect(numberRangeError("health_height", 6464)).toMatch(/between 36 and 96/);
  expect(numberRangeError("health_height", 64)).toBeNull();
  expect(numberRangeError("health_weight", 15000)).toMatch(/between 50 and 700/);
  expect(numberRangeError("moving_violations", -1)).toMatch(/zero or more/);
  expect(numberRangeError("annual_income", 52000)).toBeNull();
});