import "server-only";

import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";

/**
 * The audit actions the after-submit services write (LA-3.15, 3.18, 3.20, 3.24, 3.26), each one
 * registered in lib/audit/actions.ts (the `satisfies` below fails the type-check if one is not).
 */
export const AFTER_SUBMIT_AUDIT_ACTIONS = {
  "tenant.application_confirmation_attached": "Submission confirmation attached",
  "tenant.application_requirement_added": "Carrier requirement added",
  "tenant.application_requirement_updated": "Carrier requirement updated",
  "tenant.application_requirement_chased": "Carrier requirement chased",
  "tenant.application_counteroffer_recorded": "Carrier counteroffer recorded",
  "tenant.application_counteroffer_answered": "Counteroffer accepted, refused or expired",
  "tenant.application_welcome_pack_sent": "Welcome pack generated or sent",
  "tenant.application_spouse_added": "Spouse application linked to the household",
  "tenant.application_household_detached": "Shared household value detached",
} as const;

export type AfterSubmitAuditAction = keyof typeof AFTER_SUBMIT_AUDIT_ACTIONS;

export async function auditAfterSubmit(params: {
  actorId: string | null;
  action: AfterSubmitAuditAction;
  targetId: string;
  metadata?: Record<string, unknown>;
  request: Request;
}) {
  await audit({
    actorType: params.actorId ? "tenant" : "system",
    actorId: params.actorId,
    action: params.action satisfies AuditAction,
    targetType: "tenant_application",
    targetId: params.targetId,
    metadata: params.metadata,
    request: params.request,
  });
}
