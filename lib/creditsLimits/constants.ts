// Client-safe names shared by the Credits & Limits admin screen and its server routes.

export const CREDIT_METER_KEYS = [
  "tcpa_checks",
  "dnc_lookups",
  "dialer_minutes",
  "sms_segments",
  "statement_pages",
  "esign_envelopes",
] as const;

export type CreditMeterKey = (typeof CREDIT_METER_KEYS)[number];

export const CREDIT_METER_LABELS: Record<CreditMeterKey, string> = {
  tcpa_checks: "TCPA checks",
  dnc_lookups: "DNC lookups",
  dialer_minutes: "Dialer minutes",
  sms_segments: "SMS segments",
  statement_pages: "Statement pages",
  esign_envelopes: "E-sign envelopes",
};

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
  updated_at: string;
};

export type UsageMonitorRow = {
  tenant_id: string;
  tenant_name: string;
  tenant_status: string;
  meter_key: CreditMeterKey;
  meter_label: string;
  unit: string;
  used_qty: number;
  included_qty: number | null;
  grant_qty: number;
  plan_included_qty: number | null;
  hard_cap: boolean;
  percent_used: number | null;
  alert_level: "ok" | "warning" | "exhausted";
  period_start: string | null;
};

export type CreditTenant = { id: string; name: string; status: string };
