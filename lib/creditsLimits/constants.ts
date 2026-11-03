// Client-safe names shared by the Credits & Limits admin screen and its server routes.

/**
 * The meters staff can grant credits on and sell packs for.
 *
 * `monthly_leads_imported` and `consent_cert_claims` joined on 2026-09-24 (user decision). Both are
 * enforced by lib/metering/outbound.ts assertOutboundLimit: the cached entitlement's `included` (which
 * carries the period's grants, 20260924344000) and then check_meter_capacity (which adds grants in
 * SQL), so a grant on either really raises the allowance on both checks.
 */
export const CREDIT_METER_KEYS = [
  "tcpa_checks",
  "dnc_lookups",
  "dialer_minutes",
  "sms_segments",
  "statement_pages",
  "esign_envelopes",
  "monthly_leads_imported",
  "consent_cert_claims",
] as const;

export type CreditMeterKey = (typeof CREDIT_METER_KEYS)[number];

export const CREDIT_METER_LABELS: Record<CreditMeterKey, string> = {
  tcpa_checks: "TCPA checks",
  dnc_lookups: "DNC lookups",
  dialer_minutes: "Dialer minutes",
  sms_segments: "SMS segments",
  statement_pages: "Statement pages",
  esign_envelopes: "E-sign envelopes",
  monthly_leads_imported: "Leads imported",
  consent_cert_claims: "Consent certificate claims",
};

export function isCreditMeterKey(value: string): value is CreditMeterKey {
  return (CREDIT_METER_KEYS as readonly string[]).includes(value);
}

export type CreditPack = {
  id: string;
  name: string;
  meter_key: CreditMeterKey;
  quantity: number;
  price_cents: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MeterPricing = {
  meter_key: CreditMeterKey;
  cost_cents: number;
  sell_cents: number;
  default_included: number | null;
  cost_source: "compliance_vendor" | "configured";
  updated_at: string | null;
};

/**
 * One tenant × meter row of the usage monitor, as `admin_usage_monitor_json` returns it.
 *
 * `alert_level` follows the board's rule since 20260924360000: `over` is strictly past the limit,
 * `warning` is at or above the warn threshold (usage.warn_percent) INCLUDING exactly at the limit,
 * `ok` is below it. Rows with no finite limit are not returned. `exhausted` is the pre-migration
 * spelling (used >= limit) and is read as over-or-at by `limitState`, which recomputes from the numbers.
 */
export type UsageMonitorRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_status: string;
  meter_key: string;
  meter_label: string;
  unit: string;
  used_qty: number;
  included_qty: number | null;
  grant_qty: number;
  /** Add-on credits in `included_qty`. Absent from the pre-migration function. */
  addon_qty?: number;
  plan_included_qty: number | null;
  hard_cap: boolean;
  percent_used: number | null;
  alert_level: "ok" | "warning" | "over" | "exhausted";
  period_start: string | null;
};

/** Seats held against the plan's seat limit, for tenants whose plan has a finite one. */
export type SeatMonitorRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_status: string;
  used_qty: number;
  included_qty: number;
};

export type CreditTenant = { id: string; name: string; status: string };

/** One plan column of the Default limits table: the latest non-archived version of a plan code. */
export type DefaultLimitPlan = { id: string; code: string; name: string; version: number };

/**
 * One row of the Default limits table. `values` is keyed by plan id; null is Unlimited, 0 is none.
 * `source` says where a meter value came from, so "platform default" can be told from "the plan".
 */
export type DefaultLimitRow = {
  key: string;
  label: string;
  values: Record<string, { value: number | null; source: "plan" | "platform_default" }>;
};

export type DefaultLimits = { plans: DefaultLimitPlan[]; rows: DefaultLimitRow[] };

export type CreditsLimitsData = {
  packs: CreditPack[];
  pricing: MeterPricing[];
  monitor: UsageMonitorRow[];
  seats: SeatMonitorRow[];
  defaultLimits: DefaultLimits;
  tenants: CreditTenant[];
  /** usage.warn_percent, 1–99. */
  warnPercent: number;
};
