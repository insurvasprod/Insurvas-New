import { callbackWords, cardLine, matchesFilters, moveTitle, nextStage, NO_FILTERS, pronoun, readinessLines, rowChip, usdCents } from "../logic";

/** Boards D1, D2, D3, D4, D6 and D8: the words and colours the lead screens draw from the server's facts. */
const stages = [
  { id: "s-new", name: "New", stage_type: "open" },
  { id: "s-int", name: "Interested", stage_type: "open" },
  { id: "s-sold", name: "Sold", stage_type: "won" },
  { id: "s-lost", name: "Not interested", stage_type: "lost" },
];

test("D1 · a row's chip follows what the lead is: New, Needs review, Assigned, or its stage", () => {
  expect(rowChip({ stage_id: "s-new" }, stages)).toEqual({ tone: "brand", text: "New" });
  expect(rowChip({ stage_id: "s-new", screening_outcome: "clear", screening_warning: true }, stages)).toEqual({ tone: "warn", text: "Needs review" });
  expect(rowChip({ stage_id: "s-new", owner_user_id: "u1", screening_outcome: "clear" }, stages)).toEqual({ tone: "info", text: "Assigned" });
  expect(rowChip({ stage_id: "s-int", owner_user_id: "u1" }, stages)).toEqual({ tone: "brand", text: "Interested" });
  expect(rowChip({ stage_id: "s-sold" }, stages)).toEqual({ tone: "ok", text: "Sold" });
  expect(rowChip({ stage_id: "s-lost" }, stages)).toEqual({ tone: "neutral", text: "Not interested" });
  expect(rowChip({ stage_id: "s-new", screening_outcome: "dnc_listed" }, stages)).toEqual({ tone: "bad", text: "Dnc listed" });
  expect(rowChip({ stage_id: "gone" }, stages)).toBeNull();
});

test("D2 · a card says what comes next: outcome, quote, callback; overdue when past", () => {
  const now = Date.parse("2026-11-26T15:00:00Z"); // Thu 26 Nov, 10:00 in New York
  expect(callbackWords("2026-11-26T13:00:00Z", "America/New_York", now)).toBe("Overdue 2 h");
  expect(callbackWords("2026-11-26T20:30:00Z", "America/New_York", now)).toBe("Today 3:30 pm");
  expect(callbackWords("2026-11-28T15:00:00Z", "America/New_York", now)).toBe("Callback Sat");
  expect(callbackWords("2026-12-10T15:00:00Z", "America/New_York", now)).toBe("Callback 10 Dec");
  expect(cardLine({ disposition: "interested", monthly_premium_cents: 4812, callback_at: "2026-11-28T15:00:00Z", callback_timezone: "America/New_York" }, now)).toBe("Interested · $48/mo · callback Sat");
  expect(cardLine({ disposition: "callback_scheduled", callback_at: "2026-11-26T13:00:00Z", callback_timezone: "America/New_York" }, now)).toBe("Overdue 2 h");
  expect(cardLine({ disposition: null }, now)).toBeNull();
});

test("D2 → D6 · a long-press offers the next stage first, the one before at the end", () => {
  expect(nextStage(stages, "s-new")?.id).toBe("s-int");
  expect(nextStage(stages, "s-lost")?.id).toBe("s-sold");
  expect(nextStage(stages, null)?.id).toBe("s-new");
});

test("D3 · what happens next in the board's order and words; cost with cents; the pronoun", () => {
  expect(readinessLines([
    { key: "bank", done: false }, { key: "coverage", done: true, faceAmountCents: 1_500_000 }, { key: "consent", done: true }, { key: "beneficiary", done: false },
  ])).toEqual([
    { key: "consent", done: true, text: "Consent on file" },
    { key: "coverage", done: true, text: "Coverage amount picked · $15,000" },
    { key: "beneficiary", done: false, text: "Beneficiary named" },
    { key: "bank", done: false, text: "Bank for the draft" },
  ]);
  expect(readinessLines([{ key: "coverage", done: false, faceAmountCents: null }])).toEqual([{ key: "coverage", done: false, text: "Coverage amount picked" }]);
  expect(usdCents(2800)).toBe("$28.00");
  expect(pronoun({ gender: "Female" })).toBe("she");
  expect(pronoun({ sex: "M" })).toBe("he");
  expect(pronoun({})).toBe("they");
});

test("D4 · a stage change reads as the move it was", () => {
  expect(moveTitle("Lead Stage Changed", "Stage: 3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d", [{ id: "3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d", name: "Interested" }])).toBe("Moved to Interested");
  expect(moveTitle("Lead Note Added", "Stage: x", [])).toBeNull();
});

test("D8 · Callable now only keeps the leads the calling-window check cleared, never an unknown", () => {
  const lead = (callable_now: boolean | null) => ({ partner_name: null, values: {}, callable_now });
  const f = { ...NO_FILTERS, callable: true as const };
  expect(matchesFilters(lead(true), f, null)).toBe(true);
  expect(matchesFilters(lead(false), f, null)).toBe(false);
  expect(matchesFilters(lead(null), f, null)).toBe(false);
  expect(matchesFilters(lead(null), NO_FILTERS, null)).toBe(true);
});
