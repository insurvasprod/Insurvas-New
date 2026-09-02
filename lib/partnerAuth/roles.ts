export const PARTNER_ROLES = ["partner_admin", "partner_user"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export function isPartnerRole(value: string): value is PartnerRole {
  return (PARTNER_ROLES as readonly string[]).includes(value);
}
