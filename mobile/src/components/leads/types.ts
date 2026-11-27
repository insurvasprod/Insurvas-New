import type { LeadWorkspace } from "@/lib/types";

import type { FormTemplate, ReadinessItem, VerificationField } from "./logic";

/**
 * The parts of GET /api/app/leads/:id the lead screens read beyond lib/types.ts `LeadWorkspace`
 * (traced from lib/leadWorkspace/service.ts getLeadWorkspace and lib/leadWorkspace/lineage.ts).
 */
export type Lineage = { vendorName: string | null; campaignName: string | null; sourceType: string | null; costCents: number | null; costAt: string | null } | null;
export type NextAction = { kind: "callback"; at: string; timezone: string } | { kind: "dial"; at: string } | null;
export type Screening = { outcome: string | null; warning: string | null; checkedAt: string | null } | null;
export type PreflightMatch = { leadId: string | null; contactId?: string | null; submittedAt?: string | null; partnerName: string | null; productLine?: string | null; outcome: string | null; matchedOn?: string[]; sourceType?: "lead" | "contact" };
export type Preflight = { status: string | null; checkedAt?: string | null; matches?: PreflightMatch[] };

export type FullWorkspace = LeadWorkspace & {
  lineage?: Lineage;
  nextAction: NextAction;
  screening?: Screening;
  lead: LeadWorkspace["lead"] & { stage_entered_at?: string | null };
  template?: FormTemplate;
  queue: { id: string; status: string; owner_user_id: string | null; disposition?: string | null } | null;
  submitter?: { id: string; name: string } | null;
  role?: string;
  currentUserId?: string;
  licensedAgents?: { id: string; name: string; role: string }[];
  verification?: { session: { status: string; progress_percentage: number; started_at: string; completed_at: string | null }; fields: VerificationField[] } | null;
  quotedMonthlyCents?: number | null;
  preflight?: Preflight;
  transfer?: { buffer: { id: string; name: string; onCall: boolean } | null } | null;
  /** GET /api/app/leads/:id, 2026-11-26 (absent from an older server): what an application still needs, who verified, agents' licensed states. */
  readiness?: ReadinessItem[] | null;
  verifierName?: string | null;
  licensedStates?: Record<string, string[]>;
  actions: LeadWorkspace["actions"] & { canRequeue?: boolean; canUnassign?: boolean; canEndBufferInvolvement?: boolean; canAcceptHandoff?: boolean };
};

/** A row of GET /api/app/leads, with the facts the route adds (owner, stage entry). */
export type BoardLead = {
  id: string; product_line: string | null; pipeline_id: string | null; stage_id: string | null; values: Record<string, unknown>;
  partner_name: string | null; owner_name: string | null; owner_user_id?: string | null; disposition: string | null;
  stage_entered_at?: string | null; created_at: string; updated_at: string;
  /** The first source row's vendor and kind (GET /api/app/leads, 2026-11-25); absent from an older server. */
  source_name?: string | null; source_type?: string | null;
  /** The quoted premium (money roles only), the soonest open callback, the screening and, with ?callable=1, the calling-window answer (2026-11-26). */
  monthly_premium_cents?: number | null;
  callback_at?: string | null; callback_timezone?: string | null;
  screening_outcome?: string | null; screening_warning?: boolean;
  callable_now?: boolean | null;
};
