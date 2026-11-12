import type { StatusTone } from "@/components/ui/status-chip";
import { fileDay } from "@/lib/ingestion/constants";
import { NEXT_STEPS, unprovableText, WAITING_STATUSES, type RequestStatus, type RequestType } from "@/lib/retention/servicing";

/**
 * LA-5.4 · what the Servicing list, a request's page and its step form share. No "use client": the request
 * page (a server component) reads these values too.
 */
export const SERVICING_TONE: Record<RequestStatus, StatusTone> = {
  draft: "neutral", submitted: "info", awaiting_carrier: "info", confirmed_by_carrier: "warning", verified_in_file: "good", failed: "danger", cancelled: "neutral",
};

/** The steps a person takes, by the button that takes them. "Cancel the request", not "Cancel": its confirm also has a way back (live test 2026-11-02). Round 7: Mark sent and Check it are dialogs on the request page. */
export const STEP_LABEL: Partial<Record<RequestStatus, string>> = { submitted: "Mark sent", awaiting_carrier: "Carrier is on it", confirmed_by_carrier: "Carrier says done", cancelled: "Cancel the request" };

/** The steps that open a form on the request's page (cancel is a confirm). */
export const FORM_STEPS = ["submitted", "awaiting_carrier", "confirmed_by_carrier"] as const;
export type FormStep = (typeof FORM_STEPS)[number];
export const isFormStep = (value: string | null | undefined): value is FormStep => (FORM_STEPS as readonly string[]).includes(value ?? "");

/** The one step forward a request offers (cancel aside), or null. */
export const nextStepOf = (status: RequestStatus): FormStep | null => (NEXT_STEPS[status].find((st) => st !== "cancelled") as FormStep | undefined) ?? null;
export const canCancel = (status: RequestStatus) => NEXT_STEPS[status].includes("cancelled");

export const dayText = (iso: string | null) => (iso ? fileDay(iso.slice(0, 10)) : null);

export const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

/** Try again: the new-request page, filled in from the failed one. */
export const tryAgainHref = (r: { carrierId: string; policyNumber: string; type: RequestType }) =>
  `/app/servicing/new?carrier=${r.carrierId}&policy=${encodeURIComponent(r.policyNumber)}&type=${r.type}`;

export const policyHref = (r: { carrierId: string; policyNumber: string }) => `/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`;

/** The file check, in plain words: what proved it, why it failed, why it can't be proven, or what it waits on. */
export function fileCheckText(r: {
  status: RequestStatus; failureReason: string | null; verifiedSnapshotDate: string | null; unprovable: string[]; carrierName: string;
  checkedSnapshotDate: string | null; expectedEffectiveDate: string | null; confirmedAt: string | null;
}): { text: string; tone: "error" | "warning" | "muted" } | null {
  if (r.status === "failed") return { text: r.failureReason ?? "The carrier file doesn't show the change.", tone: "error" };
  if (r.status === "verified_in_file") return { text: `In the file of ${dayText(r.verifiedSnapshotDate) ?? "—"}`, tone: "muted" };
  if (WAITING_STATUSES.includes(r.status) && r.unprovable.length) return { text: unprovableText(r.unprovable, r.carrierName) ?? "", tone: "warning" };
  if (WAITING_STATUSES.includes(r.status)) {
    return { text: `${r.checkedSnapshotDate ? `Not in the file of ${dayText(r.checkedSnapshotDate)} yet` : "No carrier file since"}${r.expectedEffectiveDate ? ` · due ${dayText(r.expectedEffectiveDate)}` : ""}`, tone: "muted" };
  }
  if (r.status === "confirmed_by_carrier" && r.confirmedAt) return { text: `Carrier said done ${dayText(r.confirmedAt)}`, tone: "muted" };
  return null;
}

export const TONE_CLASS = { error: "text-[var(--error-ink)]", warning: "text-[var(--warning-ink)]", muted: "text-muted-foreground" } as const;

/**
 * Where a request stands, by what you do next (round 3, owner 2026-11-06; round 7, owner pick 2·A, 2026-11-10: these
 * are the tabs on the title line). The list, its tab counts and a request page's ‹ › all read them from here.
 */
export type Bucket = "check" | "send" | "waiting" | "failed" | "proven" | "cancelled";
export const BUCKETS: Array<{ key: Bucket; label: string; ink: string; empty: { title: string; hint: string } }> = [
  { key: "check", label: "Check it", ink: "var(--error-ink)", empty: { title: "Nothing to check", hint: "A request lands here when the carrier's file doesn't show the change by its date." } },
  { key: "send", label: "Send it", ink: "var(--warning-ink)", empty: { title: "Nothing to send", hint: "Every request was sent. One saved as not sent yet lands here until you mark it sent." } },
  { key: "waiting", label: "Waiting", ink: "var(--info-ink)", empty: { title: "Nothing waiting on a file", hint: "A request lands here once it is sent, until a carrier file shows the change or its date passes." } },
  { key: "failed", label: "Not in the file", ink: "var(--error-ink)", empty: { title: "None failed", hint: "A request lands here when a carrier file shows it wasn't done; its case opens again." } },
  { key: "proven", label: "Proven", ink: "var(--success-ink)", empty: { title: "None proven yet", hint: "A request lands here when a carrier file shows the change." } },
  { key: "cancelled", label: "Cancelled", ink: "var(--muted-foreground)", empty: { title: "None cancelled", hint: "A request a person stopped lands here." } },
];
/** The list's tabs: open (check, send, waiting, grouped) by default, or one bucket. */
export type ServicingView = "open" | Bucket;
export const OPEN_ORDER: Bucket[] = ["check", "send", "waiting"];
export const asServicingView = (value: string | null | undefined): ServicingView => (BUCKETS.some((b) => b.key === value) ? (value as Bucket) : "open");
export const servicingViewHref = (v: ServicingView) => (v === "open" ? "/app/servicing" : `/app/servicing?status=${v}`);
/** A request's page, remembering the tab it was opened from so its ‹ › walk that list. */
export const requestHref = (id: string, from: ServicingView, tab?: string) => {
  const q = new URLSearchParams();
  if (tab && tab !== "request") q.set("tab", tab);
  if (from !== "open") q.set("from", from);
  const s = q.toString();
  return `/app/servicing/${id}${s ? `?${s}` : ""}`;
};

type Bucketable = { status: RequestStatus; unprovable: string[]; expectedEffectiveDate: string | null; submittedAt: string | null; createdAt: string };

export function bucketOf(r: Bucketable, today: string): Bucket {
  if (r.status === "draft") return "send";
  if (r.status === "failed") return "failed";
  if (r.status === "verified_in_file") return "proven";
  if (r.status === "cancelled") return "cancelled";
  // Sent: it needs you once the carrier says done, the file can't show it, or its date has passed.
  return r.status === "confirmed_by_carrier" || r.unprovable.length > 0 || (r.expectedEffectiveDate !== null && r.expectedEffectiveDate < today) ? "check" : "waiting";
}

/** Days since it was sent (or saved, if never sent); none once it is closed. */
export function waitedDays(r: Bucketable): number | null {
  if (!(WAITING_STATUSES.includes(r.status) || r.status === "draft")) return null;
  const from = r.submittedAt ?? r.createdAt;
  return Math.max(0, Math.floor((Date.now() - Date.parse(from)) / 86_400_000));
}

/** One tab's rows in the list's order: Open groups by next step, the longest wait first; a bucket keeps the newest first. */
export function rowsInView<R extends Bucketable>(rows: R[], view: ServicingView, today: string): R[] {
  if (view !== "open") return rows.filter((r) => bucketOf(r, today) === view);
  return rows
    .filter((r) => OPEN_ORDER.includes(bucketOf(r, today)))
    .sort((a, b) => OPEN_ORDER.indexOf(bucketOf(a, today)) - OPEN_ORDER.indexOf(bucketOf(b, today)) || (waitedDays(b) ?? 0) - (waitedDays(a) ?? 0));
}

/** The next step in words, as the row's last column and the request page's primary say it. */
export const NEXT_WORDS: Partial<Record<Bucket, string>> = { check: "Check it", send: "Send it", failed: "Try again" };

/** What the change is, as a step's words: "The next file shows the new date". */
export const CHANGE_NOUN: Record<RequestType, string> = {
  draft_date_change: "the new date", payment_method_change: "the new bank or card", bill_to_draft_conversion: "the bank payment", address_change: "the new address",
};

/** Today on this computer's calendar: toISOString() is the UTC day, a day ahead on a US evening (QA 2026-11-05). */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The New request page's title-line slot: its two saves sit there (round 7, owner pick 2·3, 2026-11-10). */
export const NEW_REQUEST_SLOT = "servicing-new-request-actions";
