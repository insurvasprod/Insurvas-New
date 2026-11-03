import type { PartnerType } from "./constants";

export const PARTNER_LIMIT_KEYS = {
  publisher: "max_publishers",
  marketing: "max_marketing_partners",
  affiliate: "max_affiliates",
} as const;

export type PartnerLimitKey = (typeof PARTNER_LIMIT_KEYS)[PartnerType];

export function partnerLimitKey(type: PartnerType): PartnerLimitKey {
  return PARTNER_LIMIT_KEYS[type];
}

export function capacityLabel(used: number, limit: number | null | undefined, noun: string): string {
  return limit == null ? `${used} ${noun} · unlimited` : `${used} of ${limit} ${noun}`;
}
