/**
 * Helpers for what happens after submission (LA-3.18 requirements, LA-3.26 counteroffers, LA-3.16
 * outcomes and new attempts). No React, no fetch — the After step and the Timeline read the same
 * numbers from here, and the arithmetic itself lives in lib/applications/afterSubmitRules.
 */

import { TIER_LABEL, WAITING_ON_LABEL, type WaitingOn } from "@/lib/applications/constants";
import type { AttemptView, CounterofferView } from "@/lib/applications/types";
import { shortDate } from "@/components/app/applications/dates";

export { ageingOf, counterofferDelta, daysOpen, isOpenStatus, tierChangeLine } from "@/lib/applications/afterSubmitRules";

export const DAY_MS = 86_400_000;

export function ago(iso: string | null, now: number) {
  if (!iso) return "never";
  const d = Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export const tierName = (tier: string | null | undefined) => (tier ? TIER_LABEL[tier] ?? tier : "—");

export const waitingLine = (w: WaitingOn) => (w === "agent" ? "Waiting on you" : w === "third_party" ? "Waiting on a third party" : `Waiting on the ${WAITING_ON_LABEL[w].toLowerCase()}`);

export type Coverage = CounterofferView["applied"];

/** What the attempt is covered for right now: the application's values (an accepted counteroffer wrote them), else the selected quote. */
export function coverageOf(attempt: AttemptView): Coverage {
  const quote = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId) ?? null;
  const num = (key: string) => {
    const v = attempt.values[key]?.value;
    return typeof v === "number" ? v : null;
  };
  const tier = attempt.values["cov.product_tier"]?.value;
  return {
    tier: typeof tier === "string" ? tier : attempt.tier ?? quote?.tier ?? null,
    healthClass: quote?.healthClass ?? null,
    faceCents: num("cov.face_amount") ?? quote?.faceAmountCents ?? 0,
    monthlyCents: num("cov.monthly_premium") ?? quote?.monthlyPremiumCents ?? 0,
  };
}

/** What the attempt applied for: the selected quote, never the counteroffer. */
export function appliedOf(attempt: AttemptView): Coverage {
  const quote = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId) ?? null;
  return quote
    ? { tier: quote.tier, healthClass: quote.healthClass ?? null, faceCents: quote.faceAmountCents, monthlyCents: quote.monthlyPremiumCents }
    : coverageOf(attempt);
}

/** Expiry countdown: amber, then red on the last day. */
export function expiryOf(expiresAt: string, now: number): { tone: "neutral" | "warning" | "danger"; label: string } {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return { tone: "danger", label: "Expired" };
  const hours = Math.floor(ms / 3_600_000);
  if (ms < DAY_MS) return { tone: "danger", label: hours <= 1 ? "Expires within the hour" : `Expires in ${hours} hours` };
  const days = Math.floor(ms / DAY_MS);
  // A pending offer is always something to act on before it lapses: amber until the last day, then red.
  return { tone: "warning", label: `Expires in ${days} ${days === 1 ? "day" : "days"}` };
}

/** YYYY-MM-DD for a date input, local time. */
export function dateInput(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "12 Sep" / "2 Oct 2026" the way the boards write dates. */
export const dayMonth = (iso: string | null | undefined, withYear = false) => shortDate(iso, { year: withYear });
