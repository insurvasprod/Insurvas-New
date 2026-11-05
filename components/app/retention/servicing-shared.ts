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

/** The steps a person takes, by the button that takes them. "Cancel the request", not "Cancel": its confirm also has a way back (live test 2026-11-02). */
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

/** Today on this computer's calendar: toISOString() is the UTC day, a day ahead on a US evening (QA 2026-11-05). */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
