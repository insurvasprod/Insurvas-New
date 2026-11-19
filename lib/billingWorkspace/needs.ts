// Admin › Billing workspace (admin round 1, docs/design/admin-r1/billing-r2.html screen 1): what waits on an
// admin, worst first, each row opening its page already filtered, and the rail's badge counts. Plain module — no
// database, no `server-only` — so which row says what, which role sees it and how the badges count is tested on
// its own (needs.test.mjs). lib/billingWorkspace/reads.ts reads the inputs.
//
// A read that failed is "Couldn't check", never left out as if all were well, and never counted as a badge.

export type NeedTone = "failing" | "look" | "unknown";

export type NeedRow = {
  key: string;
  title: string;
  detail: string;
  tone: NeedTone;
  href: string;
  /** The rail step this row's badge belongs to, when it has one. */
  step: BillingCountKey | null;
};

/** The rail steps that carry a count (lib/adminBilling/steps.ts BILLING_WAITING). */
export type BillingCountKey = "workspace" | "trials" | "failed" | "invoices" | "refunds" | "reconciliation" | "credits";

/** Every input is null when its read failed. */
export type NeedsInput = {
  now: number;
  billingRun: { healthy: boolean; description: string; lastFinishedAt: string | null } | null;
  stuckWebhooks: { count: number; oldestReceivedAt: string | null } | null;
  pastDue: { count: number; atRiskCents: number | null } | null;
  overdue: { count: number; owedCents: number } | null;
  mismatched: number | null;
  /** Trials in flight with their calendar days left and whether a card is on file. */
  trials: Array<{ daysLeft: number; hasPaymentMethod: boolean }> | null;
  /** Credit notes waiting for approval that THIS admin did not raise (the raiser may not approve). */
  creditNotesToApprove: number | null;
  /** Credit notes waiting that this admin raised: someone else must approve them. */
  creditNotesOwn: number | null;
  /** Customers past a usage limit. */
  overLimit: number | null;
};

/** A payment event unprocessed this long is stuck, not queued (as the daily checks). */
export const WEBHOOK_STUCK_MINUTES = 10;
/** The Trials badge and the "Ending in 3 days" tile: three or fewer calendar days left. */
export const TRIAL_SOON_DAYS = 3;
/** The workspace row and Coming up: the next seven days. */
export const WEEK_DAYS = 7;

/** Where each row opens, filtered. Exported so the pages that read these parameters stay in step. */
export const NEED_HREFS = {
  billingRun: "/admin/invoices",
  webhooks: "/admin/payments",
  pastDue: "/admin/billing/failed-payments",
  overdue: "/admin/invoices?lens=overdue",
  mismatched: "/admin/billing/reconciliation",
  trials: "/admin/trials?ends=week&card=no_card",
  approve: "/admin/credit-notes?lens=approval",
  overLimit: "/admin/credits-limits?show=over",
} as const;

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const COULD_NOT = "Couldn't read this just now";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep 13" (UTC), the board's short date. */
export function monthDay(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** "12 minutes", "5 hours", "64 days". */
export function waitedWords(minutes: number): string {
  if (minutes < 90) return plural(minutes, "minute");
  if (minutes < 48 * 60) return plural(Math.round(minutes / 60), "hour");
  return plural(Math.round(minutes / 1440), "day");
}

/**
 * Every row before the role filter, in the board's order; `needsFor` sorts worst first and drops what the role
 * cannot open. Clear checks are left out: the card lists only what waits on someone.
 */
export function allNeeds(input: NeedsInput): NeedRow[] {
  const rows: NeedRow[] = [];
  const add = (row: NeedRow) => rows.push(row);

  const run = input.billingRun;
  if (run === null) add({ key: "billing-run", title: "Billing run", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.billingRun, step: null });
  else if (!run.healthy) {
    const last = monthDay(run.lastFinishedAt);
    add({ key: "billing-run", title: "Billing run stopped", detail: last ? `Last finished ${last} · invoices aren't being raised` : run.description, tone: "failing", href: NEED_HREFS.billingRun, step: null });
  }

  const hooks = input.stuckWebhooks;
  if (hooks === null) add({ key: "webhooks", title: "Payment events", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.webhooks, step: null });
  else if (hooks.count > 0 && hooks.oldestReceivedAt) {
    const minutes = Math.max(0, Math.round((input.now - new Date(hooks.oldestReceivedAt).getTime()) / 60_000));
    if (minutes >= WEBHOOK_STUCK_MINUTES) {
      add({ key: "webhooks", title: "Payment events stuck", detail: `${n(hooks.count)} waiting, oldest ${waitedWords(minutes)}`, tone: "failing", href: NEED_HREFS.webhooks, step: null });
    }
  }

  const pastDue = input.pastDue;
  if (pastDue === null) add({ key: "past-due", title: "Failed payments", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.pastDue, step: "failed" });
  else if (pastDue.count > 0) {
    add({ key: "past-due", title: "Customers past due", detail: `${plural(pastDue.count, "customer")}${pastDue.atRiskCents ? ` · ${dollars(pastDue.atRiskCents)} at risk` : ""}`, tone: "look", href: NEED_HREFS.pastDue, step: "failed" });
  }

  if (input.mismatched === null) add({ key: "mismatched", title: "Invoices that don't match", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.mismatched, step: "reconciliation" });
  else if (input.mismatched > 0) {
    add({ key: "mismatched", title: "Invoices that don't match", detail: `${n(input.mismatched)} differ from what the provider charged`, tone: "look", href: NEED_HREFS.mismatched, step: "reconciliation" });
  }

  const overdue = input.overdue;
  if (overdue === null) add({ key: "overdue", title: "Overdue invoices", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.overdue, step: "invoices" });
  else if (overdue.count > 0) {
    add({ key: "overdue", title: "Overdue invoices", detail: `${n(overdue.count)} · ${dollars(overdue.owedCents)} owed`, tone: "look", href: NEED_HREFS.overdue, step: "invoices" });
  }

  const trials = input.trials;
  if (trials === null) add({ key: "trials", title: "Trials ending, no card", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.trials, step: "trials" });
  else {
    const noCard = trials.filter((trial) => !trial.hasPaymentMethod && trial.daysLeft <= WEEK_DAYS).length;
    if (noCard > 0) add({ key: "trials", title: "Trials ending, no card", detail: `${n(noCard)} within ${WEEK_DAYS} days`, tone: "look", href: NEED_HREFS.trials, step: "trials" });
  }

  if (input.creditNotesToApprove === null) add({ key: "approve", title: "Credit notes to approve", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.approve, step: "refunds" });
  else if (input.creditNotesToApprove > 0) {
    add({ key: "approve", title: "Credit notes to approve", detail: `${n(input.creditNotesToApprove)} raised by another admin`, tone: "look", href: NEED_HREFS.approve, step: "refunds" });
  }

  if (input.overLimit === null) add({ key: "over-limit", title: "Over a usage limit", detail: COULD_NOT, tone: "unknown", href: NEED_HREFS.overLimit, step: "credits" });
  else if (input.overLimit > 0) {
    add({ key: "over-limit", title: "Over a usage limit", detail: plural(input.overLimit, "customer"), tone: "look", href: NEED_HREFS.overLimit, step: "credits" });
  }

  return rows;
}

const TONE_ORDER: Record<NeedTone, number> = { failing: 0, look: 1, unknown: 2 };

/** The role's rows, worst first; within a tone, the board's order. `canOpen` is the admin menu's own answer. */
export function needsFor(input: NeedsInput, canOpen: (href: string) => boolean): NeedRow[] {
  return allNeeds(input)
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => canOpen(row.href))
    .sort((a, b) => TONE_ORDER[a.row.tone] - TONE_ORDER[b.row.tone] || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * The rail's badges: only what waits on an admin, only for the steps the role may open (`steps`), and a count
 * whose read failed is left out rather than drawn as zero. The workspace counts the rows that need someone.
 */
export function stepCounts(input: NeedsInput, steps: ReadonlySet<string>, rows: readonly NeedRow[]): Partial<Record<BillingCountKey, number>> {
  const counts: Partial<Record<BillingCountKey, number>> = {};
  const put = (key: BillingCountKey, value: number | null) => {
    if (value !== null && steps.has(key)) counts[key] = value;
  };
  put("workspace", rows.filter((row) => row.tone !== "unknown").length);
  put("trials", input.trials === null ? null : input.trials.filter((trial) => !trial.hasPaymentMethod && trial.daysLeft <= TRIAL_SOON_DAYS).length);
  put("failed", input.pastDue === null ? null : input.pastDue.count);
  put("invoices", input.overdue === null ? null : input.overdue.count);
  put("refunds", input.creditNotesToApprove);
  put("reconciliation", input.mismatched);
  put("credits", input.overLimit);
  return counts;
}
