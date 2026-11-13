// Settings › Plan & billing (Settings round 8, option A) · the shapes /api/app/billing returns, and the
// few formatting helpers every part of the page shares. Client-safe. No arithmetic on money here or in
// any part of the page: every figure comes from the route (LA-8.5's rule, selfService.test.mjs).

import { dayMonth, dayMonthYear } from "@/lib/format/dates";
import type { BillingCycle } from "@/lib/money";
import type { DunningView, SelfServeActions, UsageTier } from "@/lib/billing/selfServiceRules";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";

export type Limit = { key: string; label: string; used: number; limit: number; tier: UsageTier; metered: boolean; resetsAt: string | null; hardCap: boolean };
export type Invoice = { id: string; number: string; status: string; totalCents: number; periodStart: string | null; periodEnd: string | null; issuedAt: string | null; dueAt: string | null; paidAt: string | null; payOnlineUrl: string | null };
export type PlanOption = { id: string; name: string; priceCents: number; applyNow: boolean };
export type ComparePlan = { id: string; name: string; description: string | null; limits: Record<string, number | null>; features: string[] };
export type Subscription = { id: string; status: SubscriptionStatus; statusLabel: string; cycle: BillingCycle; periodStart: string | null; periodEnd: string | null; renewsAt: string | null; trialEndsAt: string | null; pendingPlanName: string | null; cancelledAt: string | null };
export type Plan = { id: string; name: string; priceCents: number | null; features: { key: string; label: string }[]; addons: { name: string; priceCents: number; cycle: BillingCycle }[] };

export type View = {
  schemaReady: boolean;
  subscription: Subscription | null;
  plan: Plan | null;
  limits: Limit[];
  warnPercent: number;
  invoices: Invoice[];
  dunning: DunningView;
  retention: { days: number; endsAt: string | null };
  actions: SelfServeActions | null;
  cardOnFile: boolean;
  planChangeBySupport: boolean;
  options: PlanOption[];
  /** Older routes did not send it. */
  compare?: { plans: ComparePlan[]; featureLabels: Record<string, string> };
};

export type Impact = {
  plan: { id: string; name: string };
  preview: { currentPriceCents: number | null; newPriceCents: number | null; applyNow: boolean; proration: { netCents: number; remainingDays: number } | null } | null;
  effectiveAt: string | null;
  featuresLost: { key: string; label: string; records: string | null }[];
  limitsOver: { key: string; label: string; used: number; newLimit: number }[];
};

export type InvoiceDoc = {
  id: string;
  number: string;
  status: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  billedTo: string;
  billedAddress: string | null;
  lines: { id: string; label: string; kind: string; quantity: number; amountCents: number }[];
};

/** "3 Dec 2026"; "—" without a date. */
export const day = (iso: string | null | undefined) => (iso ? dayMonthYear(iso) : "—");
/** "3 Dec"; "—" without a date. */
export const short = (iso: string | null | undefined) => (iso ? dayMonth(iso) : "—");
export const n = (value: number) => value.toLocaleString("en-US");
/** A whole percentage of a limit, for the meter's chip and the status line. */
export const pct = (l: Pick<Limit, "used" | "limit">) => (l.limit > 0 ? Math.round((l.used / l.limit) * 100) : 100);

export const INVOICE_LABEL: Record<string, string> = { paid: "Paid", issued: "Due", overdue: "Overdue", uncollectible: "Uncollectible", void: "Void" };

/** A fresh key per request: the route replays a repeated one instead of changing the plan twice. */
export const idempotencyKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const SUPPORT_EMAIL = "support@insurvas.com";
/** "Ask support to move me": the one way a card-billed agency changes plan (selfChangePlan refuses it). */
export const askSupportHref = (from: string, to: string) =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Move my plan to ${to}`)}&body=${encodeURIComponent(`Please move our workspace from ${from} to ${to}.`)}`;

/** Where a cancelling or cancelled agency takes its records (lib/billing/bookExport.ts). */
export const EXPORTS = [
  { part: "policies", label: "Your book", sub: "Policies · CSV" },
  { part: "commissions", label: "Commission history", sub: "Statement lines · CSV" },
] as const;
export const exportHref = (part: string) => `/api/app/billing/export?part=${part}`;
