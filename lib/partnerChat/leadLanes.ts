// Partner chat › Leads (owner pick "B · lead lanes", 2026-10-27): each lead a partner sent, built from the
// channel's automatic updates — where it is now, and the steps that got it there. Client-safe and pure.

import type { PartnerCardType, PartnerMessage } from "./cards";

/** The four steps the progress bar shows, in order. */
export const LEAD_STEPS = ["new_lead", "connected", "transferred", "outcome"] as const;
export type LeadStep = (typeof LEAD_STEPS)[number];
export type LeadState = "waiting" | "live" | "won" | "dropped" | "closed";

export type LeadLane = {
  /** The lead's work item; updates without one never make a lane. */
  workItemId: string;
  customer: string | null;
  firstAt: string;
  lastAt: string;
  /** The newest update's card. */
  latest: PartnerMessage;
  state: LeadState;
  /** Which of the four steps it reached; a dropped call marks the outcome step as reached, and failed. */
  reached: Record<LeadStep, boolean>;
  steps: PartnerMessage[];
};

const stepOf = (type: PartnerCardType | null): LeadStep | null =>
  type === "new_lead" ? "new_lead" : type === "connected" ? "connected" : type === "transferred" ? "transferred" : type === "call_outcome" || type === "call_dropped" ? "outcome" : null;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function stateOf(latest: PartnerMessage): LeadState {
  const payload = latest.cardPayload;
  if (latest.cardType === "call_dropped" || payload.closes_as === "dropped") return "dropped";
  if (latest.cardType === "call_outcome") return payload.counts_as_work_completed === true ? "won" : "closed";
  if (latest.cardType === "new_lead") return "waiting";
  return "live";
}

/** One lane per lead, newest activity first. Agent-ready and nobody-claimed cards name no lead's step. */
export function leadLanes(messages: PartnerMessage[]): LeadLane[] {
  const byLead = new Map<string, PartnerMessage[]>();
  for (const message of messages) {
    if (message.messageKind !== "system_card" || !message.workItemId || !stepOf(message.cardType)) continue;
    const list = byLead.get(message.workItemId) ?? [];
    list.push(message);
    byLead.set(message.workItemId, list);
  }
  const lanes: LeadLane[] = [];
  for (const [workItemId, unsorted] of byLead) {
    const steps = [...unsorted].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const latest = steps[steps.length - 1];
    const reached = { new_lead: false, connected: false, transferred: false, outcome: false };
    for (const step of steps) reached[stepOf(step.cardType) as LeadStep] = true;
    lanes.push({
      workItemId,
      customer: steps.map((step) => text(step.cardPayload.customer)).find(Boolean) ?? null,
      firstAt: steps[0].createdAt,
      lastAt: latest.createdAt,
      latest,
      state: stateOf(latest),
      reached,
      steps,
    });
  }
  return lanes.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** The words for where a lead is now. */
export const LEAD_STATE_LABEL: Record<LeadState, string> = { waiting: "Waiting for an agent", live: "On a call now", won: "Done · completed", dropped: "Done · dropped", closed: "Done" };
