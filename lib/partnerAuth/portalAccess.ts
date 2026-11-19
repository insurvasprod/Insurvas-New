/**
 * Pure and client-safe: which portal pages a partner gets, by the partner's type (LA-1.1) and the
 * seat's role (LA-1.2). The menu, the pages and the API routes all ask this one function, so a page a
 * type does not get is refused on the server, not just hidden from the menu (roles board P1–P3,
 * owner 2026-11-18: "Build 1, 2 and 3").
 *
 *   Publisher  Overview · Submit transfer · Lead pipeline · Daily deal flow · Messages ·
 *              Statements · Team performance · Team access
 *   Marketing  Overview · Submit lead (short form; the full application stays open) · Lead pipeline ·
 *              Campaigns · Messages · Statements · Team access
 *   Affiliate  Overview · My links · Referrals · Refer someone · Messages · Statements — and Daily
 *              deal flow, Team performance and Team access only once the affiliate has more than
 *              one person.
 *
 * Statements, Team performance and Team access stay the partner admin's (LA-7.4, LA-1.2).
 */
import type { PartnerRole } from "./roles.ts";
import type { PartnerType } from "../partners/constants.ts";

export type PartnerPortalPage =
  | "overview"
  | "submit"
  | "refer"
  | "pipeline"
  | "deal-flow"
  | "campaigns"
  | "links"
  | "messages"
  | "statements"
  | "team-review"
  | "team"
  | "settings";

export type PartnerPortalViewer = {
  type: PartnerType;
  role: PartnerRole;
  /** More than one active person in the partner organisation. Only an affiliate's menu depends on it. */
  hasTeam: boolean;
};

const ADMIN_ONLY: ReadonlySet<PartnerPortalPage> = new Set(["statements", "team-review", "team"]);

/** The pages each type gets at all, before the admin-only rule. */
const BY_TYPE: Record<PartnerType, ReadonlySet<PartnerPortalPage>> = {
  publisher: new Set(["overview", "submit", "pipeline", "deal-flow", "messages", "statements", "team-review", "team", "settings"]),
  // The full application stays open to marketing ("optional", Module 1 §3); its menu item is the short form.
  marketing: new Set(["overview", "refer", "submit", "pipeline", "campaigns", "messages", "statements", "team", "settings"]),
  affiliate: new Set(["overview", "links", "pipeline", "refer", "messages", "statements", "settings"]),
};

/** What an affiliate with more than one person gets back. */
const AFFILIATE_TEAM_PAGES: ReadonlySet<PartnerPortalPage> = new Set(["deal-flow", "team-review", "team"]);

export function partnerPageAllowed(page: PartnerPortalPage, viewer: PartnerPortalViewer): boolean {
  if (ADMIN_ONLY.has(page) && viewer.role !== "partner_admin") return false;
  if (BY_TYPE[viewer.type]?.has(page)) return true;
  return viewer.type === "affiliate" && viewer.hasTeam && AFFILIATE_TEAM_PAGES.has(page);
}

/** A partner type read from the database, or null for a value this code does not know. */
export function asPartnerType(value: unknown): PartnerType | null {
  return value === "publisher" || value === "marketing" || value === "affiliate" ? value : null;
}

export type PartnerMenuItem = { page: PartnerPortalPage; label: string; path: string };

/** Where each page lives. */
export const PARTNER_PAGE_PATHS: Record<PartnerPortalPage, string> = {
  overview: "/partner",
  submit: "/partner/submit-lead",
  refer: "/partner/refer",
  pipeline: "/partner/pipeline",
  "deal-flow": "/partner/deal-flow",
  campaigns: "/partner/campaigns",
  links: "/partner/links",
  messages: "/partner/messages",
  statements: "/partner/payouts",
  "team-review": "/partner/team-review",
  team: "/partner/team",
  settings: "/partner/settings",
};

/** The words a type's portal speaks: a call centre sends transfers, an affiliate refers people. */
export type PartnerWords = {
  /** The menu item and button that sends a new person to the agency. */
  submitLabel: string;
  submitPath: string;
  /** The pipeline page's title. */
  pipelineTitle: string;
  /** One of the things this partner sends, and many. */
  one: string;
  many: string;
  /** How a statement counts what it pays for: "accepted transfers × your rate". */
  statementBasis: string;
};

export const PARTNER_WORDS: Record<PartnerType, PartnerWords> = {
  publisher: { submitLabel: "Submit transfer", submitPath: "/partner/submit-lead", pipelineTitle: "Lead pipeline", one: "transfer", many: "transfers", statementBasis: "Accepted transfers × your rate, less compliance rejects, credits and open disputes." },
  marketing: { submitLabel: "Submit lead", submitPath: "/partner/refer", pipelineTitle: "Lead pipeline", one: "lead", many: "leads", statementBasis: "Your leads or sales × your rate, or your revenue-share rate, as your terms say." },
  affiliate: { submitLabel: "Refer someone", submitPath: "/partner/refer", pipelineTitle: "Referrals", one: "referral", many: "referrals", statementBasis: "Each sale from your referrals × your rate." },
};

/**
 * The menu, in the board's order: the workspace, then the organisation's pages. Settings sits at the
 * foot of the rail for everyone and is not listed here.
 */
export function partnerMenu(viewer: PartnerPortalViewer): { workspace: PartnerMenuItem[]; organization: PartnerMenuItem[] } {
  const words = PARTNER_WORDS[viewer.type];
  const item = (page: PartnerPortalPage, label: string, path = PARTNER_PAGE_PATHS[page]): PartnerMenuItem => ({ page, label, path });
  const workspace: Record<PartnerType, PartnerMenuItem[]> = {
    publisher: [item("overview", "Overview"), item("submit", words.submitLabel), item("pipeline", "Lead pipeline"), item("deal-flow", "Daily deal flow"), item("messages", "Messages")],
    marketing: [item("overview", "Overview"), item("refer", words.submitLabel), item("pipeline", "Lead pipeline"), item("campaigns", "Campaigns"), item("messages", "Messages")],
    affiliate: [item("overview", "Overview"), item("links", "My links"), item("pipeline", "Referrals"), item("refer", words.submitLabel), item("deal-flow", "Daily deal flow"), item("messages", "Messages")],
  };
  const organization = [item("statements", "Statements"), item("team-review", "Team performance"), item("team", "Team access")];
  return {
    workspace: (workspace[viewer.type] ?? []).filter((entry) => partnerPageAllowed(entry.page, viewer)),
    organization: organization.filter((entry) => partnerPageAllowed(entry.page, viewer)),
  };
}
