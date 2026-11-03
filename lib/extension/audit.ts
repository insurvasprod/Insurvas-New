import "server-only";

import type { AuditAction } from "@/lib/audit/actions";
import { audit } from "@/lib/audit/log";

/**
 * The audit actions LA-3.12 / 3.13 write. They belong in lib/audit/actions.ts (a shared file this
 * build may not edit); until they are added there, this is the one place that widens the type. Once
 * they are in AUDIT_ACTIONS the cast below is a no-op and can go.
 */
export const EXTENSION_AUDIT_ACTIONS = {
  "tenant.extension_grant_issued": "Browser extension grant opened",
  "tenant.extension_grants_revoked": "Browser extension grants revoked",
  "field_map.created": "Carrier field map draft created",
  "field_map.updated": "Carrier field map edited",
  "field_map.published": "Carrier field map published",
} as const;
export type ExtensionAuditAction = keyof typeof EXTENSION_AUDIT_ACTIONS;

export async function auditExtension(params: {
  actorType: "tenant" | "admin";
  actorId: string;
  action: ExtensionAuditAction;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  request: Request;
}) {
  const action: string = params.action;
  await audit({ ...params, action: action as AuditAction });
}
