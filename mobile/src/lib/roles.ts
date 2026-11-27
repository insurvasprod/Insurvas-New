/**
 * Five tabs by role (board section 00 and kit.js TABS).
 *
 *   producer, assistant                            Home · Calls · Leads · Inbox · Menu
 *   owner, admin                                   Home · Team · Money · Inbox · Menu
 *   manager                                        Home · Team · Calls · Inbox · Menu (B8: Money gives way to Calls)
 *   setter                                         Home · Calls (the dialer) · Inbox · Menu
 *     (board B3 draws Home · Dialer · Callbacks · Inbox · Menu, but GET /api/app/callbacks and the web's
 *      Callbacks page both admit owner, producer and assistant only, so a setter's Callbacks tab would
 *      only ever answer 403. It waits on the owner opening callbacks to setters; see callsPartsFor.)
 *   bookkeeper                                     Home · Money · Book · Inbox · Menu
 *   retention                                      Home · Cases (the ladder) · Book · Inbox · Menu
 *
 * Settled decision 7: an owner who also sells can switch to the producer tabs (Settings, board J3).
 * The Team and Money tab files are named apart from the /team and /money stack screens. These only
 * shape what the app shows; every route is still gated by the server.
 */
export type TabKey = "index" | "calls" | "leads" | "ladder" | "policies" | "teamtab" | "moneytab" | "inbox" | "menu";

/** `solo`: an individual plan with no other caller (GET /api/app/me, lib/tenantTeam/solo.ts on the server). */
export type TabOptions = { producerTabs?: boolean; features?: readonly string[] | null; solo?: boolean };

export function tabsFor(role: string | undefined | null, options: TabOptions = {}): TabKey[] {
  return roleTabs(role, options).filter((t) => planHasTab(t, role, options.features));
}

/** The plan sells (calls or leads). Unknown features count as selling: an older server hides nothing. */
export function planSells(features: readonly string[] | null | undefined): boolean {
  return !features || features.includes("lead_import") || Object.values(PART_FEATURE).some((f) => features.includes(f));
}

/**
 * Owner 2026-11-26: a solo owner has no team to watch, so the bar is their own work. A plan that sells gets the
 * producer's Calls · Leads; a book-only plan (Ledger) gets the bookkeeper's Money · Book, since Calls and Leads
 * would be empty there.
 */
function soloOwnerTabs(features: readonly string[] | null | undefined): TabKey[] {
  return planSells(features) ? ["index", "calls", "leads", "inbox", "menu"] : ["index", "moneytab", "policies", "inbox", "menu"];
}

function roleTabs(role: string | undefined | null, options: TabOptions): TabKey[] {
  switch (role) {
    case "setter": return ["index", "calls", "inbox", "menu"];
    case "bookkeeper": return ["index", "moneytab", "policies", "inbox", "menu"];
    case "retention": return ["index", "ladder", "policies", "inbox", "menu"];
    case "manager": return ["index", "teamtab", "calls", "inbox", "menu"];
    case "owner":
    case "admin":
      if (options.solo) return soloOwnerTabs(options.features);
      return options.producerTabs ? ["index", "calls", "leads", "inbox", "menu"] : ["index", "teamtab", "moneytab", "inbox", "menu"];
    default: return ["index", "calls", "leads", "inbox", "menu"];
  }
}

/**
 * The plan's side (the web menu's required_feature): Leads needs lead_import, Calls needs one of its parts,
 * the retention ladder chargeback_radar, Book book_of_business. Unknown features (an older server) hide nothing.
 */
const PART_FEATURE = { incoming: "inbound_transfers", dialer: "outbound_dialing", callbacks: "callback_calendar" } as const;
function planHasTab(tab: TabKey, role: string | undefined | null, features: readonly string[] | null | undefined): boolean {
  if (!features) return true;
  switch (tab) {
    case "leads": return features.includes("lead_import");
    case "calls": return callsPartsFor(role, features).length > 0;
    case "ladder": return features.includes("chargeback_radar");
    case "policies": return features.includes("book_of_business");
    default: return true;
  }
}

/** Which parts of Calls a role may open, matching the server's gates, less what the plan does not include. */
export function callsPartsFor(role: string | undefined | null, features?: readonly string[] | null): ("incoming" | "dialer" | "callbacks")[] {
  const parts: ("incoming" | "dialer" | "callbacks")[] = role === "setter" ? ["dialer"] : role === "assistant" ? ["incoming", "callbacks"] : ["incoming", "dialer", "callbacks"];
  return features ? parts.filter((p) => features.includes(PART_FEATURE[p])) : parts;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner", admin: "Agency admin", manager: "Manager", producer: "Producer", assistant: "Assistant", bookkeeper: "Bookkeeper", setter: "Setter", retention: "Retention rep",
};
