import assert from "node:assert/strict";
import test from "node:test";

import { callbacksSentence, dialerSentence, inboundSentence, leadsSentence, policiesSentence, waitLabel } from "./summaryText.ts";

test("inbound reads like the board, and says only what the counts support", () => {
  assert.equal(inboundSentence({ waiting: 14, longestSeconds: 252, pastSla: 2, slaSeconds: 900 }), "14 waiting, longest 4m 12s. Two past the 15-minute SLA.");
  assert.equal(inboundSentence({ waiting: 3, longestSeconds: 40, pastSla: 0, slaSeconds: 120 }), "3 waiting, longest 40s.");
  assert.equal(inboundSentence({ waiting: 0, longestSeconds: null, pastSla: 0, slaSeconds: 120 }), "Nobody is waiting right now.");
  assert.equal(inboundSentence({ waiting: 30, longestSeconds: 9000, pastSla: 12, slaSeconds: 90 }), "30 waiting, longest 2h 30m. 12 past the 90-second SLA.");
});

test("waits read in the largest sensible units", () => {
  assert.deepEqual([38, 252, 7500].map(waitLabel), ["38s", "4m 12s", "2h 5m"]);
});

test("the other tiles' sentences", () => {
  assert.equal(dialerSentence(212), "212 leads ready to dial.");
  assert.equal(dialerSentence(1), "1 lead ready to dial.");
  assert.equal(dialerSentence(0), "No leads are waiting to be dialled.");
  assert.equal(callbacksSentence(5, 2), "5 due today, 2 overdue.");
  assert.equal(callbacksSentence(0, 1), "1 overdue.");
  assert.equal(callbacksSentence(0, 0), "Nothing due today.");
  assert.equal(leadsSentence(12, 1204), "12 added in the last 7 days, 1,204 in all.");
  assert.equal(policiesSentence(61), "61 policies in your book.");
  assert.equal(policiesSentence(1), "1 policy in your book.");
});

test("the four newer tile sentences say nothing they cannot count", async () => {
  const { activitySentence, appointmentsSentence, carriersSentence, poolSentence } = await import("./summaryText.ts");
  assert.equal(carriersSentence(0), "No carriers added yet.");
  assert.equal(carriersSentence(5), "5 carriers active in your library.");
  assert.equal(appointmentsSentence(1, 1), "1 appointment on file across 1 state.");
  assert.equal(poolSentence(0), "Every lead in the pool has an owner.");
  assert.equal(poolSentence(12), "12 leads in the pool with no owner.");
  assert.equal(activitySentence(0, 0), "No dials in the last 7 days.");
  assert.equal(activitySentence(8, 5), "8 dials this week, 62.5% reached.");
});
