import "server-only";

import type { AuditAction } from "@/lib/audit/actions";
import { audit } from "@/lib/audit/log";
import type { Actor } from "@/lib/applications/http";

/**
 * LA-3.17 · every Settings › Sales change (templates, carrier facts, products, portal accounts)
 * writes one audit row carrying the value before and the value after.
 */
export const SALES_SETTINGS_AUDIT_ACTIONS = {
  "tenant.sales_template_created": "Sales template created",
  "tenant.sales_template_updated": "Sales template draft edited",
  "tenant.sales_template_version_created": "Sales template new version drafted",
  "tenant.sales_template_copied": "Sales template copied",
  "tenant.sales_template_published": "Sales template published",
  "tenant.sales_template_retired": "Sales template retired",
  "tenant.carrier_settings_saved": "Carrier portal, reference pattern or descriptor changed",
  "tenant.carrier_product_created": "Carrier product added",
  "tenant.carrier_product_updated": "Carrier product changed",
  "tenant.carrier_product_copied": "Platform carrier product copied to the agency",
  "tenant.carrier_portal_account_saved": "Carrier portal account saved",
  "tenant.carrier_portal_account_verified": "Carrier portal account marked verified",
} as const satisfies Partial<Record<AuditAction, string>>;

export type SalesSettingsAuditAction = keyof typeof SALES_SETTINGS_AUDIT_ACTIONS;

export async function auditSalesSetting(
  actor: Actor,
  action: SalesSettingsAuditAction,
  target: { type: string; id: string },
  change: { before: unknown; after: unknown },
  extra: Record<string, unknown> = {},
) {
  await audit({
    actorType: "tenant",
    actorId: actor.userId,
    action,
    targetType: target.type,
    targetId: target.id,
    metadata: { ...extra, before: change.before ?? null, after: change.after ?? null },
    request: actor.request,
  });
}
