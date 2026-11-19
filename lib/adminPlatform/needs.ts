// Admin › Platform workspace and rail badges (admin round 1, owner 2026-11-18): what each Platform page already shows
// as waiting on an admin, gathered into one "Needs a look" list and the rail's waiting counts. Pure and import-free, so
// the workspace, GET /api/admin/platform/steps and node:test (needs.test.mjs) share it. The reads live in reads.ts.
// Twin: lib/adminCatalog/needs.ts.
//
// Every queue is `undefined` when the role may not open its page (it is never read) and `null` when its read failed
// (the row says it couldn't be checked; the badge is left out, never sent as 0).

export type PlatformQueues = {
  /** Compliance: the screening vendors and the dial gate's own verdict. */
  compliance?: { registered: number; enabled: number; unreachable: number; blocked: boolean; demo: boolean } | null;
  /** Disclosures: proposals waiting for review and the coverage the dialer reads. */
  disclosures?: { pending: number; oldestPending: string | null; placeholders: number; uncovered: number; statesCovered: number; available: boolean } | null;
  /** Calling rules: the rules feed's last review. `reviewedAt` null when no review was ever recorded. */
  calling?: { stale: boolean; reviewedAt: string | null; staleAfterDays: number | null } | null;
  /** Mail setup: the delivery switch and the names of settings not set (names only, never values). */
  mail?: { smtp: boolean; missing: string[] } | null;
  /** Maintenance: the level in force, a level saved for later, and the announcements customers see now. */
  maintenance?: { on: string | null; scheduled: string | null; announcementsLive: number | null } | null;
  /** Advanced: settings this role may change, and how many differ from the default. */
  advanced?: { settings: number; overridden: number } | null;
  /** Admin users: active staff, those not enrolled in two-factor sign-in, and active super admins. */
  admins?: { active: number; noTwoFactor: number; activeSuperAdmins: number } | null;
  /** Legal: drafts saved but not published (`docs` in doc order), and whether drafts exist on this database. */
  legal?: { drafts: number; docs: string[]; supported: boolean } | null;
};

export type PlatformNeedTone = "act" | "review" | "unknown";

export type PlatformNeedRow = {
  key: string;
  title: string;
  detail: string;
  tone: PlatformNeedTone;
  href: string;
  /** What the row counts; 0 for a row that could not be checked. */
  count: number;
};

/** Where each row opens, filtered where the page reads a filter. */
export const PLATFORM_NEED_HREF = {
  compliance: "/admin/compliance-sources",
  disclosuresReview: "/admin/state-disclosures",
  disclosuresUncovered: "/admin/state-disclosures?show=not_covered",
  disclosuresPlaceholders: "/admin/state-disclosures?show=placeholders",
  calling: "/admin/calling-rules",
  mail: "/admin/email",
  maintenance: "/admin/system",
  admins: "/admin/admins",
  legal: "/admin/legal",
} as const;

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

/** "today", "1 day", "6 days": how long something has waited, by the request's clock. */
export function waitedWords(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const days = Math.floor(ms / 86_400_000);
  return days <= 0 ? "today" : plural(days, "day");
}

const STEP_NAME: Record<keyof PlatformQueues, string> = {
  compliance: "Compliance vendors",
  disclosures: "Disclosures",
  calling: "Calling rules",
  mail: "Mail setup",
  maintenance: "Maintenance",
  advanced: "Advanced settings",
  admins: "Admin users",
  legal: "Legal drafts",
};

const STEP_HREF: Record<keyof PlatformQueues, string> = {
  compliance: PLATFORM_NEED_HREF.compliance,
  disclosures: PLATFORM_NEED_HREF.disclosuresReview,
  calling: PLATFORM_NEED_HREF.calling,
  mail: PLATFORM_NEED_HREF.mail,
  maintenance: PLATFORM_NEED_HREF.maintenance,
  advanced: "/admin/advanced",
  admins: PLATFORM_NEED_HREF.admins,
  legal: PLATFORM_NEED_HREF.legal,
};

/** Every row that waits on an admin, most urgent first ("act" before "review"; unreadable last). */
export function platformNeeds(queues: PlatformQueues, now: number): PlatformNeedRow[] {
  const rows: PlatformNeedRow[] = [];
  const unknown: PlatformNeedRow[] = [];
  for (const key of Object.keys(STEP_NAME) as (keyof PlatformQueues)[]) {
    if (queues[key] === null) unknown.push({ key: `${key}-unknown`, title: STEP_NAME[key], detail: "Couldn't be read just now. Open the page to check.", tone: "unknown", href: STEP_HREF[key], count: 0 });
  }

  const { compliance, disclosures, calling, mail, maintenance, admins, legal } = queues;
  if (compliance && !compliance.demo && compliance.blocked) {
    rows.push({ key: "dialing-blocked", title: "Dialing is blocked", detail: "No enabled DNC or litigator vendor is answering, so every dial on the platform is refused.", tone: "act", href: PLATFORM_NEED_HREF.compliance, count: 1 });
  }
  if (compliance && compliance.unreachable > 0) {
    rows.push({ key: "vendors-unreachable", title: "Screening vendors unreachable", detail: `${plural(compliance.unreachable, "enabled vendor")} failed every call in the last 24 hours`, tone: "act", href: PLATFORM_NEED_HREF.compliance, count: compliance.unreachable });
  }
  if (maintenance?.on) {
    rows.push({ key: "maintenance-on", title: "Maintenance is on", detail: `${maintenance.on}, in force for customers now`, tone: "act", href: PLATFORM_NEED_HREF.maintenance, count: 1 });
  }
  if (calling && calling.stale) {
    const after = calling.staleAfterDays === null ? "" : `; stale after ${plural(calling.staleAfterDays, "day")}`;
    const when = waitedWords(calling.reviewedAt, now);
    rows.push({ key: "calling-stale", title: "Calling rules review overdue", detail: `Last reviewed ${when === "today" ? "today" : when ? `${when} ago` : "never"}${after}, so every dial is refused`, tone: "act", href: PLATFORM_NEED_HREF.calling, count: 1 });
  }
  if (disclosures && disclosures.uncovered > 0) {
    rows.push({ key: "disclosures-uncovered", title: "Pairs with no disclosure", detail: `${plural(disclosures.uncovered, "state and product pair")} with no wording in force; the dialer refuses those calls`, tone: "act", href: PLATFORM_NEED_HREF.disclosuresUncovered, count: disclosures.uncovered });
  }
  if (disclosures && disclosures.pending > 0) {
    const oldest = waitedWords(disclosures.oldestPending, now);
    rows.push({ key: "disclosures-review", title: "Disclosure changes to review", detail: `${plural(disclosures.pending, "proposal")} waiting${oldest ? ` · oldest ${oldest === "today" ? "from today" : oldest}` : ""}`, tone: "review", href: PLATFORM_NEED_HREF.disclosuresReview, count: disclosures.pending });
  }
  if (disclosures && disclosures.placeholders > 0) {
    rows.push({ key: "disclosures-placeholder", title: "Placeholder disclosure wording", detail: `${plural(disclosures.placeholders, "disclosure")} in force ${disclosures.placeholders === 1 ? "is" : "are"} placeholder text; replace before live calls`, tone: "review", href: PLATFORM_NEED_HREF.disclosuresPlaceholders, count: disclosures.placeholders });
  }
  if (maintenance?.scheduled) {
    rows.push({ key: "maintenance-scheduled", title: "Maintenance scheduled", detail: `${maintenance.scheduled} is saved and starts later`, tone: "review", href: PLATFORM_NEED_HREF.maintenance, count: 1 });
  }
  if (mail && (!mail.smtp || mail.missing.length > 0)) {
    const detail = !mail.smtp
      ? `Delivery is off in this environment; emails are logged as skipped${mail.missing.length ? ` · ${plural(mail.missing.length, "setting")} not set` : ""}`
      : `Not sent from this environment: ${mail.missing.join(", ")} not set`;
    rows.push({ key: "mail-off", title: "Email is not being sent", detail, tone: "review", href: PLATFORM_NEED_HREF.mail, count: mail.missing.length || 1 });
  }
  if (admins && admins.noTwoFactor > 0) {
    rows.push({ key: "admins-2fa", title: "Admins without two-factor", detail: `${plural(admins.noTwoFactor, "active admin")} not enrolled yet; each enrols at their next sign-in`, tone: "review", href: PLATFORM_NEED_HREF.admins, count: admins.noTwoFactor });
  }
  if (admins && admins.activeSuperAdmins <= 1) {
    rows.push({ key: "admins-one-super", title: "One active super admin", detail: "Nobody else can manage staff if this account is lost", tone: "review", href: PLATFORM_NEED_HREF.admins, count: 1 });
  }
  if (legal && legal.drafts > 0) {
    rows.push({ key: "legal-drafts", title: "Unpublished legal drafts", detail: `${plural(legal.drafts, "draft")} saved and not published; customers still see the live version`, tone: "review", href: legal.docs[0] ? `${PLATFORM_NEED_HREF.legal}?doc=${legal.docs[0]}` : PLATFORM_NEED_HREF.legal, count: legal.drafts });
  }
  return [...rows.filter((row) => row.tone === "act"), ...rows.filter((row) => row.tone === "review"), ...unknown];
}

/** How many things need a look: every row that could be read (an unreadable queue is not counted as 0 or as 1). */
export function needsTotal(queues: PlatformQueues, now: number): number | null {
  const parts = Object.values(queues);
  if (parts.length > 0 && parts.every((part) => part === null)) return null;
  return platformNeeds(queues, now).filter((row) => row.tone !== "unknown").length;
}

/**
 * The rail's badges (GET /api/admin/platform/steps), for the steps the role may open. A count whose read failed is
 * left out, never sent as 0 (lib/adminPlatform/steps.ts PLATFORM_WAITING names what each counts).
 */
export function platformStepCounts(queues: PlatformQueues, steps: ReadonlySet<string>, now: number): Record<string, number> {
  const counts: Record<string, number> = {};
  const put = (step: string, value: number | null | undefined) => {
    if (steps.has(step) && typeof value === "number") counts[step] = value;
  };
  put("workspace", needsTotal(queues, now));
  put("compliance", queues.compliance ? queues.compliance.unreachable : null);
  put("disclosures", queues.disclosures ? queues.disclosures.pending : null);
  put("calling", queues.calling ? (queues.calling.stale ? 1 : 0) : null);
  put("mail", queues.mail ? queues.mail.missing.length : null);
  put("maintenance", queues.maintenance ? (queues.maintenance.on ? 1 : 0) + (queues.maintenance.scheduled ? 1 : 0) : null);
  put("admins", queues.admins ? queues.admins.noTwoFactor : null);
  put("legal", queues.legal ? queues.legal.drafts : null);
  return counts;
}
