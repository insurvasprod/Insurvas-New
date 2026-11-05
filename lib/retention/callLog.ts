import { ACTION_TAKEN, type ActionTaken, type ContactOutcome } from "./constants.ts";

/** What the agent did on the call, as the log and the form name it. */
export const ACTION_LABELS: Record<ActionTaken, string> = {
  none: "Nothing changed",
  move_draft_date: "Agreed to move the payment date",
  convert_to_draft: "Agreed to switch to bank payment",
  confirm_card_funded: "Confirmed the card will be funded",
  confirm_account: "Confirmed the account",
  review_coverage: "Reviewed the coverage",
  courtesy_call: "Courtesy check-in",
};

/**
 * Logging a save call (LA-5.3), on the card's page since 2026-11-05. "What you did" follows what happened,
 * so a call can't be logged as refused and agreed at once (the old pop-up offered every action on every
 * outcome). The card's suggested fixes come first where they fit.
 *
 *   reached, agreed   any action but "nothing changed"
 *   reached, said no  nothing changed, reviewed the coverage, a courtesy check-in
 *   already fixed     nothing changed, confirmed the account or the card
 *   not reached       nothing changed (voicemail, no answer, wrong number): no choice to make
 */
export function actionsFor(outcome: ContactOutcome | "", suggested: readonly ActionTaken[]): ActionTaken[] {
  const allowed: readonly ActionTaken[] =
    outcome === "reached_agreed" ? ACTION_TAKEN.filter((a) => a !== "none")
      : outcome === "reached_refused" ? ["none", "review_coverage", "courtesy_call"]
        : outcome === "already_fixed" ? ["none", "confirm_account", "confirm_card_funded"]
          : ["none"];
  const first = suggested.filter((a) => allowed.includes(a));
  return [...new Set<ActionTaken>([...first, ...allowed])];
}

/** The action a form starts on for an outcome: the first suggested one that fits, else the first allowed. */
export function defaultActionFor(outcome: ContactOutcome | "", suggested: readonly ActionTaken[]): ActionTaken {
  return actionsFor(outcome, suggested)[0] ?? "none";
}

/** Not reached, so there is nothing to choose: the form hides "What you did". */
export const isUnreached = (outcome: ContactOutcome | "") => outcome === "voicemail" || outcome === "no_answer" || outcome === "wrong_number";
