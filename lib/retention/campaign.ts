/**
 * LA-5.5 (Notion sprint) · paper bill → bank payment, as plain rules: who is on the campaign, where
 * each policy stands, the header's figures, and the honest answer to "is it worth the hours?"
 *
 *   · Every in-force policy paid by mailed bill (direct_bill), biggest annual premium first. Direct
 *     Express is NOT here: that client may have no bank account, and the save queue decides.
 *   · A conversion counts only when its LA-5.4 request is verified in a carrier file.
 *   · A decline rests for the cooling-off period; "no bank account" leaves for good (and goes to the
 *     save queue) — asking again is useless and faintly humiliating.
 *
 * Pure; relative imports only.
 */

export const CONVERSION_OUTCOMES = ["converted", "declined", "no_answer", "callback_requested", "unable_no_bank_account"] as const;
export type ConversionOutcome = (typeof CONVERSION_OUTCOMES)[number];
/** What a person logs by hand; "converted" is logged by opening the conversion request. */
export const LOGGABLE_OUTCOMES = ["no_answer", "callback_requested", "declined", "unable_no_bank_account"] as const;
export const CONVERSION_OUTCOME_LABELS: Record<ConversionOutcome, string> = {
  converted: "Agreed to switch",
  declined: "Said no",
  no_answer: "No answer",
  callback_requested: "Asked to be called back",
  unable_no_bank_account: "Has no bank account",
};

/** The platform's talk track: content, not code — an agency writes its own (LA-5.11). */
export const PLATFORM_TALK_TRACK = [
  "You pay us by posting a cheque every month, and you never miss — thank you.",
  "I'm calling because we can take it straight from your bank account instead, on the day after your money arrives.",
  "No more stamps, no more remembering, and no risk of the post being late and the policy cancelling because a letter got lost.",
  "Nothing about your coverage changes, and you can switch back whenever you like.",
].join("\n\n");

export type CampaignState = "remaining" | "in_progress" | "converted" | "declined" | "no_bank_account";
export const STATE_LABELS: Record<CampaignState, string> = {
  remaining: "To call",
  in_progress: "Switch asked for",
  converted: "Converted",
  declined: "Said no",
  no_bank_account: "No bank account",
};

export type CampaignPolicy = {
  key: string;
  /** In force and paid by mailed bill now. A converted policy pays by draft now, and is listed by its request instead. */
  onPaperNow: boolean;
  annualCents: number | null;
  attempts: Array<{ outcome: ConversionOutcome; at: string }>;
  /** The newest bill_to_draft_conversion request for this policy, if any. */
  request: { status: string; verifiedAt: string | null } | null;
};

const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/** Where a policy stands. The file decides "converted"; a person's "agreed" is only "switch asked for". */
export function stateOf(p: CampaignPolicy, today: string, cooloffDays: number): { state: CampaignState; returnsOn: string | null } {
  if (p.request?.status === "verified_in_file") return { state: "converted", returnsOn: null };
  if (p.attempts.some((a) => a.outcome === "unable_no_bank_account")) return { state: "no_bank_account", returnsOn: null };
  if (p.request && ["draft", "submitted", "awaiting_carrier", "confirmed_by_carrier"].includes(p.request.status)) return { state: "in_progress", returnsOn: null };
  const lastDecline = p.attempts.filter((a) => a.outcome === "declined").map((a) => a.at.slice(0, 10)).sort().at(-1);
  if (lastDecline && dayNumber(today) - dayNumber(lastDecline) < cooloffDays) {
    const back = new Date((dayNumber(lastDecline) + cooloffDays) * 86_400_000).toISOString().slice(0, 10);
    return { state: "declined", returnsOn: back };
  }
  return { state: "remaining", returnsOn: null };
}

/** Biggest exposure first: a conversion is a conversion, so take the valuable ones first. */
export const campaignOrder = <T extends { annualCents: number | null; key: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (b.annualCents ?? -1) - (a.annualCents ?? -1) || a.key.localeCompare(b.key));

/** "Paying by post since issue · never missed" — from the radar's signals. */
export function historyLine(monthsSinceIssue: number | null, failures: number | null): string {
  const since = monthsSinceIssue === null ? "Paying by post" : monthsSinceIssue < 1 ? "Paying by post since this month" : `Paying by post for ${monthsSinceIssue} ${monthsSinceIssue === 1 ? "month" : "months"}`;
  const missed = failures === null ? "" : failures === 0 ? " · never missed" : ` · missed ${failures === 1 ? "once" : `${failures} times`}`;
  return `${since}${missed}`;
}

export type CampaignTotals = { policies: number; monthlyCents: number; converted: number; inProgress: number; declined: number; noBankAccount: number; remaining: number; monthlyMovedCents: number };

export function campaignTotals(rows: Array<{ state: CampaignState; annualCents: number | null }>): CampaignTotals {
  const monthly = (r: { annualCents: number | null }) => Math.round((r.annualCents ?? 0) / 12);
  const count = (s: CampaignState) => rows.filter((r) => r.state === s).length;
  return {
    policies: rows.length,
    monthlyCents: rows.reduce((sum, r) => sum + monthly(r), 0),
    converted: count("converted"),
    inProgress: count("in_progress"),
    declined: count("declined"),
    noBankAccount: count("no_bank_account"),
    remaining: count("remaining"),
    monthlyMovedCents: rows.filter((r) => r.state === "converted").reduce((sum, r) => sum + monthly(r), 0),
  };
}

/**
 * The payoff number: how many converted policies lapsed against how many still on paper did. Below
 * the sample floor on either side it is counts, not percentages — three of five is not 60%.
 */
export function lapseComparison(converted: { lapsed: number; total: number }, onPaper: { lapsed: number; total: number }, floor: number) {
  const text = (side: { lapsed: number; total: number }) =>
    side.total === 0 ? "none yet" : side.total < floor ? `${side.lapsed} of ${side.total} lapsed` : `${Math.round((side.lapsed * 100) / side.total)}% lapsed (${side.lapsed} of ${side.total})`;
  return { converted: text(converted), onPaper: text(onPaper), comparable: converted.total >= floor && onPaper.total >= floor };
}

/** Per person: calls made and conversions the file has proven (feeds LA-5.8's scorecard). */
export function byPerson(attempts: Array<{ by: string | null; outcome: ConversionOutcome; verified: boolean }>) {
  const out = new Map<string, { calls: number; agreed: number; verified: number }>();
  for (const a of attempts) {
    const k = a.by ?? "—";
    const e = out.get(k) ?? { calls: 0, agreed: 0, verified: 0 };
    e.calls++;
    if (a.outcome === "converted") {
      e.agreed++;
      if (a.verified) e.verified++;
    }
    out.set(k, e);
  }
  return out;
}
