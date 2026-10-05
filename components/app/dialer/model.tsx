import { notify } from "@/lib/notify";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { type PillTone } from "@/components/app/settings/primitives";
import { zonedInstant } from "@/lib/appointments/calendarMath";
import { type CallbackWindowFacts } from "@/lib/callbacks/windowFacts";
import { cn } from "@/lib/utils";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { localClock, zoneShort, type QueuePriority, type ReturnWindow } from "@/lib/dialerScripts/display";
import { APPLICATION_OUTCOME, type DialerVocabulary } from "@/lib/dialerScripts/outcomes";

export type Lead = { id: string; product_line?: string; values: Record<string, unknown> };

export type Eligibility = {
  allowed: boolean;
  reason: string;
  message: string;
  checkedAt: string;
  timezone: string | null;
  customerLocalTime: string | null;
  /** Vendor availability, not a lookup of this number. See lib/dialerScripts/service.ts. */
  dncCheck: "pending" | "clear" | "suppressed" | "unavailable";
  suppression?: "clear" | "suppressed" | "unavailable" | "not_checked";
  /** Every stored list the number is on (20260925700200); null when only the agency's list could be read. */
  suppressionHits?: Array<{ listType: string; reason: string; addedAt: string | null }> | null;
  licence?: { status: "live" | "refused" | "unavailable"; state: string; expiresAt: string | null; message: string | null } | null;
  /** LA-2.3-3: an owner-recorded DNC exemption; clears federal/state DNC only. */
  dncExemption?: { basis: string; expiresAt: string | null; certificateUrl: string | null } | null;
};

export type Consent = { available: boolean; hasCertificate: boolean; provider: string | null; status: string | null; capturedAt: string | null; consentTimestamp: string | null; ageDays: number | null };

export type AttemptHistory = { id: string; attemptNumber: number; attemptedAt: string; slot: string; disposition: string | null; dialClicked: boolean; disclosureConfirmed: boolean };

export type Panel = {
  lead: { id: string; firstName: string; fullName?: string; state: string; city?: string; age: string; phone: string; campaignId: string | null; productCode: string; workItemId: string | null; attemptsMade?: number; leadState?: string | null; nextDialAfter?: string | null; nextSlot?: string | null; attemptCeiling?: number | null };
  recycle?: { angle: string; script: string | null; attemptCeiling: number | null; recycledAt: string | null } | null;
  viewerUserId?: string | null;
  /** The agent's own zone (their working hours); null → the browser's. */
  viewerTimezone?: string | null;
  /** The outcome buttons from the tenant's dispositions (one vocabulary), or the pre-migration list. */
  outcomes?: DialerVocabulary;
  campaign?: { name: string | null; vendorName: string | null; leadType: string | null; costPerLeadCents?: number | null; scrubStatus?: string | null; scrubbedAt?: string | null } | null;
  returnWindow?: ReturnWindow | null;
  callbackWindow?: CallbackWindowFacts | null;
  window?: { allowed: boolean; startMinute: number | null; endMinute: number | null; zone: string | null; reason: string } | null;
  lastDncCheck?: { result: string; checkedAt: string } | null;
  script: { id: string | null; version: number; campaignId: string | null; productCode: string; sections: Record<string, unknown> };
  rebuttals: Array<{ id: string; objectionKey: string; label: string; body: string }>;
  disclosure: { id: string | null; state: string; productCode: string; requiredText: string; configured: boolean; blocking: boolean; approved?: boolean };
  eligibility: Eligibility;
  selectionReason: string | null;
  consent: Consent;
  attemptHistory: AttemptHistory[];
};

export type Attempt = { id: string; attempt_number?: number };

export type Served = { leadId: string; workItemId?: string; tier: number; tierName: string; selectionReason: string | null; appointmentNotes: string | null; lockedUntil: string };

export type QueueRow = { workItemId: string; leadId: string; tier: number; tierName: string; name: string | null; state: string | null; attemptsMade: number; assignedToYou: boolean; localTime: string | null };

export type Stats = { dials: number; contacts: number; contactRate: number | null; since: string; zone: string };

export type Queue = ({ available: true; count: number; capped: boolean; cap: number; rows: QueueRow[]; emptyReason?: string | null } | { available: false; message: string }) & { stats?: Stats | null };

export type QueueFilter = "all" | "high" | "medium" | "low";

/**
 * The outcome buttons are the tenant's own dispositions (M1 LA-1.12-4, one vocabulary): the panel
 * carries them in button order from `dispositions.dialer_position`, and keys 1–9 then 0 pick them
 * in that order. Before migration 20260929200000 the panel carries the pre-migration list instead
 * (lib/dialerScripts/outcomes.ts), so nothing changes for a tenant until its rows exist. The first
 * four are the primary buttons, the rest sit under "More outcomes"; Do not call, Callback and the
 * two returnable outcomes each ask one more question before they are recorded.
 *
 * The inbound return call is not a button here: it is the customer's call, offered only on the
 * search path and recorded without touching the cadence (decision 1).
 */
/** Outcomes that can send the lead back to its vendor (vendor_claimable_leads); confirmed with the return window first. */
export const RETURNABLE = new Set(["wrong_number", "disconnected"]);

export const CALLBACK_OUTCOME = "callback_scheduled";

export const DNC_OUTCOME = "do_not_call";

/** A disposition key as words, for a history row whose outcome the tenant has since removed. */
export const keyWords = (key: string) => key.replaceAll("_", " ");

export const scriptSections = ["opening", "qualifying_questions", "transition_to_quote", "close"];

export const SECTION_LABELS: Record<string, string> = { opening: "Opening", qualifying_questions: "Qualifying questions", transition_to_quote: "Transition to quote", close: "Close" };

export const PRIORITY_TONE: Record<QueuePriority, PillTone> = { High: "error", Medium: "warning", Low: "neutral" };

export const FILTERS: Array<{ key: QueueFilter; label: string }> = [
  { key: "all", label: "All priorities" },
  { key: "high", label: "High priority" },
  { key: "medium", label: "Medium priority" },
  { key: "low", label: "Low priority" },
];

export const card = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)]";

export const h2 = "m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]";

export const label = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

export const value = "mt-1 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums break-words";

export const small = "text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";

export const body14 = "text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

export const barHead = "flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3";

export const barTitle = "text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]";

export const fieldLabel = "text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]";

/** A form control in a side panel: the same 36px box as the buttons beside it. */
export const fieldClass = cn(toolbarControl, "mt-1.5 w-full");

export function errorText(body: unknown, fallback: string) {
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : fallback;
}

/** A `datetime-local` value read in `zone` as a UTC instant, or null. */
export function instantInZone(local: string, zone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  return zonedInstant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]) * 60 + Number(m[5]), zone);
}

/** A slot as the booking list reads it: the customer's time first, then "= your time". */
export function slotOptionLabel(iso: string, customerZone: string | null): string {
  const yours = `${localClock(iso, viewerTimeZone())} your time`;
  if (!customerZone) return `${dateTime(iso, viewerTimeZone(), { weekday: true, clock: "12h" })} your time`;
  return `${dateTime(iso, customerZone, { weekday: true, clock: "12h" })} ${zoneShort(customerZone)} = ${yours}`;
}

/**
 * The toast after a disposition, with the server's own sentence for what happens next ("Attempt 4
 * scheduled for Thu 26 Sep 14:00 in the afternoon slot.", "Closed. Claimable from …") from
 * complete_existing_dial_disposition.
 */
export function announceDisposition(value: string, body: { attempt?: unknown } | null) {
  const attempt = body?.attempt as { reason?: unknown; scheduled_at_utc?: unknown } | Array<{ reason?: unknown }> | undefined;
  const recorded = Array.isArray(attempt) ? attempt[0] : attempt;
  const nextStep = typeof recorded?.reason === "string" && recorded.reason ? recorded.reason : undefined;
  const callbackAt = !Array.isArray(attempt) && typeof attempt?.scheduled_at_utc === "string" ? attempt.scheduled_at_utc : null;
  if (value === APPLICATION_OUTCOME) { if (nextStep) notify.win("Application submitted", { detail: nextStep }); else notify.win("Application submitted"); }
  else if (value === CALLBACK_OUTCOME && callbackAt) notify.done("Callback booked", { detail: `For ${new Date(callbackAt).toLocaleString()}.` });
  else notify.done("Disposition recorded", { detail: nextStep });
}

/** A key hint inside a button (LA-2.9-9). Hidden from screen readers: the button carries aria-keyshortcuts. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd aria-hidden="true" className="ml-2 rounded-[4px] border border-current px-1 font-sans text-[12px] leading-[1.4] font-semibold opacity-60">{children}</kbd>;
}

export function leadName(values: Record<string, unknown>) {
  const composed = [values.first_name, values.last_name].filter(Boolean).join(" ");
  return String(values.full_name ?? values.name ?? (composed || "Unnamed lead"));
}
