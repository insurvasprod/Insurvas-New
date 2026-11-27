/**
 * The inbound (transfer) routes' answers, traced from the web's own services (2026-11-24):
 *
 *   GET  /api/app/inbound/verification   lib/verification/service.ts getVerificationPanel, masked by
 *                                        lib/verification/sensitive.ts, plus context + stored preflight
 *   GET  /api/app/inbound/caller         notes, calls placed, times transferred in
 *   GET  /api/app/inbound/screening      lib/transferInbox/screeningLadder.ts
 *   GET  /api/app/inbound                lib/transferInbox/service.ts getTransferInbox (items carry age, preflight)
 *   GET  /api/app/agent-floor            lib/agentFloor/service.ts getAgentFloor
 *   GET  /api/app/inbound/handoff        lib/bufferHandoff/service.ts getBufferHandoffContext (assistants)
 *   POST /api/app/inbound/disposition    lib/dispositions/types.ts DispositionWizard + outcome context
 */

export type FieldType = "text" | "long_text" | "number" | "date" | "currency" | "phone" | "email" | "ssn" | "bank_routing" | "bank_account" | "boolean" | "single_select" | "multi_select";
export type VerifyState = "confirmed" | "corrected" | "outstanding";

export type PanelField = {
  field_key: string; label: string; type: FieldType; options: string[]; help_text?: string | null;
  is_required: boolean; is_visible: boolean; state: VerifyState; old_value: unknown; new_value: unknown; confirmed_at: string | null;
};
export type PanelSection = { section_key: string; label: string; sort_order: number; fields: PanelField[] };
export type CallContext = { claim: { at: string | null; byName: string | null; isYou: boolean }; partnerName: string | null; callStartedAt: string | null };
export type Preflight = { status: "new_household" | "spoken_before" | "already_customer" | "not_checked"; matches?: { partnerName: string | null; submittedAt: string; matchedOn: string[] }[] } | null;

export type VerificationPanel = {
  session: { id: string; progress_percentage: number; completed_at: string | null; started_at: string };
  workItem: { id: string; leadId: string; productLine: string };
  lead: { id: string; values: Record<string, unknown> };
  template: { product_name: string };
  sections: PanelSection[];
  requiredCount: number;
  visibleCount: number;
  sensitiveKeys?: string[];
  context?: CallContext | null;
  preflight?: Preflight;
};

export type CallerExtras = {
  leadId: string;
  notes: { id: string; body: string; author: string; createdAt: string }[] | null;
  calls: { count: number; last: { at: string; outcome: string | null; by: string } | null } | null;
  transfers: number | null;
  /** The newest consent certificate on the lead (null: none stored; undefined: not readable). */
  consent?: { provider: string | null; status: string; consentAt: string | null; capturedAt: string | null } | null;
  /** The customer's zone and the effective calling window (hours of their day) the lead record computes. */
  zones?: { customer: string; window: { start: number; end: number; noSunday: boolean; state: string } | null } | null;
  /** When the partner sent this caller (the transfer's own row), the campaign it came through, and the
   *  partner's free-text note on the lead (2026-11-26; undefined from an older server). */
  sentAt?: string | null;
  campaign?: string | null;
  partnerNote?: string | null;
  /** The earlier lead with the same phone (null: none; undefined: not readable). Its details are null
   *  when the session may not see that lead. */
  duplicate?: { leadId: string | null; name: string | null; phone: string | null; lastContact: { at: string; by: string | null } | null } | null;
};

export type LadderStep = { key: "phone" | "tenant_dnc" | "litigator" | "dnc_registry" | "duplicate"; label: string; state: "passed" | "match" | "not_reached" | "unknown" };
export type Screening = { steps: LadderStep[]; checked: boolean; summary: string; checkedAt: string | null; warning: string | null };

/** One row of GET /api/app/inbound (the inbox's own read): the waiting read plus age and the duplicate check. */
export type InboxItem = {
  id: string; leadId: string; customer: string; age: string | null; state: string | null; partnerName: string | null; productLine: string | null;
  waitSeconds: number; status: string; screeningOutcome: string | null; duplicateWarning: boolean;
  preflight: { status: string; matches?: { partnerName: string | null; submittedAt: string; matchedOn: string[] }[] } | null;
};

export type FloorMember = {
  id: string; name: string; role: string;
  availability: "ready" | "on_break" | "off" | "offline" | "on_call";
  away: boolean; lastSeenAt: string | null; statusChangedAt: string | null;
  call: { workItemId: string; leadId: string; customer: string; partnerName: string | null; startedAt: string } | null;
  lastCall: { customer: string; endedAt: string } | null;
  supporting: boolean;
};
export type FloorCall = { id: string; customer: string; age?: string | null; agentId: string; agentName: string; startedAt: string; productLine: string; state: string; verificationPercent?: number | null; buffer: { userId: string; name: string } | null };
export type Floor = { members: FloorMember[]; onCalls: FloorCall[]; ownStatus: "ready" | "on_break" | "off" };

export type HandoffContext = {
  canOffer: boolean; licensedAgents: { id: string; name: string; role: "owner" | "producer" }[];
  /** Each agent's licensed states (2026-11-26; null when unreadable, undefined from an older server). */
  licensedStates?: Record<string, string[]> | null;
};

export type DispositionOption = { id: string; option_key: string; label: string; next_node_id: string | null; disposition_key: string | null; sort_order: number };
export type DispositionNode = { id: string; label: string; prompt: string; node_type: "choice" | "multi_select" | "free_text"; options: DispositionOption[] };
export type WalkStep = { id: string; sequence: number; node_id: string; node_label: string; answer: unknown; option_key: string | null };
export type OutcomeOption = {
  disposition_key: string; label: string; closes_as: "completed" | "dropped"; description: string;
  stage: { id: string; name: string; pipeline_name: string; is_current: boolean } | null;
  application: boolean; needs_verification: boolean; adds_to_do_not_call: boolean;
};
export type Wizard = {
  walk: { id: string; status: "open" | "completed"; current_node_id: string | null; final_disposition_key: string | null };
  flow: { nodes: DispositionNode[] };
  currentNode: DispositionNode | null;
  steps: WalkStep[];
  lead: { id: string; values: Record<string, unknown> };
  customerTimezone: string | null;
  customerName: string;
  outcomeOptions: OutcomeOption[] | null;
  verification: { progress: number; complete: boolean } | null;
  /** Minutes before a callback its reminder goes out: the agency's setting, else the platform's (2026-11-26). */
  callbackReminderMinutes?: number | null;
};
