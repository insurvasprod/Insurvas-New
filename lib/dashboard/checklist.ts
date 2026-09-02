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

const SETUP_STEPS = [
  { key: "carriers", label: "Add your carriers", path: "/app/settings" },
  { key: "statement", label: "Upload a carrier statement", path: "/app/settings" },
  { key: "appointments", label: "Confirm your appointments", path: "/app/settings" },
  { key: "lead-sources", label: "Add your lead sources", path: "/app/settings" },
  { key: "phone", label: "Connect your phone number", path: "/app/settings" },
] as const;

/**
 * Onboarding completion is already persisted on tenants. Until the platform has per-step
 * completion timestamps, the honest progress signal is 0/5 for an unfinished tenant and 5/5 at
 * the durable completed state. This avoids pretending that a recommended step list is progress.
 */
export function setupChecklistForState(onboardingState: string): SetupChecklist {
  const complete = onboardingState === "completed";
  return {
    complete,
    completed: complete ? SETUP_STEPS.length : 0,
    total: SETUP_STEPS.length,
    steps: SETUP_STEPS.map((step) => ({ ...step, complete })),
  };
}

export function setupStepDefinitions(): readonly Omit<SetupChecklistStep, "complete">[] {
  return SETUP_STEPS;
}
