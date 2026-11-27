/**
 * The answers of the web routes the Team, Reports and Compliance screens read (release 3, board section 09). Only
 * the fields the screens use are typed; each names the route and the server type it mirrors.
 */

/** GET /api/app/agency/scorecards (lib/agency/scorecardStore.ts ProducerScore). */
export type ProducerScore = {
  producerUserId: string;
  name: string;
  submitted: number;
  issued: number;
  placed: number;
  /** "82%", or "2/2" under the sample size, or "—". */
  placement: string;
  m4: { text: string };
  chargebackCents: number;
  /** Charged-back policies, a count (added for the phone, 2026-11-25). */
  chargebacks?: number;
  /** Issued annual premium in the period (added for the phone, 2026-11-25). */
  issuedAnnualCents?: number;
};
export type ScoresAnswer = { available: boolean; rows: ProducerScore[]; minSample: number; issuedDays?: Record<string, [string, number][]> };

/** GET /api/app/agency/producers (lib/agency/producerStore.ts RosterRow). */
export type RosterRow = { id: string; userId: string; displayName: string; status: string; role: string | null; hiredOn: string | null; managerProducerId?: string | null };
export type RosterAnswer = { schemaPending: boolean; rows: RosterRow[] };

/** GET /api/app/agency/producers/[id]. */
export type ProducerRecord = {
  id: string; userId: string; displayName: string; status: string; hiredOn: string | null; email: string | null; phone: string | null;
  role: string | null; managerName: string; isSelf: boolean;
};

/** GET /api/app/agency/producers/[id]/carriers (lib/agency/carrierStore.ts ProducerCarrierRow). */
export type ProducerCarriers = { schemaPending: boolean; rows: { carrierId: string; carrierName: string; appointments: { state: string; status: string; expiresOn: string | null }[] }[] };

/** GET /api/app/goals. */
export type GoalAnswer = { goal: { state: "set"; target: number } | { state: "none" | "missing" } };

/** GET /api/app/team (owner only): the members, with the states each is licensed in and when each lapses. */
export type TeamMember = { id: string; name: string; role: string; status: string; licensedStates?: string[]; licensedStateExpiries?: Record<string, string> };
export type TeamAnswer = { members: TeamMember[] };

/** GET /api/app/reports/sales (lib/applications/reportRules.ts SalesReport). */
export type Ratio = { n: number; d: number };
export type SalesReport = {
  from: string; to: string;
  totals: { submitted: number; issued: Ratio };
  funnel: { quoted: number; applied: Ratio; submitted: Ratio; issued: Ratio };
  declines: { rows: { key: string; label: string; total: number }[]; total: number };
  timing: { all: { submitToIssueDays: { value: number | null; n: number } } };
  trend: { grain: string; buckets: { key: string; label: string; submitted: number; issued: number }[] };
  options?: { carriers: { id: string; name: string }[]; products: { code: string; label: string }[]; producers: { id: string; name: string }[] };
};

/** GET /api/app/reports/sales?days_by_month=N (added for the phone, 2026-11-27). */
export type DaysByMonth = { months: { key: string; label: string; submitToIssueDays: { value: number | null; n: number } }[] };
/** GET /api/app/reports/sales?declined=<key> (added for the phone, 2026-11-27). */
export type DeclinedAnswer = { applications: { id: string; leadId: string; clientName: string; carrierName: string | null; submittedOn: string | null }[] };

/** GET /api/app/true-cpa (lib/vendorScorecard/types.ts VendorScorecardTotals): the lead-to-policy counts only. */
export type LeadFunnelTotals = { leads_received: number; contacted_leads: number; quoted_leads: number | null; applied_leads: number | null; applications: number; issued_policies: number };
export type TrueCpaAnswer = { totals: LeadFunnelTotals };
/** GET /api/app/true-cpa/leads (VendorScorecardLeadResult): the leads behind one figure. */
export type FunnelLeadsAnswer = { rows: { lead_id: string; lead_date: string; campaign_name: string; vendor_name: string }[]; total: number | null; has_more: boolean };

/** GET /api/app/persistency (lib/persistency/compute.ts PersistencyReport). */
export type PersistencyCell = { month: number; eligible: number; alive: number; rate: number | null };
export type PersistencyAnswer = { report: { overall: PersistencyCell[]; byCohort: { key: string; label: string; policies: number; cells: PersistencyCell[] }[]; policies: number } };

/** GET /api/app/activity (lib/activityLog/types.ts ActivityReport · ScorecardRow, and ?series=weeks). */
export type ActivityRow = {
  agent_user_id: string | null; agent_name?: string | null; served: number; clicked: number; contact_rate_percent: number | null;
  callbacks_booked: number; appointments_booked: number; applications_started: number; applications_submitted: number;
};
export type ActivityAnswer = { scorecard: ActivityRow[] };
export type ActivityWeeks = { weeks: { key: string; label: string; dials: number; contacts: number; submitted: number }[] };

/** GET /api/app/retention/cases?scorecard= (lib/retention/cases/scorecard.ts ScoreLine, counts only). */
export type ScoreLine = { key: string; open: number; saved: number; lost: number; closedNoSave: number; unreachable: number; rate: number | null };
/** GET /api/app/scorecard?kind=retention (added for the phone, 2026-11-27): this month, by reason and by person. */
export type RetentionMonth =
  | { available: true; month: string; total: ScoreLine; reasons: (ScoreLine & { label: string })[]; people: (ScoreLine & { name: string })[] }
  | { available: false; message: string };
export type RetentionScorecard =
  | { available: true; days: number; total: ScoreLine; steps: (ScoreLine & { label: string })[]; people: (ScoreLine & { name: string })[] }
  | { available: false; message: string };

/** GET /api/app/callbacks (lib/callbacks/service.ts CallbackView). */
export type CallbackItem = {
  id: string; leadId: string; customerName: string; scheduledAtUtc: string; assignedTo: string; assigneeName: string;
  status: string; completedVia: "call" | "manual" | null; missedAt: string | null;
};
export type CallbacksAnswer = { callbacks: CallbackItem[] };

/** GET /api/app/partner-quality (lib/partnerQuality/types.ts PartnerQualityReport). */
export type QualityRow = {
  partner_id: string; partner_name: string; partner_type?: string | null; sent: number; worked: number; submitted: number;
  disqualified: number; disqualification_rate: number | null; previous: { sent: number; submitted: number };
};
export type QualityAnswer = {
  from: string; to: string; rows: QualityRow[];
  summary: { sent: number; submitted: number }; previous_summary: { sent: number; submitted: number };
  weeks: { key: string; sent: number; submitted: number }[];
};

/** POST /api/app/dial/preflight (lib/compliance/preflightChecks.ts PreflightCheck); a refusal carries the same fields. */
export type PreflightCheck = { key: string; label: string; result: string; tone: "success" | "error" | "warning" | "neutral"; source: string; age: string; refuses: boolean; refusal?: string };
export type PreflightAnswer = { ok?: boolean; code?: string; error?: string; message?: string; phone?: string; state?: string | null; checks?: PreflightCheck[]; lead?: { id: string } | null };

/** GET /api/app/consent (lib/consent/constants.ts ConsentArtefact). */
export type ConsentArtefact = {
  id: string; leadId: string; leadName: string; leadPhone: string | null; provider: string; certificateId: string | null;
  status: "pending" | "claimed" | "expired" | "failed"; capturedAt: string; claimedAt: string | null; consentTimestamp: string | null;
  ip: string | null; sourceUrl: string | null; landingPage: string | null; vendorName: string | null;
  /** ?words=1 (added for the phone, 2026-11-27): the words agreed to, verbatim, and when an unclaimed copy's claim window closes. */
  consentText?: string | null; claimClosesAt?: string | null;
};
export type ConsentAnswer = { artefacts: ConsentArtefact[]; hasMore: boolean };

/** GET /api/app/compliance/complaints (lib/compliance/complaintStore.ts ComplaintRow). */
export type Complaint = {
  id: string; channel: string; regulatorState: string | null; receivedAt: string; receivedVia: string; complainantName: string | null;
  phoneDigits: string | null; policyNumber: string | null; category: string; summary: string; responseDueAt: string | null;
  respondedAt: string | null; responseText: string | null; status: string; owner: { id: string; name: string }; dncAddedAt: string | null;
  resolvedAt: string | null; notes: string | null; aboutAgent: { id: string; name: string } | null;
  countdown: { tone: "overdue" | "red" | "amber" | "calm" | "no_deadline" | "none"; daysLeft: number | null; label: string };
};
export type ComplaintsAnswer = { complaints: Complaint[] };
export type ComplaintEvent = { at: string; by: string | null; action: string; fields: string[] };
export type ComplaintAnswer = { complaint: Complaint; team?: { id: string; name: string; role: string }[]; carrierName?: string | null; history?: ComplaintEvent[] };

/** GET /api/app/appointment-vault (lib/appointments/service.ts AppointmentVault). */
export type Vault = {
  carriers: { id: string; name: string }[];
  appointments: { id: string; carrier_id: string; state: string; status: "pending" | "active" | "terminated"; effective_from: string; expires_at?: string | null }[];
  licenses: { id: string; state: string; expires_at: string; licence_type?: "resident" | "non_resident" | null }[];
  /** ?mine=1 (added for the phone, 2026-11-27): the signed-in person's own licensed states. */
  mine?: { state: string; expiresOn: string | null }[] | null;
};

/** GET /api/app/partners (lib/partners/service.ts PartnerRow + the directory). */
export type PartnerTerm = { payout_model: string; rate_cents: number | null; rate_pct_bp: number | null; effective_from: string };
export type Partner = {
  id: string; name: string; partner_type: string; status: string; created_at: string; active_term: PartnerTerm | null;
  lead_volume_this_month: number; transfers_this_month: number;
};
/** GET /api/app/partners/[id] (added for the phone, 2026-11-27): owed and due, the deal in force, the chat. */
export type PartnerDetail = { owedCents: number | null; dueOn: string | null; term: PartnerTerm | null; threadId: string | null };

export type PartnersAnswer = {
  partners: Partner[];
  directoryUsers: { user_id: string; name: string | null; email: string | null; role: "partner_admin" | "partner_user"; status: string; partner_id: string }[];
};
