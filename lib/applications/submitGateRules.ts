// AG-1.10 · the producer submit gate as the application workspace shows it. Pure and client-safe; the
// read is ./submitGate.ts and the authority is lib/agency/submitGate.ts (the 409 on POST …/submissions).

import type { SubmitGateView } from "./types";

/** The gate from the producer row, worded as the server's refusal is. */
export function gateFromProducer(producer: { can_submit: boolean | null; can_submit_reason: string | null } | null): SubmitGateView {
  if (!producer) return { canSubmit: false, code: "not_a_producer", reason: "You are not set up as a producer in your agency yet" };
  if (producer.can_submit) return { canSubmit: true, code: null, reason: null };
  return { canSubmit: false, code: "cannot_submit", reason: producer.can_submit_reason?.trim() || "Onboarding is not complete" };
}

/** Whether the gate stops a submission now. A missing gate (solo agent, no read) never does. */
export function gateBlocks(gate: SubmitGateView | null | undefined): gate is SubmitGateView & { canSubmit: false } {
  return Boolean(gate && !gate.canSubmit);
}

/** The one plain line: what is missing, and who fixes it (the owner, on the producer record). */
export function gateLine(gate: SubmitGateView): string {
  const reason = (gate.reason ?? "Onboarding is not complete").replace(/\.\s*$/, "");
  return gate.code === "not_a_producer"
    ? `You can't submit yet: ${lowerFirst(reason)}. Ask your agency owner to add you as a producer.`
    : `You can't submit yet: ${lowerFirst(reason)}. Ask your agency owner to fix it on your producer record.`;
}

function lowerFirst(s: string) {
  // "State licence number…" reads mid-sentence; an acronym ("NPN missing") keeps its capitals.
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
