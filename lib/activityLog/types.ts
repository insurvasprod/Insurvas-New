/**
 * The call log's shapes and the pure rules the page and the server share.
 *
 * Plain module (no `server-only`): the Activity workspace is a client component and imports these;
 * lib/activityLog/service.ts re-exports the types for the route.
 */

/** Integrity flags tenant_activity_report computes per row. */
export const ACTIVITY_FLAGS = ["zero_click_disposition", "served_never_dispositioned", "impossibly_fast_disposition"] as const;
export type ActivityFlag = (typeof ACTIVITY_FLAGS)[number];
/** What the report's p_flag accepts: one flag, or "any" for every flagged row. */
export type ActivityFlagFilter = ActivityFlag | "any";

/** Only owners and producers review outcomes logged without a Dial press (the user's decision). */
export const ZERO_CLICK_ROLES: ReadonlySet<string> = new Set(["owner", "producer"]);
export function mayReviewZeroClick(role: string | null | undefined) {
  return ZERO_CLICK_ROLES.has(role ?? "");
}

export function parseFlagFilter(value: unknown): ActivityFlagFilter | null {
  if (value === "any") return "any";
  return typeof value === "string" && (ACTIVITY_FLAGS as readonly string[]).includes(value) ? (value as ActivityFlag) : null;
}

export type ActivityRow = {
  id: string; work_item_id: string | null; lead_id: string; campaign_id: string | null; agent_user_id: string | null;
  served_at: string; clicked_at: string | null; dispositioned_at: string | null; disposition: string | null;
  card_open_seconds: number | null; notes: string | null; agent_name: string; campaign_name: string | null; lead_name: string | null;
  integrity_flags: string[];
  /**
   * Which attempt this was. The dialer's own attempt number for the linked call when the report
   * carries it (20260925705100); before that, which serve of this lead it was.
   */
  attempt?: number | null;
  // ── 20260925705000 / 705100. Absent until those are applied; the page shows what it has. ──
  call_attempt_id?: string | null;
  lead_state?: string | null;
  dial_attempt_number?: number | null;
  open_to_log_seconds?: number | null;
  callback_at?: string | null;
  callback_timezone?: string | null;
  deal_face_amount_cents?: number | null;
  deal_product?: string | null;
  on_internal_dnc?: boolean | null;
  vendor_claim_status?: string | null;
};

export type ScorecardRow = {
  agent_user_id: string | null; agent_name?: string | null; served: number; clicked: number; logged: number;
  contact_rate_percent: number | null; disposition_breakdown: Record<string, number>;
  /** Logged outcomes whose disposition "counts as work" (Settings → Dispositions). */
  worked: number; callbacks_booked: number; callbacks_kept: number; appointments_booked: number; appointments_showed: number;
  applications_started: number; applications_submitted: number;
  /** Outcomes on a card with no Dial press (20260925705100). Absent before it. */
  zero_click?: number;
};

export type RecyclePerformanceRow = { source_type: "fresh" | "recycled"; served: number; clicked: number; contacts: number; contact_rate_percent: number | null };

/**
 * A dial the product refused (audit_log `tenant.dial_refused`: at prepare, and at the Dial press).
 * Never placed, so it is not a dial and is never counted as one; the log shows it as its own row.
 */
export type BlockedDialRow = {
  id: string; lead_id: string; lead_name: string | null; lead_state: string | null;
  campaign_id: string | null; campaign_name: string | null; agent_user_id: string | null; agent_name: string;
  at: string; reason: string | null; message: string | null; inbound: boolean;
};

export type ActivityReport = {
  rows: ActivityRow[]; total: number; page: number; page_size: number; export: boolean;
  scorecard: ScorecardRow[]; recycle_performance: RecyclePerformanceRow[];
  /** Refused dials that fall between this page's rows; null when the view does not show them. */
  blocked: BlockedDialRow[] | null;
  /** Refused dials in the whole window under the same filters; null when they could not be read. */
  blocked_total: number | null;
};

/** Short names for the dialer's refusal codes (DialerEligibility["reason"]). */
export const REFUSAL_LABEL: Record<string, string> = {
  outside_window: "Outside calling window",
  no_state: "No state on the lead",
  invalid_phone: "Invalid phone",
  not_licensed: "Not licensed in state",
  internal_suppressed: "On a do-not-call list",
  dnc_unavailable: "DNC check unavailable",
  policy_unavailable: "Window policy unavailable",
};

export function refusalLabel(reason: string | null | undefined) {
  if (!reason) return "Blocked";
  return REFUSAL_LABEL[reason] ?? reason.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** "4s", "3m 05s", "2h 10m" — the served → outcome time. */
export function formatSpan(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 86_400)}d`;
}

/** "$15k", "$250k", "$1.5M", "$8,500". */
export function formatFaceAmount(cents: number | null | undefined) {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return null;
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(Math.round(dollars / 100_000) / 10).toLocaleString("en-US")}M`;
  if (dollars >= 10_000) return `$${(Math.round(dollars / 100) / 10).toLocaleString("en-US")}k`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

/** "Thu 2:30 PM PT" in the customer's own timezone, or null when it cannot be read. */
export function formatCallback(at: string | null | undefined, timezone: string | null | undefined) {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  // Newer ICU puts a narrow no-break space before AM/PM; the log's lines use a plain one.
  const tidy = (value: string) => value.replace(",", "").replace(/[\u202f\u00a0]/g, " ");
  try {
    return tidy(new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timezone || undefined, timeZoneName: "short" }).format(date));
  } catch {
    return tidy(new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date));
  }
}

const CLAIM_STATUS: Record<string, string> = { draft: "draft", submitted: "submitted", accepted: "credited", partial: "part credited", rejected: "rejected" };

/**
 * The lines under a row's outcome: what the outcome led to, each read from its own record. Nothing
 * here is inferred from the disposition key — a tenant can rename every outcome.
 */
export function outcomeDetails(row: ActivityRow): string[] {
  if (!row.disposition) return [];
  const lines: string[] = [];
  const callback = formatCallback(row.callback_at, row.callback_timezone);
  if (callback) lines.push(`Callback ${callback}`);
  const face = formatFaceAmount(row.deal_face_amount_cents);
  const product = row.deal_product?.trim() || null;
  if (face || product) lines.push([face, product].filter(Boolean).join(" · "));
  if (row.on_internal_dnc) lines.push("On the do-not-call list");
  if (row.vendor_claim_status) lines.push(`On a vendor claim · ${CLAIM_STATUS[row.vendor_claim_status] ?? row.vendor_claim_status}`);
  return lines;
}

/** The biggest share of zero-click outcomes, for the integrity callout. */
export function zeroClickConcentration(scorecard: ScorecardRow[]) {
  let total = 0;
  let top: { name: string; count: number } | null = null;
  for (const row of scorecard) {
    const n = Number(row.zero_click ?? 0);
    if (!(n > 0)) continue;
    total += n;
    if (!top || n > top.count) top = { name: row.agent_name ?? "Unknown agent", count: n };
  }
  return { total, top };
}

/**
 * Which refused dials belong on this page of the log. The log is newest first; a page holds the
 * refusals from its own last row up to the previous page's last row (the window's end on page 1),
 * and the last page also takes everything down to the window's start. Each refusal lands on
 * exactly one page.
 */
export function blockedForPage(
  blocked: BlockedDialRow[],
  span: { windowFrom: string | null; windowTo: string | null; upper: string | null; lower: string | null; lastPage: boolean },
) {
  // Compared as instants: the report writes "+00:00" offsets, the window bounds are "Z" ISO strings.
  const time = (value: string | null) => (value == null ? null : Date.parse(value));
  const upper = time(span.upper ?? span.windowTo);
  const lower = time(span.lastPage ? span.windowFrom : span.lower);
  return blocked.filter((row) => {
    const at = Date.parse(row.at);
    return (upper == null || at < upper) && (lower == null || at >= lower);
  });
}
