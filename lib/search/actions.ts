import { allMenuItems } from "../menu/definition.ts";
import type { TenantRole } from "../tenantAuth/roles.ts";

/**
 * Things to DO from the search box (2026-10-09): "book an appointment", "import a list". Search
 * already finds records and pages; this is the third kind of answer, the one a command bar exists
 * for.
 *
 * Each action belongs to a menu item and is offered only when that item is — same plan feature,
 * same roles — so search never suggests something the person cannot open. An action is a
 * navigation to the screen that does the thing (with the opener's query parameter where the screen
 * has one); it never performs a write itself.
 *
 * Pure: no server imports, so the rules are unit-tested (lib/search/actions.test.mjs).
 */
export type WorkspaceAction = {
  key: string;
  title: string;
  /** Where it happens, shown under the title. */
  meta: string;
  href: string;
  /** The menu item whose feature and roles gate this action. */
  menuKey: string;
  /**
   * A narrower role gate than the menu item's, where the action is one part of a screen others may
   * open too: Settings is every role's since LA-8.1, but only the owner invites (Team & access).
   */
  roles?: readonly TenantRole[];
  /** Other words people type for it. */
  keywords: readonly string[];
};

export const WORKSPACE_ACTIONS: readonly WorkspaceAction[] = [
  { key: "serve-next", title: "Serve the next lead", meta: "Dialer", href: "/app/dialer", menuKey: "leads.dialer", keywords: ["call", "dial", "next lead", "start calling"] },
  { key: "import-list", title: "Import a lead list", meta: "List import", href: "/app/import", menuKey: "leads.import", keywords: ["upload", "csv", "import leads", "new list"] },
  { key: "claim-transfer", title: "Take the next caller", meta: "Inbound", href: "/app/inbound", menuKey: "leads.inbound", keywords: ["claim", "transfer", "inbound", "pick up"] },
  { key: "book-callback", title: "Book a callback", meta: "Callbacks", href: "/app/callbacks", menuKey: "sell.callbacks", keywords: ["callback", "call back", "reschedule"] },
  { key: "book-appointment", title: "Book an appointment", meta: "Calendar", href: "/app/calendar", menuKey: "sell.calendar", keywords: ["appointment", "schedule", "meeting", "book"] },
  { key: "add-lead", title: "Add a lead", meta: "Lead workspace", href: "/app/leads", menuKey: "leads.workspace", keywords: ["new lead", "create lead", "contact"] },
  { key: "start-application", title: "Start an application", meta: "From a lead's page", href: "/app/leads", menuKey: "sell.applications", keywords: ["application", "app", "submit", "sell"] },
  { key: "new-campaign", title: "New campaign", meta: "Vendors & campaigns", href: "/app/campaigns", menuKey: "leads.campaigns", keywords: ["campaign", "vendor", "buy leads"] },
  { key: "add-partner", title: "Add a partner", meta: "Partners", href: "/app/publishers", menuKey: "partners.publishers", keywords: ["partner", "publisher", "affiliate", "lead source"] },
  { key: "import-statement", title: "Import a carrier statement", meta: "Statements", href: "/app/statements?import=1", menuKey: "book.statements", keywords: ["statement", "commission", "carrier file", "upload"] },
  { key: "check-number", title: "Check a number before calling", meta: "TCPA / DNC", href: "/app/tcpa", menuKey: "compliance.tcpa", keywords: ["dnc", "do not call", "suppression", "tcpa", "check"] },
  { key: "invite-teammate", title: "Invite a teammate", meta: "Settings › Team & access", href: "/app/settings#team-access", menuKey: "settings.root", roles: ["owner"], keywords: ["invite", "team", "user", "agent", "seat"] },
] as const;

/** Suggested when the search box opens empty, in this order. */
const SUGGESTED = ["serve-next", "claim-transfer", "book-callback", "book-appointment", "import-list", "add-lead"] as const;

function allowedKeys(granted: ReadonlySet<string>, role: TenantRole) {
  return new Set(
    allMenuItems()
      .filter((item) => !item.required_feature || granted.has(item.required_feature))
      .filter((item) => !item.required_roles || item.required_roles.includes(role))
      .map((item) => item.key),
  );
}

/** How well `term` names an action: 3 the title starts with it, 2 a word or keyword does, 1 it appears, 0 not at all. */
function score(action: WorkspaceAction, term: string) {
  const needle = term.toLowerCase();
  const title = action.title.toLowerCase();
  if (title.startsWith(needle)) return 3;
  const words = [...title.split(/\s+/), ...action.keywords.map((keyword) => keyword.toLowerCase())];
  if (words.some((word) => word.startsWith(needle))) return 2;
  if (title.includes(needle) || action.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) return 1;
  return 0;
}

/** The actions this person may take whose words match `term`, best first (at most `limit`). */
export function matchActions(term: string, granted: Iterable<string>, role: TenantRole, limit = 4): WorkspaceAction[] {
  const trimmed = term.replace(/\s+/g, " ").trim();
  if (trimmed.length < 2) return [];
  const allowed = allowedKeys(new Set(granted), role);
  return WORKSPACE_ACTIONS
    .filter((action) => allowed.has(action.menuKey) && (!action.roles || action.roles.includes(role)))
    .map((action) => ({ action, rank: score(action, trimmed) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((entry) => entry.action);
}

/** What the box offers before anything is typed: the everyday actions this person may take. */
export function suggestedActions(granted: Iterable<string>, role: TenantRole, limit = 5): WorkspaceAction[] {
  const allowed = allowedKeys(new Set(granted), role);
  return SUGGESTED
    .map((key) => WORKSPACE_ACTIONS.find((action) => action.key === key))
    .filter((action): action is WorkspaceAction => Boolean(action && allowed.has(action.menuKey) && (!action.roles || action.roles.includes(role))))
    .slice(0, limit);
}
