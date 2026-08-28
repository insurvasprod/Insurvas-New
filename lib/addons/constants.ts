// Client-safe: no `server-only` import.

import type { BillingCycle } from "@/lib/money";

export type AddonRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  billing_cycle: BillingCycle;
  is_active: boolean;
  sort_order: number;
  feature_keys: string[];
  meters: { meter_key: string; included_qty: number }[];
};

export type AttachedAddon = {
  id: string;
  addon_id: string;
  code: string;
  name: string;
  price_cents: number;
  billing_cycle: BillingCycle;
  attached_at: string;
  availability_overridden: boolean;
};

export const ADDON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ADDON_CODE_RULE = "Lowercase letters, digits and underscores only, starting with a letter";
