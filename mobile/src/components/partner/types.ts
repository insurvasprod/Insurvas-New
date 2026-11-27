/**
 * The partner app's answers, exactly as the partner portal's own routes (app/api/partner/**) send them.
 * Only the fields the screens read are named; the server sends more.
 */
export type PartnerType = "publisher" | "marketing" | "affiliate";
export type PartnerRole = "partner_admin" | "partner_user";

/** GET /api/partner/me. */
export type PartnerMe = {
  userId: string;
  name: string | null;
  partnerId: string;
  partnerName: string;
  role: PartnerRole;
  partnerType: PartnerType;
  partnerStatus: "draft" | "active" | "paused" | "offboarded";
  hasTeam: boolean;
  agencyName: string | null;
};

/** One row of GET /api/partner/leads/pipeline (lib/partnerLeads/types.ts PartnerLeadRow). */
export type PartnerLeadRow = {
  id: string;
  workItemId: string;
  customer: string;
  submittedAt: string;
  updatedAt: string;
  product: string;
  stageId: string;
  stageName: string;
  stageType: string;
  disposition: string | null;
  outcome: string | null;
  submittedBy: { id: string | null; name: string };
  status: string;
  lane?: "new" | "claimed" | "verification" | "converted" | "closed";
  /** With ?live=1 (board K1, K3): the claimer's first name, when it was claimed, and the next open callback. */
  live?: LiveFact;
};

/** The partner-safe live line (lib/partnerLeads/phoneFactsCore.ts): a first name and two moments, nothing more. */
export type LiveFact = { claimedBy: string | null; claimedAt: string | null; callbackAt: string | null };

export type PartnerStage = { id: string; pipelineId: string; name: string; position: number; stageType: string; isArchived: boolean; leadCount: number };

export type PipelineAnswer = {
  rows: PartnerLeadRow[];
  stages: PartnerStage[];
  total: number;
  nextOffset: number | null;
};

/** GET /api/partner/leads/[id]: the row plus its history in the partner's words (never internal notes). */
export type PartnerLeadDetail = PartnerLeadRow & {
  notes: { at: string; body: string }[];
  timeline: { type: string; label: string; at: string; detail?: string | null }[];
  /** The submission's own answers (SSN, banking and policy numbers masked by the server). */
  values?: Record<string, unknown>;
  /** With ?phone=1 (board K2b, K3b). */
  live?: LiveFact | null;
  attempts?: { count: number; firstAt: string; lastAt: string } | null;
  agentsReady?: number | null;
};

/** GET /api/partner/payouts (partner admins): published and paid statements, newest first. */
export type PayoutRun = { id: string; periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null; invoiceNumber: string | null };
/** GET /api/partner/payouts?phone=1 (board K1, K4): the statements and the payout facts beside them. */
export type BreakdownLine = { itemType: string; count: number; rateCents: number };
export type PayoutFacts = { method: string | null; expectedOn: Record<string, string>; next: { runId: string; lines: BreakdownLine[]; revenueShareCents: number | null } | null };
export type PayoutsAnswer = { runs: PayoutRun[]; payout?: PayoutFacts };

/** GET /api/partner/links (affiliates). referrals is -1 when it could not be counted. */
export type PartnerLink = { id: string; slug: string; campaign: string | null; isActive: boolean; clicks: number; referrals: number; createdAt: string };

/** GET /api/partner/users (partner admins). */
export type PartnerUser = { id: string; user_id: string; name: string; email: string; role: PartnerRole; status: "active" | "revoked"; invited_at: string; accepted_at: string | null; last_login_at: string | null };
/** GET /api/partner/users?phone=1 (board K6): each member's leads sent this month, by user id. */
export type UsersAnswer = { users: PartnerUser[]; sentThisMonth?: Record<string, number> };

/** GET /api/partner/notifications: the person's alert settings (lib/partnerAlerts/presentation.ts). */
export type PartnerAlertEvent = "partner_message" | "lead_status_changed" | "partner_account_changed" | "team_access_changed";
export type PartnerAlertSettings = { enabled_events: Record<PartnerAlertEvent, boolean>; do_not_disturb: boolean; sound_muted: boolean; sound_volume: number; sound_opted_in_at: string | null };

/** GET /api/partner/products. */
export type PartnerProduct = { code: string; name: string; approved?: boolean };

/** A field of the agency's partner template (lib/templates/constants.ts TemplateField). */
export type TemplateField = {
  field_key: string;
  label: string;
  type: "text" | "long_text" | "number" | "date" | "currency" | "phone" | "email" | "ssn" | "bank_routing" | "bank_account" | "boolean" | "single_select" | "multi_select";
  is_required: boolean;
  options: string[];
  sort_order: number;
  help_text?: string | null;
};
/** GET /api/partner/forms/[productCode]. */
export type FormAnswer = { template: { template: { fields: TemplateField[] } } };

/** A chat message on either side (lib/partnerChat/cards.ts PartnerMessage). */
export type ChatMessage = {
  id: string;
  channelId: string;
  workItemId: string | null;
  message: string;
  messageKind: "text" | "system_card";
  cardType: string | null;
  cardPayload: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number; downloadUrl: string | null }[];
};
export type ChatChannel = { id: string; name: string; channel_type: "partner" | "direct" | "group"; status: "active" | "archived"; partner_id?: string | null };
export type ChatEntry = { channel: ChatChannel; messages: ChatMessage[]; unreadCount: number; othersReadAt?: string | null; state?: { archivedAt: string | null } };
type Person = { user_id: string; users: { name: string | null; email: string | null } | null };
export type Directory = { tenantUsers?: Person[]; partnerUsers?: Person[] };

/** GET /api/partner/chat: the partner's own channel and groups, and who wrote. */
export type PartnerChatAnswer = { channels: ChatEntry[]; directory: Directory; viewerId: string; agencyName: string | null };
/** GET /api/app/partner-chat?with=leads: the agent's conversations, and the lead behind each card. */
export type AgentChatAnswer = { channels: ChatEntry[]; directory: Directory; viewerId: string; leadIds?: Record<string, string> };
