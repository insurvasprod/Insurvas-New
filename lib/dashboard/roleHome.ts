/**
 * The home screen per role (2026-10-09): which sections the dashboard shows, in what order, which
 * figures and "needs you" rows go in them, and the one to three actions in the "Your day" header.
 *
 * Pure data and one resolver, so it is tested without a database or a render.
 *
 * Nothing here grants anything. Every section, figure, row and action names the menu entries
 * (`lib/menu/definition.ts`) of the page it opens, and is shown only when that page is in this
 * person's menu — the same feature (plan, after kill switches) and role gates the sidebar and the
 * pages apply. So a role never sees a tile for something it cannot open, by construction: a new gate
 * on a page moves the dashboard with it. Where an entry lists more than one menu key, the first one
 * this person can open is the link.
 *
 * A role's layout can only ever narrow what the gates allow: listing a section for a role does not
 * show it unless its page is open to them, and leaving it out hides it even when it is.
 */
import type { TenantRole } from "../tenantAuth/roles.ts";
import { allMenuItems } from "../menu/definition.ts";

/**
 * The blocks a home can hold.
 *
 *   closeOut      the appointment close-out strip (LA-2 decision 12), hidden when nothing to close
 *   pending       LA-3's Pending cases card (3.15 / 3.18 / 3.26)
 *   figures       the one StatStrip: today's numbers
 *   needs         "Needs you today": transfers, callbacks, lapse risk, licences
 *   callbacks     the callbacks due today list
 *   appointments  today's appointments (LA-2.11-8)
 *   activity      the analysis panels: 14 days of dialling, outcomes, best hour
 *   team          the team's standings beside the best-hour panel (agency scope)
 *   shortcuts     the tile registry's metrics grid (lib/dashboard/tiles.ts)
 *   setup         the setup checklist
 */
export type HomeSectionKey = "closeOut" | "pending" | "figures" | "needs" | "callbacks" | "appointments" | "activity" | "team" | "shortcuts" | "setup";

/** The figures the strip can hold. Each is a number `getDashboardToday` already reads. */
export type HomeFigureKey = "dials" | "reached" | "rate" | "appointments" | "dials7" | "premium" | "queue" | "booked";

/** The "needs you today" rows. */
export type HomeNeedKey = "transfers" | "callbacks" | "lapse" | "licences";

/** Menu keys, in order of preference. Empty means "no page of its own": its contents gate it. */
type Opens = readonly string[];

/**
 * Sections that read the streamed "today" data. The others render on their own (the close-out strip
 * and the pending card fetch for themselves; the shortcuts grid streams each figure; setup and
 * callbacks have their own reads).
 */
export const STREAMED_SECTIONS: ReadonlySet<HomeSectionKey> = new Set(["figures", "needs", "appointments", "activity", "team"]);

export const HOME_SECTIONS: Record<HomeSectionKey, { opens: Opens }> = {
  // The close-out strip also lives on Activity & scorecard; its route admits owner and producer,
  // which is why only those two layouts list it (a setter never records whether their own booking
  // showed — decision 12).
  closeOut: { opens: ["insight.activity"] },
  pending: { opens: ["sell.pending"] },
  figures: { opens: [] },
  needs: { opens: [] },
  callbacks: { opens: ["sell.callbacks"] },
  appointments: { opens: ["sell.calendar"] },
  activity: { opens: ["insight.activity"] },
  team: { opens: ["insight.activity"] },
  shortcuts: { opens: [] },
  setup: { opens: ["settings.root"] },
};

/** `money` marks a figure that is premium or commission: never on a setter's or assistant's home. */
export const HOME_FIGURES: Record<HomeFigureKey, { label: string; opens: Opens; money?: boolean }> = {
  dials: { label: "Dials today", opens: ["insight.activity"] },
  reached: { label: "Reached", opens: ["insight.activity"] },
  rate: { label: "Contact rate", opens: ["insight.activity"] },
  appointments: { label: "Appointments today", opens: ["sell.calendar"] },
  dials7: { label: "Dials · 7 days", opens: ["insight.activity"] },
  premium: { label: "Premium · 30 days", opens: ["book.policies"], money: true },
  queue: { label: "Queue ready", opens: ["leads.dialer"] },
  booked: { label: "Booked · 7 days", opens: ["insight.activity"] },
};

export const HOME_NEEDS: Record<HomeNeedKey, { label: string; opens: Opens }> = {
  transfers: { label: "Transfers waiting", opens: ["leads.inbound"] },
  callbacks: { label: "Callbacks overdue", opens: ["sell.callbacks"] },
  lapse: { label: "Lapse risk", opens: ["retention.lapse-risk"] },
  // The owner fixes a licence in Settings; a producer keeps theirs in the appointments vault.
  licences: { label: "Licences", opens: ["settings.root", "book.appointments"] },
};

export type HomeAction = { label: string; opens: string };

export type RoleHome = {
  sections: readonly HomeSectionKey[];
  /** In order; the strip shows the first six that have a number. */
  figures: readonly HomeFigureKey[];
  needs: readonly HomeNeedKey[];
  /** In order of preference; the header shows the first three this person can open. */
  actions: readonly HomeAction[];
};

/** At most this many figures in the strip (UI-CONSISTENCY §4: 3–6 tiles). */
export const MAX_FIGURES = 6;
/** At most this many actions in the "Your day" header. */
export const MAX_ACTIONS = 3;

export const ROLE_HOMES: Record<TenantRole, RoleHome> = {
  // The team view: setup first while it is unfinished (LA-0.3: "Setup checklist pinned until
  // complete"; the card hides itself once done), then today's close-outs and pending cases, the
  // agency's numbers, what needs a person, the diary, the floor's dialling and standings, every
  // module's figure, and callbacks.
  owner: {
    sections: ["setup", "closeOut", "pending", "figures", "needs", "appointments", "activity", "team", "shortcuts", "callbacks"],
    figures: ["dials", "reached", "rate", "appointments", "dials7", "premium", "queue"],
    needs: ["transfers", "callbacks", "lapse", "licences"],
    actions: [
      { label: "Open the floor", opens: "leads.floor" },
      { label: "Team scorecard", opens: "insight.activity" },
      { label: "Start calling", opens: "leads.dialer" },
      { label: "Settings", opens: "settings.root" },
    ],
  },
  // The licensed agent: transfers waiting and callbacks first, then the diary and pending cases.
  producer: {
    sections: ["closeOut", "pending", "figures", "needs", "callbacks", "appointments", "activity", "shortcuts"],
    figures: ["appointments", "queue", "dials", "reached", "rate", "premium"],
    needs: ["transfers", "callbacks", "lapse", "licences"],
    actions: [
      { label: "Open the inbox", opens: "leads.inbound" },
      { label: "Start calling", opens: "leads.dialer" },
      { label: "Callbacks", opens: "sell.callbacks" },
      { label: "Calendar", opens: "sell.calendar" },
    ],
  },
  // The setter: the queue and their own bookings, the dialer one click away. No money, no callbacks
  // calendar (the dialer serves their callbacks), no close-outs.
  setter: {
    sections: ["figures", "appointments", "activity", "shortcuts"],
    figures: ["queue", "booked", "appointments", "dials", "reached", "rate"],
    needs: [],
    actions: [
      { label: "Start calling", opens: "leads.dialer" },
      { label: "Calendar", opens: "sell.calendar" },
      { label: "My scorecard", opens: "insight.activity" },
    ],
  },
  // The assistant: the inbound queue and callbacks, then lists and imports.
  assistant: {
    sections: ["needs", "callbacks", "shortcuts"],
    figures: [],
    needs: ["transfers", "callbacks"],
    actions: [
      { label: "Open the inbox", opens: "leads.inbound" },
      { label: "Callbacks", opens: "sell.callbacks" },
      { label: "Import a list", opens: "leads.import" },
      { label: "Lead lists", opens: "leads.lists" },
    ],
  },
  // The bookkeeper: statements, what the carriers owe, the ledger. No call operations.
  bookkeeper: {
    sections: ["shortcuts"],
    figures: [],
    needs: [],
    actions: [
      { label: "Review statements", opens: "book.statements" },
      { label: "Discrepancies", opens: "book.discrepancies" },
      { label: "Commission ledger", opens: "book.ledger" },
      { label: "Policies", opens: "book.policies" },
    ],
  },
};

export type HomeLink = { key: string; href: string };

export type ResolvedHome = {
  sections: HomeSectionKey[];
  figures: Array<HomeLink & { key: HomeFigureKey }>;
  needs: Array<HomeLink & { key: HomeNeedKey }>;
  /** The header's buttons, primary first. */
  actions: Array<{ label: string; href: string }>;
  /** Where the next-callback chip in the header links; null when callbacks are not this person's. */
  nextCallbackHref: string | null;
  /** Which of the "today" reads this home uses, so the others are never run. */
  reads: TodayReads;
};

/** The groups of reads `getDashboardToday` can skip when the home does not show them. */
export type TodayReads = { dialing: boolean; policies: boolean; inbound: boolean; callbacks: boolean; lapse: boolean; licences: boolean; setterWeek: boolean };

/** The path of the first menu entry in `opens` that this person's menu holds, or null. */
export function firstOpenable(opens: Opens, granted: Iterable<string>, role: TenantRole): string | null {
  const features = new Set(granted);
  const items = allMenuItems();
  for (const key of opens) {
    const entry = items.find((item) => item.key === key);
    if (!entry || !entry.built) continue;
    if (entry.required_feature && !features.has(entry.required_feature)) continue;
    if (entry.required_roles && !entry.required_roles.includes(role)) continue;
    return entry.path;
  }
  return null;
}

const DIALING_FIGURES: ReadonlySet<HomeFigureKey> = new Set(["dials", "reached", "rate", "appointments", "dials7", "queue"]);

/**
 * This person's home: the role's layout with everything they cannot open taken out. A section with
 * a page of its own goes when that page is closed to them; a section without one (figures, needs)
 * goes when none of its contents survive. The shortcuts grid stays — the tile registry gates each
 * tile, and the page says so when there are none.
 */
export function resolveRoleHome(granted: Iterable<string>, role: TenantRole): ResolvedHome {
  const features = [...granted];
  const layout = ROLE_HOMES[role];
  const open = (opens: Opens) => firstOpenable(opens, features, role);

  const figures = layout.figures
    .map((key) => ({ key, href: open(HOME_FIGURES[key].opens) }))
    .filter((item): item is { key: HomeFigureKey; href: string } => item.href !== null);
  const needs = layout.needs
    .map((key) => ({ key, href: open(HOME_NEEDS[key].opens) }))
    .filter((item): item is { key: HomeNeedKey; href: string } => item.href !== null);

  const sections = layout.sections.filter((key) => {
    if (key === "figures") return figures.length > 0;
    if (key === "needs") return needs.length > 0;
    const opens = HOME_SECTIONS[key].opens;
    return opens.length === 0 || open(opens) !== null;
  });

  const seen = new Set<string>();
  const actions: Array<{ label: string; href: string }> = [];
  for (const action of layout.actions) {
    const href = open([action.opens]);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    actions.push({ label: action.label, href });
    if (actions.length === MAX_ACTIONS) break;
  }

  const shown = new Set(sections);
  const figureKeys = new Set(shown.has("figures") ? figures.map((item) => item.key) : []);
  const needKeys = new Set(shown.has("needs") ? needs.map((item) => item.key) : []);
  const nextCallbackHref = open(HOME_SECTIONS.callbacks.opens);

  return {
    sections,
    figures: shown.has("figures") ? figures : [],
    needs: shown.has("needs") ? needs : [],
    actions,
    nextCallbackHref,
    reads: {
      dialing: shown.has("activity") || shown.has("appointments") || shown.has("team") || [...figureKeys].some((key) => DIALING_FIGURES.has(key)),
      policies: figureKeys.has("premium"),
      inbound: needKeys.has("transfers"),
      callbacks: needKeys.has("callbacks") || nextCallbackHref !== null,
      lapse: needKeys.has("lapse"),
      licences: needKeys.has("licences"),
      setterWeek: figureKeys.has("booked"),
    },
  };
}

/**
 * The order split around the streamed "today" data: what renders before it, what waits for it, and
 * what renders after it. A section between two streamed ones waits with them, so the order the role
 * asked for is the order on screen.
 */
export function splitHomeSections(sections: readonly HomeSectionKey[]): { before: HomeSectionKey[]; streamed: HomeSectionKey[]; after: HomeSectionKey[] } {
  const first = sections.findIndex((key) => STREAMED_SECTIONS.has(key));
  if (first === -1) return { before: [...sections], streamed: [], after: [] };
  let last = first;
  sections.forEach((key, index) => { if (STREAMED_SECTIONS.has(key)) last = index; });
  return { before: sections.slice(0, first), streamed: sections.slice(first, last + 1), after: sections.slice(last + 1) };
}
