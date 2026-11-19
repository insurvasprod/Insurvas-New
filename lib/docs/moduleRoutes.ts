import { allMenuItems } from "../menu/definition.ts";

import type { DocModuleKey } from "./modules.ts";

/**
 * Which Docs module guide a page belongs to, so the (i) on its title can link to "How this works" (owner
 * 2026-11-17, board docs-modules.html A "Where it's linked from"). Read from the menu itself: a page belongs to its
 * menu section's module, so a page added to the menu gets its guide without another list to keep.
 */
const SECTION_MODULE: Record<string, DocModuleKey> = {
  Home: "home",
  Today: "today",
  Leads: "leads",
  Sales: "sales",
  Retention: "retention",
  Commissions: "commissions",
  "Book of business": "book",
  "Carrier sync": "carrier-sync",
  Accounting: "accounting",
  Partners: "partners",
  Compliance: "compliance",
  Reports: "reports",
};

/** Settings pages that belong to a module rather than to the agency's own setup. */
const SETTINGS_MODULE: Record<string, DocModuleKey> = {
  "/app/accounting-settings": "accounting",
  "/app/retention-settings": "retention",
  "/app/settings": "agency",
};

const ROUTES: { path: string; module: DocModuleKey }[] = [
  ...Object.entries(SETTINGS_MODULE).map(([path, module]) => ({ path, module })),
  ...allMenuItems().flatMap((item) => (SECTION_MODULE[item.sectionLabel] ? [{ path: item.path, module: SECTION_MODULE[item.sectionLabel] }] : [])),
]
  // Longest first: /app/inbound/team before /app/inbound, /app/book-setup/agent-codes before /app/book-setup.
  .sort((a, b) => b.path.length - a.path.length);

/** The module guide for a page address, or null (Docs itself, Get set up, a page outside any module). */
export function docModuleForPath(pathname: string): DocModuleKey | null {
  if (!pathname.startsWith("/app/") || pathname.startsWith("/app/docs") || pathname.startsWith("/app/setup")) return null;
  const hit = ROUTES.find((route) => pathname === route.path || pathname.startsWith(`${route.path}/`));
  return hit?.module ?? null;
}
