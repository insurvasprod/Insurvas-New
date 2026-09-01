/**
 * The agent API surface and its authorization contract.
 *
 * This is deliberately about routes that exist today, not one placeholder endpoint per future
 * module. A feature with no agent API yet belongs to that module's ticket; an API that does exist
 * must name the entitlement it enforces here and call requireFeature for that key.
 */
export type AgentApiPolicy = {
  sourceFile: string;
  featureKey: string | null;
  allowedRoles?: readonly string[];
};

export const AGENT_API_POLICIES: AgentApiPolicy[] = [
  { sourceFile: "app/api/app/announcements/[id]/dismiss/route.ts", featureKey: null },
  { sourceFile: "app/api/app/announcements/route.ts", featureKey: null },
  { sourceFile: "app/api/app/auth/confirm-email/route.ts", featureKey: null },
  { sourceFile: "app/api/app/auth/login/route.ts", featureKey: null },
  { sourceFile: "app/api/app/auth/logout/route.ts", featureKey: null },
  { sourceFile: "app/api/app/auth/set-password/route.ts", featureKey: null },
  { sourceFile: "app/api/app/checkout/coupon/route.ts", featureKey: null },
  { sourceFile: "app/api/app/checkout/start/route.ts", featureKey: null },
  { sourceFile: "app/api/app/carrier-library/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/carrier-library/tenant-carriers/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/carrier-library/commission-schedules/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/carrier-library/advance-rules/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/appointment-vault/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/appointment-vault/appointments/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/appointment-vault/licenses/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/appointment-vault/eo-policies/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/appointment-vault/ce-records/route.ts", featureKey: "appointment_vault", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/contacts/route.ts", featureKey: "duplicate_detection", allowedRoles: ["owner", "producer", "assistant"] },
  { sourceFile: "app/api/app/contacts/export/route.ts", featureKey: "duplicate_detection", allowedRoles: ["owner", "producer", "assistant"] },
  { sourceFile: "app/api/app/contacts/field-schema/route.ts", featureKey: "duplicate_detection", allowedRoles: ["owner", "producer", "assistant"] },
  { sourceFile: "app/api/app/contacts/import/route.ts", featureKey: "duplicate_detection", allowedRoles: ["owner", "producer", "assistant"] },
  { sourceFile: "app/api/app/contacts/merge/route.ts", featureKey: "duplicate_detection", allowedRoles: ["owner", "producer", "assistant"] },
  { sourceFile: "app/api/app/contacts/merge/undo/route.ts", featureKey: "duplicate_detection", allowedRoles: ["owner", "producer", "assistant"] },
  { sourceFile: "app/api/app/dial/preflight/route.ts", featureKey: "outbound_dialing" },
  { sourceFile: "app/api/app/ledger/route.ts", featureKey: "commission_ledger", allowedRoles: ["owner", "producer", "bookkeeper"] },
  { sourceFile: "app/api/app/inbound/transfer/route.ts", featureKey: "inbound_transfers" },
  { sourceFile: "app/api/app/inbound/route.ts", featureKey: "inbound_transfers", allowedRoles: ["owner", "producer"] },
  { sourceFile: "app/api/app/inbound/claim/route.ts", featureKey: "inbound_transfers", allowedRoles: ["owner", "producer"] },
  { sourceFile: "app/api/app/inbound/verification/route.ts", featureKey: "inbound_transfers", allowedRoles: ["owner", "producer"] },
  { sourceFile: "app/api/app/leads/[id]/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/leads/[id]/disposition/route.ts", featureKey: "book_of_business", allowedRoles: ["owner", "producer"] },
  { sourceFile: "app/api/app/leads/export/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/leads/draft/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/leads/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/legal/accept/route.ts", featureKey: null },
  { sourceFile: "app/api/app/me/route.ts", featureKey: null },
  { sourceFile: "app/api/app/partners/route.ts", featureKey: "publisher_records", allowedRoles: ["owner", "bookkeeper"] },
  { sourceFile: "app/api/app/partners/[id]/route.ts", featureKey: "publisher_records", allowedRoles: ["owner", "bookkeeper"] },
  { sourceFile: "app/api/app/partners/[id]/users/route.ts", featureKey: "publisher_records", allowedRoles: ["owner", "bookkeeper"] },
  { sourceFile: "app/api/app/partners/[id]/users/[userId]/route.ts", featureKey: "publisher_records", allowedRoles: ["owner", "bookkeeper"] },
  { sourceFile: "app/api/app/partners/[id]/users/[userId]/resend-invite/route.ts", featureKey: "publisher_records", allowedRoles: ["owner", "bookkeeper"] },
  { sourceFile: "app/api/app/partners/[id]/affiliate-links/route.ts", featureKey: "publisher_records", allowedRoles: ["owner", "bookkeeper"] },
  { sourceFile: "app/api/app/partners/[id]/affiliate-links/[linkId]/route.ts", featureKey: "publisher_records", allowedRoles: ["owner", "bookkeeper"] },
  { sourceFile: "app/api/app/products/route.ts", featureKey: "publisher_records", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/products/[code]/route.ts", featureKey: "publisher_records", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/partners/[id]/products/route.ts", featureKey: "publisher_records", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/onboarding/business-profile/route.ts", featureKey: null },
  { sourceFile: "app/api/app/onboarding/status/route.ts", featureKey: null },
  { sourceFile: "app/api/app/onboarding/verification/route.ts", featureKey: null },
  { sourceFile: "app/api/app/pipelines/route.ts", featureKey: "book_of_business", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/pipelines/[id]/route.ts", featureKey: "book_of_business", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/pipelines/[id]/stages/route.ts", featureKey: "book_of_business", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/pipelines/[id]/stages/reorder/route.ts", featureKey: "book_of_business", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/pipelines/[id]/stages/[stageId]/route.ts", featureKey: "book_of_business", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/pipelines/dispositions/route.ts", featureKey: "book_of_business", allowedRoles: ["owner"] },
  { sourceFile: "app/api/app/policies/lapse-risk/route.ts", featureKey: "chargeback_radar" },
  { sourceFile: "app/api/app/policies/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/signup/route.ts", featureKey: null },
  { sourceFile: "app/api/app/templates/[id]/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/templates/assignment/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/templates/preview/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/templates/route.ts", featureKey: "book_of_business" },
  { sourceFile: "app/api/app/team/[userId]/route.ts", featureKey: null },
  { sourceFile: "app/api/app/team/route.ts", featureKey: null },
];
