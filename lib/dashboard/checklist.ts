import { isOnboardingComplete } from "../signup/constants.ts";

export type SetupChecklistStep = {
  key: string;
  label: string;
  path: string;
  complete: boolean;
};

export type SetupChecklist = {
  complete: boolean;
  completed: number;
  total: number;
  steps: SetupChecklistStep[];
};

/**
 * Every step used to point at `/app/settings`, which renders ten tabs — so the reader clicked a
 * specific instruction and was dropped at the top of a ten-tab page to find it themselves.
 *
 * `AgentSettingsTabs` already selects a tab from the URL hash, so the fix is the destination, not
 * the component. The two steps that are not settings go to the screens that actually own them.
 */
const SETUP_STEPS = [
  { key: "carriers", label: "Add your carriers", path: "/app/settings#carrier-library" },
  // LA-4.6: straight to the import, which is the activation step ("You appear to be owed $X").
  { key: "statement", label: "Upload a carrier statement", path: "/app/statements?import=1" },
  { key: "appointments", label: "Confirm your appointments", path: "/app/settings#states-licences" },
  { key: "lead-sources", label: "Add your lead sources", path: "/app/publishers" },
  { key: "phone", label: "Connect your phone number", path: "/app/settings#agency-profile" },
] as const;

/**
 * Onboarding completion is already persisted on tenants. Until the platform has per-step
 * completion timestamps, the honest progress signal is 0/5 for an unfinished tenant and 5/5 at
 * the durable completed state. This avoids pretending that a recommended step list is progress.
 *
 * The comparison goes through `isOnboardingComplete` because the column holds **two spellings** of
 * the finished state. This line read `onboardingState === "completed"`, which matched 197 tenants
 * and missed the 383 stored as `"complete"` — so two thirds of the platform saw a permanent
 * "0 of 5" checklist telling them to redo setup they had already finished.
 */
export function setupChecklistForState(onboardingState: string, progress: { statementImported?: boolean } = {}): SetupChecklist {
  const complete = isOnboardingComplete(onboardingState);
  // LA-4.6: the one step with its own durable signal. A statement that stands (not voided) means the
  // step is done, whatever the onboarding state says.
  const steps = SETUP_STEPS.map((step) => ({ ...step, complete: complete || (step.key === "statement" && Boolean(progress.statementImported)) }));
  const completed = steps.filter((step) => step.complete).length;
  return { complete: completed === steps.length, completed, total: steps.length, steps };
}

export function setupStepDefinitions(): readonly Omit<SetupChecklistStep, "complete">[] {
  return SETUP_STEPS;
}
