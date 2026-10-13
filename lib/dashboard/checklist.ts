export type SetupChecklistStep = {
  key: string;
  label: string;
  path: string;
  /** What the link does, said on the row and to a screen reader: not every step is a settings tab. */
  action: string;
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
  { key: "carriers", label: "Add your carriers", path: "/app/settings#carrier-library", action: "Open settings tab" },
  // LA-4.6: straight to the import, which is the activation step ("You appear to be owed $X").
  { key: "statement", label: "Upload a carrier statement", path: "/app/statements?import=1", action: "Import a statement" },
  { key: "appointments", label: "Confirm your appointments", path: "/app/settings#states-licences", action: "Open settings tab" },
  { key: "lead-sources", label: "Add your lead sources", path: "/app/publishers", action: "Open lead sources" },
  { key: "phone", label: "Connect your phone number", path: "/app/settings#agency-profile", action: "Open settings tab" },
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"];

/**
 * The durable fact behind each step, read server-side by `loadSetupProgress` (setupProgress.ts).
 * A missing or false field means "not proven yet", never "failed": a read that errors leaves the
 * step undone rather than breaking the dashboard.
 */
export type SetupProgress = {
  /** LA-4.6 · a carrier statement that stands (not voided). */
  statementImported?: boolean;
  /** An active row in the tenant's carrier library (tenant_carriers.is_active). */
  carriersAdded?: boolean;
  /** An agency appointment still in force (appointments.terminated_at is null). */
  appointmentsConfirmed?: boolean;
  /** A lead source on the Partners screen that is not offboarded (partners.status). */
  leadSourcesAdded?: boolean;
  /** The agency's phone on the agency profile tab (tenants.support_phone). */
  phoneAdded?: boolean;
  /**
   * LA-0.3 "disappears once complete and does not come back": tenants.setup_checklist_completed_at
   * is set the first time every step is done, and from then on the checklist is finished even if a
   * fact later stops holding (a carrier switched off, a lead source offboarded).
   */
  finished?: boolean;
};

const PROGRESS_FIELD: Record<SetupStepKey, keyof SetupProgress> = {
  carriers: "carriersAdded",
  statement: "statementImported",
  appointments: "appointmentsConfirmed",
  "lead-sources": "leadSourcesAdded",
  phone: "phoneAdded",
};

/**
 * Each step is done when its own durable fact is true — so the checklist moves one row at a time
 * as the owner works through it, instead of jumping from 0/5 to 5/5 at the end of onboarding.
 *
 * A finished onboarding does NOT tick the steps (owner decision 2026-10-13, "show until done").
 * Checkout writes the finished onboarding state before the agency has set anything up, so counting
 * it hid the checklist from every new agency on its first visit. `onboardingState` stays in the
 * signature for the callers; only the stamp in `progress.finished` closes the checklist for good.
 */
export function setupChecklistForState(onboardingState: string, progress: SetupProgress = {}): SetupChecklist {
  const finished = progress.finished === true;
  const steps = SETUP_STEPS.map((step) => ({ ...step, complete: finished || progress[PROGRESS_FIELD[step.key]] === true }));
  const completed = steps.filter((step) => step.complete).length;
  return { complete: completed === steps.length, completed, total: steps.length, steps };
}

/** One existence read as Supabase returns it: rows (or one row) and an error. */
export type ExistenceRead = { data?: unknown; error?: unknown } | null | undefined;

/**
 * Whether an existence read proves its step. An error — a table or column not migrated yet, a
 * timeout — proves nothing, so the step stays undone and the dashboard still renders.
 */
export function readFoundRow(read: ExistenceRead): boolean {
  if (!read || read.error) return false;
  return Array.isArray(read.data) ? read.data.length > 0 : read.data != null;
}

/** The phone step reads one tenants row; a blank or missing support_phone is no phone. */
export function readHasPhone(read: ExistenceRead): boolean {
  if (!readFoundRow(read)) return false;
  const phone = (read?.data as { support_phone?: unknown }).support_phone;
  return typeof phone === "string" && phone.trim().length > 0;
}

export function setupStepDefinitions(): readonly Omit<SetupChecklistStep, "complete">[] {
  return SETUP_STEPS;
}
