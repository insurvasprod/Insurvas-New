import { fileDay } from "@/lib/ingestion/constants";
import { personName } from "@/lib/format/personName";
import type { WinbackRow } from "@/lib/retention/winbackStore";

/**
 * Retention › Win-back, the plain rules both its pages share (round 7, owner pick 3·A, 2026-11-10): where a former
 * client stands, the tabs on the title line (the address the list already used, `?show=`), the order a tab lists
 * them in (so a client's ‹ › name the neighbours the person just saw), and the words a row ends with.
 *
 * No hooks and no server reads: imported by the list (a client island) and by the server pages that draw the tabs.
 */

/** Where a lapsed client stands (round 3, owner 2026-11-06). */
export type WinbackStage = "blocked" | "released" | "soon" | "resting" | "never";
export type WinbackView = "open" | WinbackStage | "claims";

/** The title-line tabs, in their order: All · Call now · Stuck · Soon · Cooling off · Never call · Possible claims. */
export const WINBACK_VIEWS: ReadonlyArray<{ key: WinbackView; label: string }> = [
  { key: "open", label: "All" },
  { key: "released", label: "Call now" },
  { key: "blocked", label: "Stuck" },
  { key: "soon", label: "Soon" },
  { key: "resting", label: "Cooling off" },
  { key: "never", label: "Never call" },
  { key: "claims", label: "Possible claims" },
];

export const winbackViewLabel = (view: WinbackView) => WINBACK_VIEWS.find((v) => v.key === view)?.label ?? "All";
export const isWinbackView = (v: string | null | undefined): v is WinbackView => WINBACK_VIEWS.some((x) => x.key === v);

/** A tab's address. "All" is the bare address, so every old link still lands. */
export const winbackViewHref = (view: WinbackView) => (view === "open" ? "/app/reinstatement" : `/app/reinstatement?show=${view}`);

/** A former client's page; the tab they were opened from rides along, for its ‹ › and its trail. */
export const winbackClientHref = (id: string, view: WinbackView = "open", tab?: string) => {
  const q = new URLSearchParams();
  if (view !== "open") q.set("show", view);
  if (tab) q.set("tab", tab);
  const s = q.toString();
  return `/app/reinstatement/winback/${id}${s ? `?${s}` : ""}`;
};

/** A possible claim's page: Mark handled lives there, never in the row. */
export const winbackClaimHref = (id: string) => `/app/reinstatement/claim/${id}`;

export const policyHref = (carrierId: string, policyNumber: string) => `/app/policies/carrier/${carrierId}/${encodeURIComponent(policyNumber)}`;

const soonLimit = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);

export function winbackStage(r: WinbackRow, today: string): WinbackStage {
  if (r.band === "never") return "never";
  if (r.releasedAt) return "released";
  if (r.blockedReason) return "blocked";
  return r.eligibleFrom && r.eligibleFrom <= soonLimit(today) ? "soon" : "resting";
}

/** "All" is the open ones, stuck and callable first. */
const OPEN_ORDER: WinbackStage[] = ["blocked", "released", "soon", "resting"];

/** The clients a tab lists, in the order it lists them. */
export function winbackList(rows: WinbackRow[], view: WinbackView, today: string): WinbackRow[] {
  if (view === "claims") return [];
  if (view !== "open") return rows.filter((r) => winbackStage(r, today) === view);
  const at = (r: WinbackRow) => OPEN_ORDER.indexOf(winbackStage(r, today));
  return rows.filter((r) => at(r) >= 0).sort((a, b) => at(a) - at(b) || (a.eligibleFrom ?? "").localeCompare(b.eligibleFrom ?? ""));
}

/** Each tab's count, from the same rule as its list. */
export function winbackCounts(rows: WinbackRow[], claims: number, today: string): Record<WinbackView, number> {
  const counts: Record<WinbackView, number> = { open: 0, released: 0, blocked: 0, soon: 0, resting: 0, never: 0, claims };
  for (const r of rows) {
    const s = winbackStage(r, today);
    counts[s]++;
    if (s !== "never") counts.open++;
  }
  return counts;
}

export const clientName = (r: { clientName: string | null; policyNumber: string }) => (r.clientName ? personName(r.clientName) : r.policyNumber);

export const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

export const money = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
export const coverText = (cents: number | null) => (cents === null ? null : `$${Math.round(cents / 100).toLocaleString("en-US")} cover`);
export const paidText = (months: number | null) => (months === null ? null : `${months} ${months === 1 ? "month" : "months"} paid`);

/** Why the chance is what it is (critique 3·0: "Fair" for everyone, with no explanation). */
export const chanceWhy = (r: WinbackRow) => (r.band === "never" ? "do-not-call or deceased" : paidText(r.monthsPaid) ?? "months paid not known");

/** When to call, in two short lines. */
export function whenToCall(r: WinbackRow, today: string): { line: string; sub: string | null; tone: "good" | "danger" | "plain" | "muted" } {
  const s = winbackStage(r, today);
  if (s === "never") return { line: "Never", sub: null, tone: "muted" };
  if (s === "released") return { line: "On the list", sub: `since ${fileDay(r.releasedAt!.slice(0, 10))}`, tone: "good" };
  if (s === "blocked") return { line: "Couldn't go on the list", sub: r.blockedReason, tone: "danger" };
  if (!r.eligibleFrom) return { line: "From —", sub: null, tone: "plain" };
  const days = Math.max(0, Math.ceil((Date.parse(r.eligibleFrom) - Date.parse(today)) / 86_400_000));
  return { line: `From ${fileDay(r.eligibleFrom)}`, sub: `in ${days} ${days === 1 ? "day" : "days"}`, tone: "plain" };
}

/**
 * The row's last column: the next step as a short verb, the long sentence its tooltip (board 3·A; one-line tables,
 * owner 2026-11-11). Cooling off and Never call have nothing to do yet, so their words only open the client.
 */
export function nextStep(r: WinbackRow, today: string): { step: string; why: string } {
  const s = winbackStage(r, today);
  if (s === "released") return { step: "Call", why: "Call from the Win-back list" };
  if (s === "blocked") return { step: "Fix", why: "See why it's stuck" };
  if (s === "soon") return { step: "Line up", why: "Line them up for the Win-back list" };
  return { step: "Open", why: s === "never" ? "Never called" : "Cooling off: nothing to do yet" };
}
