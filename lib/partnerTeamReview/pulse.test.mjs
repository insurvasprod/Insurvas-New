import assert from "node:assert/strict";
import test from "node:test";

import { durationLabel, teamPulse } from "./pulse.ts";

const team = new Set(["dee", "jo"]);
const at = (minutes) => new Date(Date.UTC(2026, 8, 20, 9, 0) + minutes * 60_000).toISOString();
const window = { from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 30) };
const msg = (channelId, createdBy, minutes, kind = "text") => ({ channelId, createdBy, createdAt: at(minutes), kind });

test("a reply is timed from the first unanswered agent message in that conversation", () => {
  const pulse = teamPulse([
    msg("a", "agent", 0),
    msg("a", "agent", 10), // a second nudge does not restart the clock
    msg("a", "dee", 40),
    msg("b", "agent", 100),
    msg("b", "jo", 150),
  ], team, window);
  assert.equal(pulse.responses, 2);
  assert.equal(pulse.averageResponseMinutes, 45);
  assert.equal(pulse.pendingFollowUps, 0);
});

test("a conversation whose latest word is the agent's is a pending follow-up", () => {
  const pulse = teamPulse([msg("a", "dee", 0), msg("a", "agent", 5), msg("b", "agent", 1)], team, window);
  assert.equal(pulse.pendingFollowUps, 2);
  assert.equal(pulse.averageResponseMinutes, null);
});

test("automatic updates and the team talking among itself owe nobody an answer", () => {
  const pulse = teamPulse([msg("a", null, 0, "system_card"), msg("a", "agent", 1, "system_card"), msg("t", "dee", 2), msg("t", "jo", 3)], team, window);
  assert.deepEqual(pulse, { averageResponseMinutes: null, responses: 0, pendingFollowUps: 0 });
});

test("only questions asked inside the review window are timed", () => {
  const early = { from: Date.UTC(2026, 8, 21), to: Date.UTC(2026, 8, 30) };
  const pulse = teamPulse([msg("a", "agent", 0), msg("a", "dee", 30)], team, early);
  assert.equal(pulse.responses, 0);
});

test("durations read in the largest sensible unit", () => {
  assert.equal(durationLabel(0.4), "under a minute");
  assert.equal(durationLabel(42), "42 min");
  assert.equal(durationLabel(185), "3 hr 5 min");
  assert.equal(durationLabel(120), "2 hr");
  assert.equal(durationLabel(60 * 50), "2 days");
});
