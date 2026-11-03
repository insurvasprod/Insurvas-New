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
  /** Plan versions that currently offer this add-on. */
  plan_ids: string[];
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

/**
 * The refusal when price or billing cycle changes on an add-on the billing run still invoices. Shared
 * by the API (before and after 20260924352000 is applied) and the dialog.
 */
export const ADDON_PRICE_LOCKED_MESSAGE =
  "This add-on is attached to live subscriptions, so its price and billing cycle are locked. Archive it and create a new code to change them.";

export const ADDON_GRANTS_LOCKED_MESSAGE =
  "This add-on is attached to live subscriptions, so its feature and meter grants are locked. Archive it and create a new code to change them.";

export const ADDON_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ADDON_CODE_RULE = "Lowercase letters, digits and underscores only, starting with a letter";
