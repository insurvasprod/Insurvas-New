// Which moves the generic transition route may make (STATUS-MODEL §4). Pure and client-safe.
//
// `application_transition` allows every edge in the graph, but some edges carry side effects that
// only their own service performs: the first requirement is what makes an attempt pending_carrier
// (LA-3.18), a counteroffer row and its waiting-on-client requirement are what make it
// counteroffer_pending (LA-3.26), the client's answer to that offer updates the effective coverage and
// the welcome pack, and a submission freezes the QA verdict (LA-3.15). Taking those edges through the
// bare route would leave the state without the record that explains it, so the route refuses them and
// names the action that does it properly.

import type { ApplicationOutcome } from "./constants.ts";

export type TransitionRefusal = { code: string; message: string };

export function genericTransitionRefusal(to: string, outcome: ApplicationOutcome | null | undefined): TransitionRefusal | null {
  if (to === "submitted") {
    return { code: "TRANSITION_USE_SUBMISSION", message: "Record the submission instead — it freezes the QA verdict and moves the application to Submitted." };
  }
  if (to === "pending_carrier") {
    return { code: "TRANSITION_USE_REQUIREMENT", message: "Add what the carrier asked for instead — the first requirement moves the application to Pending carrier, and accepting a counteroffer moves it back." };
  }
  if (to === "counteroffer_pending") {
    return { code: "TRANSITION_USE_COUNTEROFFER", message: "Record the counteroffer instead — it keeps the offered terms beside the ones applied for and raises the client's requirement." };
  }
  if (to === "closed" && (outcome === "declined_by_client" || outcome === "offer_expired")) {
    return { code: "TRANSITION_USE_COUNTEROFFER_ANSWER", message: "Answer the counteroffer instead — refusing or letting it expire closes the application with that outcome." };
  }
  return null;
}
