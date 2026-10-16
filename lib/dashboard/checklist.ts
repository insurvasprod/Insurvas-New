import { BOOK_IMPORT_SETUP_STEP, LEAD_SOURCE_SETUP_STEP, ROUTED_LEAD_SOURCES } from "../signup/constants.ts";

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
  { key: "phone", label: "Connect your phone number", path: "/app/settings#business-identity/identity-partner-support", action: "Open settings tab" },
] as const;

/**
 * Shown only when the business profile recommended it (the owner ticked "existing book of
 * business"), right after the statement step: the book import is the other half of "bring your data".
 */
const BOOK_STEP = { key: "book", label: "Import your existing book", path: "/app/book-import", action: "Import your book" } as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"] | (typeof BOOK_STEP)["key"];

/**
 * The plan feature each step's destination needs (lib/menu/definition.ts and the settings registry
 * gate those screens on exactly these). A step the plan cannot do is left out, not shown as a dead
 * link: on Ledger and Pro, "Add your lead sources" opened /app/publishers, which needs
 * publisher_records, so the checklist could never complete. null = every plan (the owner's own
 * Business identity tab).
 */
const STEP_FEATURE: Record<SetupStepKey, string | null> = {
  carriers: "appointment_vault",
  statement: "statement_ingestion",
  appointments: "appointment_vault",
  "lead-sources": "publisher_records",
  phone: null,
  book: "statement_ingestion",
};

/** What the signup business profile saved (business_profiles), as the checklist reads it. */
export type SetupProfileFacts = {
  leadSources?: readonly string[] | null;
  recommendedSetupSteps?: readonly string[] | null;
};

export type SetupChecklistContext = {
  /** The features the tenant can use (after kill switches). Absent = no gating (tests, previews). */
  features?: Iterable<string> | null;
  /** The saved business profile; absent = no profile, so every step the plan allows is shown. */
  profile?: SetupProfileFacts | null;
};

/**
 * Basic Idea, step 8.4: lead sources are "only shown if he ticked the relevant boxes in step 5" — a
 * referrals-only agent has nothing to route. The saved recommendation decides; a profile saved
 * without one falls back to the lead sources it ticked; no profile at all keeps the step.
 */
function wantsLeadSources(profile: SetupProfileFacts | null | undefined): boolean {
  if (!profile) return true;
  const recommended = profile.recommendedSetupSteps ?? [];
  if (recommended.length > 0) return recommended.includes(LEAD_SOURCE_SETUP_STEP);
  const sources = profile.leadSources ?? [];
  if (sources.length > 0) return sources.some((source) => ROUTED_LEAD_SOURCES.includes(source));
  return true;
}

function wantsBookImport(profile: SetupProfileFacts | null | undefined): boolean {
  if (!profile) return false;
  const recommended = profile.recommendedSetupSteps ?? [];
  if (recommended.length > 0) return recommended.includes(BOOK_IMPORT_SETUP_STEP);
  return (profile.leadSources ?? []).includes("existing_book");
}

/** The steps this tenant's checklist has: the plan's features and the business profile decide. */
export function applicableSetupSteps(context: SetupChecklistContext = {}): Omit<SetupChecklistStep, "complete">[] {
  const granted = context.features ? new Set(context.features) : null;
  const allowed = (key: SetupStepKey) => {
    const feature = STEP_FEATURE[key];
    return granted === null || feature === null || granted.has(feature);
  };
  const steps: Omit<SetupChecklistStep, "complete">[] = [];
  for (const step of SETUP_STEPS) {
    if (step.key === "lead-sources" && !wantsLeadSources(context.profile)) continue;
    if (allowed(step.key)) steps.push(step);
    if (step.key === "statement" && wantsBookImport(context.profile) && allowed(BOOK_STEP.key)) steps.push(BOOK_STEP);
  }
  return steps;
}

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
  /** A policy from the agency's carrier files (policy_current): the book import landed. */
  bookImported?: boolean;
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
  book: "bookImported",
};

/**
 * Each step is done when its own durable fact is true — so the checklist moves one row at a time
 * as the owner works through it, instead of jumping from 0/5 to 5/5 at the end of onboarding.
 *
 * A finished onboarding does NOT tick the steps (owner decision 2026-10-13, "show until done").
 * Checkout writes the finished onboarding state before the agency has set anything up, so counting
 * it hid the checklist from every new agency on its first visit. `onboardingState` stays in the
 * signature for the callers; only the stamp in `progress.finished` closes the checklist for good.
 *
 * `context` decides which steps exist (applicableSetupSteps): the plan's features and the saved
 * business profile. A plan that cannot do a step never sees it, so every plan can finish.
 */
export function setupChecklistForState(onboardingState: string, progress: SetupProgress = {}, context: SetupChecklistContext = {}): SetupChecklist {
  const finished = progress.finished === true;
  const steps = applicableSetupSteps(context).map((step) => ({ ...step, complete: finished || progress[PROGRESS_FIELD[step.key as SetupStepKey]] === true }));
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
