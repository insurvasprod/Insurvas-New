/**
 * LA-5.3 (Notion sprint) · the recommended fix. Deterministic: each signal maps to an action, ranked
 * by the share of the score it would remove. At most two per card — with three or more the agent
 * picks none.
 *
 * Pure; relative imports only.
 */

import type { FixAction } from "./constants.ts";
import type { RiskScore } from "./score.ts";
import type { SignalRow } from "./signals.ts";

export type Fix = { action: FixAction; label: string; removes: number; targetDraftDay?: number; reason?: string };

export const MAX_FIXES = 2;

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

export function recommendFixes(s: SignalRow, score: RiskScore): Fix[] {
  const share = new Map(score.contributions.map((c) => [c.signal, c.contribution]));
  const out: Fix[] = [];
  const timing = share.get("draft_timing") ?? 0;
  // A specific day from LA-3.9, never "consider changing it". Only when the optimiser has one, and it differs.
  if (timing > 0 && s.recommendedDraftDay && s.recommendedDraftDay !== s.draftDay) {
    out.push({ action: "move_draft_date", label: `Move the payment date to the ${ordinal(s.recommendedDraftDay)}`, removes: timing, targetDraftDay: s.recommendedDraftDay, reason: s.recommendedDraftReason ?? undefined });
  }
  const method = share.get("payment_method") ?? 0;
  if (method > 0 && s.paymentMethod === "direct_bill") out.push({ action: "convert_to_draft", label: "Switch them to bank payment", removes: method });
  if (method > 0 && s.paymentMethod === "direct_express") {
    out.push({ action: "confirm_card_funded", label: s.draftDay ? `Confirm the card is funded before the ${ordinal(s.draftDay)}; offer bank draft` : "Confirm the card is funded before each draft; offer bank draft", removes: method });
  }
  const wobble = share.get("payment_wobble") ?? 0;
  if (wobble > 0) out.push({ action: "confirm_account", label: "Confirm the account; offer a date change", removes: wobble });
  const afford = share.get("affordability") ?? 0;
  if (afford > 0 && (s.premiumPctOfIncomeBp ?? 0) > 0) out.push({ action: "review_coverage", label: "Review the coverage: a smaller policy kept beats one lost", removes: afford });

  const ranked = out.sort((a, b) => b.removes - a.removes).slice(0, MAX_FIXES);
  if (ranked.length) return ranked;
  return [{ action: "courtesy_call", label: "A courtesy check-in call. No change needed.", removes: 0 }];
}
