/** The shapes of the /api/app routes the app reads (traced from the web's lib services, 2026-11-24). */

export type CallbackView = {
  id: string; leadId: string; workItemId: string | null; customerName: string; scheduledAtUtc: string;
  customerTimezone: string | null; customerTime: string | null; agentTime: string | null;
  assignedTo: string | null; assigneeName: string | null; note: string | null;
  /** Missed = past due and never completed; it still needs a call. */
  status: "scheduled" | "due" | "completed" | "cancelled" | "missed";
  productName: string | null; phone: string | null; state: string | null; attemptNumber: number | null;
  isOverdue: boolean; isDueToday: boolean;
};
export type CallbacksAnswer = { callbacks: CallbackView[]; viewer: { userId: string; role: string } };

export type WaitingAnswer = {
  count: number;
  items: { id: string; customer: string; productLine: string | null; partnerName: string | null; state: string | null; waitSeconds: number; screening: string }[];
  sla: { warnSeconds: number; escalateSeconds: number } | null;
  readOnly: boolean;
};
export type ClaimAnswer = { claim: { work_item_id: string; lead_id: string; status: string }; resumed: boolean };

export type ServedAnswer = {
  served: { workItemId: string; leadId: string; tier: number; tierName: string; lockedUntil: string; appointmentNotes: string | null; selectionReason: string | null } | null;
  refused: number; emptyReason: string | null; atCapacity: { open: number; max: number } | null;
};

export type LeadRow = {
  id: string; product_line: string | null; pipeline_id: string | null; stage_id: string | null; values: Record<string, unknown>;
  partner_name: string | null; owner_name: string | null; disposition: string | null; created_at: string; updated_at: string;
};
export type Pipeline = { id: string; name: string; stages?: { id: string; name: string }[] };
export type LeadsAnswer = { leads: LeadRow[]; page: number; pageSize: number; hasMore: boolean; pipelineId: string | null; pipelines?: Pipeline[]; totals?: Record<string, number>; readOnly: boolean };

export type TimelineEvent = { id: string; label: string; at: string; actor: string | null; detail: string | null };
export type LeadWorkspace = {
  lead: { id: string; values: Record<string, unknown>; product_line: string | null; created_at: string };
  stage: { id: string; name: string } | null;
  stages: { id: string; name: string }[];
  partner: { name: string } | null;
  owner: { id: string; name: string } | null;
  disposition: { label?: string; key?: string } | null;
  timeline: TimelineEvent[];
  actions: { canClaim: boolean; canHandoff: boolean; canDisposition: boolean; canChangeStage: boolean };
  nextAction: unknown;
  readOnly: boolean;
};
export type Note = { id: string; body: string | null; visibility: string; author: { id: string; name: string }; createdAt: string };

export type Alert = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; event_type: string };
export type AlertsAnswer = { alerts: Alert[] };

export type SearchHit = { group: string; title: string; meta: string | null; href: string };
export type SessionRow = { id: string; tenantName: string; createdAt: string; lastSeenAt: string; location: string | null; device: string; current: boolean; twoFactor: boolean };
export type Workspace = { tenantId: string; name: string; roleLabel: string; current: boolean };

export type PreflightCheck = { key: string; label: string; result: string; tone: string };
export type PreflightAnswer = { ok?: boolean; code?: string; message?: string; error?: string; checks: PreflightCheck[]; phone: string; state: string | null };

/** GET /api/app/calling-windows: only the phone Home's `now` summary is read here. */
export type CallingWindowNow = { openStates: number; states: number; closesAt: string | null; opensAt: string | null };
export type CallingWindowAnswer = { now?: CallingWindowNow };

/** GET /api/app/pending/summary (lib/applications/listRules.ts PendingSummary). */
export type PendingSummaryAnswer = {
  summary: {
    awaitingPolicyNumber: { count: number; missingReference: number; missingPolicyNumber: number };
    waitingOnClient: { count: number; overdue: number; overdueAfterDays: number };
    counteroffersExpiring: { count: number; withinDays: number; soonestExpiresAt: string | null };
  };
};
