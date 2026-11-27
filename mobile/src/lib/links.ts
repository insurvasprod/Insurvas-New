/**
 * The web's addresses as app screens. A push, a bell row and a search hit all carry web paths
 * (/app/leads/<id>); the phone opens its own screen for each. A path with no phone screen answers null, and
 * the caller opens the "works best on a computer" sheet (/computer, board J2) for it; only a tapped push
 * with no screen falls back to the Inbox. Pure, so it is shared by push and every list.
 */
export type AppHref = string;

/** Board K: the partner portal's pages as the partner app's screens. */
function partnerHrefFor(path: string): AppHref | null {
  if (/^\/partner\/(submit-lead|refer)/.test(path)) return "/partner/send";
  const lead = /^\/partner\/pipeline\/([^/?]+)/.exec(path);
  if (lead) return `/partner/lead/${lead[1]}`;
  if (/^\/partner\/pipeline/.test(path)) return "/partner/pipeline";
  if (/^\/partner\/messages/.test(path)) return "/partner/messages";
  if (/^\/partner\/payouts/.test(path)) return "/partner/account";
  if (/^\/partner\/team/.test(path)) return "/partner/team";
  if (/^\/partner(\/links)?\/?$/.test(path)) return "/partner";
  return null;
}

/**
 * A tab the person's bar does not show cannot be opened: expo-router falls back to Home. Calls, Leads and Team
 * have pushed twins (/calls-page, /leads-page, /team) for those roles, so a link always lands on its screen.
 * Without `tabs` the href is returned as is.
 */
export function reachable<H extends AppHref | null>(href: H, tabs?: readonly string[] | null): H {
  if (!href || !tabs) return href;
  if (/^\/calls(\?|$)/.test(href) && !tabs.includes("calls")) return href.replace(/^\/calls/, "/calls-page") as H;
  if (/^\/leads(\?|$)/.test(href) && !tabs.includes("leads")) return href.replace(/^\/leads/, "/leads-page") as H;
  if (/^\/teamtab(\?|$)/.test(href) && !tabs.includes("teamtab")) return href.replace(/^\/teamtab/, "/team") as H;
  return href;
}

/**
 * The signed-in person's tabs, kept by lib/nav.ts `useTabs` for the plain functions outside a component
 * (a Home tile's openWeb, a tapped push, a shortcut link). Null before the tab bar has drawn.
 */
let latestTabs: readonly string[] | null = null;
export function rememberTabs(tabs: readonly string[] | null): void {
  latestTabs = tabs;
}
export function currentTabs(): readonly string[] | null {
  return latestTabs;
}

/**
 * The app screen for a web address, reachable from the person's own tab bar when `tabs` is given. `role`
 * (the Menu, board J1) opens the pages whose phone screen depends on who you are: the Commission ledger is a
 * producer's own ledger (My pay) and, for the owner and the bookkeeper, the book with each policy's ledger.
 */
export function appHrefFor(webPath: string | null | undefined, tabs?: readonly string[] | null, role?: string | null): AppHref | null {
  return reachable(roleScreenFor(webPath, role) ?? screenFor(webPath), tabs);
}

function roleScreenFor(webPath: string | null | undefined, role: string | null | undefined): AppHref | null {
  if (!role || !webPath) return null;
  if (/^\/app\/ledger\/?$/.test(webPath.split("?")[0])) {
    if (role === "producer") return "/money/pay";
    if (role === "owner" || role === "admin" || role === "bookkeeper") return "/book";
  }
  return null;
}

function screenFor(webPath: string | null | undefined): AppHref | null {
  if (webPath?.startsWith("/partner")) return partnerHrefFor(webPath.split("?")[0]);
  if (!webPath || !webPath.startsWith("/app/")) return null;
  const [path, query = ""] = webPath.split("?");
  // Board H2 · H3: partner chat is the Inbox's Messages on the phone.
  if (/^\/app\/partner-chat/.test(path)) return "/inbox?part=messages";
  const lead = /^\/app\/leads\/([0-9a-f-]{36})/i.exec(path);
  if (lead) return `/lead/${lead[1]}`;
  if (/^\/app\/(inbound|agent-floor|today)/.test(path)) return "/calls?part=incoming";
  if (/^\/app\/(dialer|outbound)/.test(path)) return "/calls?part=dialer";
  // The Calendar is its own month screen (board C13); callbacks are the Calls tab's third part.
  if (/^\/app\/calendar/.test(path)) return "/calendar";
  // J1 (re-audit 2026-11-27): Appointments & setters is not the Calendar (that row is its own). The web page is the
  // setter ranking (appointments set, by setter); on the phone that is Team activity, where each setter's row
  // carries "(setter)" and the appointments set. Its slot view stays on the computer.
  if (/^\/app\/setters\/?$/.test(path)) return "/reports/activity";
  if (/^\/app\/callbacks/.test(path) || /callback/.test(query)) return "/calls?part=callbacks";
  if (/^\/app\/leads/.test(path)) return "/leads";
  // Release 2 · cases and deal flow.
  const caseId = /^\/app\/applications\/([0-9a-f-]{36})/i.exec(path);
  if (caseId) return `/cases/${caseId[1]}`;
  if (/^\/app\/applications\/?$/.test(path)) return "/application";
  if (/^\/app\/pending/.test(path)) return "/cases";
  if (/^\/app\/deal-flow/.test(path)) return "/deal-flow";
  // D10 (2026-11-26): Vendors & campaigns opens the phone's vendor list, each vendor its D10 card.
  if (/^\/app\/campaigns(\/vendors)?\/?$/.test(path)) return "/vendor";
  // E1 · Quick quote (2026-11-26): the phone has its own quote screen.
  if (/^\/app\/quoting/.test(path)) return "/quote";
  // Release 2 · retention.
  if (/^\/app\/reinstatement/.test(path)) return "/retention/win-back";
  // Release 2 · book of business.
  const policy = /^\/app\/policies\/carrier\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (policy) return `/book/${policy[1]}/${policy[2]}`;
  if (/^\/app\/policies\/?$/.test(path)) return "/book";
  if (/^\/app\/needs-you/.test(path)) return "/book/sync";
  if (/^\/app\/servicing(\/?$|\/[0-9a-f-]{36})/i.test(path)) return "/retention/waiting";
  const retentionCase = /^\/app\/retention\/([0-9a-f-]{36})/i.exec(path);
  if (retentionCase) return `/retention/${retentionCase[1]}`;
  if (/^\/app\/retention\/?$/.test(path)) return "/retention";
  if (/^\/app\/settings.*sessions/.test(webPath)) return "/devices";
  // Release 3 · money.
  if (/^\/app\/my-pay/.test(path)) return "/money/pay";
  const statement = /^\/app\/producer-statements\/([^/?]+)/.exec(path);
  if (statement) return `/money/statement/${statement[1]}`;
  if (/^\/app\/my-balance/.test(path)) return "/money/balance";
  if (/^\/app\/producer-payouts/.test(path)) return "/money?sheet=team";
  if (/^\/app\/payouts\/?$/.test(path)) return "/money/payouts";
  const bill = /^\/app\/vendor-bills\/([0-9a-f-]{36})/i.exec(path);
  if (bill) return `/money/bills/${bill[1]}`;
  const deposit = /^\/app\/bank\/payments\/([0-9a-f-]{36})/i.exec(path);
  if (deposit) return `/money/deposits/${deposit[1]}`;
  if (/^\/app\/pnl/.test(path)) return "/money/pnl";
  if (/^\/app\/expenses\/new/.test(path)) return "/money/expense";
  if (/^\/app\/discrepancies\/?$/.test(path)) return "/money/pay-issues";
  if (/^\/app\/accounting\/?$/.test(path)) return "/money";
  // Release 3 · team, reports and compliance.
  const scorecard = /^\/app\/producer-scorecards\/([0-9a-f-]{36})/i.exec(path);
  if (scorecard) return `/team/${scorecard[1]}`;
  if (/^\/app\/(producers|agency)(\/|$)/.test(path)) return "/teamtab";
  const publisher = /^\/app\/publishers\/([0-9a-f-]{36})/i.exec(path);
  if (publisher) return `/team/partner/${publisher[1]}`;
  if (/^\/app\/sales-performance/.test(path)) return "/reports/sales";
  if (/^\/app\/(activity|scorecard)\/?$/.test(path)) return "/reports/activity";
  if (/^\/app\/retention-scorecard/.test(path)) return "/reports/retention";
  if (/^\/app\/callback-results/.test(path)) return "/reports/callbacks";
  if (/^\/app\/partner-quality/.test(path)) return "/reports/partners";
  if (/^\/app\/reports\/?$/.test(path)) return "/reports";
  const complaint = /^\/app\/complaints\/([0-9a-f-]{36})/i.exec(path);
  if (complaint) return `/compliance/complaints/${complaint[1]}`;
  if (/^\/app\/complaints\/?$/.test(path)) return "/compliance/complaints";
  if (/^\/app\/consent/.test(path)) return "/compliance/consent";
  if (/^\/app\/tcpa/.test(path)) return "/compliance/check-number";
  if (/^\/app\/appointments/.test(path)) return "/compliance/licences";
  // Release 3 · setup and vendors.
  if (/^\/app\/setup\/?$/.test(path)) return "/setup";
  const vendor = /^\/app\/campaigns\/vendors\/([0-9a-f-]{36})/i.exec(path);
  if (vendor) return `/vendor/${vendor[1]}`;
  if (/^\/app\/dashboard/.test(path)) return "/";
  return null;
}

/** A mail to the person's own address with a web link to open at their desk (board J2). */
export function linkMail(to: string | null | undefined, name: string, url: string): string {
  const subject = encodeURIComponent(`${name} in Insurvas`);
  const body = encodeURIComponent(`Open this on your computer:\n${url}`);
  return `mailto:${to ? encodeURIComponent(to) : ""}?subject=${subject}&body=${body}`;
}
