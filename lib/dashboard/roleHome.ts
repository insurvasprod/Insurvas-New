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
 *   shortcuts     the tile registry's "Your modules" list (lib/dashboard/tiles.ts)
 *   setup         the setup checklist
 *   money         money and retention (LA-4.18, Sixteen #15): the page's one strip on a money
 *                 profile, a list beside the day's figures otherwise (see DASHBOARD_PROFILES)
 *   upgrade       the one upgrade tile (Sixteen #15), in a fixed place under the strip
 *   flow          the lead-to-money map and its biggest leak (redesign 2026-10-25), from the Daily
 *                 deal flow funnel; it reads for itself, so it is never streamed with "today"
 */
export type HomeSectionKey = "closeOut" | "pending" | "figures" | "needs" | "callbacks" | "appointments" | "activity" | "team" | "shortcuts" | "setup" | "money" | "upgrade" | "flow";

/** The figures the strip can hold. Each is a number `getDashboardToday` already reads. */
export type HomeFigureKey = "dials" | "reached" | "rate" | "appointments" | "dials7" | "premium" | "queue" | "booked" | "shown" | "showRate" | "closeOut";

/**
 * The money and retention figures (LA-4.18; the four of Sixteen #15's money dashboard are the first
 * four). Each opens the page that lists its rows (LA-4.20), with the view that holds them.
 */
export type HomeMoneyKey = "statements" | "discrepancies" | "owed" | "exposure" | "lapse" | "persistency";

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
  // The close-out strip also lives on Team activity; its route admits owner and producer,
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
  money: { opens: [] },
  // Only someone who can buy sees an upgrade prompt (Sixteen #15): only the owner's layout lists
  // this section. (Settings opens for every role since LA-8.1; Plan & billing inside it is the owner's.)
  upgrade: { opens: ["settings.root"] },
  // The same gate as the Daily deal flow page and its funnel route: the feature, owner or producer.
  flow: { opens: ["sell.deal-flow"] },
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
  shown: { label: "Shown · 7 days", opens: ["insight.activity"] },
  // LA-2.12 / Sixteen #12: a show rate never travels without its coverage.
  showRate: { label: "Show rate · 7 days", opens: ["insight.activity"] },
  // The reader's own close-out rate (Sixteen #12): the close-out strip on Activity lists the rest.
  closeOut: { label: "Your close-out · 30 days", opens: ["insight.activity"] },
};

/**
 * `query` is the view of the page that holds the rows behind the figure, added to whichever entry
 * of `opens` is the link (keyed by menu key, since the two pages name their views differently).
 */
export const HOME_MONEY: Record<HomeMoneyKey, { label: string; opens: Opens; query?: Readonly<Record<string, string>> }> = {
  statements: { label: "Statements to review", opens: ["book.statements"] },
  discrepancies: { label: "Discrepancies found", opens: ["book.discrepancies"] },
  owed: { label: "Owed, not paid", opens: ["book.discrepancies"] },
  exposure: { label: "Chargeback exposure", opens: ["book.ledger"], query: { "book.ledger": "?view=expected" } },
  lapse: { label: "Lapse risk", opens: ["retention.lapse-risk"], query: { "retention.lapse-risk": "?view=signals" } },
  persistency: { label: "Persistency · month 9", opens: ["insight.book-scorecards"], query: { "insight.book-scorecards": "?view=persistency" } },
};

/**
 * Sixteen Open Questions #15: the dashboard is composed per plan. Each plan declares a profile:
 * which money tiles, in what order, how few is too few, and the primary working screen to land on
 * instead when it is too few.
 *
 * Plans are data the Super Admin edits, and the plans table has no profile column (adding one is a
 * migration this pass does not apply), so the declaration lives here, keyed by plan code. A plan not
 * listed takes the profile its features imply: a plan with no call operations at all (neither
 * inbound transfers nor outbound dialling) is a money plan. So the $99 Ledger tier (`basic`) is a
 * money dashboard by name, and a new money-only plan is one by its features.
 *
 * The bookkeeper is on the money profile whatever the plan: their home was shortcuts only.
 */
export type DashboardProfileKey = "operations" | "money";

export const PLAN_PROFILES: Readonly<Record<string, DashboardProfileKey>> = { basic: "money" };

export const DASHBOARD_PROFILES: Record<DashboardProfileKey, { money: readonly HomeMoneyKey[] | null; minTiles: number; landing: Opens }> = {
  // The role's own money line (ROLE_HOMES[role].money), as a list beside the day's figures.
  operations: { money: null, minTiles: 0, landing: [] },
  // Four tiles as the page's one strip: statements awaiting review, discrepancies found, commission
  // owed but unpaid, chargeback exposure. Fewer than three (UI-CONSISTENCY §4's smallest strip)
  // and the dashboard is skipped for the plan's primary working screen.
  money: { money: ["statements", "discrepancies", "owed", "exposure"], minTiles: 3, landing: ["book.statements", "book.ledger", "book.policies"] },
};

/** Which profile this plan and role get. */
export function dashboardProfile(plan: { code: string | null; features: Iterable<string> } | null | undefined, role: TenantRole): DashboardProfileKey {
  const forced = ROLE_HOMES[role].profile;
  if (forced) return forced;
  if (!plan) return "operations";
  const declared = plan.code ? PLAN_PROFILES[plan.code] : undefined;
  if (declared) return declared;
  const features = new Set(plan.features);
  return features.size > 0 && !features.has("inbound_transfers") && !features.has("outbound_dialing") ? "money" : "operations";
}

/**
 * The one upgrade tile (Sixteen #15), the single bounded exception to "absent, not greyed": shown
 * only when the plan lacks the feature, the agent's own data makes the case (checked at render: the
 * count must be above zero), and the reader can buy. The rows behind the count open on a page the
 * plan does have.
 */
export const UPGRADE_TILE = { feature: "chargeback_radar", featureOpens: "retention.lapse-risk", rowsOpen: ["book.ledger"], rowsQuery: "?view=expected" } as const;

export const HOME_NEEDS: Record<HomeNeedKey, { label: string; opens: Opens }> = {
  transfers: { label: "Transfers waiting", opens: ["leads.inbound"] },
  callbacks: { label: "Callbacks overdue", opens: ["sell.callbacks"] },
  lapse: { label: "Lapse risk", opens: ["retention.lapse-risk"] },
  // The appointments vault first: the owner edits there and a producer keeps theirs there. Settings
  // is every role's since LA-8.1, so it is only the fallback (its States & licences tab is the
  // owner's, behind the same appointment_vault feature).
  licences: { label: "Licences", opens: ["book.appointments", "settings.root"] },
};

export type HomeAction = { label: string; opens: string };

export type RoleHome = {
  sections: readonly HomeSectionKey[];
  /** In order; the strip shows the first six that have a number. */
  figures: readonly HomeFigureKey[];
  needs: readonly HomeNeedKey[];
  /** The money and retention line on the operations profile, in order. Scoped to the reader by money.ts. */
  money: readonly HomeMoneyKey[];
  /** In order of preference; the header shows the first three this person can open. */
  actions: readonly HomeAction[];
  /** A profile this role always gets, whatever the plan. */
  profile?: DashboardProfileKey;
};

/** At most this many figures in the strip (UI-CONSISTENCY §4: 3–6 tiles). */
export const MAX_FIGURES = 6;
/** At most this many actions in the "Your day" header. */
export const MAX_ACTIONS = 3;

export const ROLE_HOMES: Record<TenantRole, RoleHome> = {
  // The team view: setup first while it is unfinished (LA-0.3: "Setup checklist pinned until
  // complete"; the card hides itself once done), then today's close-outs and pending cases, the
  // agency's numbers, what needs a person, the diary, the floor's dialling and standings, every
  // module's figure, and callbacks. The upgrade tile sits directly under the strip, its fixed place
  // (Sixteen #15); the money and retention line (LA-4.18) follows what needs a person.
  owner: {
    // Pending cases follow the streamed sections, so the figure strip sits directly under the header
    // (UI-CONSISTENCY §4); only the pinned setup checklist and the close-out strip (LA-2.12) go above.
    sections: ["setup", "closeOut", "flow", "figures", "upgrade", "needs", "money", "appointments", "activity", "team", "pending", "shortcuts", "callbacks"],
    figures: ["dials", "reached", "rate", "closeOut", "appointments", "premium", "queue", "dials7"],
    needs: ["transfers", "callbacks", "lapse", "licences"],
    money: ["owed", "statements", "exposure", "lapse", "persistency"],
    actions: [
      { label: "Open the team", opens: "leads.floor" },
      { label: "Team scorecard", opens: "insight.activity" },
      { label: "Start calling", opens: "leads.dialer" },
      { label: "Settings", opens: "settings.root" },
    ],
  },
  // The licensed agent: transfers waiting and callbacks first, then the diary and pending cases.
  // Their money and retention line is their own book (money.ts scopes it). Lapse risk moved there
  // from "needs", whose count is the agency's open signals, not theirs.
  producer: {
    sections: ["closeOut", "flow", "figures", "needs", "money", "callbacks", "appointments", "activity", "pending", "shortcuts"],
    figures: ["appointments", "closeOut", "queue", "dials", "reached", "rate", "premium"],
    needs: ["transfers", "callbacks", "licences"],
    money: ["exposure", "lapse", "persistency"],
    actions: [
      { label: "Open Inbound", opens: "leads.inbound" },
      { label: "Start calling", opens: "leads.dialer" },
      { label: "Callbacks", opens: "sell.callbacks" },
      { label: "Calendar", opens: "sell.calendar" },
    ],
  },
  // The setter: the queue and their own bookings, the dialer one click away. No money, no callbacks
  // calendar (the dialer serves their callbacks), no close-outs.
  // Their own booked, shown and show rate with its coverage (LA-2.12), then today's appointments.
  setter: {
    sections: ["figures", "appointments", "activity", "shortcuts"],
    figures: ["booked", "shown", "showRate", "appointments", "queue", "dials"],
    needs: [],
    money: [],
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
    money: [],
    actions: [
      { label: "Open Inbound", opens: "leads.inbound" },
      { label: "Callbacks", opens: "sell.callbacks" },
      { label: "Import a list", opens: "leads.import" },
      { label: "Lead lists", opens: "leads.lists" },
    ],
  },
  // The bookkeeper: statements, what the carriers owe, the ledger. No call operations. The money
  // profile's four tiles (Sixteen #15: "the bookkeeper role, which today gets only shortcuts").
  bookkeeper: {
    sections: ["money", "shortcuts"],
    figures: [],
    needs: [],
    money: [],
    profile: "money",
    actions: [
      { label: "Review statements", opens: "book.statements" },
      { label: "Discrepancies", opens: "book.discrepancies" },
      { label: "Commission ledger", opens: "book.ledger" },
      { label: "Policies", opens: "book.policies" },
    ],
  },
  // LA-5.8 · the retention rep: their own queue, the cases with a deadline, the board of what has
  // already slipped, and their own scorecard. No money tiles — the exposure on a card is the only
  // figure the role sees, and it is on the card.
  retention: {
    sections: ["shortcuts"],
    figures: [],
    needs: [],
    money: [],
    actions: [
      { label: "Save queue", opens: "retention.save-queue" },
      { label: "Reinstatement", opens: "retention.winback" },
      { label: "Lapse risk", opens: "retention.lapse-risk" },
      { label: "My scorecard", opens: "retention.scorecard" },
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
  /** Sixteen #15: the plan's dashboard profile for this reader. */
  profile: DashboardProfileKey;
  /** The money and retention figures this person can open, in order, each with the view of its rows. */
  money: Array<HomeLink & { key: HomeMoneyKey }>;
  /** The page's one strip on a money profile; a list beside the day's strip otherwise. */
  moneyAs: "strip" | "list";
  /** Too few tiles for the profile: the plan's primary working screen to land on instead, else null. */
  landing: string | null;
  /** The upgrade tile's two links, when the reader may be offered it (the data decides the rest). */
  upgrade: { featureHref: string; rowsHref: string } | null;
};

/** The groups of reads `getDashboardToday` can skip when the home does not show them. */
export type TodayReads = { dialing: boolean; policies: boolean; inbound: boolean; callbacks: boolean; lapse: boolean; licences: boolean; setterWeek: boolean; closeOut: boolean };

/** The plan as the role home needs it: the code, what it grants, and what staff switched off. */
export type HomePlan = { code: string | null; features: readonly string[]; disabled?: readonly string[] };

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
 *
 * `plan` is the raw plan (before kill switches): it picks the dashboard profile and decides the
 * upgrade tile. `granted` stays the effective list every link is gated by.
 */
export function resolveRoleHome(granted: Iterable<string>, role: TenantRole, plan?: HomePlan | null): ResolvedHome {
  const features = [...granted];
  const layout = ROLE_HOMES[role];
  const open = (opens: Opens) => firstOpenable(opens, features, role);
  const profile = dashboardProfile(plan, role);
  const moneyProfile = DASHBOARD_PROFILES[profile];

  const figures = layout.figures
    .map((key) => ({ key, href: open(HOME_FIGURES[key].opens) }))
    .filter((item): item is { key: HomeFigureKey; href: string } => item.href !== null);
  const needs = layout.needs
    .map((key) => ({ key, href: open(HOME_NEEDS[key].opens) }))
    .filter((item): item is { key: HomeNeedKey; href: string } => item.href !== null);
  const money = (moneyProfile.money ?? layout.money)
    .map((key) => ({ key, href: moneyHref(key, features, role) }))
    .filter((item): item is { key: HomeMoneyKey; href: string } => item.href !== null);

  // The upgrade tile: the plan lacks the feature (and staff did not merely switch it off, which is
  // not something to sell), the reader can buy, and the rows behind the count are on a page they
  // have. Without a plan to read, nothing is offered.
  const lacks = plan ? !plan.features.includes(UPGRADE_TILE.feature) && !(plan.disabled ?? []).includes(UPGRADE_TILE.feature) : false;
  const featureEntry = allMenuItems().find((item) => item.key === UPGRADE_TILE.featureOpens);
  const rowsPath = open(UPGRADE_TILE.rowsOpen);
  const upgrade = lacks && featureEntry && rowsPath && open(HOME_SECTIONS.upgrade.opens) ? { featureHref: featureEntry.path, rowsHref: `${rowsPath}${UPGRADE_TILE.rowsQuery}` } : null;

  // On a money profile the money tiles are the page's one strip: they take the figures' place.
  const order: HomeSectionKey[] = [];
  for (const key of layout.sections) {
    const placed: HomeSectionKey = moneyProfile.money && key === "figures" ? "money" : key;
    if (!order.includes(placed)) order.push(placed);
  }
  if (moneyProfile.money && !order.includes("money")) order.splice(order[0] === "setup" ? 1 : 0, 0, "money");

  const sections = order.filter((key) => {
    if (key === "figures") return figures.length > 0;
    if (key === "needs") return needs.length > 0;
    if (key === "money") return money.length > 0;
    if (key === "upgrade") return upgrade !== null;
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
      setterWeek: figureKeys.has("booked") || figureKeys.has("shown") || figureKeys.has("showRate"),
      closeOut: figureKeys.has("closeOut"),
    },
    profile,
    money: shown.has("money") ? money : [],
    moneyAs: moneyProfile.money ? "strip" : "list",
    landing: moneyProfile.money && money.length < moneyProfile.minTiles ? open(moneyProfile.landing) : null,
    upgrade: shown.has("upgrade") ? upgrade : null,
  };
}

/** A money figure's link: the first of its pages this person can open, with the view of its rows. */
export function moneyHref(key: HomeMoneyKey, granted: Iterable<string>, role: TenantRole): string | null {
  const entry = HOME_MONEY[key];
  for (const menuKey of entry.opens) {
    const path = firstOpenable([menuKey], granted, role);
    if (path) return `${path}${entry.query?.[menuKey] ?? ""}`;
  }
  return null;
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
