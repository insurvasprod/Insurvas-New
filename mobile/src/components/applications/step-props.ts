import type { StepKey } from "./logic";
import type { AttemptView, CaseView, InterviewView } from "./types";
import type { CaseHandle } from "./use-case";

/** What the screen host hands every step: the case as read, its writes, and the way around the steps. */
export type StepProps = {
  caseView: CaseView;
  attempt: AttemptView;
  interview: InterviewView | null;
  actions: CaseHandle["actions"];
  /** "American Amicable", or the product while no carrier is picked. */
  carrier: string;
  /** The insured's first name, for the back button and the sentences read aloud. */
  firstName: string;
  /** This step's place among the ten (0-based), for the bars. */
  index: number;
  total: number;
  /** Back: the header's arrow (the screen the application was opened from). */
  leave: () => void;
  goTo: (step: StepKey) => void;
  /** The step after this one. */
  next: () => void;
  /** The step before this one. */
  previous: () => void;
  openSteps: () => void;
  /** The carrier, tier and coverage picked on Quick quote (E1), carried into the case's Quote step. */
  pick?: { carrierId: string | null; tier: string | null; faceCents: number | null };
};
