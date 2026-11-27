/**
 * The answers the owner, bookkeeper and manager homes, Get set up and the vendor card read, as the web routes send
 * them. Only the fields these screens use are named; the routes send more.
 */
import type { CallbackView } from "@/lib/types";

/** GET /api/app/applications (lib/applications/lists.ts ApplicationRow): every application the reader may see. */
export type AppRow = {
  applicationId: string;
  caseId: string;
  status: string;
  outcome: string | null;
  monthlyPremiumCents: number | null;
  submittedAt?: string | null;
  closedAt?: string | null;
  updatedAt: string;
};
export type ApplicationsAnswer = { applications: AppRow[] };

/** GET /api/app/agency/dashboard (lib/agency/dashboardStore.ts AgencyDashboard): one row per visible producer. */
export type ProducerScore = {
  producerUserId: string;
  producerId: string | null;
  name: string;
  submitted: number;
  issued: number;
  placement: string;
  chargebackCents: number;
};
export type HealthAlert = { producerUserId: string; name: string; item: string; detail: string; expiresOn: string; daysLeft: number };
export type AgencyAnswer = { period: { from: string; to: string }; producers: ProducerScore[]; alerts: HealthAlert[] };

/** GET /api/app/accounting/steps?items=1 (lib/accounting/todoCore.ts TodoItem). */
export type TodoGroup = "bank" | "bills" | "expenses" | "payouts" | "tax";
export type TodoItem = {
  key: string;
  group: TodoGroup;
  what: string;
  detail: string;
  amountCents: number | null;
  tone?: "bad";
  since: string | null;
  yours: boolean;
  href: string;
};
export type TodoAnswer = { counts: { todo: number }; items?: TodoItem[]; failed?: TodoGroup[] };

/** GET /api/app/compliance/complaints (lib/compliance/complaintStore.ts ComplaintRow, the fields read here). */
export type Complaint = {
  id: string;
  status: string;
  respondedAt: string | null;
  resolvedAt: string | null;
  countdown: { tone: string; daysLeft: number | null; label: string };
};
export type ComplaintsAnswer = { complaints: Complaint[] };

/** GET /api/app/needs-you/item with no item: the Needs you list, cut in what the phone decides and the rest. */
export type NeedsYouAnswer = { ok: true; total: number; phone: { total: number }; computer: { total: number } };

/** GET /api/app/discrepancies: `owed` is the Pay issues total. */
export type DiscrepanciesAnswer = { ok: true; available: boolean; owed: { available: boolean; totalCents: number; count: number } };

/** GET /api/app/carrier-files?missing=1 (lib/ingestion/fileOutcomeStore.ts loadMissingFiles). */
export type MissingFile = { id: string; carrierId: string; carrierName: string; due: string; daysLate: number };
export type MissingAnswer = { ok: true; available: boolean; missing: MissingFile[] };

/** GET /api/app/agent-floor (lib/agentFloor/service.ts getAgentFloor), the parts a manager's home reads. */
export type FloorMember = {
  id: string;
  name: string;
  role: string;
  availability: "ready" | "on_break" | "off" | "offline" | "on_call";
  away: boolean;
  lastSeenAt: string | null;
  statusChangedAt: string | null;
  call: { workItemId: string; leadId: string; customer: string; partnerName: string | null; startedAt: string } | null;
  lastCall: { customer: string; endedAt: string } | null;
};
export type FloorAnswer = {
  waiting: { id: string; customer: string; queuedAt: string }[];
  members: FloorMember[];
  callbacks: CallbackView[];
  generatedAt: string;
};

/** GET /api/app/setup (app/api/app/setup/route.ts): the reader's own guided setup. */
export type SetupStep = {
  key: string;
  label: string;
  path: string;
  action: string;
  why: string;
  minutes?: number;
  complete: boolean;
  skipped?: boolean;
  optional?: boolean;
};
export type SetupAnswer = {
  audience: "owner" | "member";
  checklist: { complete: boolean; completed: number; skipped: number; total: number; steps: SetupStep[] };
  next: { key: string; label: string; href: string } | null;
};

/** GET /api/app/true-cpa (lib/vendorScorecard/types.ts VendorScorecardReport), filtered to one vendor. */
export type ScoreCampaign = {
  campaign_id: string;
  vendor_id: string;
  campaign_name: string;
  is_test_batch?: boolean;
  leads_received: number;
  issued_policies: number;
  cost_per_record_cents: number | null;
  effective_cost_per_issued_policy_cents: number | null;
  contact_rate_percent: number | null;
  cost_rank: number | null;
};
export type ScoreVendor = {
  vendor_id: string;
  vendor_name: string;
  campaigns: number;
  leads_received: number;
  contacted_leads: number;
  issued_policies: number;
  cost_per_record_cents: number | null;
  effective_cost_per_issued_policy_cents: number | null;
  contact_rate_percent: number | null;
};
export type TrueCpaAnswer = { from: string; to: string; rows: ScoreCampaign[]; vendor_rows: ScoreVendor[] };

/** GET /api/app/vendors: the vendor's own record (its name and who to write to). */
export type VendorRecord = { id: string; name: string; contact: { name?: string; email?: string; phone?: string } | null };
export type VendorsAnswer = { vendors: VendorRecord[] };
