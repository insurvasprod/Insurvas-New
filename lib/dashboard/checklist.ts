import { BOOK_IMPORT_SETUP_STEP, LEAD_SOURCE_SETUP_STEP, ROUTED_LEAD_SOURCES } from "../signup/constants.ts";

/**
 * The module a step belongs to: the setup page groups its steps under these, in this order, and a
 * module the plan did not buy has no steps at all (Basic Idea §6: absent, never greyed).
 */
export const SETUP_MODULES = [
  { key: "book", label: "Book of business" },
  { key: "account", label: "Your agency" },
  { key: "outbound", label: "Outbound" },
  { key: "inbound", label: "Inbound" },
  { key: "pipeline", label: "Pipeline" },
  { key: "sell", label: "Applications" },
  { key: "retention", label: "Retention" },
  { key: "compliance", label: "Compliance" },
  { key: "accounting", label: "Accounting" },
  { key: "agency", label: "Agency" },
  { key: "work", label: "Your work" },
] as const;

export type SetupModuleKey = (typeof SETUP_MODULES)[number]["key"];

export type SetupChecklistStep = {
  key: string;
  label: string;
  path: string;
  /** What the link does, said on the row and to a screen reader: not every step is a settings tab. */
  action: string;
  module: SetupModuleKey;
  /** The one-line instruction the guide bar shows on the destination screen. */
  instruction: string;
  /** Why the step matters, behind an InfoTip on the setup page (UI-CONSISTENCY rule 9). */
  why: string;
  /** `data-guide` on the control the guide bar outlines; absent = the bar alone. */
  target?: string;
  /**
   * Rough minutes the step takes, shown as "About N min" on the setup page (redesign, 2026-10-24).
   * Honest round figures for a first pass with the data to hand, not a promise; absent = no estimate.
   */
  minutes?: number;
  complete: boolean;
  /** Put aside by the reader ("skip it and come back", Basic Idea step 8). Not done, not blocking. */
  skipped?: boolean;
};

export type SetupChecklist = {
  /** Every step done or skipped. */
  complete: boolean;
  completed: number;
  skipped: number;
  total: number;
  steps: SetupChecklistStep[];
};

type StepDefinition = Omit<SetupChecklistStep, "complete" | "skipped">;

/**
 * Every step used to point at `/app/settings`, which renders ten tabs — so the reader clicked a
 * specific instruction and was dropped at the top of a ten-tab page to find it themselves.
 *
 * `AgentSettingsTabs` already selects a tab from the URL hash, so the fix is the destination, not
 * the component. The steps that are not settings go to the screens that actually own them.
 *
 * Order is the order a new agency should work in. The first five keep the Basic Idea step 8 order
 * (carriers first: "nothing downstream is correct without it"); the 2026-10-21 walkthrough adds the
 * day-one work of an agency that dials and takes transfers — team, leads, hours, assignment and the
 * outcome-to-stage map that moves a lead (QA 2026-10-22: new tenants have none) — then the settings
 * each further module needs before it can be trusted.
 */
const SETUP_STEPS = [
  { key: "carriers", module: "book", label: "Add your carriers", path: "/app/settings#carriers", action: "Open settings tab", target: "carrier-library-add",
    instruction: "Tick the carriers you are contracted with. Contract level and writing number are optional.",
    why: "Every other step uses your carriers, so this comes first." },
  // LA-4.6: straight to the import, which is the activation step ("You appear to be owed $X").
  { key: "statement", module: "book", label: "Upload a carrier statement", path: "/app/statements?import=1", action: "Import a statement",
    instruction: "Drop in your latest carrier statement — PDF, Excel or CSV.",
    why: "One statement is enough to show what you are owed and what was paid wrong." },
  { key: "appointments", module: "book", label: "Confirm your appointments", path: "/app/settings#carriers/carriers-states", action: "Open settings tab",
    instruction: "Confirm the states and carriers you are appointed with.",
    why: "Leads and applications are only routed to agents who are appointed for that state and carrier." },
  { key: "lead-sources", module: "inbound", label: "Add your lead sources", path: "/app/publishers", action: "Open lead sources", target: "publisher-add",
    instruction: "Add each publisher or vendor that sends you leads, and how you pay them.",
    why: "Cost per sale and lead-source scorecards are worked out per source." },
  { key: "phone", module: "account", label: "Connect your phone number", path: "/app/settings#business-identity/identity-partner-support", action: "Open settings tab",
    instruction: "Enter the phone number clients and partners should call.",
    why: "It appears on documents and partner messages sent from your workspace." },
  { key: "team", module: "account", label: "Invite your team", path: "/app/settings#team-access", action: "Open settings tab", target: "team-invite",
    instruction: "Invite each person who works with you and give them a role.",
    why: "A role decides which screens a person sees and which leads they can work." },
  { key: "import", module: "outbound", label: "Import your leads", path: "/app/import", action: "Import leads", target: "lead-import-upload",
    instruction: "Upload a CSV of leads, match its columns, and review before it lands.",
    why: "Imported leads are checked against do-not-call lists and duplicates before anyone dials them." },
  { key: "calling-windows", module: "outbound", label: "Set your calling hours", path: "/app/settings#calling-windows", action: "Open settings tab", target: "calling-windows-save",
    instruction: "Choose the hours your agency dials. Federal and state limits always apply on top.",
    why: "The dialer never offers a lead outside these hours in the lead's own time zone." },
  { key: "assign", module: "outbound", label: "Assign leads to your agents", path: "/app/assignments", action: "Open assignments", target: "assignments-assign",
    instruction: "Give a lead list, or single leads, to the agents who will call them.",
    why: "An agent's dialer queue only holds the leads assigned to them." },
  { key: "outcomes", module: "pipeline", label: "Map call outcomes to stages", path: "/app/settings#pipelines", action: "Open settings tab", target: "pipeline-outcomes",
    instruction: "Pick the pipeline stage each call outcome moves a lead to.",
    why: "Until an outcome has a stage, recording it leaves the lead where it was." },
  { key: "queue-sla", module: "inbound", label: "Set how fast transfers must be claimed", path: "/app/settings#queue-sla", action: "Open settings tab", target: "queue-sla-save",
    instruction: "Set when an unclaimed transfer warns, escalates and expires.",
    why: "These times drive the Agent Floor alerts and when the partner is told." },
  // 2026-10-27: Carrier details folded into Settings › Carriers; the carrier facts are Insurvas's now,
  // so this step is the carrier card's To finish list (products, states; the contract is optional).
  { key: "sales-carriers", module: "sell", label: "Finish a carrier so you can sell it", path: "/app/settings#carriers", action: "Open settings tab",
    instruction: "Tick the products you sell and the states you're appointed in. Contract level and writing number are optional.",
    why: "Each carrier on Carriers shows what is left; once it is done it reads Ready to sell." },
  { key: "disclosures", module: "sell", label: "Publish your disclosures", path: "/app/settings#sales-disclosures", action: "Open settings tab",
    instruction: "Write or copy the disclosures your applications need, then publish them.",
    why: "A required disclosure must be read before an application can be submitted." },
  { key: "retention", module: "retention", label: "Set your retention rules", path: "/app/retention-settings", action: "Open retention settings",
    instruction: "Choose which risk bands reach the save queue.",
    why: "The save queue only shows policies at or above the band you choose here." },
  { key: "compliance", module: "compliance", label: "Set your compliance rules", path: "/app/compliance/settings", action: "Open compliance settings",
    instruction: "Review how long each kind of record is kept.",
    why: "Records are deleted or held on these rules, so check them before your first call." },
  { key: "accounting", module: "accounting", label: "Set up accounting", path: "/app/accounting-settings", action: "Open accounting settings",
    instruction: "Set the invoice tolerance your books should flag.",
    why: "Vendor invoices off by more than this are flagged for review." },
  { key: "hierarchy", module: "agency", label: "Set your hierarchy", path: "/app/hierarchy", action: "Open hierarchy",
    instruction: "Place each producer under their upline.",
    why: "Overrides and producer pay follow this hierarchy." },
] as const satisfies readonly StepDefinition[];

/**
 * Shown only when the business profile recommended it (the owner ticked "existing book of
 * business"), right after the statement step: the book import is the other half of "bring your data".
 */
const BOOK_STEP = { key: "book", module: "book", label: "Import your existing book", path: "/app/book-import", action: "Import your book",
  instruction: "Upload the policy reports your carriers sent you.",
  why: "Your in-force book is what retention and commission checks work from." } as const satisfies StepDefinition;

export type SetupStepKey = (typeof SETUP_STEPS)[number]["key"] | (typeof BOOK_STEP)["key"];

/**
 * The plan features each step's destination needs, ALL of them (lib/menu/definition.ts and the
 * settings registry gate those screens on exactly these; a settings tab can need one feature while
 * the step only makes sense with another — outcomes live under book_of_business but only matter to
 * a plan that dials or takes transfers, see STEP_ANY_OF). A step the plan cannot do is left out, not
 * shown as a dead link: on Ledger and Pro, "Add your lead sources" opened /app/publishers, which
 * needs publisher_records, so the checklist could never complete. [] = every plan.
 */
const STEP_FEATURES: Record<SetupStepKey, readonly string[]> = {
  carriers: ["appointment_vault"],
  statement: ["statement_ingestion"],
  appointments: ["appointment_vault"],
  "lead-sources": ["publisher_records"],
  phone: [],
  team: [],
  book: ["statement_ingestion"],
  import: ["lead_import"],
  "calling-windows": ["outbound_dialing"],
  assign: ["outbound_dialing"],
  outcomes: ["book_of_business"],
  "queue-sla": ["book_of_business", "inbound_transfers"],
  "sales-carriers": ["applications"],
  disclosures: ["applications"],
  retention: ["chargeback_radar"],
  compliance: ["tcpa_checker"],
  accounting: ["profit_and_loss"],
  hierarchy: ["team_hierarchy"],
};

/** And at least one of these, when listed: the work the step serves. */
const STEP_ANY_OF: Partial<Record<SetupStepKey, readonly string[]>> = {
  outcomes: ["outbound_dialing", "inbound_transfers"],
};

/** What the signup business profile saved (business_profiles), as the checklist reads it. */
export type SetupProfileFacts = {
  leadSources?: readonly string[] | null;
  recommendedSetupSteps?: readonly string[] | null;
};

/** Who the walkthrough is for: the owner sets the agency up; an invited member learns their work. */
export type SetupAudience = "owner" | "member";

/** The reader's own marks, from tenant_setup_guide: steps put aside, and read-only steps they ticked. */
export type SetupGuideMarks = {
  skipped?: readonly string[] | null;
  done?: readonly string[] | null;
};

export type SetupChecklistContext = {
  /** The features the tenant can use (after kill switches). Absent = no gating (tests, previews). */
  features?: Iterable<string> | null;
  /** The saved business profile; absent = no profile, so every step the plan allows is shown. */
  profile?: SetupProfileFacts | null;
  /**
   * The plan's seat limit (entitlement.limits.max_seats): null = unlimited. "Invite your team" needs
   * room for a second person; undefined means the caller did not say, so the step is left out unless
   * nothing is gated at all.
   */
  seats?: number | null;
  /** Owner (default) or member; a member's steps come from their roles. */
  audience?: SetupAudience;
  /** A member's roles (base role first, as resolveTenantContext gives them). */
  roles?: readonly string[] | null;
  /** Pages the owner hid from this member (custom team access): a step there is left out. */
  hiddenPages?: readonly string[] | null;
  marks?: SetupGuideMarks | null;
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
export function applicableSetupSteps(context: SetupChecklistContext = {}): StepDefinition[] {
  if (context.audience === "member") return memberSetupSteps(context);
  const granted = context.features ? new Set(context.features) : null;
  const allowed = (key: SetupStepKey) => {
    if (granted === null) return true;
    if (key === "team" && !(context.seats === null || (typeof context.seats === "number" && context.seats > 1))) return false;
    const anyOf = STEP_ANY_OF[key];
    return STEP_FEATURES[key].every((feature) => granted.has(feature)) && (!anyOf || anyOf.some((feature) => granted.has(feature)));
  };
  const steps: StepDefinition[] = [];
  for (const step of SETUP_STEPS) {
    if (step.key === "lead-sources" && !wantsLeadSources(context.profile)) continue;
    if (allowed(step.key)) steps.push(step);
    if (step.key === "statement" && wantsBookImport(context.profile) && allowed(BOOK_STEP.key)) steps.push(BOOK_STEP);
  }
  return steps;
}

/**
 * An invited member's walkthrough (2026-10-21, outside Notion: the owner asked that the people they
 * invite learn their own work). Short, and only what their role and the plan let them open — the
 * same gates as the menu (lib/menu/definition.ts), so no step leads to a screen they are refused.
 * `manual` steps have no fact behind them (reading a screen proves nothing), so the reader ticks them.
 */
type MemberStepDefinition = StepDefinition & { feature: string; roles: readonly string[]; manual?: true; page: string };

const MEMBER_STEPS: readonly MemberStepDefinition[] = [
  { key: "first-call", module: "work", label: "Call your first lead", path: "/app/dialer", action: "Open the dialer", feature: "outbound_dialing", roles: ["producer", "setter"], page: "leads.dialer", target: "dialer-next",
    instruction: "Take the next lead in your queue and call it.",
    why: "Your queue holds the leads assigned to you, inside the agency's calling hours." },
  { key: "first-transfer", module: "work", label: "Take your first caller", path: "/app/inbound", action: "Open Inbound", feature: "inbound_transfers", roles: ["producer", "assistant"], page: "leads.inbound", target: "inbound-claim",
    instruction: "Claim the next transfer waiting in the inbox.",
    why: "An unclaimed transfer escalates after a few minutes, so claim it fast." },
  { key: "first-outcome", module: "work", label: "Record a call outcome", path: "/app/dialer", action: "Open the dialer", feature: "outbound_dialing", roles: ["producer", "setter"], page: "leads.dialer", target: "disposition-open",
    instruction: "After a call, record what happened before you take the next lead.",
    why: "The outcome moves the lead to its pipeline stage and books any callback." },
  { key: "statements", module: "work", label: "Review carrier statements", path: "/app/statements", action: "Open statements", feature: "statement_ingestion", roles: ["bookkeeper"], page: "book.statements", manual: true,
    instruction: "Open the latest statement and check the rows we could not match.",
    why: "Unmatched rows are commission nobody has been credited with yet." },
  { key: "ledger", module: "work", label: "Open the commission ledger", path: "/app/ledger", action: "Open the ledger", feature: "commission_ledger", roles: ["producer", "bookkeeper"], page: "book.ledger", manual: true,
    instruction: "See what was earned, advanced and charged back, per policy.",
    why: "Every commission movement lands here, so it is where questions are answered." },
];

function memberSetupSteps(context: SetupChecklistContext): StepDefinition[] {
  const granted = context.features ? new Set(context.features) : null;
  const roles = new Set(context.roles ?? []);
  const hidden = new Set(context.hiddenPages ?? []);
  const steps: StepDefinition[] = [];
  for (const step of MEMBER_STEPS) {
    if (granted !== null && !granted.has(step.feature)) continue;
    if (!step.roles.some((role) => roles.has(role)) || hidden.has(step.page)) continue;
    const { feature: _feature, roles: _roles, page: _page, ...definition } = step;
    void _feature; void _roles; void _page;
    steps.push(definition);
  }
  return steps;
}

/** The member steps the reader ticks themselves (no durable fact proves a screen was understood). */
export function isManualStep(key: string): boolean {
  return MEMBER_STEPS.some((step) => step.key === key && step.manual === true);
}

/** Every step key that exists, owner and member: what the setup API accepts. */
export function isSetupStepKey(key: string): boolean {
  return key === BOOK_STEP.key || SETUP_STEPS.some((step) => step.key === key) || MEMBER_STEPS.some((step) => step.key === key);
}

/**
 * The step's destination with the guide bar switched on: `?guide=<key>` goes before any `#tab`, and
 * joins a query the path already has (the statement step opens the import with `?import=1`).
 */
export function guideHref(step: Pick<SetupChecklistStep, "key" | "path">): string {
  const [beforeHash, hash] = step.path.split("#", 2);
  const joiner = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${joiner}guide=${encodeURIComponent(step.key)}${hash ? `#${hash}` : ""}`;
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
  /** A second person on the workspace, invited or joined (tenant_users, non-owner). */
  teamInvited?: boolean;
  /** A lead import batch that completed (agent_lead_import_batches). */
  leadsImported?: boolean;
  /** The agency's own calling hours saved (tenant_calling_windows). */
  callingWindowsSet?: boolean;
  /** A lead with an owner in the queue (lead_queue.owner_user_id) or an active assignment rule. */
  leadsAssigned?: boolean;
  /** At least one outcome mapped to a stage (stage_dispositions). */
  outcomesMapped?: boolean;
  /** The unclaimed-lead ladder saved (tenant_queue_sla_settings). */
  queueSlaSet?: boolean;
  /** A carrier set up for applications (tenant_carrier_settings). */
  salesCarriersSet?: boolean;
  /** A disclosure of the agency's own, published (application_disclosures). */
  disclosuresPublished?: boolean;
  /** Retention bands saved (retention_settings). */
  retentionSet?: boolean;
  /** A retention rule of the agency's own (retention_rule). */
  complianceSet?: boolean;
  /** Accounting settings saved (accounting_settings). */
  accountingSet?: boolean;
  /** A producer placed under an upline (producer_hierarchy). */
  hierarchySet?: boolean;
  /** Member: a lead served to this person (tenant_lead_activity, any served row). */
  leadServed?: boolean;
  /** Member: an outcome this person recorded (tenant_lead_activity.dispositioned_at). */
  outcomeRecorded?: boolean;
  /** Member: a transfer this person claimed from the inbox (tenant_lead_activity with a work item). */
  transferClaimed?: boolean;
  /**
   * LA-0.3 "disappears once complete and does not come back": tenants.setup_checklist_completed_at
   * is set the first time every step is done, and from then on the checklist is finished even if a
   * fact later stops holding (a carrier switched off, a lead source offboarded).
   */
  finished?: boolean;
};

/**
 * Rough minutes per step (redesign, 2026-10-24), kept beside the definitions rather than inside each
 * so the long step lines stay readable. Rounded up for someone doing it the first time: a form is a
 * couple of minutes, an upload or an import with column matching ten, writing disclosures or a
 * hierarchy longer. A step not listed shows no estimate.
 */
const STEP_MINUTES: Partial<Record<string, number>> = {
  carriers: 5,
  statement: 3,
  book: 10,
  appointments: 5,
  "lead-sources": 5,
  phone: 1,
  team: 3,
  import: 10,
  "calling-windows": 2,
  assign: 5,
  outcomes: 5,
  "queue-sla": 2,
  "sales-carriers": 10,
  disclosures: 15,
  retention: 3,
  compliance: 5,
  accounting: 2,
  hierarchy: 10,
  "first-call": 5,
  "first-transfer": 2,
  "first-outcome": 2,
  statements: 5,
  ledger: 3,
};

const PROGRESS_FIELD: Record<string, keyof SetupProgress> = {
  carriers: "carriersAdded",
  statement: "statementImported",
  appointments: "appointmentsConfirmed",
  "lead-sources": "leadSourcesAdded",
  phone: "phoneAdded",
  book: "bookImported",
  team: "teamInvited",
  import: "leadsImported",
  "calling-windows": "callingWindowsSet",
  assign: "leadsAssigned",
  outcomes: "outcomesMapped",
  "queue-sla": "queueSlaSet",
  "sales-carriers": "salesCarriersSet",
  disclosures: "disclosuresPublished",
  retention: "retentionSet",
  compliance: "complianceSet",
  accounting: "accountingSet",
  hierarchy: "hierarchySet",
  "first-call": "leadServed",
  "first-transfer": "transferClaimed",
  "first-outcome": "outcomeRecorded",
} satisfies Record<SetupStepKey, keyof SetupProgress> & Record<string, keyof SetupProgress>;

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
 *
 * A skipped step (context.marks) is put aside, not done: it stays listed with Skip undone, and the
 * checklist counts as complete once every step is done or skipped — Basic Idea step 8, "Ray can skip
 * any step and come back". A manual member step is done when the reader ticked it.
 */
export function setupChecklistForState(onboardingState: string, progress: SetupProgress = {}, context: SetupChecklistContext = {}): SetupChecklist {
  const finished = progress.finished === true;
  const skippedKeys = new Set(context.marks?.skipped ?? []);
  const doneKeys = new Set(context.marks?.done ?? []);
  const steps = applicableSetupSteps(context).map((step) => {
    const field = PROGRESS_FIELD[step.key];
    const proven = (field !== undefined && progress[field] === true) || (isManualStep(step.key) && doneKeys.has(step.key));
    // Finished holds every step done ("does not come back") — except one the reader skipped, which
    // stays shown as skipped rather than claiming work that was never done (live walkthrough, 2026-10-22).
    const complete = proven || (finished && !skippedKeys.has(step.key));
    const minutes = step.minutes ?? STEP_MINUTES[step.key];
    return { ...step, ...(minutes ? { minutes } : {}), complete, skipped: !complete && skippedKeys.has(step.key) };
  });
  const completed = steps.filter((step) => step.complete).length;
  const skipped = steps.filter((step) => step.skipped).length;
  return { complete: completed + skipped === steps.length, completed, skipped, total: steps.length, steps };
}

/** The step the reader should do next: the first one neither done nor skipped. */
export function nextSetupStep(checklist: SetupChecklist): SetupChecklistStep | null {
  return checklist.steps.find((step) => !step.complete && !step.skipped) ?? null;
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

/** The owner's steps, every one, whatever the plan (the profile-only book step aside). */
export function setupStepDefinitions(): readonly StepDefinition[] {
  return SETUP_STEPS;
}
