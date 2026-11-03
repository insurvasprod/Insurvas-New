export const PARTNER_ROLES = ["partner_admin", "partner_user"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export function isPartnerRole(value: string): value is PartnerRole {
  return (PARTNER_ROLES as readonly string[]).includes(value);
}

const PARTNER_ROLE_LABELS: Record<PartnerRole, string> = { partner_admin: "Partner admin", partner_user: "Partner user" };

/** The role as people read it ("Partner admin"), never the stored enum. */
export function partnerRoleLabel(role: PartnerRole): string {
  return PARTNER_ROLE_LABELS[role];
}
