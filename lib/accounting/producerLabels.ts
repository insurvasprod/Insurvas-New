/**
 * Producer splits' words and dates (round 7, 4·A), shared by the client board and the server pages. Kept out of
 * the "use client" board: a server page that calls a function exported from a client module gets a client
 * reference, not the function.
 */
import { percent, type Basis, type PaysOn } from "@/lib/accounting/producersCore";

export type Split = { id: string; producerUserId: string; carrierId: string | null; productCode: string | null; splitPctBp: number; basis: Basis; paysOn: PaysOn; effectiveFrom: string };

export const today = () => new Date().toISOString().slice(0, 10);
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
/** The date `days` before today, as YYYY-MM-DD. */
export const daysAgo = (days: number) => { const d = utc(today()); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
/** "Nov 6, 2026". */
export const dateLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(utc(d));
/** "Nov 6". */
export const dayLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(utc(d));
/** "Oct". */
export const monthLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(utc(d));
/** "Oct 2026". */
export const monthYearLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(utc(d));
/** "Oct 1 – Oct 31", with the year only when it is not this year's. */
export const periodLabel = (start: string, end: string) => `${dayLabel(start)} – ${end.slice(0, 4) === today().slice(0, 4) ? dayLabel(end) : dateLabel(end)}`;

/** What a share is of, and when it is owed, in the Splits tab's and the split dialog's short words. */
export const OF_LABELS: Record<Basis, string> = { advance: "Advance", earned: "Earned commission", both: "Advance and earned" };
export const OWED_LABELS: Record<PaysOn, string> = { advance_received: "On the advance", first_draft: "After the first premium", issue: "When the policy issues" };

/** The producer's split on every carrier and product, in force today. */
export const currentSplit = (splits: Split[], userId: string) => splits.find((s) => s.producerUserId === userId && !s.carrierId && !s.productCode && s.effectiveFrom <= today());
/** "40% of advance", "55% of earned commission", or "No split". */
export const splitText = (s: Pick<Split, "splitPctBp" | "basis"> | undefined) => (s ? `${percent(s.splitPctBp)} of ${s.basis === "both" ? "advance + earned" : s.basis === "earned" ? "earned commission" : "advance"}` : "No split");
